"""Iteration 20 — RRDC GO Tier 5 backend tests.

Covers (PRIMARY):
  * Raid-defeat regression fix (was the failing test in iter_19):
      - status flips to defeated atomically
      - every participant gets a synthetic catch (is_raid=True, ball_type='raid',
        caught_by uses first_name + ' ' + last_name)
      - +3 candies per participant for the boss species
      - returned RaidThrowResult has defeated=True + pokemon=PokemonOut + power_rolled set
  * Concurrent killing-blow: only one throw runs the reward loop (atomic flip)
  * cry_audio_url field on PokemonOut/PokemonUpdate end-to-end
"""
import os
import asyncio
import datetime as _dt
import threading
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Camp1993")

RAID_PIN_LAT = 40.6396
RAID_PIN_LNG = -73.6665


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _auth(t):
    return {"Authorization": f"Bearer {t}"}


def _admin_token(s):
    r = s.post(f"{API}/admin/auth/login", json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _camper_login(s, group, idx=0):
    r = s.get(f"{API}/groups/{group}/campers")
    assert r.status_code == 200
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
def camper_a(session):
    return _camper_login(session, "B01", 5)


@pytest.fixture(scope="module")
def camper_b(session):
    return _camper_login(session, "B01", 6)


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


async def _seed_position(camper_id, lat, lng):
    db, client = _get_db()
    iso = _dt.datetime.now(_dt.timezone.utc).isoformat()
    await db.camper_positions.update_one(
        {"camper_id": camper_id},
        {"$set": {"camper_id": camper_id, "latitude": lat, "longitude": lng, "updated_at": iso}},
        upsert=True,
    )
    client.close()


async def _seed_wallet(camper_id, ball, count):
    db, client = _get_db()
    await db.camper_wallets.update_one(
        {"camper_id": camper_id},
        {"$set": {f"balances.{ball}": int(count), "updated_at": _dt.datetime.now(_dt.timezone.utc).isoformat()}},
        upsert=True,
    )
    client.close()


async def _force_raid_active(raid_id, max_hp=4):
    db, client = _get_db()
    now = _dt.datetime.now(_dt.timezone.utc)
    await db.raids.update_one({"id": raid_id}, {"$set": {
        "start_at": (now - _dt.timedelta(minutes=1)).isoformat(),
        "end_at": (now + _dt.timedelta(minutes=30)).isoformat(),
        "status": "scheduled",
        "latitude": RAID_PIN_LAT, "longitude": RAID_PIN_LNG,
        "damage_dealt": 0, "participants": [], "max_hp": int(max_hp),
    }})
    client.close()


async def _get_catches(camper_id, raid_id):
    db, client = _get_db()
    rows = []
    async for c in db.catches.find({"group_id": camper_id, "raid_id": raid_id}, {"_id": 0}):
        rows.append(c)
    client.close()
    return rows


async def _candies(camper_id, pokemon_id):
    db, client = _get_db()
    r = await db.camper_pokemon_candies.find_one({"camper_id": camper_id, "pokemon_id": pokemon_id}, {"_id": 0})
    client.close()
    return int((r or {}).get("candies", 0))


async def _raid_doc(raid_id):
    db, client = _get_db()
    d = await db.raids.find_one({"id": raid_id}, {"_id": 0})
    client.close()
    return d


def _ensure_pokemon(s, t):
    rows = s.get(f"{API}/admin/pokemon", headers=_auth(t)).json()
    for p in rows:
        if p.get("active"):
            return p
    return rows[0]


# ---------------------------------------------------------------------------
# PRIMARY: raid defeat regression
# ---------------------------------------------------------------------------
class TestRaidDefeatRegression:
    def _make(self, s, t, label, max_hp=4):
        pk = _ensure_pokemon(s, t)
        body = {
            "pokemon_id": pk["id"],
            "start_at": (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(minutes=1)).isoformat(),
            "duration_minutes": 30,
            "label": label,
            "latitude": RAID_PIN_LAT, "longitude": RAID_PIN_LNG,
        }
        rid = s.post(f"{API}/admin/raids", json=body, headers=_auth(t)).json()["id"]
        run(_force_raid_active(rid, max_hp=max_hp))
        return rid, pk

    def test_defeat_grants_catch_to_all_participants(self, session, admin_token, camper_a, camper_b):
        rid, pk = self._make(session, admin_token, "TEST_iter20_defeat", max_hp=4)
        tA, idA, _ = camper_a
        tB, idB, camperB = camper_b
        run(_seed_position(idA, RAID_PIN_LAT, RAID_PIN_LNG))
        run(_seed_position(idB, RAID_PIN_LAT, RAID_PIN_LNG))
        run(_seed_wallet(idA, "pokeball", 5))
        run(_seed_wallet(idB, "pokeball", 5))
        candA0 = run(_candies(idA, pk["id"]))
        candB0 = run(_candies(idB, pk["id"]))
        # A: 2 throws (2 dmg). B: 1 throw (3 dmg). B kills with 4th (4 dmg).
        for _ in range(2):
            r = session.post(f"{API}/raids/{rid}/throw", params={"ball_type": "pokeball"}, headers=_auth(tA))
            assert r.status_code == 200, r.text
            assert r.json()["defeated"] is False
        r = session.post(f"{API}/raids/{rid}/throw", params={"ball_type": "pokeball"}, headers=_auth(tB))
        assert r.status_code == 200
        assert r.json()["defeated"] is False
        # Killing blow
        r = session.post(f"{API}/raids/{rid}/throw", params={"ball_type": "pokeball"}, headers=_auth(tB))
        assert r.status_code == 200, r.text
        j = r.json()
        # (a) defeated=True, pokemon=PokemonOut, power_rolled set
        assert j["defeated"] is True
        assert j.get("pokemon") is not None
        assert isinstance(j["pokemon"], dict) and j["pokemon"]["id"] == pk["id"]
        assert j.get("power_rolled") is not None
        assert isinstance(j["power_rolled"], int) and 1 <= j["power_rolled"] <= 1000
        # (a) status=defeated atomically
        d = run(_raid_doc(rid))
        assert d["status"] == "defeated"
        # (b) every participant got synthetic catch with required fields
        for cid, camper in [(idA, None), (idB, camperB)]:
            catches = run(_get_catches(cid, rid))
            assert len(catches) == 1, f"{cid} expected 1 raid catch, got {len(catches)}"
            c = catches[0]
            assert c["is_raid"] is True
            assert c["ball_type"] == "raid"
            assert c["pokemon_id"] == pk["id"]
            # caught_by uses first_name + ' ' + last_name (NOT 'Camper' fallback)
            assert c["caught_by"] and c["caught_by"] != "Camper", f"caught_by fallback: {c}"
            assert " " in c["caught_by"], f"caught_by should be 'first last': {c['caught_by']}"
        # (c) +3 candies per participant
        assert run(_candies(idA, pk["id"])) - candA0 == 3
        assert run(_candies(idB, pk["id"])) - candB0 == 3
        # Subsequent throw rejected
        r = session.post(f"{API}/raids/{rid}/throw", params={"ball_type": "pokeball"}, headers=_auth(tA))
        assert r.status_code == 400
        session.delete(f"{API}/admin/raids/{rid}", headers=_auth(admin_token))

    def test_concurrent_killing_blow_atomic(self, session, admin_token, camper_a, camper_b):
        # max_hp=2: a single throw of pokeball=1 from each fired in parallel both cross threshold
        # Only ONE should run reward loop. Total catches per participant should be exactly 1.
        rid, pk = self._make(session, admin_token, "TEST_iter20_concurrent", max_hp=2)
        tA, idA, _ = camper_a
        tB, idB, _ = camper_b
        run(_seed_position(idA, RAID_PIN_LAT, RAID_PIN_LNG))
        run(_seed_position(idB, RAID_PIN_LAT, RAID_PIN_LNG))
        run(_seed_wallet(idA, "pokeball", 5))
        run(_seed_wallet(idB, "pokeball", 5))
        candA0 = run(_candies(idA, pk["id"]))
        candB0 = run(_candies(idB, pk["id"])) 

        results = []
        def fire(tok):
            try:
                r = requests.post(f"{API}/raids/{rid}/throw", params={"ball_type": "pokeball"}, headers=_auth(tok), timeout=15)
                results.append((r.status_code, r.json() if r.headers.get("content-type", "").startswith("application/json") else r.text))
            except Exception as e:
                results.append((0, str(e)))
        threads = [threading.Thread(target=fire, args=(tok,)) for tok in (tA, tB)]
        for th in threads: th.start()
        for th in threads: th.join()
        assert len(results) == 2
        # Both should be 200 (one defeats, the other either added participant before flip, or got no-op success)
        statuses = sorted([r[0] for r in results])
        assert statuses == [200, 200], f"Expected both 200, got {results}"
        # Final raid state: defeated
        d = run(_raid_doc(rid))
        assert d["status"] == "defeated"
        # Participants: at least one of A/B (race may have only registered one before flip)
        participants = d.get("participants", [])
        assert len(participants) >= 1
        # No double-rewards: each participant in the raid doc has exactly ONE synthetic catch
        for cid in participants:
            catches = run(_get_catches(cid, rid))
            assert len(catches) == 1, f"Participant {cid} got {len(catches)} catches (expected 1) — double-reward race!"
        # Candy gain is +3 per participant (NOT +6)
        if idA in participants:
            assert run(_candies(idA, pk["id"])) - candA0 == 3
        if idB in participants:
            assert run(_candies(idB, pk["id"])) - candB0 == 3
        session.delete(f"{API}/admin/raids/{rid}", headers=_auth(admin_token))


# ---------------------------------------------------------------------------
# cry_audio_url field
# ---------------------------------------------------------------------------
class TestCryAudioUrl:
    SAMPLE = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA="

    def test_pokemon_out_includes_cry_audio_url_key(self, session, admin_token):
        rows = session.get(f"{API}/admin/pokemon", headers=_auth(admin_token)).json()
        assert rows
        # Key must always be present (default '')
        for p in rows[:3]:
            assert "cry_audio_url" in p, f"missing key on pokemon {p.get('id')}"
            assert isinstance(p["cry_audio_url"], str)

    def test_patch_persists_cry_audio_url(self, session, admin_token):
        rows = session.get(f"{API}/admin/pokemon", headers=_auth(admin_token)).json()
        assert rows
        target = rows[0]
        pid = target["id"]
        # PATCH with the data URL
        r = session.patch(f"{API}/admin/pokemon/{pid}", json={"cry_audio_url": self.SAMPLE}, headers=_auth(admin_token))
        assert r.status_code == 200, r.text
        assert r.json()["cry_audio_url"] == self.SAMPLE

        # GET round-trip
        rows2 = session.get(f"{API}/admin/pokemon", headers=_auth(admin_token)).json()
        match = next((p for p in rows2 if p["id"] == pid), None)
        assert match is not None
        assert match["cry_audio_url"] == self.SAMPLE

        # Clear by setting empty string
        r = session.patch(f"{API}/admin/pokemon/{pid}", json={"cry_audio_url": ""}, headers=_auth(admin_token))
        assert r.status_code == 200
        assert r.json()["cry_audio_url"] == ""


# ---------------------------------------------------------------------------
# Quick regressions
# ---------------------------------------------------------------------------
class TestRegressions:
    def test_admin_login(self, session):
        r = session.post(f"{API}/admin/auth/login", json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD})
        assert r.status_code == 200

    def test_active_raids_endpoint(self, session, camper_a):
        tA, _, _ = camper_a
        r = session.get(f"{API}/raids/active", headers=_auth(tA))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_admin_raids_list(self, session, admin_token):
        r = session.get(f"{API}/admin/raids", headers=_auth(admin_token))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_streak_endpoint(self, session, camper_a):
        tA, _, _ = camper_a
        r = session.get(f"{API}/streak", headers=_auth(tA))
        assert r.status_code == 200
