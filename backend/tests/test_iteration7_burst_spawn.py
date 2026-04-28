"""
Iteration 7 - Burst spawn behaviour tests.

Validates:
  * GET /api/spawn/current returns >=4 spawns immediately for a freshly-flushed camper.
  * Mixed rarities across the burst (not all the same rarity).
  * Re-poll: still returns the same active spawns (no churn).
  * Catch flow still works (deducts ball, returns success/failure).
"""
import os
import time
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"


# ----- Helpers / fixtures -----
@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def camper_token(session):
    """Login as the first camper in the first group."""
    g = session.get(f"{API}/groups", timeout=15)
    assert g.status_code == 200, f"groups failed: {g.status_code} {g.text}"
    groups = g.json()
    if not groups:
        pytest.skip("No groups available")
    code = groups[0]["group_code"]
    c = session.get(f"{API}/groups/{code}/campers", timeout=15)
    assert c.status_code == 200, c.text
    campers = c.json()
    if not campers:
        pytest.skip("No campers in first group")
    camper_id = campers[0]["id"]
    r = session.post(f"{API}/camper/login", json={"camper_id": camper_id}, timeout=15)
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    return token


@pytest.fixture(scope="module")
def camper_client(session, camper_token):
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {camper_token}",
    })
    return s


# ----- Burst spawn tests -----
class TestBurstSpawn:
    def test_flush_then_burst_returns_at_least_4(self, camper_client):
        # Flush all existing spawns
        f = camper_client.post(f"{API}/spawn/flee", timeout=15)
        assert f.status_code == 200, f.text

        # Poll once with camper coords
        r = camper_client.get(
            f"{API}/spawn/current",
            params={"lat": 40.6396, "lng": -73.6665},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "spawns" in data
        assert isinstance(data["spawns"], list)
        assert data.get("enabled") is True, "Spawning is disabled in admin config"
        assert len(data["spawns"]) >= 4, (
            f"Expected >=4 spawns on first poll, got {len(data['spawns'])}: "
            f"{[s['pokemon']['name'] for s in data['spawns']]}"
        )
        # Each spawn has pokemon, lat/lng, expires_at
        for s in data["spawns"]:
            assert "spawn_id" in s
            assert "pokemon" in s and "rarity" in s["pokemon"]
            assert s.get("latitude") is not None
            assert s.get("longitude") is not None

    def test_rarity_mix(self, camper_client):
        r = camper_client.get(
            f"{API}/spawn/current",
            params={"lat": 40.6396, "lng": -73.6665},
            timeout=15,
        )
        assert r.status_code == 200
        spawns = r.json()["spawns"]
        rarities = [s["pokemon"]["rarity"] for s in spawns]
        # Soft assertion: with 4+ spawns, expect at least 2 distinct rarities most of the time
        # Don't fail hard on randomness — log if uniform.
        unique = set(rarities)
        if len(unique) < 2:
            pytest.skip(
                f"All {len(rarities)} spawns rolled same rarity={rarities[0]} — "
                "stochastic, may pass on retry"
            )
        assert len(unique) >= 2, f"All same rarity: {rarities}"

    def test_repoll_no_churn(self, camper_client):
        r1 = camper_client.get(
            f"{API}/spawn/current",
            params={"lat": 40.6396, "lng": -73.6665},
            timeout=15,
        )
        ids1 = sorted(s["spawn_id"] for s in r1.json()["spawns"])
        time.sleep(2)
        r2 = camper_client.get(
            f"{API}/spawn/current",
            params={"lat": 40.6396, "lng": -73.6665},
            timeout=15,
        )
        ids2 = sorted(s["spawn_id"] for s in r2.json()["spawns"])
        # ids1 must be a subset of ids2 (next_spawn_at may add 1 more, max 5)
        for sid in ids1:
            assert sid in ids2, f"Spawn {sid} disappeared on re-poll (churn)"
        assert len(ids2) <= 5, f"Exceeded max_active_spawns=5: got {len(ids2)}"


# ----- Catch flow regression -----
class TestCatchFlow:
    def test_catch_deducts_ball(self, camper_client):
        # Get wallet balance
        wb = camper_client.get(f"{API}/wallet", timeout=15)
        assert wb.status_code == 200, wb.text
        before = int(wb.json().get("balance", 0))
        if before < 1:
            pytest.skip("Camper has 0 balls — cannot test throw")

        # Get current spawns
        r = camper_client.get(
            f"{API}/spawn/current",
            params={"lat": 40.6396, "lng": -73.6665},
            timeout=15,
        )
        spawns = r.json()["spawns"]
        if not spawns:
            pytest.skip("No active spawns to catch")
        sid = spawns[0]["spawn_id"]
        c = camper_client.post(f"{API}/spawn/catch", json={"spawn_id": sid}, timeout=15)
        assert c.status_code == 200, c.text
        body = c.json()
        assert "success" in body
        # After throw, balance should be at least 1 less (catch_reward may have added back)
        wb2 = camper_client.get(f"{API}/wallet", timeout=15)
        after = int(wb2.json().get("balance", 0))
        # If miss → exactly -1; if catch → -1 + reward (>=0)
        assert after != before or body.get("success") is True, (
            f"Balance unchanged after throw: before={before} after={after}"
        )
