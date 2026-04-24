"""Iteration 5 — Weekly Leaderboard tests.

Covers:
- GET /api/leaderboard/weekly (camper-auth) shape & ISO-week scoping
- POST /api/camper/position accumulates meters in camper_distance_daily
- `me` object ranks / is_me flag correctness when current camper appears
"""
import os
import uuid
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://river-catch-1.preview.emergentagent.com").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

API = f"{BASE_URL}/api"


# ---------- Shared fixtures ----------
@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def camper_auth(session):
    """Log in as first camper in first group; returns (token, camper_dict)."""
    r = session.get(f"{API}/groups", timeout=15)
    assert r.status_code == 200, f"/groups failed: {r.status_code} {r.text}"
    groups = r.json()
    assert groups, "No groups seeded — can't run camper auth tests"
    group_code = groups[0]["group_code"]

    r = session.get(f"{API}/groups/{group_code}/campers", timeout=15)
    assert r.status_code == 200, r.text
    campers = r.json()
    assert campers, f"No campers in group {group_code}"
    camper = campers[0]

    r = session.post(f"{API}/camper/login", json={"camper_id": camper["id"]}, timeout=15)
    assert r.status_code == 200, f"camper/login failed: {r.text}"
    token = r.json()["access_token"]
    return token, camper


@pytest.fixture(scope="module")
def auth_headers(camper_auth):
    token, _ = camper_auth
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def second_camper(session):
    """Second camper for multi-user leaderboard seeding."""
    r = session.get(f"{API}/groups", timeout=15)
    groups = r.json()
    group_code = groups[0]["group_code"]
    r = session.get(f"{API}/groups/{group_code}/campers", timeout=15)
    campers = r.json()
    if len(campers) < 2:
        pytest.skip("Need at least 2 campers in first group for leaderboard comparison")
    camper = campers[1]
    r = session.post(f"{API}/camper/login", json={"camper_id": camper["id"]}, timeout=15)
    token = r.json()["access_token"]
    return token, camper


# ---------- Direct DB helpers (seeding & cleanup) ----------
@pytest.fixture(scope="module")
def db():
    client = AsyncIOMotorClient(MONGO_URL)
    return client[DB_NAME]


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


@pytest.fixture(scope="module")
def seeded_catches(db, camper_auth, second_camper):
    """Insert TEST_ catches for this week so top_catchers has entries."""
    _, c1 = camper_auth
    _, c2 = second_camper
    now_iso = datetime.now(timezone.utc).isoformat()
    docs = [
        {"id": f"TEST_{uuid.uuid4()}", "group_id": c1["id"], "group_name": c1["group_code"],
         "caught_by": c1["first_name"], "pokemon_id": "TEST_POKE_A", "pokemon_name": "TestMon A",
         "pokemon_image": "", "rarity": "legendary", "power_rolled": 500, "caught_at": now_iso},
        {"id": f"TEST_{uuid.uuid4()}", "group_id": c1["id"], "group_name": c1["group_code"],
         "caught_by": c1["first_name"], "pokemon_id": "TEST_POKE_A", "pokemon_name": "TestMon A",
         "pokemon_image": "", "rarity": "rare", "power_rolled": 300, "caught_at": now_iso},
        {"id": f"TEST_{uuid.uuid4()}", "group_id": c1["id"], "group_name": c1["group_code"],
         "caught_by": c1["first_name"], "pokemon_id": "TEST_POKE_B", "pokemon_name": "TestMon B",
         "pokemon_image": "", "rarity": "common", "power_rolled": 100, "caught_at": now_iso},
        {"id": f"TEST_{uuid.uuid4()}", "group_id": c2["id"], "group_name": c2["group_code"],
         "caught_by": c2["first_name"], "pokemon_id": "TEST_POKE_A", "pokemon_name": "TestMon A",
         "pokemon_image": "", "rarity": "common", "power_rolled": 100, "caught_at": now_iso},
    ]
    _run(db.catches.insert_many(docs))
    yield {"c1_id": c1["id"], "c2_id": c2["id"], "ids": [d["id"] for d in docs]}
    _run(db.catches.delete_many({"id": {"$in": [d["id"] for d in docs]}}))


@pytest.fixture(scope="module")
def seeded_distance(db, camper_auth, second_camper):
    """Upsert TEST distance rows into camper_distance_daily (today's YMD)."""
    _, c1 = camper_auth
    _, c2 = second_camper
    ymd = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    async def do():
        await db.camper_distance_daily.update_one(
            {"camper_id": c1["id"], "date_ymd": ymd},
            {"$set": {"camper_id": c1["id"], "date_ymd": ymd, "meters": 120.0,
                      "first_name": c1["first_name"], "last_name": c1["last_name"],
                      "group_code": c1["group_code"], "updated_at": datetime.now(timezone.utc).isoformat()}},
            upsert=True,
        )
        await db.camper_distance_daily.update_one(
            {"camper_id": c2["id"], "date_ymd": ymd},
            {"$set": {"camper_id": c2["id"], "date_ymd": ymd, "meters": 500.0,
                      "first_name": c2["first_name"], "last_name": c2["last_name"],
                      "group_code": c2["group_code"], "updated_at": datetime.now(timezone.utc).isoformat()}},
            upsert=True,
        )
    _run(do())
    yield {"c1_id": c1["id"], "c2_id": c2["id"], "ymd": ymd}
    _run(db.camper_distance_daily.delete_many(
        {"camper_id": {"$in": [c1["id"], c2["id"]]}, "date_ymd": ymd}
    ))


# ---------- Tests: basic shape & auth ----------
class TestLeaderboardShape:
    def test_requires_auth(self, session):
        r = session.get(f"{API}/leaderboard/weekly", timeout=15)
        assert r.status_code in (401, 403), f"Expected 401/403 without token, got {r.status_code}"

    def test_basic_shape(self, session, auth_headers):
        r = session.get(f"{API}/leaderboard/weekly", headers=auth_headers, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        for key in ("week_start", "top_catchers", "top_pokemon", "top_walkers", "me"):
            assert key in data, f"Missing key: {key}"
        # week_start should parse as ISO
        ws = datetime.fromisoformat(data["week_start"])
        # Should be Monday 00:00 UTC
        assert ws.weekday() == 0, f"week_start weekday = {ws.weekday()} (expected Monday=0)"
        assert ws.hour == 0 and ws.minute == 0 and ws.second == 0
        assert isinstance(data["top_catchers"], list)
        assert isinstance(data["top_pokemon"], list)
        assert isinstance(data["top_walkers"], list)
        me = data["me"]
        for k in ("catches", "catch_rank", "meters", "walk_rank",
                  "total_campers_with_catches", "total_campers_walking"):
            assert k in me, f"me missing {k}"


# ---------- Tests: catches feeding leaderboard ----------
class TestLeaderboardCatches:
    def test_top_catchers_and_me(self, session, auth_headers, seeded_catches, camper_auth):
        _, me = camper_auth
        r = session.get(f"{API}/leaderboard/weekly", headers=auth_headers, timeout=20)
        assert r.status_code == 200
        data = r.json()
        # Find our camper in top_catchers
        mine = [row for row in data["top_catchers"] if row["camper_id"] == me["id"]]
        assert mine, f"Current camper not found in top_catchers: {data['top_catchers']}"
        row = mine[0]
        assert row["is_me"] is True
        assert row["catches"] >= 3, f"Expected >=3 catches from seed, got {row['catches']}"
        assert row["legendaries"] >= 1
        assert row["rares"] >= 1
        assert "rank" in row
        # Others should not have is_me=True
        others = [r for r in data["top_catchers"] if r["camper_id"] != me["id"]]
        for o in others:
            assert o["is_me"] is False
        # me object
        assert data["me"]["catches"] >= 3
        assert data["me"]["catch_rank"] == row["rank"]
        assert data["me"]["total_campers_with_catches"] >= 2

    def test_top_pokemon_aggregates(self, session, auth_headers, seeded_catches):
        r = session.get(f"{API}/leaderboard/weekly", headers=auth_headers, timeout=20)
        data = r.json()
        ids = {p["pokemon_id"]: p for p in data["top_pokemon"]}
        assert "TEST_POKE_A" in ids, f"TEST_POKE_A missing in top_pokemon: {list(ids.keys())}"
        a = ids["TEST_POKE_A"]
        # 3 catches: 2 by c1, 1 by c2 → count=3, unique=2
        assert a["count"] >= 3, a
        assert a["unique_catchers"] >= 2, a
        assert a["rank"] >= 1
        assert "name" in a and "rarity" in a


# ---------- Tests: walking meters ----------
class TestLeaderboardWalkers:
    def test_top_walkers_and_me(self, session, auth_headers, seeded_distance, camper_auth):
        _, me = camper_auth
        r = session.get(f"{API}/leaderboard/weekly", headers=auth_headers, timeout=20)
        data = r.json()
        mine = [w for w in data["top_walkers"] if w["camper_id"] == me["id"]]
        assert mine, f"Current camper not in top_walkers: {data['top_walkers']}"
        row = mine[0]
        assert row["is_me"] is True
        assert row["meters"] >= 120.0
        # Second camper walked 500m → should rank above us
        others = [w for w in data["top_walkers"] if w["camper_id"] != me["id"]]
        # At least one other camper with higher meters should exist
        higher = [o for o in others if o["meters"] >= row["meters"]]
        assert higher, "Expected at least one camper with >= our meters"
        # me summary
        assert data["me"]["meters"] >= 120.0
        assert data["me"]["walk_rank"] == row["rank"]


# ---------- Tests: position endpoint accumulates meters ----------
class TestPositionAccumulation:
    def test_position_endpoint_shape(self, session, auth_headers):
        r = session.post(f"{API}/camper/position",
                         json={"latitude": 40.6396, "longitude": -73.6665, "accuracy": 5.0},
                         headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "saved" in data
        assert "step_meters" in data

    def test_position_accumulates_into_daily(self, session, auth_headers, db, camper_auth):
        _, me = camper_auth
        ymd = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        # Clean baseline for this camper today
        _run(db.camper_distance_daily.delete_one({"camper_id": me["id"], "date_ymd": ymd}))
        # Prime prev position
        session.post(f"{API}/camper/position",
                     json={"latitude": 40.7000, "longitude": -73.7000},
                     headers=auth_headers, timeout=15)
        # Hop ~11 m north (1e-4 deg lat ≈ 11.1 m) several times with throttle-bypass delay
        import time
        last_lat = 40.7000
        accumulated_expected = 0.0
        for i in range(1, 4):
            time.sleep(0.1)
            new_lat = 40.7000 + i * 0.0001  # +11m each step
            r = session.post(f"{API}/camper/position",
                             json={"latitude": new_lat, "longitude": -73.7000},
                             headers=auth_headers, timeout=15)
            assert r.status_code == 200
            body = r.json()
            # server may throttle because dt<20s AND dist<5 — but 11 m > 5 so should save
            if body.get("saved"):
                accumulated_expected += body.get("step_meters", 0)
            last_lat = new_lat
        # Check DB
        doc = _run(db.camper_distance_daily.find_one({"camper_id": me["id"], "date_ymd": ymd}))
        assert doc is not None, "camper_distance_daily not created after multi-hop"
        assert doc["meters"] > 0, f"Expected meters>0, got {doc}"
        # Should be roughly the accumulated step_meters the server reported
        if accumulated_expected > 0:
            assert doc["meters"] >= accumulated_expected * 0.9, \
                f"DB meters ({doc['meters']}) << reported accum ({accumulated_expected})"
        # Cleanup
        _run(db.camper_distance_daily.delete_one({"camper_id": me["id"], "date_ymd": ymd}))

    def test_position_ignores_gps_jump(self, session, auth_headers, db, camper_auth):
        """A huge (>200m) jump should not add meters."""
        _, me = camper_auth
        ymd = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        _run(db.camper_distance_daily.delete_one({"camper_id": me["id"], "date_ymd": ymd}))
        # Baseline
        session.post(f"{API}/camper/position",
                     json={"latitude": 10.0, "longitude": 10.0},
                     headers=auth_headers, timeout=15)
        # Big jump ~ 1 deg ≈ 111 km
        r = session.post(f"{API}/camper/position",
                         json={"latitude": 11.0, "longitude": 10.0},
                         headers=auth_headers, timeout=15)
        assert r.status_code == 200
        doc = _run(db.camper_distance_daily.find_one({"camper_id": me["id"], "date_ymd": ymd}))
        # Should NOT have been inserted because dist_m > 200 cap
        assert doc is None or doc.get("meters", 0) == 0, \
            f"GPS jump should not accumulate; got {doc}"
        # Cleanup (just in case)
        _run(db.camper_distance_daily.delete_one({"camper_id": me["id"], "date_ymd": ymd}))
