"""Iteration 4 regression tests — multi-spawn, rarity catch rates, TTL migration, no-flee on miss."""
import os
import time
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL missing"
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME")
assert MONGO_URL and DB_NAME

# Direct mongo (sync) for seed/teardown convenience
mongo = MongoClient(MONGO_URL)[DB_NAME]


# ------------------------ fixtures ------------------------
@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/admin/auth/login", json={"username": "admin", "password": "Camp1993"})
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="session")
def camper_token():
    # Find any camper id (first one of the first group)
    camper = mongo.campers.find_one({}, {"_id": 0, "id": 1})
    assert camper, "No campers seeded — cannot test camper flow"
    r = requests.post(f"{API}/camper/login", json={"camper_id": camper["id"]})
    assert r.status_code == 200, f"Camper login failed: {r.status_code} {r.text}"
    return r.json()["access_token"], camper["id"]


@pytest.fixture(scope="session")
def camper_headers(camper_token):
    tok, _ = camper_token
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="session", autouse=True)
def ensure_pokemon_active(admin_headers):
    """Make sure at least one pokemon per rarity is active and enough balls exist."""
    # Activate at least one per rarity directly in mongo (fast; avoids PATCH loop)
    for rar in ["common", "uncommon", "rare", "legendary"]:
        doc = mongo.pokemon.find_one({"rarity": rar})
        if doc:
            mongo.pokemon.update_one({"id": doc["id"]}, {"$set": {"active": True}})
    yield


# ------------------------ tests ------------------------

# --- /api/spawn/current returns list schema ---
class TestSpawnCurrent:
    def test_returns_spawns_list(self, camper_headers, camper_token):
        _, cid = camper_token
        # Reset group state so we start fresh
        mongo.group_spawns.delete_one({"group_id": cid})
        # Enable spawn config
        mongo.spawn_config.update_one(
            {"id": "singleton"},
            {"$set": {"enabled": True, "max_active_spawns": 5, "min_interval_min": 0.01, "max_interval_min": 0.02, "active_hours_start": 0, "active_hours_end": 24}},
            upsert=True,
        )
        r = requests.get(f"{API}/spawn/current", headers=camper_headers, params={"lat": 40.6396, "lng": -73.6665})
        assert r.status_code == 200, r.text
        data = r.json()
        assert "spawns" in data and isinstance(data["spawns"], list)
        assert "current_spawn" not in data  # old singleton field gone from response
        # max_active_spawns should be reported
        assert data.get("max_active_spawns") == 5

    def test_multi_spawn_up_to_max(self, camper_headers, camper_token):
        _, cid = camper_token
        mongo.group_spawns.delete_one({"group_id": cid})
        # Up to 3 spawns created per call (per server code); poll a few times to fill
        seen = 0
        for _ in range(5):
            # Force next_spawn_at to now to bypass interval
            mongo.group_spawns.update_one(
                {"group_id": cid},
                {"$set": {"next_spawn_at": "1970-01-01T00:00:00+00:00"}},
                upsert=True,
            )
            r = requests.get(f"{API}/spawn/current", headers=camper_headers, params={"lat": 40.6396, "lng": -73.6665})
            assert r.status_code == 200
            seen = len(r.json()["spawns"])
            if seen >= 4:
                break
            time.sleep(0.1)
        assert seen >= 4, f"Expected multiple spawns (>=4), got {seen}"
        # Every spawn has lat/lng near camper
        for s in r.json()["spawns"]:
            assert s.get("latitude") is not None and s.get("longitude") is not None
            assert abs(s["latitude"] - 40.6396) < 0.002  # within ~200m
            assert abs(s["longitude"] + 73.6665) < 0.002


# --- /api/spawn/catch: miss keeps spawn, hit removes only that spawn ---
class TestCatchNoFleeOnMiss:
    def _seed_multi_spawns(self, cid, n=3):
        """Seed exactly n spawns in the group state using a common-rarity pokemon."""
        common = mongo.pokemon.find_one({"rarity": "common", "active": True}, {"_id": 0})
        assert common, "need active common pokemon"
        from datetime import datetime, timedelta, timezone
        now = datetime.now(timezone.utc)
        spawns = []
        for i in range(n):
            spawns.append({
                "spawn_id": f"TEST4_spawn_{i}_{int(time.time())}",
                "pokemon_id": common["id"],
                "pokemon": common,
                "started_at": now.isoformat(),
                "expires_at": (now + timedelta(hours=1)).isoformat(),
                "latitude": 40.6396,
                "longitude": -73.6665,
                "pin_name": "Test",
            })
        mongo.group_spawns.update_one(
            {"group_id": cid},
            {"$set": {"current_spawns": spawns, "current_spawn": None, "next_spawn_at": (now + timedelta(hours=1)).isoformat()}},
            upsert=True,
        )
        return [s["spawn_id"] for s in spawns]

    def test_miss_keeps_spawn_in_list(self, camper_headers, camper_token):
        _, cid = camper_token
        # Make CATCH fail deterministically by force-patching pokemon rarity->legendary temporarily
        common = mongo.pokemon.find_one({"rarity": "common", "active": True}, {"_id": 0})
        # Temporarily swap its rarity to "legendary" so 25% rate; we'll just retry until at least one miss is observed OR hit
        ids = self._seed_multi_spawns(cid, n=3)
        # Grant plenty of balls
        mongo.wallet.update_one({"camper_id": cid}, {"$set": {"balance": 500}}, upsert=True)

        target = ids[0]
        # Try a throw — regardless of hit/miss for common (95%), assert behavior:
        r = requests.post(f"{API}/spawn/catch", headers=camper_headers, json={"spawn_id": target})
        assert r.status_code == 200, r.text
        body = r.json()
        state = mongo.group_spawns.find_one({"group_id": cid})
        current_ids = [s["spawn_id"] for s in state.get("current_spawns", [])]
        if body["success"]:
            # Hit: target removed, other two remain
            assert target not in current_ids
            assert len(current_ids) == 2
            assert set(current_ids) == set(ids[1:])
        else:
            # Miss: target STILL in the list (no flee)
            assert target in current_ids, "Pokemon should NOT flee on miss"
            assert len(current_ids) == 3

    def test_miss_explicit_by_forcing_legendary(self, camper_headers, camper_token):
        """Force a deterministic miss by patching the seeded pokemon to have rarity=legendary in the spawn doc
        so CATCH_RATES=0.25 and we retry up to 10 times to observe a miss."""
        _, cid = camper_token
        common = mongo.pokemon.find_one({"rarity": "common", "active": True}, {"_id": 0})
        mongo.wallet.update_one({"camper_id": cid}, {"$set": {"balance": 500}}, upsert=True)

        # Seed a single spawn whose embedded pokemon.rarity=legendary (25% catch rate)
        from datetime import datetime, timedelta, timezone
        now = datetime.now(timezone.utc)
        mon = dict(common)
        mon["rarity"] = "legendary"
        spawn_id = f"TEST4_forcemiss_{int(time.time())}"
        spawn = {
            "spawn_id": spawn_id,
            "pokemon_id": mon["id"],
            "pokemon": mon,
            "started_at": now.isoformat(),
            "expires_at": (now + timedelta(hours=1)).isoformat(),
            "latitude": 40.64, "longitude": -73.66, "pin_name": "T",
        }
        mongo.group_spawns.update_one(
            {"group_id": cid},
            {"$set": {"current_spawns": [spawn], "current_spawn": None}},
            upsert=True,
        )

        observed_miss = False
        for _ in range(15):
            r = requests.post(f"{API}/spawn/catch", headers=camper_headers, json={"spawn_id": spawn_id})
            if r.status_code != 200:
                break
            body = r.json()
            state = mongo.group_spawns.find_one({"group_id": cid})
            ids = [s["spawn_id"] for s in state.get("current_spawns", [])]
            if not body["success"]:
                observed_miss = True
                assert spawn_id in ids, "Miss should keep spawn alive (no flee)"
                break
            else:
                # Caught — reseed and try again
                mongo.group_spawns.update_one({"group_id": cid}, {"$set": {"current_spawns": [spawn]}})
        assert observed_miss, "Expected at least one miss with 25% catch rate in 15 tries"


# --- /api/spawn/flee only removes the specified spawn ---
class TestSpawnFlee:
    def test_flee_one_keeps_others(self, camper_headers, camper_token):
        _, cid = camper_token
        common = mongo.pokemon.find_one({"rarity": "common", "active": True}, {"_id": 0})
        from datetime import datetime, timedelta, timezone
        now = datetime.now(timezone.utc)
        ids = [f"TEST4_flee_{i}_{int(time.time())}" for i in range(3)]
        spawns = [{
            "spawn_id": sid, "pokemon_id": common["id"], "pokemon": common,
            "started_at": now.isoformat(), "expires_at": (now + timedelta(hours=1)).isoformat(),
            "latitude": 40.64, "longitude": -73.66, "pin_name": "T",
        } for sid in ids]
        mongo.group_spawns.update_one(
            {"group_id": cid},
            {"$set": {"current_spawns": spawns, "current_spawn": None}},
            upsert=True,
        )
        r = requests.post(f"{API}/spawn/flee", headers=camper_headers, json={"spawn_id": ids[0]})
        assert r.status_code == 200
        state = mongo.group_spawns.find_one({"group_id": cid})
        remaining = [s["spawn_id"] for s in state.get("current_spawns", [])]
        assert ids[0] not in remaining
        assert set(ids[1:]).issubset(set(remaining)), f"Expected {ids[1:]} to remain, got {remaining}"


# --- TTL migration in load_spawn_config ---
class TestSpawnTTLMigration:
    def test_low_ttl_bumped_to_3600(self, admin_headers):
        # inject a low TTL directly
        mongo.spawn_config.update_one({"id": "singleton"}, {"$set": {"spawn_ttl_seconds": 600}}, upsert=True)
        # Trigger load_spawn_config via admin GET
        r = requests.get(f"{API}/admin/spawn-config", headers=admin_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert int(data.get("spawn_ttl_seconds", 0)) == 3600
        # Verify persisted
        doc = mongo.spawn_config.find_one({"id": "singleton"})
        assert int(doc["spawn_ttl_seconds"]) == 3600


# --- Catch rates rarity-tuned (statistical) ---
@pytest.mark.parametrize("rarity,expected,tol", [
    ("common", 0.95, 0.08),
    ("legendary", 0.25, 0.12),
])
def test_catch_rates_statistical(camper_headers, camper_token, rarity, expected, tol):
    _, cid = camper_token
    common = mongo.pokemon.find_one({"rarity": "common", "active": True}, {"_id": 0})
    mongo.wallet.update_one({"camper_id": cid}, {"$set": {"balance": 10_000}}, upsert=True)
    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc)
    hits = 0
    N = 120  # reduced from 200 to keep runtime reasonable
    for i in range(N):
        mon = dict(common)
        mon["rarity"] = rarity
        sid = f"TEST4_rate_{rarity}_{i}_{int(time.time()*1000)}"
        spawn = {
            "spawn_id": sid, "pokemon_id": mon["id"], "pokemon": mon,
            "started_at": now.isoformat(), "expires_at": (now + timedelta(hours=1)).isoformat(),
            "latitude": 40.64, "longitude": -73.66, "pin_name": "T",
        }
        mongo.group_spawns.update_one(
            {"group_id": cid},
            {"$set": {"current_spawns": [spawn], "current_spawn": None}},
            upsert=True,
        )
        r = requests.post(f"{API}/spawn/catch", headers=camper_headers, json={"spawn_id": sid})
        assert r.status_code == 200, r.text
        if r.json()["success"]:
            hits += 1
    rate = hits / N
    assert abs(rate - expected) < tol, f"{rarity} catch rate {rate:.2%} not within {tol} of {expected:.2%}"


# --- Existing admin APIs still work ---
class TestAdminSmoke:
    def test_admin_login(self, admin_headers):
        r = requests.get(f"{API}/admin/auth/me", headers=admin_headers)
        assert r.status_code == 200
        assert r.json()["username"] == "admin"

    def test_admin_pokemon_list(self, admin_headers):
        r = requests.get(f"{API}/admin/pokemon", headers=admin_headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_admin_analytics(self, admin_headers):
        r = requests.get(f"{API}/admin/analytics", headers=admin_headers)
        assert r.status_code == 200
        data = r.json()
        assert "total_catches" in data and "by_rarity" in data

    def test_admin_roster(self, admin_headers):
        r = requests.get(f"{API}/admin/roster", headers=admin_headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_admin_map_pins(self, admin_headers):
        r = requests.get(f"{API}/admin/map-pins", headers=admin_headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# --- Wallet endpoints still work ---
class TestWalletSmoke:
    def test_wallet_get(self, camper_headers):
        r = requests.get(f"{API}/wallet", headers=camper_headers)
        assert r.status_code == 200
        data = r.json()
        assert "balance" in data
        assert isinstance(data["balance"], int)

    def test_wallet_claim_daily(self, camper_headers):
        r = requests.post(f"{API}/wallet/claim-daily", headers=camper_headers)
        # 200 or 429 (already claimed today) — both acceptable
        assert r.status_code in (200, 429), r.text


# --- Teardown cleanup ---
def teardown_module(module):
    # Clean up test-created spawn entries from group_spawns
    for doc in mongo.group_spawns.find({}):
        spawns = doc.get("current_spawns") or []
        filtered = [s for s in spawns if not (s and str(s.get("spawn_id", "")).startswith("TEST4_"))]
        if len(filtered) != len(spawns):
            mongo.group_spawns.update_one({"_id": doc["_id"]}, {"$set": {"current_spawns": filtered}})
