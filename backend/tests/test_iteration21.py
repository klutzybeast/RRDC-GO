"""Iteration 21 — RRDC GO Tier 5/6 backend tests.

Covers:
  * Friends list (same-group only, [] when social_enabled=False)
  * Daily gifts: send / inbox / open (incl. cooldown, cross-group, self-gift)
  * Trades: propose / accept (proximity-gated) / reject / revert
  * Admin trade revert (no window restriction)
  * Social toggle gating
  * Quick regressions on iter_18..20 endpoints
"""
import os
import asyncio
import datetime as _dt
import uuid as _uuid
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Camp1993")

PIN_LAT = 40.6396
PIN_LNG = -73.6665


# ---------------------------------------------------------------------------
# Fixtures + helpers
# ---------------------------------------------------------------------------

def _auth(t):
    return {"Authorization": f"Bearer {t}"}


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


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _admin_token(s):
    r = s.post(f"{API}/admin/auth/login", json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_token(session):
    return _admin_token(session)


def _camper_login(s, group, idx):
    r = s.get(f"{API}/groups/{group}/campers")
    assert r.status_code == 200, r.text
    payload = r.json()
    campers = payload.get("campers") if isinstance(payload, dict) else payload
    cid = campers[idx]["id"]
    r2 = s.post(f"{API}/camper/login", json={"camper_id": cid})
    assert r2.status_code == 200, r2.text
    return r2.json()["access_token"], cid, campers[idx]


@pytest.fixture(scope="module")
def camper_a(session):
    return _camper_login(session, "B01", 0)


@pytest.fixture(scope="module")
def camper_b(session):
    return _camper_login(session, "B01", 1)


# Cross-group camper for negative tests
@pytest.fixture(scope="module")
def camper_other_group(session):
    # Try a few groups to find a different one
    for g in ("G01", "B02", "G02"):
        r = s = session.get(f"{API}/groups/{g}/campers")
        if r.status_code == 200:
            payload = r.json()
            campers = payload.get("campers") if isinstance(payload, dict) else payload
            if campers:
                return _camper_login(session, g, 0)
    pytest.skip("No alternate group found for cross-group test")


@pytest.fixture(scope="module")
def active_pokemon(session, admin_token):
    rows = session.get(f"{API}/admin/pokemon", headers=_auth(admin_token)).json()
    actives = [p for p in rows if p.get("active")]
    return actives if actives else rows


# ---------------------------------------------------------------------------
# Async DB helpers
# ---------------------------------------------------------------------------
async def _seed_position(camper_id, lat=PIN_LAT, lng=PIN_LNG, minutes_ago=0):
    db, client = _get_db()
    iso = (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(minutes=minutes_ago)).isoformat()
    await db.camper_positions.update_one(
        {"camper_id": camper_id},
        {"$set": {"camper_id": camper_id, "latitude": lat, "longitude": lng, "updated_at": iso}},
        upsert=True,
    )
    client.close()


async def _set_social(enabled: bool):
    db, client = _get_db()
    await db.spawn_config.update_one({"id": "singleton"}, {"$set": {"social_enabled": bool(enabled)}}, upsert=True)
    client.close()


async def _insert_catch(camper_id, pokemon_id, group_code):
    db, client = _get_db()
    pk = await db.pokemon.find_one({"id": pokemon_id}, {"_id": 0}) or {}
    doc = {
        "id": str(_uuid.uuid4()),
        "group_id": camper_id,
        "group_name": group_code,
        "caught_by": "TEST iter21",
        "pokemon_id": pokemon_id,
        "pokemon_name": pk.get("name", ""),
        "pokemon_image": pk.get("image_data_url", ""),
        "pokemon_type": pk.get("type", "normal"),
        "rarity": pk.get("rarity", "common"),
        "ball_type": "pokeball",
        "power_rolled": 100,
        "is_shiny": False,
        "caught_at": _dt.datetime.now(_dt.timezone.utc).isoformat(),
    }
    await db.catches.insert_one(doc)
    client.close()
    return doc["id"]


async def _count_catches(camper_id, pokemon_id):
    db, client = _get_db()
    n = await db.catches.count_documents({"group_id": camper_id, "pokemon_id": pokemon_id})
    client.close()
    return n


async def _delete_test_trades(ids):
    db, client = _get_db()
    if ids:
        await db.trades.delete_many({"id": {"$in": list(ids)}})
    client.close()


async def _delete_test_gifts(camper_a_id, camper_b_id):
    db, client = _get_db()
    await db.daily_gifts.delete_many({
        "$or": [
            {"from_camper_id": camper_a_id}, {"to_camper_id": camper_a_id},
            {"from_camper_id": camper_b_id}, {"to_camper_id": camper_b_id},
        ]
    })
    client.close()


async def _set_trade_status(trade_id, status, **extra):
    db, client = _get_db()
    upd = {"status": status}
    upd.update(extra)
    await db.trades.update_one({"id": trade_id}, {"$set": upd})
    client.close()


async def _insert_completed_trade(camper_id, today_ymd):
    """Seed an accepted trade row to push daily-cap counter."""
    db, client = _get_db()
    tid = str(_uuid.uuid4())
    now = _dt.datetime.now(_dt.timezone.utc)
    await db.trades.insert_one({
        "id": tid,
        "proposer_id": camper_id,
        "receiver_id": camper_id,  # self for counting
        "offer_pokemon_id": "x",
        "request_pokemon_id": "y",
        "status": "accepted",
        "created_at": now.isoformat(),
        "expires_at": (now + _dt.timedelta(hours=24)).isoformat(),
        "completed_at": now.isoformat(),
        "completed_ymd": today_ymd,
    })
    client.close()
    return tid


def _local_ymd_today():
    """Mimic backend _local_ymd(now_utc()) using America/New_York."""
    try:
        from zoneinfo import ZoneInfo
        return _dt.datetime.now(ZoneInfo("America/New_York")).strftime("%Y-%m-%d")
    except Exception:
        return _dt.datetime.utcnow().strftime("%Y-%m-%d")


# ---------------------------------------------------------------------------
# 1. Friends
# ---------------------------------------------------------------------------
class TestFriends:
    def test_friends_returns_same_group_excluding_self(self, session, camper_a):
        run(_set_social(True))
        tA, idA, _ = camper_a
        r = session.get(f"{API}/friends", headers=_auth(tA))
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        ids = [f["camper_id"] for f in rows]
        assert idA not in ids, "Self should be excluded"
        # Required fields
        if rows:
            f = rows[0]
            for k in ("camper_id", "first_name", "group_code", "catches_count", "can_send_gift"):
                assert k in f, f"missing key {k}"
            assert f["group_code"] == "B01"

    def test_friends_empty_when_social_disabled(self, session, camper_a):
        try:
            run(_set_social(False))
            tA, _, _ = camper_a
            r = session.get(f"{API}/friends", headers=_auth(tA))
            assert r.status_code == 200
            assert r.json() == []
        finally:
            run(_set_social(True))


# ---------------------------------------------------------------------------
# 2. Gifts
# ---------------------------------------------------------------------------
class TestGifts:
    def test_self_gift_400(self, session, camper_a):
        run(_set_social(True))
        tA, idA, _ = camper_a
        r = session.post(f"{API}/gifts/send", json={"to_camper_id": idA}, headers=_auth(tA))
        assert r.status_code == 400

    def test_send_gift_then_inbox_then_open(self, session, camper_a, camper_b):
        run(_set_social(True))
        tA, idA, _ = camper_a
        tB, idB, _ = camper_b
        # Wipe any prior gift between A and B today
        run(_delete_test_gifts(idA, idB))

        r = session.post(f"{API}/gifts/send", json={"to_camper_id": idB}, headers=_auth(tA))
        assert r.status_code == 200, r.text
        body = r.json()
        assert 3 <= int(body["pokeballs"]) <= 6

        # Same-day duplicate -> 429
        r2 = session.post(f"{API}/gifts/send", json={"to_camper_id": idB}, headers=_auth(tA))
        assert r2.status_code == 429

        # B inbox
        r3 = session.get(f"{API}/gifts/inbox", headers=_auth(tB))
        assert r3.status_code == 200
        inbox = r3.json()
        assert any(g["from_camper_id"] == idA for g in inbox), f"sent gift not in inbox: {inbox}"
        gift = next(g for g in inbox if g["from_camper_id"] == idA and not g["opened"])
        gift_id = gift["id"]

        # Open
        r4 = session.post(f"{API}/gifts/{gift_id}/open", headers=_auth(tB))
        assert r4.status_code == 200, r4.text
        d = r4.json()
        assert d["already_opened"] is False
        assert d["pokeballs"] == gift["pokeballs"]

        # Re-open -> already_opened=True
        r5 = session.post(f"{API}/gifts/{gift_id}/open", headers=_auth(tB))
        assert r5.status_code == 200
        assert r5.json()["already_opened"] is True

    def test_cross_group_gift_403(self, session, camper_a, camper_other_group):
        run(_set_social(True))
        tA, _, _ = camper_a
        _, oid, _ = camper_other_group
        r = session.post(f"{API}/gifts/send", json={"to_camper_id": oid}, headers=_auth(tA))
        assert r.status_code == 403

    def test_gift_send_blocked_when_social_off(self, session, camper_a, camper_b):
        try:
            run(_set_social(False))
            tA, _, _ = camper_a
            _, idB, _ = camper_b
            r = session.post(f"{API}/gifts/send", json={"to_camper_id": idB}, headers=_auth(tA))
            assert r.status_code == 403
            # inbox still works
            tB, _, _ = camper_b
            r2 = session.get(f"{API}/gifts/inbox", headers=_auth(tB))
            assert r2.status_code == 200
        finally:
            run(_set_social(True))


# ---------------------------------------------------------------------------
# 3. Trades — propose/accept/reject/revert
# ---------------------------------------------------------------------------
class TestTrades:
    def _two_pokemon_same_rarity(self, active_pokemon):
        # Find two active pokemon with same rarity
        by_rarity = {}
        for p in active_pokemon:
            by_rarity.setdefault(p.get("rarity", "common"), []).append(p)
        for r, lst in by_rarity.items():
            if len(lst) >= 2:
                return lst[0], lst[1]
        return active_pokemon[0], active_pokemon[1] if len(active_pokemon) > 1 else active_pokemon[0]

    def _two_pokemon_different_rarity(self, active_pokemon):
        seen = {}
        for p in active_pokemon:
            r = p.get("rarity", "common")
            if r not in seen:
                seen[r] = p
            if len(seen) >= 2:
                vals = list(seen.values())
                return vals[0], vals[1]
        return None, None

    def test_propose_same_rarity_success(self, session, camper_a, camper_b, active_pokemon):
        run(_set_social(True))
        tA, idA, A = camper_a
        tB, idB, B = camper_b
        p1, p2 = self._two_pokemon_same_rarity(active_pokemon)
        # Seed catches: A owns p1, B owns p2
        run(_insert_catch(idA, p1["id"], "B01"))
        run(_insert_catch(idB, p2["id"], "B01"))

        r = session.post(f"{API}/trades/propose", json={
            "to_camper_id": idB, "offer_pokemon_id": p1["id"], "request_pokemon_id": p2["id"],
        }, headers=_auth(tA))
        assert r.status_code == 200, r.text
        t = r.json()
        assert t["status"] == "proposed"
        assert t["proposer_id"] == idA
        assert t["receiver_id"] == idB
        assert t["offer_rarity"] == t["request_rarity"]
        # 24h expiry
        exp = _dt.datetime.fromisoformat(t["expires_at"].replace("Z", "+00:00"))
        delta = (exp - _dt.datetime.now(_dt.timezone.utc)).total_seconds()
        assert 23 * 3600 < delta <= 24 * 3600 + 60
        # Cleanup
        run(_delete_test_trades([t["id"]]))

    def test_propose_cross_rarity_400(self, session, camper_a, camper_b, active_pokemon):
        run(_set_social(True))
        tA, idA, _ = camper_a
        _, idB, _ = camper_b
        p1, p2 = self._two_pokemon_different_rarity(active_pokemon)
        if not p1 or not p2:
            pytest.skip("Need pokemon of differing rarities")
        run(_insert_catch(idA, p1["id"], "B01"))
        run(_insert_catch(idB, p2["id"], "B01"))
        r = session.post(f"{API}/trades/propose", json={
            "to_camper_id": idB, "offer_pokemon_id": p1["id"], "request_pokemon_id": p2["id"],
        }, headers=_auth(tA))
        assert r.status_code == 400

    def test_accept_proximity_gate_far(self, session, camper_a, camper_b, active_pokemon):
        run(_set_social(True))
        tA, idA, _ = camper_a
        tB, idB, _ = camper_b
        p1, p2 = self._two_pokemon_same_rarity(active_pokemon)
        run(_insert_catch(idA, p1["id"], "B01"))
        run(_insert_catch(idB, p2["id"], "B01"))
        # Position B very far from A
        run(_seed_position(idA, PIN_LAT, PIN_LNG))
        run(_seed_position(idB, PIN_LAT + 0.01, PIN_LNG + 0.01))  # ~1km

        rp = session.post(f"{API}/trades/propose", json={
            "to_camper_id": idB, "offer_pokemon_id": p1["id"], "request_pokemon_id": p2["id"],
        }, headers=_auth(tA))
        assert rp.status_code == 200, rp.text
        tid = rp.json()["id"]
        ra = session.post(f"{API}/trades/{tid}/accept", headers=_auth(tB))
        assert ra.status_code == 400
        assert "Stand within" in ra.text or "apart" in ra.text
        run(_delete_test_trades([tid]))

    def test_accept_success_swaps_catches(self, session, camper_a, camper_b, active_pokemon):
        run(_set_social(True))
        tA, idA, _ = camper_a
        tB, idB, _ = camper_b
        p1, p2 = self._two_pokemon_same_rarity(active_pokemon)
        # Each owns ONE of each type (count=1)
        run(_insert_catch(idA, p1["id"], "B01"))
        run(_insert_catch(idB, p2["id"], "B01"))
        before_A_p1 = run(_count_catches(idA, p1["id"]))
        before_A_p2 = run(_count_catches(idA, p2["id"]))
        before_B_p1 = run(_count_catches(idB, p1["id"]))
        before_B_p2 = run(_count_catches(idB, p2["id"]))
        # Position both within 30m
        run(_seed_position(idA, PIN_LAT, PIN_LNG))
        run(_seed_position(idB, PIN_LAT, PIN_LNG))

        rp = session.post(f"{API}/trades/propose", json={
            "to_camper_id": idB, "offer_pokemon_id": p1["id"], "request_pokemon_id": p2["id"],
        }, headers=_auth(tA))
        assert rp.status_code == 200, rp.text
        tid = rp.json()["id"]

        ra = session.post(f"{API}/trades/{tid}/accept", headers=_auth(tB))
        assert ra.status_code == 200, ra.text
        out = ra.json()
        assert out["status"] == "accepted"
        assert out.get("revert_until")

        # Verify counts: A loses 1 of p1, gains 1 of p2; B loses 1 of p2, gains 1 of p1
        assert run(_count_catches(idA, p1["id"])) == before_A_p1 - 1
        assert run(_count_catches(idA, p2["id"])) == before_A_p2 + 1
        assert run(_count_catches(idB, p2["id"])) == before_B_p2 - 1
        assert run(_count_catches(idB, p1["id"])) == before_B_p1 + 1

        # Verify the inserted catch has ball_type='trade', is_trade=True, traded_from_id set
        db, client = _get_db()
        new_catch = run(db.catches.find_one({"group_id": idA, "pokemon_id": p2["id"], "ball_type": "trade"}, {"_id": 0}))
        client.close()
        assert new_catch is not None
        assert new_catch.get("is_trade") is True
        assert new_catch.get("traded_from_id") == idB
        run(_delete_test_trades([tid]))

    def test_reject_proposed(self, session, camper_a, camper_b, active_pokemon):
        run(_set_social(True))
        tA, idA, _ = camper_a
        tB, idB, _ = camper_b
        p1, p2 = self._two_pokemon_same_rarity(active_pokemon)
        run(_insert_catch(idA, p1["id"], "B01"))
        run(_insert_catch(idB, p2["id"], "B01"))
        rp = session.post(f"{API}/trades/propose", json={
            "to_camper_id": idB, "offer_pokemon_id": p1["id"], "request_pokemon_id": p2["id"],
        }, headers=_auth(tA))
        assert rp.status_code == 200
        tid = rp.json()["id"]
        rr = session.post(f"{API}/trades/{tid}/reject", headers=_auth(tB))
        assert rr.status_code == 200
        assert rr.json()["status"] == "rejected"
        # Reject again -> 400
        rr2 = session.post(f"{API}/trades/{tid}/reject", headers=_auth(tB))
        assert rr2.status_code == 400
        run(_delete_test_trades([tid]))

    def test_reject_works_when_social_off(self, session, camper_a, camper_b, active_pokemon):
        run(_set_social(True))
        tA, idA, _ = camper_a
        tB, idB, _ = camper_b
        p1, p2 = self._two_pokemon_same_rarity(active_pokemon)
        run(_insert_catch(idA, p1["id"], "B01"))
        run(_insert_catch(idB, p2["id"], "B01"))
        rp = session.post(f"{API}/trades/propose", json={
            "to_camper_id": idB, "offer_pokemon_id": p1["id"], "request_pokemon_id": p2["id"],
        }, headers=_auth(tA))
        assert rp.status_code == 200
        tid = rp.json()["id"]
        try:
            run(_set_social(False))
            rr = session.post(f"{API}/trades/{tid}/reject", headers=_auth(tB))
            assert rr.status_code == 200
        finally:
            run(_set_social(True))
        run(_delete_test_trades([tid]))

    def test_propose_blocked_when_social_off(self, session, camper_a, camper_b, active_pokemon):
        try:
            run(_set_social(False))
            tA, _, _ = camper_a
            _, idB, _ = camper_b
            p1, p2 = self._two_pokemon_same_rarity(active_pokemon)
            r = session.post(f"{API}/trades/propose", json={
                "to_camper_id": idB, "offer_pokemon_id": p1["id"], "request_pokemon_id": p2["id"],
            }, headers=_auth(tA))
            assert r.status_code == 403
        finally:
            run(_set_social(True))

    def test_camper_revert_within_window(self, session, camper_a, camper_b, active_pokemon):
        run(_set_social(True))
        tA, idA, _ = camper_a
        tB, idB, _ = camper_b
        p1, p2 = self._two_pokemon_same_rarity(active_pokemon)
        run(_insert_catch(idA, p1["id"], "B01"))
        run(_insert_catch(idB, p2["id"], "B01"))
        run(_seed_position(idA, PIN_LAT, PIN_LNG))
        run(_seed_position(idB, PIN_LAT, PIN_LNG))
        rp = session.post(f"{API}/trades/propose", json={
            "to_camper_id": idB, "offer_pokemon_id": p1["id"], "request_pokemon_id": p2["id"],
        }, headers=_auth(tA))
        tid = rp.json()["id"]
        ra = session.post(f"{API}/trades/{tid}/accept", headers=_auth(tB))
        assert ra.status_code == 200

        # Revert as proposer
        rv = session.post(f"{API}/trades/{tid}/revert", headers=_auth(tA))
        assert rv.status_code == 200, rv.text
        assert rv.json()["status"] == "reverted"
        run(_delete_test_trades([tid]))

    def test_camper_revert_outside_window_400(self, session, camper_a, camper_b, active_pokemon):
        run(_set_social(True))
        tA, idA, _ = camper_a
        tB, idB, _ = camper_b
        p1, p2 = self._two_pokemon_same_rarity(active_pokemon)
        run(_insert_catch(idA, p1["id"], "B01"))
        run(_insert_catch(idB, p2["id"], "B01"))
        run(_seed_position(idA, PIN_LAT, PIN_LNG))
        run(_seed_position(idB, PIN_LAT, PIN_LNG))
        rp = session.post(f"{API}/trades/propose", json={
            "to_camper_id": idB, "offer_pokemon_id": p1["id"], "request_pokemon_id": p2["id"],
        }, headers=_auth(tA))
        tid = rp.json()["id"]
        session.post(f"{API}/trades/{tid}/accept", headers=_auth(tB))
        # Force revert window into the past
        past = (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(hours=2)).isoformat()
        run(_set_trade_status(tid, "accepted", revert_until=past))
        rv = session.post(f"{API}/trades/{tid}/revert", headers=_auth(tA))
        assert rv.status_code == 400
        run(_delete_test_trades([tid]))

    def test_admin_revert_any_accepted(self, session, admin_token, camper_a, camper_b, active_pokemon):
        run(_set_social(True))
        tA, idA, _ = camper_a
        tB, idB, _ = camper_b
        p1, p2 = self._two_pokemon_same_rarity(active_pokemon)
        run(_insert_catch(idA, p1["id"], "B01"))
        run(_insert_catch(idB, p2["id"], "B01"))
        run(_seed_position(idA, PIN_LAT, PIN_LNG))
        run(_seed_position(idB, PIN_LAT, PIN_LNG))
        rp = session.post(f"{API}/trades/propose", json={
            "to_camper_id": idB, "offer_pokemon_id": p1["id"], "request_pokemon_id": p2["id"],
        }, headers=_auth(tA))
        tid = rp.json()["id"]
        session.post(f"{API}/trades/{tid}/accept", headers=_auth(tB))
        # Force window past — admin should still revert
        past = (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(hours=48)).isoformat()
        run(_set_trade_status(tid, "accepted", revert_until=past))
        ra = session.post(f"{API}/admin/trades/{tid}/revert", headers=_auth(admin_token))
        assert ra.status_code == 200, ra.text
        # Check stamped reverted_by_admin
        db, client = _get_db()
        d = run(db.trades.find_one({"id": tid}, {"_id": 0}))
        client.close()
        assert d["status"] == "reverted"
        assert d.get("reverted_by_admin") is True
        run(_delete_test_trades([tid]))

    def test_admin_list_trades(self, session, admin_token):
        r = session.get(f"{API}/admin/trades", headers=_auth(admin_token))
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---------------------------------------------------------------------------
# 4. Regressions (iter 18..20)
# ---------------------------------------------------------------------------
class TestRegressions:
    def test_admin_login(self, session):
        r = session.post(f"{API}/admin/auth/login", json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD})
        assert r.status_code == 200

    def test_streak(self, session, camper_a):
        tA, _, _ = camper_a
        r = session.get(f"{API}/streak", headers=_auth(tA))
        assert r.status_code == 200

    def test_buddy_get(self, session, camper_a):
        tA, _, _ = camper_a
        r = session.get(f"{API}/buddy", headers=_auth(tA))
        assert r.status_code == 200

    def test_inventory(self, session, camper_a):
        tA, _, _ = camper_a
        r = session.get(f"{API}/inventory", headers=_auth(tA))
        assert r.status_code == 200

    def test_active_raids(self, session, camper_a):
        tA, _, _ = camper_a
        r = session.get(f"{API}/raids/active", headers=_auth(tA))
        assert r.status_code == 200

    def test_pokestops_status(self, session, camper_a):
        tA, _, _ = camper_a
        r = session.get(f"{API}/pokestops/status", headers=_auth(tA))
        assert r.status_code == 200

    def test_admin_pokemon_list(self, session, admin_token):
        r = session.get(f"{API}/admin/pokemon", headers=_auth(admin_token))
        assert r.status_code == 200

    def test_admin_events(self, session, admin_token):
        r = session.get(f"{API}/admin/events", headers=_auth(admin_token))
        assert r.status_code == 200

    def test_spawn_current(self, session, camper_a):
        tA, _, _ = camper_a
        r = session.get(f"{API}/spawn/current", headers=_auth(tA))
        # 200 or 204; just ensure no 5xx
        assert r.status_code < 500
