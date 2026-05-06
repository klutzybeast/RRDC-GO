"""Iteration 19 — RRDC GO Tier 4 backend tests.

Covers:
  * GET /api/map/group-positions (kid-safe, group-scoped, first-name only)
    + SpawnConfig.show_group_positions admin toggle
  * Admin raids: GET/POST/DELETE /api/admin/raids and POST /api/admin/raids/{id}/end
  * Camper raids: GET /api/raids/active, GET /api/raids/{id}, POST /api/raids/{id}/throw
  * Raid HP scaling by rarity (RAID_HP_BY_RARITY)
  * Raid throw: engage radius (30m), ball charge, damage by ball, participant set,
    multi-throw defeat → synthetic catch + 3 candies for ALL participants
  * Raid scoping by group_code (B01 vs B02 vs all-groups null)
  * Regression: /spawn/catch path, /streak, /buddy, /evolve, /admin/events, /admin/pokemon
    + pokemon_to_out includes evolution fields (iter_18 fix verification)
"""
import os
import asyncio
import datetime as _dt
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Camp1993")

# Match server constants
RAID_HP_BY_RARITY = {"common": 10, "uncommon": 18, "rare": 30, "legendary": 60}
RAID_PIN_LAT = 40.6396
RAID_PIN_LNG = -73.6665


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _admin_token(s):
    r = s.post(f"{API}/admin/auth/login", json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _camper_login(s, group, idx=0):
    r = s.get(f"{API}/groups/{group}/campers")
    assert r.status_code == 200, r.text
    payload = r.json()
    campers = payload.get("campers") if isinstance(payload, dict) else payload
    cid = campers[idx]["id"]
    r2 = s.post(f"{API}/camper/login", json={"camper_id": cid})
    assert r2.status_code == 200, r2.text
    return r2.json()["access_token"], cid, campers[idx]


@pytest.fixture(scope="module")
def admin_token(session):
    return _admin_token(session)


@pytest.fixture(scope="module")
def camper_b01_a(session):
    return _camper_login(session, "B01", 5)


@pytest.fixture(scope="module")
def camper_b01_b(session):
    return _camper_login(session, "B01", 6)


@pytest.fixture(scope="module")
def camper_b02(session):
    # Used for cross-group scoping tests
    return _camper_login(session, "B02", 0)


def _get_db():
    from motor.motor_asyncio import AsyncIOMotorClient
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME", "test_database")
    client = AsyncIOMotorClient(mongo_url)
    return client[db_name], client


def run(coro):
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            raise RuntimeError
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)


async def _seed_position(camper_id, lat, lng, when=None):
    db, client = _get_db()
    iso = (when or _dt.datetime.now(_dt.timezone.utc)).isoformat()
    await db.camper_positions.update_one(
        {"camper_id": camper_id},
        {"$set": {"camper_id": camper_id, "latitude": lat, "longitude": lng, "updated_at": iso}},
        upsert=True,
    )
    client.close()


async def _seed_wallet_balls(camper_id, ball, count):
    db, client = _get_db()
    await db.camper_wallets.update_one(
        {"camper_id": camper_id},
        {"$set": {f"balances.{ball}": int(count), "updated_at": _dt.datetime.now(_dt.timezone.utc).isoformat()}},
        upsert=True,
    )
    client.close()


async def _delete_camper_positions(camper_id):
    db, client = _get_db()
    await db.camper_positions.delete_many({"camper_id": camper_id})
    client.close()


async def _cleanup_raids():
    db, client = _get_db()
    await db.raids.delete_many({"label": {"$regex": "^TEST_"}})
    client.close()


async def _force_raid_active(raid_id, lat=RAID_PIN_LAT, lng=RAID_PIN_LNG, group_code=None, max_hp=None):
    """Set start_at to now-1m, end_at to now+30m, status active. Optionally re-pin lat/lng + group + hp."""
    db, client = _get_db()
    now = _dt.datetime.now(_dt.timezone.utc)
    upd = {
        "start_at": (now - _dt.timedelta(minutes=1)).isoformat(),
        "end_at": (now + _dt.timedelta(minutes=30)).isoformat(),
        "status": "scheduled",  # _raid_to_out re-derives "active" if dmg<hp
        "latitude": lat,
        "longitude": lng,
        "damage_dealt": 0,
        "participants": [],
    }
    if group_code is not None:
        upd["group_code"] = (group_code or "").upper() or None
    if max_hp is not None:
        upd["max_hp"] = int(max_hp)
    await db.raids.update_one({"id": raid_id}, {"$set": upd})
    client.close()


async def _get_raid_doc(raid_id):
    db, client = _get_db()
    d = await db.raids.find_one({"id": raid_id}, {"_id": 0})
    client.close()
    return d


async def _count_synthetic_catches(camper_id, raid_id):
    db, client = _get_db()
    n = await db.catches.count_documents({"group_id": camper_id, "raid_id": raid_id, "is_raid": True})
    client.close()
    return n


async def _candies_for(camper_id, pokemon_id):
    db, client = _get_db()
    r = await db.camper_pokemon_candies.find_one({"camper_id": camper_id, "pokemon_id": pokemon_id}, {"_id": 0})
    client.close()
    return int((r or {}).get("candies", 0))


# ---------------------------------------------------------------------------
# /map/group-positions
# ---------------------------------------------------------------------------
class TestGroupPositions:
    def test_excludes_requester_and_first_name_only(self, session, camper_b01_a, camper_b01_b, admin_token):
        tA, idA, _camperA = camper_b01_a
        tB, idB, camperB = camper_b01_b
        # Ensure feature is ON
        cfg = session.get(f"{API}/admin/spawn-config", headers=_auth(admin_token)).json()
        cfg["show_group_positions"] = True
        r = session.put(f"{API}/admin/spawn-config", json=cfg, headers=_auth(admin_token))
        assert r.status_code == 200
        # Seed B's position so it's fresh
        run(_seed_position(idB, 40.6396, -73.6665))
        # A queries — should see B but NOT itself
        r = session.get(f"{API}/map/group-positions", headers=_auth(tA))
        assert r.status_code == 200, r.text
        rows = r.json()
        ids = [x["camper_id"] for x in rows]
        assert idA not in ids
        # B should appear (or at least one peer with first-name only)
        assert any(x["camper_id"] == idB for x in rows), f"B not in peer rows: {rows}"
        for x in rows:
            assert "first_name" in x and x["first_name"]
            # Must not leak last name fields
            assert "last_name" not in x
            assert "username" not in x

    def test_filters_stale_positions(self, session, camper_b01_a, camper_b01_b):
        tA, idA, _ = camper_b01_a
        _, idB, _ = camper_b01_b
        # Seed B with position older than 10 min
        old = _dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(minutes=15)
        run(_seed_position(idB, 40.6396, -73.6665, when=old))
        r = session.get(f"{API}/map/group-positions", headers=_auth(tA))
        assert r.status_code == 200
        ids = [x["camper_id"] for x in r.json()]
        assert idB not in ids, "Stale position should be filtered"
        # Restore
        run(_seed_position(idB, 40.6396, -73.6665))

    def test_disabled_returns_empty(self, session, camper_b01_a, admin_token):
        tA, idA, _ = camper_b01_a
        cfg = session.get(f"{API}/admin/spawn-config", headers=_auth(admin_token)).json()
        cfg["show_group_positions"] = False
        session.put(f"{API}/admin/spawn-config", json=cfg, headers=_auth(admin_token))
        r = session.get(f"{API}/map/group-positions", headers=_auth(tA))
        assert r.status_code == 200
        assert r.json() == []
        # Restore
        cfg["show_group_positions"] = True
        session.put(f"{API}/admin/spawn-config", json=cfg, headers=_auth(admin_token))


# ---------------------------------------------------------------------------
# Admin raids CRUD
# ---------------------------------------------------------------------------
def _ensure_pokemon(session, admin_token, rarity="common"):
    """Pick or create an active pokemon of the given rarity."""
    r = session.get(f"{API}/admin/pokemon", headers=_auth(admin_token))
    assert r.status_code == 200
    for p in r.json():
        if p.get("rarity") == rarity and p.get("active"):
            return p
    # Fallback: pick any pokemon and return it (rarity will determine HP)
    rows = r.json()
    assert rows, "no pokemon seeded"
    return rows[0]


class TestAdminRaidCRUD:
    def test_404_for_unknown_pokemon(self, session, admin_token):
        run(_cleanup_raids())
        body = {
            "pokemon_id": "does-not-exist",
            "start_at": _dt.datetime.now(_dt.timezone.utc).isoformat(),
            "duration_minutes": 15,
            "label": "TEST_404",
        }
        r = session.post(f"{API}/admin/raids", json=body, headers=_auth(admin_token))
        assert r.status_code == 404, r.text

    def test_400_for_bad_duration(self, session, admin_token):
        pk = _ensure_pokemon(session, admin_token)
        for bad in (0, -5, 121, 9999):
            body = {
                "pokemon_id": pk["id"],
                "start_at": _dt.datetime.now(_dt.timezone.utc).isoformat(),
                "duration_minutes": bad,
                "label": f"TEST_dur{bad}",
            }
            r = session.post(f"{API}/admin/raids", json=body, headers=_auth(admin_token))
            assert r.status_code == 400, f"duration={bad} → {r.status_code} {r.text}"

    def test_create_seeds_max_hp_from_rarity(self, session, admin_token):
        # Try every rarity available in the catalog
        seen = {}
        rows = session.get(f"{API}/admin/pokemon", headers=_auth(admin_token)).json()
        for p in rows:
            rar = p.get("rarity", "common")
            if rar in seen or rar not in RAID_HP_BY_RARITY:
                continue
            body = {
                "pokemon_id": p["id"],
                "start_at": _dt.datetime.now(_dt.timezone.utc).isoformat(),
                "duration_minutes": 15,
                "label": f"TEST_hp_{rar}",
            }
            r = session.post(f"{API}/admin/raids", json=body, headers=_auth(admin_token))
            assert r.status_code == 200, r.text
            j = r.json()
            assert j["max_hp"] == RAID_HP_BY_RARITY[rar], f"{rar}: {j['max_hp']}"
            seen[rar] = j["id"]
        assert seen, "no pokemon found to test rarity HP"
        # cleanup
        for rid in seen.values():
            session.delete(f"{API}/admin/raids/{rid}", headers=_auth(admin_token))

    def test_admin_only(self, session):
        r = session.get(f"{API}/admin/raids")
        assert r.status_code in (401, 403)
        r = session.post(f"{API}/admin/raids", json={"pokemon_id": "x", "start_at": _dt.datetime.now(_dt.timezone.utc).isoformat()})
        assert r.status_code in (401, 403)

    def test_force_end_and_delete(self, session, admin_token):
        pk = _ensure_pokemon(session, admin_token)
        body = {"pokemon_id": pk["id"], "start_at": _dt.datetime.now(_dt.timezone.utc).isoformat(),
                "duration_minutes": 15, "label": "TEST_endme"}
        rid = session.post(f"{API}/admin/raids", json=body, headers=_auth(admin_token)).json()["id"]
        r = session.post(f"{API}/admin/raids/{rid}/end", headers=_auth(admin_token))
        assert r.status_code == 200
        # Verify status flipped
        d = run(_get_raid_doc(rid))
        assert d["status"] == "expired"
        r = session.delete(f"{API}/admin/raids/{rid}", headers=_auth(admin_token))
        assert r.status_code == 200
        d = run(_get_raid_doc(rid))
        assert d is None

    def test_force_end_404(self, session, admin_token):
        r = session.post(f"{API}/admin/raids/nope/end", headers=_auth(admin_token))
        assert r.status_code == 404


# ---------------------------------------------------------------------------
# Camper raid endpoints + scoping
# ---------------------------------------------------------------------------
class TestRaidScoping:
    def test_group_scoped_excludes_other_group(self, session, admin_token, camper_b01_a, camper_b02):
        pk = _ensure_pokemon(session, admin_token)
        body = {
            "pokemon_id": pk["id"],
            "start_at": (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(minutes=1)).isoformat(),
            "duration_minutes": 15,
            "label": "TEST_b01_only",
            "group_code": "B01",
            "latitude": RAID_PIN_LAT, "longitude": RAID_PIN_LNG,
        }
        rid = session.post(f"{API}/admin/raids", json=body, headers=_auth(admin_token)).json()["id"]
        tA, _, _ = camper_b01_a
        tB2, _, _ = camper_b02
        rA = session.get(f"{API}/raids/active", headers=_auth(tA)).json()
        rB2 = session.get(f"{API}/raids/active", headers=_auth(tB2)).json()
        assert any(r["id"] == rid for r in rA), "B01 camper should see B01-scoped raid"
        assert not any(r["id"] == rid for r in rB2), "B02 camper must NOT see B01-scoped raid"
        session.delete(f"{API}/admin/raids/{rid}", headers=_auth(admin_token))

    def test_null_group_visible_to_all(self, session, admin_token, camper_b01_a, camper_b02):
        pk = _ensure_pokemon(session, admin_token)
        body = {
            "pokemon_id": pk["id"],
            "start_at": (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(minutes=1)).isoformat(),
            "duration_minutes": 15,
            "label": "TEST_open_to_all",
            "latitude": RAID_PIN_LAT, "longitude": RAID_PIN_LNG,
        }
        rid = session.post(f"{API}/admin/raids", json=body, headers=_auth(admin_token)).json()["id"]
        tA, _, _ = camper_b01_a
        tB2, _, _ = camper_b02
        rA = session.get(f"{API}/raids/active", headers=_auth(tA)).json()
        rB2 = session.get(f"{API}/raids/active", headers=_auth(tB2)).json()
        assert any(r["id"] == rid for r in rA)
        assert any(r["id"] == rid for r in rB2)
        session.delete(f"{API}/admin/raids/{rid}", headers=_auth(admin_token))


# ---------------------------------------------------------------------------
# Raid throw mechanics
# ---------------------------------------------------------------------------
class TestRaidThrow:
    def _make_raid(self, session, admin_token, label, max_hp_override=None):
        pk = _ensure_pokemon(session, admin_token, rarity="common")
        body = {
            "pokemon_id": pk["id"],
            "start_at": (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(minutes=1)).isoformat(),
            "duration_minutes": 30,
            "label": label,
            "latitude": RAID_PIN_LAT, "longitude": RAID_PIN_LNG,
        }
        rid = session.post(f"{API}/admin/raids", json=body, headers=_auth(admin_token)).json()["id"]
        if max_hp_override:
            run(_force_raid_active(rid, max_hp=max_hp_override))
        return rid, pk["id"]

    def test_400_when_not_active(self, session, admin_token, camper_b01_a):
        # Schedule a future raid
        pk = _ensure_pokemon(session, admin_token, rarity="common")
        body = {
            "pokemon_id": pk["id"],
            "start_at": (_dt.datetime.now(_dt.timezone.utc) + _dt.timedelta(minutes=30)).isoformat(),
            "duration_minutes": 15,
            "label": "TEST_future",
            "latitude": RAID_PIN_LAT, "longitude": RAID_PIN_LNG,
        }
        rid = session.post(f"{API}/admin/raids", json=body, headers=_auth(admin_token)).json()["id"]
        tA, idA, _ = camper_b01_a
        run(_seed_position(idA, RAID_PIN_LAT, RAID_PIN_LNG))
        r = session.post(f"{API}/raids/{rid}/throw", params={"ball_type": "pokeball"}, headers=_auth(tA))
        assert r.status_code == 400
        session.delete(f"{API}/admin/raids/{rid}", headers=_auth(admin_token))

    def test_400_when_too_far(self, session, admin_token, camper_b01_a):
        rid, _ = self._make_raid(session, admin_token, "TEST_far")
        tA, idA, _ = camper_b01_a
        # Place camper ~500m away (~0.005 lat ≈ 555m)
        run(_seed_position(idA, RAID_PIN_LAT + 0.01, RAID_PIN_LNG))
        run(_seed_wallet_balls(idA, "pokeball", 5))
        r = session.post(f"{API}/raids/{rid}/throw", params={"ball_type": "pokeball"}, headers=_auth(tA))
        assert r.status_code == 400, r.text
        session.delete(f"{API}/admin/raids/{rid}", headers=_auth(admin_token))

    def test_400_when_wrong_group(self, session, admin_token, camper_b02):
        # B01-scoped raid; B02 tries to throw
        pk = _ensure_pokemon(session, admin_token, rarity="common")
        body = {
            "pokemon_id": pk["id"],
            "start_at": (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(minutes=1)).isoformat(),
            "duration_minutes": 30,
            "label": "TEST_b01_only_throw",
            "group_code": "B01",
            "latitude": RAID_PIN_LAT, "longitude": RAID_PIN_LNG,
        }
        rid = session.post(f"{API}/admin/raids", json=body, headers=_auth(admin_token)).json()["id"]
        tB2, idB2, _ = camper_b02
        run(_seed_position(idB2, RAID_PIN_LAT, RAID_PIN_LNG))
        run(_seed_wallet_balls(idB2, "pokeball", 5))
        r = session.post(f"{API}/raids/{rid}/throw", params={"ball_type": "pokeball"}, headers=_auth(tB2))
        assert r.status_code == 400
        session.delete(f"{API}/admin/raids/{rid}", headers=_auth(admin_token))

    def test_throw_deals_damage_charges_ball_and_adds_participant(self, session, admin_token, camper_b01_a):
        rid, pkid = self._make_raid(session, admin_token, "TEST_dmg", max_hp_override=50)
        tA, idA, _ = camper_b01_a
        run(_seed_position(idA, RAID_PIN_LAT, RAID_PIN_LNG))
        run(_seed_wallet_balls(idA, "pokeball", 10))
        # pokeball → 1 dmg
        r = session.post(f"{API}/raids/{rid}/throw", params={"ball_type": "pokeball"}, headers=_auth(tA))
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["damage_dealt"] == 1
        assert j["max_hp"] == 50
        assert j["defeated"] is False
        # Wallet decremented
        assert int(j["balances"].get("pokeball", 0)) == 9
        # Participant set updated
        d = run(_get_raid_doc(rid))
        assert idA in d["participants"]
        # rayball=2
        run(_seed_wallet_balls(idA, "rayball", 5))
        r = session.post(f"{API}/raids/{rid}/throw", params={"ball_type": "rayball"}, headers=_auth(tA))
        assert r.status_code == 200
        assert r.json()["damage_dealt"] == 3  # 1 + 2
        # lunchball=3
        run(_seed_wallet_balls(idA, "lunchball", 5))
        r = session.post(f"{API}/raids/{rid}/throw", params={"ball_type": "lunchball"}, headers=_auth(tA))
        assert r.status_code == 200
        assert r.json()["damage_dealt"] == 6  # 3 + 3
        session.delete(f"{API}/admin/raids/{rid}", headers=_auth(admin_token))

    def test_400_when_out_of_balls(self, session, admin_token, camper_b01_a):
        rid, _ = self._make_raid(session, admin_token, "TEST_noballs")
        tA, idA, _ = camper_b01_a
        run(_seed_position(idA, RAID_PIN_LAT, RAID_PIN_LNG))
        run(_seed_wallet_balls(idA, "myrtleball", 0))
        r = session.post(f"{API}/raids/{rid}/throw", params={"ball_type": "myrtleball"}, headers=_auth(tA))
        assert r.status_code == 400
        session.delete(f"{API}/admin/raids/{rid}", headers=_auth(admin_token))

    def test_defeat_grants_catch_and_candies_to_all_participants(self, session, admin_token, camper_b01_a, camper_b01_b):
        rid, pkid = self._make_raid(session, admin_token, "TEST_defeat", max_hp_override=4)
        tA, idA, _ = camper_b01_a
        tB, idB, _ = camper_b01_b
        run(_seed_position(idA, RAID_PIN_LAT, RAID_PIN_LNG))
        run(_seed_position(idB, RAID_PIN_LAT, RAID_PIN_LNG))
        run(_seed_wallet_balls(idA, "pokeball", 5))
        run(_seed_wallet_balls(idB, "pokeball", 5))
        candies_a_before = run(_candies_for(idA, pkid))
        candies_b_before = run(_candies_for(idB, pkid))
        # A throws twice (2 dmg), B throws twice (2 dmg) → 4 dmg total → defeated on B's 2nd throw
        for _ in range(2):
            r = session.post(f"{API}/raids/{rid}/throw", params={"ball_type": "pokeball"}, headers=_auth(tA))
            assert r.status_code == 200, r.text
            assert r.json()["defeated"] is False
        r = session.post(f"{API}/raids/{rid}/throw", params={"ball_type": "pokeball"}, headers=_auth(tB))
        assert r.status_code == 200
        assert r.json()["defeated"] is False
        # final throw → defeats
        r = session.post(f"{API}/raids/{rid}/throw", params={"ball_type": "pokeball"}, headers=_auth(tB))
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["defeated"] is True, j
        assert j["damage_dealt"] >= 4
        # Both participants got synthetic catch
        assert run(_count_synthetic_catches(idA, rid)) == 1, "A missing synthetic catch"
        assert run(_count_synthetic_catches(idB, rid)) == 1, "B missing synthetic catch"
        # Candies +3 each
        assert run(_candies_for(idA, pkid)) - candies_a_before == 3
        assert run(_candies_for(idB, pkid)) - candies_b_before == 3
        # Subsequent throws are rejected because raid is no longer active
        r = session.post(f"{API}/raids/{rid}/throw", params={"ball_type": "pokeball"}, headers=_auth(tA))
        assert r.status_code == 400
        # Verify catch fields
        from motor.motor_asyncio import AsyncIOMotorClient
        db, client = _get_db()
        doc = run(db.catches.find_one({"group_id": idA, "raid_id": rid}, {"_id": 0}))
        client.close()
        assert doc["ball_type"] == "raid"
        assert doc["is_raid"] is True
        assert doc["pokemon_id"] == pkid
        session.delete(f"{API}/admin/raids/{rid}", headers=_auth(admin_token))


# ---------------------------------------------------------------------------
# Regressions (iter 18 + earlier)
# ---------------------------------------------------------------------------
class TestRegressions:
    def test_admin_login(self, session):
        r = session.post(f"{API}/admin/auth/login", json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD})
        assert r.status_code == 200
        assert "access_token" in r.json()

    def test_admin_pokemon_serialises_evolution_fields(self, session, admin_token):
        # iter_18 fix verification
        rows = session.get(f"{API}/admin/pokemon", headers=_auth(admin_token)).json()
        assert rows
        sample = rows[0]
        # Even if null, key must exist
        assert "evolution_target_id" in sample
        assert "evolution_cost" in sample

    def test_streak_endpoint_unchanged(self, session, camper_b01_a):
        tA, _, _ = camper_b01_a
        r = session.get(f"{API}/streak", headers=_auth(tA))
        assert r.status_code == 200
        assert "current_streak" in r.json()

    def test_admin_events_endpoint_unchanged(self, session, admin_token):
        r = session.get(f"{API}/admin/events", headers=_auth(admin_token))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_admin_raids_list_smoke(self, session, admin_token):
        r = session.get(f"{API}/admin/raids", headers=_auth(admin_token))
        assert r.status_code == 200
        assert isinstance(r.json(), list)
