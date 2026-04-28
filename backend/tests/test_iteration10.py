"""
Iteration 10 tests:
P0 - /api/spawn/current and /api/spawn/catch return image_data_url, no DocumentTooLarge
P0 - group_spawns docs stay under 16MB after multiple polls
P1 - /api/admin/camper-positions
P2 - /api/admin/spawn-config persists scheduled_windows
P2 - is_within_active_hours respects scheduled_windows (smoke via PUT during active window)
"""
import os
import time
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Read directly from frontend/.env as a fallback
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
                    break
    except Exception:
        pass

ADMIN_USER = "admin"
ADMIN_PASS = "Camp1993"
MOCK_LAT = 40.6396
MOCK_LNG = -73.6665


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/admin/auth/login",
                      json={"username": ADMIN_USER, "password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="session")
def camper_token():
    # Find a camper from group B01 (or any group)
    g = requests.get(f"{BASE_URL}/api/groups", timeout=15)
    assert g.status_code == 200
    groups = g.json()
    assert groups, "No groups found"
    code = "B01" if any((x.get("group_code") == "B01") for x in groups) else groups[0]["group_code"]
    cr = requests.get(f"{BASE_URL}/api/groups/{code}/campers", timeout=15)
    assert cr.status_code == 200
    body = cr.json()
    if isinstance(body, dict):
        campers = body.get("campers") or []
    else:
        campers = body or []
    assert campers, "No campers in group"
    cid = campers[0]["id"]
    lr = requests.post(f"{BASE_URL}/api/camper/login", json={"camper_id": cid}, timeout=15)
    assert lr.status_code == 200, f"camper login failed: {lr.status_code} {lr.text}"
    return lr.json()["access_token"]


@pytest.fixture(scope="session")
def camper_headers(camper_token):
    return {"Authorization": f"Bearer {camper_token}"}


# -------------- P0 spawn tests --------------
class TestP0Spawns:
    def test_spawn_current_polled_5x_no_500(self, camper_headers):
        last_spawns = None
        for i in range(5):
            r = requests.get(
                f"{BASE_URL}/api/spawn/current?lat={MOCK_LAT}&lng={MOCK_LNG}",
                headers=camper_headers, timeout=15)
            assert r.status_code == 200, f"poll {i} failed: {r.status_code} {r.text[:300]}"
            data = r.json()
            assert "spawns" in data
            last_spawns = data["spawns"]
            time.sleep(1.2)
        # By the 5th poll there should be at least one active spawn (max 6 in pool, 15-45s interval)
        assert isinstance(last_spawns, list)

    def test_spawn_current_image_data_url_populated(self, camper_headers):
        # Poll until at least one spawn appears (up to 12 tries)
        spawns = []
        for _ in range(12):
            r = requests.get(
                f"{BASE_URL}/api/spawn/current?lat={MOCK_LAT}&lng={MOCK_LNG}",
                headers=camper_headers, timeout=15)
            assert r.status_code == 200
            spawns = r.json().get("spawns") or []
            if spawns:
                break
            time.sleep(2)
        assert spawns, "No spawn appeared in 24s of polling"
        for s in spawns:
            poke = s.get("pokemon") or {}
            url = poke.get("image_data_url") or ""
            assert url and (url.startswith("data:") or url.startswith("http")), \
                f"image_data_url missing/invalid for {poke.get('name')}: {url[:60]}"

    def test_spawn_current_polled_10x_no_doctoo_large(self, camper_headers):
        for i in range(10):
            r = requests.get(
                f"{BASE_URL}/api/spawn/current?lat={MOCK_LAT}&lng={MOCK_LNG}",
                headers=camper_headers, timeout=15)
            assert r.status_code == 200, f"poll {i}: {r.status_code} {r.text[:200]}"
            time.sleep(0.6)

    def test_spawn_catch_returns_image_url(self, camper_headers):
        # Get first spawn
        spawn = None
        for _ in range(12):
            r = requests.get(
                f"{BASE_URL}/api/spawn/current?lat={MOCK_LAT}&lng={MOCK_LNG}",
                headers=camper_headers, timeout=15)
            spawns = r.json().get("spawns") or []
            if spawns:
                spawn = spawns[0]
                break
            time.sleep(2)
        if not spawn:
            pytest.skip("No spawn available to catch")
        spawn_id = spawn["spawn_id"]

        # Try up to 10 catch attempts (use camper close to spawn coords)
        last_resp = None
        for attempt in range(10):
            cr = requests.post(
                f"{BASE_URL}/api/spawn/catch",
                json={"spawn_id": spawn_id, "latitude": spawn.get("latitude") or MOCK_LAT,
                      "longitude": spawn.get("longitude") or MOCK_LNG},
                headers=camper_headers, timeout=15)
            # 200/400/402 all are valid app-level responses; 500 is the bug
            assert cr.status_code != 500, f"server error on catch: {cr.text[:300]}"
            if cr.status_code == 402:
                pytest.skip("Out of balls — cannot finish catch test")
            if cr.status_code == 400:
                # spawn changed/expired — that's fine, no 500
                last_resp = cr.json()
                break
            assert cr.status_code == 200, f"catch failed: {cr.status_code} {cr.text[:200]}"
            data = cr.json()
            last_resp = data
            if data.get("success"):
                # On success the pokemon image must be re-attached
                p = data.get("pokemon") or {}
                url = p.get("image_data_url") or ""
                assert url and (url.startswith("data:") or url.startswith("http")), \
                    f"caught pokemon missing image_data_url: {url[:60]}"
                break
            if data.get("fled"):
                break
        assert last_resp is not None


# -------------- P1 admin camper positions --------------
class TestP1CamperPositions:
    def test_camper_positions_requires_admin(self):
        r = requests.get(f"{BASE_URL}/api/admin/camper-positions", timeout=15)
        assert r.status_code in (401, 403)

    def test_camper_positions_shape(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/camper-positions",
                         headers=admin_headers, timeout=15)
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        data = r.json()
        assert "count" in data and "positions" in data
        assert isinstance(data["positions"], list)
        assert data["count"] == len(data["positions"])
        for p in data["positions"]:
            for k in ["camper_id", "first_name", "last_name", "group_code",
                      "latitude", "longitude", "updated_at"]:
                assert k in p, f"missing key {k} in position"
            assert isinstance(p["latitude"], (int, float))
            assert isinstance(p["longitude"], (int, float))


# -------------- P2 scheduled_windows --------------
class TestP2ScheduledWindows:
    def _get_cfg(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/spawn-config",
                         headers=admin_headers, timeout=15)
        assert r.status_code == 200
        return r.json()

    def _put_cfg(self, admin_headers, cfg):
        r = requests.put(f"{BASE_URL}/api/admin/spawn-config",
                         json=cfg, headers=admin_headers, timeout=15)
        assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
        return r.json()

    def test_scheduled_windows_persists(self, admin_headers):
        original = self._get_cfg(admin_headers)
        try:
            now = datetime.now(timezone.utc).replace(microsecond=0)
            windows = [
                {
                    "label": "TEST_window_1",
                    "start": (now - timedelta(hours=1)).isoformat(),
                    "end": (now + timedelta(hours=1)).isoformat(),
                },
                {
                    "label": "TEST_window_2_future",
                    "start": (now + timedelta(days=1)).isoformat(),
                    "end": (now + timedelta(days=1, hours=2)).isoformat(),
                },
            ]
            cfg = dict(original)
            cfg["scheduled_windows"] = windows
            saved = self._put_cfg(admin_headers, cfg)
            assert saved.get("scheduled_windows"), "PUT did not return scheduled_windows"
            assert len(saved["scheduled_windows"]) == 2

            re = self._get_cfg(admin_headers)
            sw = re.get("scheduled_windows") or []
            assert len(sw) == 2
            labels = [w.get("label") for w in sw]
            assert "TEST_window_1" in labels
            assert "TEST_window_2_future" in labels
        finally:
            # Restore original (clear scheduled_windows)
            cfg2 = dict(original)
            cfg2["scheduled_windows"] = original.get("scheduled_windows") or []
            self._put_cfg(admin_headers, cfg2)

    def test_active_window_overrides_off_hours(self, admin_headers, camper_headers):
        """Set active_hours to 0..0 (off) but a window covering NOW.
        spawn/current should still be enabled=True."""
        original = self._get_cfg(admin_headers)
        try:
            now = datetime.now(timezone.utc).replace(microsecond=0)
            cfg = dict(original)
            cfg["active_hours_start"] = 0
            cfg["active_hours_end"] = 0  # equal => no daily window
            cfg["scheduled_windows"] = [
                {
                    "label": "TEST_now_window",
                    "start": (now - timedelta(minutes=10)).isoformat(),
                    "end": (now + timedelta(minutes=30)).isoformat(),
                }
            ]
            self._put_cfg(admin_headers, cfg)

            # Wait briefly to allow new spawn cycle
            time.sleep(1)
            r = requests.get(
                f"{BASE_URL}/api/spawn/current?lat={MOCK_LAT}&lng={MOCK_LNG}",
                headers=camper_headers, timeout=15)
            assert r.status_code == 200
            # When active window is in effect spawns should be enabled (next_spawn_at present
            # OR existing spawns visible). We assert enabled flag.
            assert r.json().get("enabled") is True

            # Now flip — all windows in the past, off hours -> spawns should NOT be allowed
            cfg2 = dict(original)
            cfg2["active_hours_start"] = 0
            cfg2["active_hours_end"] = 0
            cfg2["scheduled_windows"] = [
                {
                    "label": "TEST_past_only",
                    "start": (now - timedelta(hours=2)).isoformat(),
                    "end": (now - timedelta(hours=1)).isoformat(),
                }
            ]
            self._put_cfg(admin_headers, cfg2)
            time.sleep(1)
            r2 = requests.get(
                f"{BASE_URL}/api/spawn/current?lat={MOCK_LAT}&lng={MOCK_LNG}",
                headers=camper_headers, timeout=15)
            assert r2.status_code == 200
            # enabled flag still True (master switch), but no NEW spawns should be created.
            # We don't fail here on next_spawn_at — main check is the helper logic
            # (covered by direct unit-style call below).
        finally:
            self._put_cfg(admin_headers, original)


# -------------- P2 is_within_active_hours unit-style --------------
def test_is_within_active_hours_window_overrides():
    import sys
    sys.path.insert(0, "/app/backend")
    from server import is_within_active_hours
    now = datetime.now(timezone.utc)
    # Off-hours daily but active window NOW -> True
    cfg_now = {
        "active_hours_start": 0, "active_hours_end": 0,
        "scheduled_windows": [{
            "label": "x",
            "start": (now - timedelta(minutes=5)).isoformat(),
            "end": (now + timedelta(minutes=30)).isoformat(),
        }],
    }
    assert is_within_active_hours(cfg_now) is True

    # All windows in past -> falls back to daily hours (which are off here) -> False
    cfg_past = {
        "active_hours_start": 0, "active_hours_end": 0,
        "scheduled_windows": [{
            "label": "p",
            "start": (now - timedelta(hours=3)).isoformat(),
            "end": (now - timedelta(hours=2)).isoformat(),
        }],
    }
    assert is_within_active_hours(cfg_past) is False

    # All windows in past + daily hours covering now -> True (fallback)
    h = now.astimezone().hour
    cfg_fb = {
        "active_hours_start": max(0, h),
        "active_hours_end": min(24, h + 1) if h < 24 else 24,
        "scheduled_windows": [{
            "label": "p",
            "start": (now - timedelta(hours=3)).isoformat(),
            "end": (now - timedelta(hours=2)).isoformat(),
        }],
    }
    assert is_within_active_hours(cfg_fb) is True
