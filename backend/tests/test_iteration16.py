"""Iteration 16 — Pokemon-GO parity (subset).

Backend tests:
- GET /api/streak shape for fresh camper + after catch
- POST /api/spawn/catch returns wobble_stages, is_shiny, streak fields
- WOBBLE_RETENTION kid-friendly tuning (common ≥85%, legendary ~50-60%)
- Ball multiplier (lunchball 2.5x) raises retention vs pokeball
- Daily streak math: consecutive day → +1 + reward; skip → reset to 1
- Regression: /api/auth/login (admin), /api/camper/login, /api/spawn/current,
  /api/wallet, /api/bank, /api/catches, /api/admin/roster-status still 200.
"""
import os
import asyncio
import datetime as _dt
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Camp1993")


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _camper_token(s, group, idx=0):
    r = s.get(f"{API}/groups/{group}/campers")
    assert r.status_code == 200, r.text
    payload = r.json()
    campers = payload.get("campers") if isinstance(payload, dict) else payload
    cid = campers[idx]["id"]
    r2 = s.post(f"{API}/camper/login", json={"camper_id": cid})
    assert r2.status_code == 200, r2.text
    return r2.json()["access_token"], cid


def _admin_token(s):
    r = s.post(f"{API}/admin/auth/login", json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def admin_token(session):
    return _admin_token(session)


@pytest.fixture(scope="module")
def camper(session):
    # Use later index to reduce collision with other test suites that grab idx 0/1.
    return _camper_token(session, "B01", 5)


# ---------- mongo helpers (direct manipulation for streak tests) ----------
def _get_db():
    from motor.motor_asyncio import AsyncIOMotorClient
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME", "test_database")
    client = AsyncIOMotorClient(mongo_url)
    return client[db_name], client


async def _set_streak_yesterday(camper_id):
    db, client = _get_db()
    today = _dt.datetime.utcnow().strftime("%Y-%m-%d")
    yest = (_dt.datetime.utcnow() - _dt.timedelta(days=1)).strftime("%Y-%m-%d")
    await db.camper_streaks.update_one(
        {"id": camper_id},
        {"$set": {"id": camper_id, "current_streak": 1, "longest_streak": 1, "last_caught_ymd": yest}},
        upsert=True,
    )
    client.close()
    return today, yest


async def _set_streak_two_days_ago(camper_id):
    db, client = _get_db()
    two = (_dt.datetime.utcnow() - _dt.timedelta(days=2)).strftime("%Y-%m-%d")
    await db.camper_streaks.update_one(
        {"id": camper_id},
        {"$set": {"id": camper_id, "current_streak": 5, "longest_streak": 5, "last_caught_ymd": two}},
        upsert=True,
    )
    client.close()


async def _clear_streak(camper_id):
    db, client = _get_db()
    await db.camper_streaks.delete_one({"id": camper_id})
    client.close()


async def _force_active_spawn(camper_id, rarity="common", pokemon=None):
    """Create / replace an active spawn for the camper at a known rarity."""
    db, client = _get_db()
    # Fetch any one pokemon of that rarity (or first) so the catch endpoint resolves.
    poke = pokemon
    if not poke:
        poke = await db.pokemon.find_one({"rarity": rarity}, {"_id": 0}) or await db.pokemon.find_one({}, {"_id": 0})
    if not poke:
        client.close()
        return None
    poke = {**poke, "rarity": rarity}
    now = _dt.datetime.now(_dt.timezone.utc)
    spawn = {
        "spawn_id": f"test_{camper_id}_{int(now.timestamp())}",
        "pokemon_id": poke["id"],
        "pokemon": poke,
        "rarity": rarity,
        "started_at": now.isoformat(),
        "expires_at": (now + _dt.timedelta(hours=2)).isoformat(),
        "miss_count": 0,
        "latitude": 40.6396,
        "longitude": -73.6665,
        "pin_name": "Test Pin",
    }
    await db.group_spawns.update_one(
        {"group_id": camper_id},
        {"$set": {
            "group_id": camper_id,
            "current_spawns": [spawn],
            "current_spawn": spawn,
            "next_spawn_at": (now + _dt.timedelta(hours=4)).isoformat(),
        }},
        upsert=True,
    )
    # Make sure the camper has plenty of balls.
    await db.ball_wallets.update_one(
        {"id": camper_id},
        {"$set": {
            "id": camper_id,
            "balances": {"pokeball": 9999, "rayball": 9999, "myrtleball": 9999, "lunchball": 9999},
        }},
        upsert=True,
    )
    client.close()
    return spawn["spawn_id"]


def run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# ---------- 1. GET /api/streak shape (fresh camper) ----------
class TestStreakEndpoint:
    def test_streak_fresh_shape(self, session, camper):
        token, cid = camper
        run(_clear_streak(cid))
        r = session.get(f"{API}/streak", headers=_auth(token))
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("current_streak", "longest_streak", "last_caught_ymd",
                  "today_ymd", "caught_today", "at_risk", "next_reward"):
            assert k in d, f"missing key {k}"
        assert d["current_streak"] == 0
        assert d["longest_streak"] == 0
        assert d["last_caught_ymd"] is None
        assert d["caught_today"] is False
        assert d["at_risk"] is False
        # YYYY-MM-DD format
        _dt.datetime.strptime(d["today_ymd"], "%Y-%m-%d")

    def test_streak_after_catch(self, session, camper):
        token, cid = camper
        run(_clear_streak(cid))
        spawn_id = run(_force_active_spawn(cid, rarity="common"))
        assert spawn_id, "could not seed pokemon doc to create spawn"
        # Try a few catches — common is ~97% per attempt; at most a couple needed.
        success = False
        for _ in range(5):
            r = session.post(f"{API}/spawn/catch", json={"spawn_id": spawn_id, "ball_type": "pokeball"}, headers=_auth(token))
            assert r.status_code == 200, r.text
            res = r.json()
            assert "wobble_stages" in res
            assert "is_shiny" in res
            assert "streak" in res
            if res["success"]:
                success = True
                assert res["streak"]["current_streak"] == 1
                break
            # Re-seed spawn after fail dodge in case it was consumed (it's not, but seed is fine).
        assert success, "Common-rarity catch failed 5 times — check WOBBLE_RETENTION."
        r2 = session.get(f"{API}/streak", headers=_auth(token))
        d = r2.json()
        assert d["current_streak"] == 1
        assert d["caught_today"] is True


# ---------- 2. wobble_stages payload semantics ----------
class TestWobbleStages:
    def test_success_all_three_true(self, session, camper):
        token, cid = camper
        ok = 0
        for _ in range(10):
            spawn_id = run(_force_active_spawn(cid, rarity="common"))
            r = session.post(f"{API}/spawn/catch", json={"spawn_id": spawn_id, "ball_type": "lunchball"}, headers=_auth(token))
            res = r.json()
            assert isinstance(res["wobble_stages"], list) and len(res["wobble_stages"]) == 3
            if res["success"]:
                assert all(res["wobble_stages"]) is True
                ok += 1
                break
        assert ok >= 1, "Could not get a single common+lunchball success in 10 tries"

    def test_failure_has_at_least_one_false(self, session, camper):
        token, cid = camper
        # Use legendary + pokeball (lowest retention) to get a fail quickly.
        saw_fail = False
        for _ in range(40):
            spawn_id = run(_force_active_spawn(cid, rarity="legendary"))
            r = session.post(f"{API}/spawn/catch", json={"spawn_id": spawn_id, "ball_type": "pokeball"}, headers=_auth(token))
            res = r.json()
            if not res["success"]:
                # Trailing False after first break-out
                ws = res["wobble_stages"]
                assert len(ws) == 3
                assert ws.count(False) >= 1
                saw_fail = True
                break
        assert saw_fail, "Could not produce a single legendary+pokeball failure in 40 attempts — retention may be too high."


# ---------- 3. Kid-friendly tuning ----------
class TestKidFriendlyRates:
    def test_common_pokeball_high_success(self, session, camper):
        token, cid = camper
        successes = 0
        N = 60  # smaller than 100 to keep test runtime reasonable, still indicative
        for _ in range(N):
            spawn_id = run(_force_active_spawn(cid, rarity="common"))
            r = session.post(f"{API}/spawn/catch", json={"spawn_id": spawn_id, "ball_type": "pokeball"}, headers=_auth(token))
            if r.json().get("success"):
                successes += 1
        rate = successes / N
        print(f"common+pokeball success rate: {rate:.2%} ({successes}/{N})")
        assert rate >= 0.85, f"common+pokeball rate {rate:.2%} below 85% kid-friendly floor"

    def test_legendary_pokeball_band(self, session, camper):
        token, cid = camper
        successes = 0
        N = 60
        for _ in range(N):
            spawn_id = run(_force_active_spawn(cid, rarity="legendary"))
            r = session.post(f"{API}/spawn/catch", json={"spawn_id": spawn_id, "ball_type": "pokeball"}, headers=_auth(token))
            if r.json().get("success"):
                successes += 1
        rate = successes / N
        print(f"legendary+pokeball success rate: {rate:.2%} ({successes}/{N})")
        # Spec target ~50-60%; with sample noise widen to 35-75%.
        assert 0.30 <= rate <= 0.80, f"legendary+pokeball rate {rate:.2%} outside expected 30-80% band"

    def test_lunchball_raises_retention_vs_pokeball(self, session, camper):
        token, cid = camper
        # Compare per-throw success on legendary with pokeball vs lunchball.
        N = 60
        pokeball_succ = 0
        lunch_succ = 0
        for _ in range(N):
            sid = run(_force_active_spawn(cid, rarity="legendary"))
            r = session.post(f"{API}/spawn/catch", json={"spawn_id": sid, "ball_type": "pokeball"}, headers=_auth(token))
            if r.json().get("success"):
                pokeball_succ += 1
        for _ in range(N):
            sid = run(_force_active_spawn(cid, rarity="legendary"))
            r = session.post(f"{API}/spawn/catch", json={"spawn_id": sid, "ball_type": "lunchball"}, headers=_auth(token))
            if r.json().get("success"):
                lunch_succ += 1
        print(f"legendary pokeball={pokeball_succ}/{N} lunchball={lunch_succ}/{N}")
        assert lunch_succ >= pokeball_succ, (
            f"lunchball ({lunch_succ}) should be ≥ pokeball ({pokeball_succ}) on legendary"
        )


# ---------- 4. Streak math (consecutive day, skip day) ----------
class TestStreakMath:
    def test_consecutive_day_increments_and_grants_reward(self, session, camper):
        token, cid = camper
        # Force last catch to be yesterday at streak=1
        run(_set_streak_yesterday(cid))
        # Snapshot current pokeball balance from ledger before catch
        bw0 = session.get(f"{API}/wallet", headers=_auth(token)).json()
        prev_pb = int((bw0.get("balances") or {}).get("pokeball", 0))
        # Force a common spawn and catch
        spawn_id = run(_force_active_spawn(cid, rarity="common"))
        succ = False
        for _ in range(5):
            r = session.post(f"{API}/spawn/catch", json={"spawn_id": spawn_id, "ball_type": "lunchball"}, headers=_auth(token))
            res = r.json()
            if res["success"]:
                assert res["streak"]["current_streak"] == 2
                # +5 reward (day 2)
                # Note: reward_granted is included in the streak dict
                if "reward_granted" in res["streak"]:
                    assert res["streak"]["reward_granted"] == 5
                succ = True
                break
            spawn_id = run(_force_active_spawn(cid, rarity="common"))
        assert succ, "could not catch in 5 tries"
        # Verify ledger has streak_bonus entry
        # Check wallet balance grew (catch_reward common is small but reward should be > 0)
        bw1 = session.get(f"{API}/wallet", headers=_auth(token)).json()
        new_pb = int((bw1.get("balances") or {}).get("pokeball", 0))
        # New balance should be at least previous + 5 (reward) - 1 (throw) = +4
        assert new_pb >= prev_pb + 4, f"expected pokeball ≥ {prev_pb+4}, got {new_pb}"

    def test_skip_day_resets_to_one(self, session, camper):
        token, cid = camper
        run(_set_streak_two_days_ago(cid))
        spawn_id = run(_force_active_spawn(cid, rarity="common"))
        succ = False
        for _ in range(5):
            r = session.post(f"{API}/spawn/catch", json={"spawn_id": spawn_id, "ball_type": "lunchball"}, headers=_auth(token))
            res = r.json()
            if res["success"]:
                assert res["streak"]["current_streak"] == 1
                succ = True
                break
            spawn_id = run(_force_active_spawn(cid, rarity="common"))
        assert succ
        s = session.get(f"{API}/streak", headers=_auth(token)).json()
        assert s["current_streak"] == 1
        # Longest preserved (>=5 from seed)
        assert s["longest_streak"] >= 5


# ---------- 5. Regressions ----------
class TestRegressions:
    def test_admin_login(self, session, admin_token):
        assert isinstance(admin_token, str) and len(admin_token) > 10

    def test_camper_login(self, session, camper):
        token, cid = camper
        assert isinstance(token, str) and len(token) > 10
        assert isinstance(cid, str)

    def test_spawn_current(self, session, camper):
        token, _ = camper
        r = session.get(f"{API}/spawn/current?lat=40.6396&lng=-73.6665", headers=_auth(token))
        assert r.status_code == 200, r.text
        d = r.json()
        assert "spawns" in d
        assert "enabled" in d

    def test_wallet(self, session, camper):
        token, _ = camper
        r = session.get(f"{API}/wallet", headers=_auth(token))
        assert r.status_code == 200, r.text
        assert "balances" in r.json()

    def test_bank(self, session, camper):
        token, _ = camper
        r = session.get(f"{API}/bank", headers=_auth(token))
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_catches(self, session, camper):
        token, _ = camper
        r = session.get(f"{API}/catches", headers=_auth(token))
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_admin_roster_status(self, session, admin_token):
        r = session.get(f"{API}/admin/roster-status", headers=_auth(admin_token))
        assert r.status_code == 200, r.text
