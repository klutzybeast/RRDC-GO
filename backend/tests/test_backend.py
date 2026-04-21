"""RRDC GO Backend API Tests - all endpoints in one file (regression suite)."""
import os
import io
import pytest
import requests
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback read frontend .env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.strip().split("=", 1)[1].rstrip("/")

API = f"{BASE_URL}/api"

def _read_env(key):
    try:
        with open("/app/backend/.env") as f:
            for line in f:
                if line.startswith(f"{key}="):
                    val = line.strip().split("=", 1)[1]
                    return val.strip().strip('"').strip("'")
    except Exception:
        return None
    return None

MONGO_URL = os.environ.get("MONGO_URL") or _read_env("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME") or _read_env("DB_NAME")

TEST_USER = "test-red-squirrels"
TEST_PASS = "camp123"
TEST_GROUP = "Test Red Squirrels"

state = {}  # shared across tests


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/admin/auth/login", json={"username": "admin", "password": "Camp1993"}, timeout=15)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def mongo():
    c = MongoClient(MONGO_URL)
    db = c[DB_NAME]
    # Clean test user and their catches/spawns before tests
    u = db.users.find_one({"username": TEST_USER})
    if u:
        db.group_spawns.delete_many({"group_id": u["id"]})
        db.catches.delete_many({"group_id": u["id"]})
        db.users.delete_one({"id": u["id"]})
    # clear lockouts
    db.login_attempts.delete_many({})
    yield db


# --- health ---
def test_health_root():
    r = requests.get(f"{API}/", timeout=10)
    assert r.status_code == 200
    assert r.json().get("ok") is True


# --- admin auth ---
def test_admin_login_valid(admin_token):
    assert isinstance(admin_token, str) and len(admin_token) > 20


def test_admin_login_invalid():
    r = requests.post(f"{API}/admin/auth/login", json={"username": "admin", "password": "wrong!!"}, timeout=10)
    assert r.status_code == 401


def test_admin_me(admin_headers):
    r = requests.get(f"{API}/admin/auth/me", headers=admin_headers, timeout=10)
    assert r.status_code == 200
    data = r.json()
    assert data["username"] == "admin"
    assert data["role"] == "admin"


# --- admin pokemon ---
def test_admin_list_pokemon_60_slots(admin_headers):
    r = requests.get(f"{API}/admin/pokemon", headers=admin_headers, timeout=15)
    assert r.status_code == 200
    lst = r.json()
    assert len(lst) >= 60, f"Expected >=60 pokemon slots, got {len(lst)}"
    slots = [p["slot_number"] for p in lst]
    assert slots == sorted(slots), "Not sorted by slot_number"
    state["pokemon"] = lst


def test_admin_patch_pokemon(admin_headers, mongo):
    pid = state["pokemon"][0]["id"]
    # Deactivate all pokemon first, then activate a legendary one for catch-flow test
    mongo.pokemon.update_many({}, {"$set": {"active": False}})
    payload = {"name": "TEST_Legendary", "power_level": 500, "rarity": "legendary", "active": True}
    r = requests.patch(f"{API}/admin/pokemon/{pid}", json=payload, headers=admin_headers, timeout=10)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["name"] == "TEST_Legendary"
    assert d["rarity"] == "legendary"
    assert d["active"] is True
    assert d["power_level"] == 500
    state["active_pid"] = pid


def test_admin_upload_image(admin_headers):
    pid = state["active_pid"]
    # tiny valid jpeg
    jpeg = bytes.fromhex(
        "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707"
        "07090908 0a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c"
        "1c2837292c30313434341f27393d38323c2e333432ffc0000b0801000100010" "11100"
        "ffc4001f0000010501010101010100000000000000000102030405060708090a0b"
        "ffc400b5100002010303020403050504040000017d01020300041105122131410613"
        "516107227114328191a1082342b1c11552d1f02433627282090a161718191a252627"
        "28292a3435363738393a434445464748494a535455565758595a636465666768696a"
        "737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aa"
        "b2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7"
        "e8e9eaf1f2f3f4f5f6f7f8f9faffda0008010100003f00fb".replace(" ", "")
    )
    files = {"file": ("p.jpg", io.BytesIO(jpeg), "image/jpeg")}
    r = requests.post(f"{API}/admin/pokemon/{pid}/image", files=files, headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["image_data_url"].startswith("data:image/jpeg;base64,")


# --- admin users / user auth ---
def test_admin_create_user(admin_headers, mongo):
    r = requests.post(f"{API}/admin/users", json={
        "username": TEST_USER, "password": TEST_PASS, "group_name": TEST_GROUP
    }, headers=admin_headers, timeout=10)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["username"] == TEST_USER
    assert d["group_name"] == TEST_GROUP
    state["user_id"] = d["id"]


def test_admin_create_user_duplicate(admin_headers):
    r = requests.post(f"{API}/admin/users", json={
        "username": TEST_USER, "password": TEST_PASS, "group_name": TEST_GROUP
    }, headers=admin_headers, timeout=10)
    assert r.status_code == 409


def test_user_login():
    r = requests.post(f"{API}/auth/login", json={"username": TEST_USER, "password": TEST_PASS}, timeout=10)
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]
    assert tok
    state["user_token"] = tok
    state["user_headers"] = {"Authorization": f"Bearer {tok}"}


def test_user_me():
    r = requests.get(f"{API}/auth/me", headers=state["user_headers"], timeout=10)
    assert r.status_code == 200
    assert r.json()["group_name"] == TEST_GROUP


# --- spawn config ---
def test_spawn_config_get(admin_headers):
    r = requests.get(f"{API}/admin/spawn-config", headers=admin_headers, timeout=10)
    assert r.status_code == 200
    d = r.json()
    assert "enabled" in d and "min_interval_min" in d


def test_spawn_config_update_invalid(admin_headers):
    cfg = {
        "enabled": True, "min_interval_min": 5, "max_interval_min": 1,
        "active_hours_start": 0, "active_hours_end": 24, "spawn_ttl_seconds": 120,
        "rarity_weights": {"common": 0, "uncommon": 0, "rare": 0, "legendary": 100}
    }
    r = requests.put(f"{API}/admin/spawn-config", json=cfg, headers=admin_headers, timeout=10)
    assert r.status_code == 400


def test_spawn_config_update_valid(admin_headers):
    cfg = {
        "enabled": True, "min_interval_min": 0.01, "max_interval_min": 0.02,
        "active_hours_start": 0, "active_hours_end": 24, "spawn_ttl_seconds": 120,
        "rarity_weights": {"common": 0, "uncommon": 0, "rare": 0, "legendary": 100}
    }
    r = requests.put(f"{API}/admin/spawn-config", json=cfg, headers=admin_headers, timeout=10)
    assert r.status_code == 200
    assert r.json()["rarity_weights"]["legendary"] == 100


# --- spawn ---
def test_spawn_catch_no_active():
    r = requests.post(f"{API}/spawn/catch", json={"spawn_id": "nope"}, headers=state["user_headers"], timeout=10)
    assert r.status_code == 400


def test_spawn_current_flow(mongo):
    # Force next_spawn_at to past
    uid = state["user_id"]
    mongo.group_spawns.update_one(
        {"group_id": uid},
        {"$set": {"group_id": uid, "next_spawn_at": (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat(), "current_spawn": None}},
        upsert=True,
    )
    r = requests.get(f"{API}/spawn/current", headers=state["user_headers"], timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["enabled"] is True
    assert d.get("spawn"), f"No spawn created: {d}"
    state["spawn_id"] = d["spawn"]["spawn_id"]


def test_catch_flow(mongo):
    """Retry until success (legendary 15%)."""
    uid = state["user_id"]
    caught = False
    for _ in range(40):
        # ensure an active spawn exists
        cur = mongo.group_spawns.find_one({"group_id": uid})
        if not cur or not cur.get("current_spawn"):
            mongo.group_spawns.update_one(
                {"group_id": uid},
                {"$set": {"next_spawn_at": (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat(), "current_spawn": None}},
                upsert=True,
            )
            r = requests.get(f"{API}/spawn/current", headers=state["user_headers"], timeout=10)
            sp = r.json().get("spawn")
            if not sp:
                continue
            sid = sp["spawn_id"]
        else:
            sid = cur["current_spawn"]["spawn_id"]
        r = requests.post(f"{API}/spawn/catch", json={"spawn_id": sid}, headers=state["user_headers"], timeout=10)
        assert r.status_code == 200
        res = r.json()
        if res["success"]:
            caught = True
            assert res["pokemon"]["name"] == "TEST_Legendary"
            break
    assert caught, "Failed to catch after 40 tries (very unlucky or bug)"


def test_bank_has_catch():
    r = requests.get(f"{API}/bank", headers=state["user_headers"], timeout=10)
    assert r.status_code == 200
    lst = r.json()
    assert any(b["name"] == "TEST_Legendary" for b in lst)


def test_catches_list():
    r = requests.get(f"{API}/catches", headers=state["user_headers"], timeout=10)
    assert r.status_code == 200
    assert len(r.json()) >= 1


def test_analytics(admin_headers):
    r = requests.get(f"{API}/admin/analytics", headers=admin_headers, timeout=10)
    assert r.status_code == 200
    d = r.json()
    for k in ("total_catches", "users_count", "active_pokemon", "by_group", "by_rarity", "most_caught", "recent"):
        assert k in d


# --- auth guards ---
def test_admin_requires_admin_token():
    r = requests.get(f"{API}/admin/users", headers=state["user_headers"], timeout=10)
    assert r.status_code == 401


def test_spawn_requires_auth():
    r = requests.get(f"{API}/spawn/current", timeout=10)
    assert r.status_code == 401


# --- cleanup ---
def test_admin_delete_user(admin_headers):
    r = requests.delete(f"{API}/admin/users/{state['user_id']}", headers=admin_headers, timeout=10)
    assert r.status_code == 200


def test_admin_create_and_delete_pokemon(admin_headers):
    r = requests.post(f"{API}/admin/pokemon", json={"name": "TEST_Temp", "power_level": 50, "rarity": "common"}, headers=admin_headers, timeout=10)
    assert r.status_code == 200
    pid = r.json()["id"]
    r2 = requests.delete(f"{API}/admin/pokemon/{pid}", headers=admin_headers, timeout=10)
    assert r2.status_code == 200
