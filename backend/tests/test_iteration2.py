"""RRDC GO Iteration 2 backend tests - roster/groups/campers, map pins, camper login, spawn-with-pin."""
import os
import pytest
import requests
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient


def _read_env(key, path):
    try:
        with open(path) as f:
            for line in f:
                if line.startswith(f"{key}="):
                    return line.strip().split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        return None


BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _read_env("REACT_APP_BACKEND_URL", "/app/frontend/.env") or "").rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL") or _read_env("MONGO_URL", "/app/backend/.env")
DB_NAME = os.environ.get("DB_NAME") or _read_env("DB_NAME", "/app/backend/.env")

state = {}


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/admin/auth/login", json={"username": "admin", "password": "Camp1993"}, timeout=15)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module", autouse=True)
def mongo():
    """Module-scoped + autouse so cleanup runs before ANY test (not lazy)."""
    c = MongoClient(MONGO_URL)
    db = c[DB_NAME]
    db.map_pins.delete_many({"name": {"$regex": "^TEST_"}})
    yield db
    db.map_pins.delete_many({"name": {"$regex": "^TEST_"}})


# ---- Groups & Campers (public) ----
def test_groups_returns_list():
    r = requests.get(f"{API}/groups", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert len(data) >= 30, f"Expected ~39 groups, got {len(data)}"
    for g in data:
        assert "group_code" in g and "camper_count" in g
        assert isinstance(g["camper_count"], int)
    # find B01
    codes = {g["group_code"] for g in data}
    assert "B01" in codes, f"B01 not in groups list: {sorted(codes)[:5]}"
    state["groups"] = data


def test_groups_b01_campers_sorted():
    r = requests.get(f"{API}/groups/B01/campers", timeout=15)
    assert r.status_code == 200
    campers = r.json()
    assert isinstance(campers, list) and len(campers) > 0
    # Should be sorted by last_name
    last_names = [c["last_name"] for c in campers]
    assert last_names == sorted(last_names), f"Not sorted by last_name: {last_names}"
    # All belong to B01
    assert all(c["group_code"] == "B01" for c in campers)
    state["b01_campers"] = campers


# ---- Camper login ----
def test_camper_login_valid():
    cid = state["b01_campers"][0]["id"]
    r = requests.post(f"{API}/camper/login", json={"camper_id": cid}, timeout=10)
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]
    assert tok and len(tok) > 20
    state["camper_token"] = tok
    state["camper_headers"] = {"Authorization": f"Bearer {tok}"}
    state["camper_id"] = cid


def test_camper_login_invalid():
    r = requests.post(f"{API}/camper/login", json={"camper_id": "not-a-real-id"}, timeout=10)
    assert r.status_code == 404


def test_camper_auth_me():
    r = requests.get(f"{API}/auth/me", headers=state["camper_headers"], timeout=10)
    assert r.status_code == 200
    d = r.json()
    expected = state["b01_campers"][0]
    full = f"{expected['first_name']} {expected['last_name']}".strip()
    assert d["username"] == full
    assert d["group_name"] == "B01"
    assert d["id"] == expected["id"]


# ---- Roster admin endpoints ----
def test_admin_roster_status(admin_headers):
    r = requests.get(f"{API}/admin/roster-status", headers=admin_headers, timeout=10)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["camper_count"] > 0
    assert d["group_count"] > 0


def test_admin_roster_list(admin_headers):
    r = requests.get(f"{API}/admin/roster", headers=admin_headers, timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list) and len(data) > 0
    g0 = data[0]
    assert "group_code" in g0 and "campers" in g0 and "count" in g0


def test_admin_roster_sync(admin_headers):
    r = requests.post(f"{API}/admin/roster-sync", headers=admin_headers, timeout=60)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["error"] is None, f"Sync error: {d}"
    assert d["camper_count"] > 0
    assert d["group_count"] > 0


def test_admin_roster_rejects_camper_token():
    r = requests.get(f"{API}/admin/roster", headers=state["camper_headers"], timeout=10)
    assert r.status_code == 401


# ---- Map Pins ----
def test_admin_pins_list_empty_or_existing(admin_headers):
    r = requests.get(f"{API}/admin/map-pins", headers=admin_headers, timeout=10)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_admin_create_pin_requires_latlng(admin_headers):
    r = requests.post(f"{API}/admin/map-pins", json={"name": "TEST_BadPin"}, headers=admin_headers, timeout=10)
    assert r.status_code == 400


def test_admin_create_pin(admin_headers):
    r = requests.post(f"{API}/admin/map-pins", json={"name": "TEST_Pin1", "latitude": 40.7128, "longitude": -74.006, "active": True}, headers=admin_headers, timeout=10)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["name"] == "TEST_Pin1"
    assert d["latitude"] == 40.7128
    assert d["active"] is True
    state["pin_id"] = d["id"]


def test_admin_update_pin_toggle(admin_headers):
    pid = state["pin_id"]
    r = requests.patch(f"{API}/admin/map-pins/{pid}", json={"active": False}, headers=admin_headers, timeout=10)
    assert r.status_code == 200
    assert r.json()["active"] is False
    # Toggle back on
    r2 = requests.patch(f"{API}/admin/map-pins/{pid}", json={"active": True}, headers=admin_headers, timeout=10)
    assert r2.json()["active"] is True


def test_user_map_pins_returns_active(admin_headers):
    # Create an inactive pin
    r = requests.post(f"{API}/admin/map-pins", json={"name": "TEST_PinInactive", "latitude": 40.0, "longitude": -75.0, "active": False}, headers=admin_headers, timeout=10)
    inactive_id = r.json()["id"]
    state["inactive_pin_id"] = inactive_id
    r2 = requests.get(f"{API}/map-pins", headers=state["camper_headers"], timeout=10)
    assert r2.status_code == 200
    pins = r2.json()
    ids = [p["id"] for p in pins]
    assert state["pin_id"] in ids
    assert inactive_id not in ids


# ---- Spawn with pin lat/lng ----
def test_spawn_includes_pin_coordinates(admin_headers, mongo):
    # Set spawn config to allow 24h and force fast spawning
    cfg = {
        "enabled": True, "min_interval_min": 0.01, "max_interval_min": 0.02,
        "active_hours_start": 0, "active_hours_end": 24, "spawn_ttl_seconds": 120,
        "rarity_weights": {"common": 0, "uncommon": 0, "rare": 0, "legendary": 100},
        "camp_latitude": 40.7128, "camp_longitude": -74.006, "camp_default_zoom": 17,
    }
    r = requests.put(f"{API}/admin/spawn-config", json=cfg, headers=admin_headers, timeout=10)
    assert r.status_code == 200

    # Activate exactly one legendary pokemon
    mongo.pokemon.update_many({}, {"$set": {"active": False}})
    pdoc = mongo.pokemon.find_one({}, sort=[("slot_number", 1)])
    pid = pdoc["id"]
    requests.patch(f"{API}/admin/pokemon/{pid}", json={"name": "TEST_LegendarySpawn", "rarity": "legendary", "power_level": 500, "active": True}, headers=admin_headers, timeout=10)

    # Force next_spawn_at to past for camper
    cid = state["camper_id"]
    mongo.group_spawns.update_one(
        {"group_id": cid},
        {"$set": {"group_id": cid, "next_spawn_at": (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat(), "current_spawn": None}},
        upsert=True,
    )
    # Make sure only TEST_Pin1 is active
    mongo.map_pins.update_many({}, {"$set": {"active": False}})
    mongo.map_pins.update_one({"id": state["pin_id"]}, {"$set": {"active": True}})

    r = requests.get(f"{API}/spawn/current", headers=state["camper_headers"], timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("spawn"), f"No spawn: {d}"
    sp = d["spawn"]
    assert sp["latitude"] == 40.7128
    assert sp["longitude"] == -74.006
    assert sp["pin_name"] == "TEST_Pin1"
    state["spawn_id"] = sp["spawn_id"]


def test_camper_catch_persists_per_camper(mongo):
    # Try a few times until success (legendary 15%)
    cid = state["camper_id"]
    success = False
    for _ in range(40):
        cur = mongo.group_spawns.find_one({"group_id": cid})
        if not cur or not cur.get("current_spawn"):
            mongo.group_spawns.update_one(
                {"group_id": cid},
                {"$set": {"next_spawn_at": (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat(), "current_spawn": None}},
                upsert=True,
            )
            r = requests.get(f"{API}/spawn/current", headers=state["camper_headers"], timeout=10)
            sp = r.json().get("spawn")
            if not sp:
                continue
            sid = sp["spawn_id"]
        else:
            sid = cur["current_spawn"]["spawn_id"]
        r = requests.post(f"{API}/spawn/catch", json={"spawn_id": sid}, headers=state["camper_headers"], timeout=10)
        assert r.status_code == 200
        if r.json()["success"]:
            success = True
            break
    assert success, "Failed to catch in 40 tries"

    # Bank reflects per camper
    r = requests.get(f"{API}/bank", headers=state["camper_headers"], timeout=10)
    assert r.status_code == 200
    lst = r.json()
    assert any(b["name"] == "TEST_LegendarySpawn" for b in lst)


def test_other_camper_separate_bank():
    # Login as second camper in same group (B01)
    if len(state["b01_campers"]) < 2:
        pytest.skip("Only one camper in B01")
    cid2 = state["b01_campers"][1]["id"]
    r = requests.post(f"{API}/camper/login", json={"camper_id": cid2}, timeout=10)
    headers2 = {"Authorization": f"Bearer {r.json()['access_token']}"}
    r2 = requests.get(f"{API}/bank", headers=headers2, timeout=10)
    assert r2.status_code == 200
    lst = r2.json()
    # Should NOT contain the first camper's TEST_LegendarySpawn (per-camper bank)
    assert not any(b["name"] == "TEST_LegendarySpawn" for b in lst), "Bank should be per-camper, not shared"


# ---- Auth guards ----
def test_admin_endpoints_reject_camper():
    for path in ["/admin/map-pins", "/admin/roster", "/admin/roster-status", "/admin/users", "/admin/pokemon"]:
        r = requests.get(f"{API}{path}", headers=state["camper_headers"], timeout=10)
        assert r.status_code == 401, f"{path} should reject camper token, got {r.status_code}"


def test_spawn_current_requires_auth():
    r = requests.get(f"{API}/spawn/current", timeout=10)
    assert r.status_code == 401


def test_legacy_user_login_endpoint_exists():
    # Posting bogus creds should give 401, not 404 (route exists)
    r = requests.post(f"{API}/auth/login", json={"username": "nonexistent_xyz", "password": "x"}, timeout=10)
    assert r.status_code in (401, 429), f"Expected 401, got {r.status_code}"


# ---- Cleanup ----
def test_admin_delete_pin(admin_headers):
    r = requests.delete(f"{API}/admin/map-pins/{state['pin_id']}", headers=admin_headers, timeout=10)
    assert r.status_code == 200
    if state.get("inactive_pin_id"):
        requests.delete(f"{API}/admin/map-pins/{state['inactive_pin_id']}", headers=admin_headers, timeout=10)
