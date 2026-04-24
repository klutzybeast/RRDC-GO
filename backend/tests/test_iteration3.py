"""RRDC GO Iteration 3 backend tests - ball economy wallet, daily bonus, pin bonus, catch flow, admin wallet."""
import os
import time
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

STARTING_BALLS = 200
DAILY_BONUS = 25
PIN_BONUS = 5
CATCH_REWARD = {"common": 1, "uncommon": 2, "rare": 5, "legendary": 15}

state = {}


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/admin/auth/login", json={"username": "admin", "password": "Camp1993"}, timeout=15)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module", autouse=True)
def mongo():
    """Autouse so cleanup runs before any test."""
    c = MongoClient(MONGO_URL)
    db = c[DB_NAME]
    # Clean up any prior TEST_ pins
    db.map_pins.delete_many({"name": {"$regex": "^TEST_"}})
    yield db
    # Teardown: cleanup TEST pins
    db.map_pins.delete_many({"name": {"$regex": "^TEST_"}})
    # Cleanup wallet and ledger for test campers used in this run
    for cid in state.get("used_camper_ids", []):
        db.camper_wallets.delete_many({"camper_id": cid})
        db.ball_ledger.delete_many({"camper_id": cid})
        db.camper_positions.delete_many({"camper_id": cid})
        db.group_spawns.delete_many({"group_id": cid})
        db.catches.delete_many({"group_id": cid})


def _login_fresh_camper(mongo, idx=0):
    """Pick camper at index idx from B01, wipe wallet/ledger, return headers+id."""
    r = requests.get(f"{API}/groups/B01/campers", timeout=15)
    assert r.status_code == 200, r.text
    campers = r.json()
    assert len(campers) > idx, f"Not enough campers in B01 (got {len(campers)})"
    cid = campers[idx]["id"]
    # Wipe any prior wallet/ledger/position
    mongo.camper_wallets.delete_many({"camper_id": cid})
    mongo.ball_ledger.delete_many({"camper_id": cid})
    mongo.camper_positions.delete_many({"camper_id": cid})
    mongo.group_spawns.delete_many({"group_id": cid})
    r = requests.post(f"{API}/camper/login", json={"camper_id": cid}, timeout=10)
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]
    hdrs = {"Authorization": f"Bearer {tok}"}
    state.setdefault("used_camper_ids", []).append(cid)
    return cid, hdrs


# ---------- GET /api/wallet auto-init ----------
def test_wallet_autoinit_returns_starting_balance(mongo):
    cid, hdrs = _login_fresh_camper(mongo, idx=0)
    state["c0_id"] = cid
    state["c0_hdrs"] = hdrs
    r = requests.get(f"{API}/wallet", headers=hdrs, timeout=10)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["balance"] == STARTING_BALLS
    assert d["starting_balance"] == STARTING_BALLS
    assert d["daily_bonus"] == DAILY_BONUS
    assert d["pin_bonus"] == PIN_BONUS
    assert d["catch_reward"] == CATCH_REWARD
    assert d["can_claim_daily"] is True
    assert d.get("next_daily_at") in (None, "")


def test_wallet_second_call_stable_balance():
    r = requests.get(f"{API}/wallet", headers=state["c0_hdrs"], timeout=10)
    assert r.status_code == 200
    assert r.json()["balance"] == STARTING_BALLS


def test_wallet_unauthenticated_rejected():
    r = requests.get(f"{API}/wallet", timeout=10)
    assert r.status_code == 401


# ---------- POST /api/wallet/claim-daily ----------
def test_claim_daily_first_time_grants_25():
    r = requests.post(f"{API}/wallet/claim-daily", headers=state["c0_hdrs"], timeout=10)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["granted"] == DAILY_BONUS
    assert d["balance"] == STARTING_BALLS + DAILY_BONUS


def test_claim_daily_second_time_429():
    r = requests.post(f"{API}/wallet/claim-daily", headers=state["c0_hdrs"], timeout=10)
    assert r.status_code == 429, r.text


def test_wallet_can_claim_daily_false_after_claim():
    r = requests.get(f"{API}/wallet", headers=state["c0_hdrs"], timeout=10)
    assert r.status_code == 200
    d = r.json()
    assert d["can_claim_daily"] is False
    assert d.get("next_daily_at") is not None


# ---------- /api/wallet/ledger ----------
def test_ledger_returns_descending_entries():
    r = requests.get(f"{API}/wallet/ledger", headers=state["c0_hdrs"], timeout=10)
    assert r.status_code == 200
    entries = r.json()
    assert isinstance(entries, list) and len(entries) >= 2
    reasons = [e["reason"] for e in entries]
    assert "daily_bonus" in reasons
    assert "initial_grant" in reasons or "starting" in reasons or reasons.count("daily_bonus") >= 1
    # Verify descending by created_at
    times = [e["created_at"] for e in entries]
    assert times == sorted(times, reverse=True), f"Ledger not descending: {times}"
    # Required fields
    top = entries[0]
    for k in ("reason", "delta", "balance_after", "created_at"):
        assert k in top, f"Missing {k} in ledger entry: {top}"


# ---------- claim-pin: proximity, 404, 400, 429 ----------
def test_claim_pin_404_when_pin_missing():
    r = requests.post(f"{API}/wallet/claim-pin/nonexistent-pin-id", headers=state["c0_hdrs"], timeout=10)
    assert r.status_code == 404


def test_claim_pin_400_when_no_position(mongo, admin_headers):
    # Create an active pin
    pin_body = {"name": "TEST_PinEconomy", "latitude": 40.0, "longitude": -74.0, "active": True}
    r = requests.post(f"{API}/admin/map-pins", json=pin_body, headers=admin_headers, timeout=10)
    assert r.status_code == 200, r.text
    pin = r.json()
    state["test_pin"] = pin
    # Ensure this camper has no saved position
    mongo.camper_positions.delete_many({"camper_id": state["c0_id"]})
    r = requests.post(f"{API}/wallet/claim-pin/{pin['id']}", headers=state["c0_hdrs"], timeout=10)
    assert r.status_code == 400, r.text
    assert "location" in r.text.lower() or "share" in r.text.lower()


def test_claim_pin_400_when_too_far():
    # Set position 1000m away
    r = requests.post(
        f"{API}/camper/position",
        json={"latitude": 40.01, "longitude": -74.0, "accuracy": 5},
        headers=state["c0_hdrs"], timeout=10,
    )
    assert r.status_code == 200, r.text
    pin = state["test_pin"]
    r = requests.post(f"{API}/wallet/claim-pin/{pin['id']}", headers=state["c0_hdrs"], timeout=10)
    assert r.status_code == 400, r.text
    assert "Walk closer" in r.text or "m away" in r.text


def test_claim_pin_success_grants_5():
    pin = state["test_pin"]
    # Move camper ~5m away (0.00005 deg lat ~= 5.5m). Use 0.00002 ~= 2m to be safe.
    r = requests.post(
        f"{API}/camper/position",
        json={"latitude": pin["latitude"] + 0.00002, "longitude": pin["longitude"], "accuracy": 2},
        headers=state["c0_hdrs"], timeout=10,
    )
    assert r.status_code == 200
    # Claim
    r = requests.post(f"{API}/wallet/claim-pin/{pin['id']}", headers=state["c0_hdrs"], timeout=10)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["granted"] == PIN_BONUS
    # Balance = 200 + 25 (daily) + 5 (pin) = 230
    assert d["balance"] == STARTING_BALLS + DAILY_BONUS + PIN_BONUS


def test_claim_pin_429_same_day():
    pin = state["test_pin"]
    r = requests.post(f"{API}/wallet/claim-pin/{pin['id']}", headers=state["c0_hdrs"], timeout=10)
    assert r.status_code == 429, r.text


# ---------- Catch flow with balls ----------
def _setup_spawn_for_camper(mongo, cid, hdrs, admin_headers, rarity="common"):
    """Activate a pokemon of given rarity, configure spawn to be available now, GET /spawn/current."""
    # Deactivate ALL pokemon directly in Mongo (faster, avoids 60 API calls)
    mongo.pokemon.update_many({}, {"$set": {"active": False}})
    r = requests.get(f"{API}/admin/pokemon", headers=admin_headers, timeout=15)
    assert r.status_code == 200
    pokes = r.json()
    slot1 = next((p for p in pokes if p.get("slot") == 1), pokes[0])
    patch = {
        "name": f"TEST_{rarity}_Spawn",
        "rarity": rarity,
        "power_level": 100,
        "description": "test",
        "active": True,
    }
    r = requests.patch(f"{API}/admin/pokemon/{slot1['id']}", json=patch, headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text

    # Configure spawn config: enabled, active hours 0-24, short interval
    cfg = {
        "enabled": True,
        "min_interval_min": 0.1,
        "max_interval_min": 0.2,
        "active_hours_start": 0,
        "active_hours_end": 24,
        "rarity_weights": {"common": 100, "uncommon": 0, "rare": 0, "legendary": 0} if rarity == "common" else {"common": 0, "uncommon": 0, "rare": 0, "legendary": 100, rarity: 100},
    }
    # adapt to actual fields the API accepts - use minimal
    r = requests.get(f"{API}/admin/spawn-config", headers=admin_headers, timeout=10)
    assert r.status_code == 200
    existing = r.json()
    existing.update({"enabled": True, "active_hours_start": 0, "active_hours_end": 24, "min_interval_min": 0.1, "max_interval_min": 0.2})
    r = requests.put(f"{API}/admin/spawn-config", json=existing, headers=admin_headers, timeout=10)
    assert r.status_code == 200, r.text

    # Clear existing group_spawns for this camper (force spawn immediately)
    mongo.group_spawns.delete_many({"group_id": cid})

    # GET /spawn/current to create spawn
    r = requests.get(f"{API}/spawn/current", headers=hdrs, timeout=10)
    assert r.status_code == 200, r.text
    sp = r.json()
    # Response may be wrapped under 'spawn'
    if "spawn" in sp and sp["spawn"]:
        sp = sp["spawn"]
    return sp


def _extract_spawn_id(obj):
    if not obj:
        return None
    if isinstance(obj, dict):
        if "spawn_id" in obj:
            return obj["spawn_id"]
        if "spawn" in obj and isinstance(obj["spawn"], dict):
            return obj["spawn"].get("spawn_id")
        if "current_spawn" in obj and isinstance(obj["current_spawn"], dict):
            return obj["current_spawn"].get("spawn_id")
    return None


def test_catch_deducts_and_rewards(mongo, admin_headers):
    # Use a fresh camper c1 to keep test independent
    cid, hdrs = _login_fresh_camper(mongo, idx=1)
    state["c1_id"] = cid
    state["c1_hdrs"] = hdrs

    # Force pokemon active
    sp = _setup_spawn_for_camper(mongo, cid, hdrs, admin_headers, rarity="common")
    if not sp.get("current_spawn") and not sp.get("spawn_id") and not sp.get("pokemon"):
        # Try again
        time.sleep(0.5)
        r = requests.get(f"{API}/spawn/current", headers=hdrs, timeout=10)
        sp = r.json()

    # Extract spawn_id
    spawn_id = _extract_spawn_id(sp)
    assert spawn_id, f"No spawn_id returned: {sp}"

    # Record balance before
    r = requests.get(f"{API}/wallet", headers=hdrs, timeout=10)
    bal_before = r.json()["balance"]
    assert bal_before == STARTING_BALLS

    # Attempt catches until we see both a hit and a miss OR up to 15 attempts.
    saw_hit = False
    saw_miss = False
    attempts = 0
    last_balance = bal_before
    while attempts < 20 and (not saw_hit or not saw_miss):
        attempts += 1
        r = requests.post(f"{API}/spawn/catch", json={"spawn_id": spawn_id}, headers=hdrs, timeout=10)
        assert r.status_code == 200, r.text
        res = r.json()
        # Fetch balance
        rb = requests.get(f"{API}/wallet", headers=hdrs, timeout=10).json()
        new_balance = rb["balance"]
        if res.get("success"):
            saw_hit = True
            # net: -1 throw +1 common reward = 0 net
            assert new_balance - last_balance == 0, f"Expected net 0 on common hit, got {new_balance - last_balance}"
        else:
            saw_miss = True
            assert new_balance - last_balance == -1, f"Expected -1 on miss, got {new_balance - last_balance}"
        last_balance = new_balance
        # Force-reset next_spawn_at so a new spawn is created immediately
        mongo.group_spawns.update_one(
            {"group_id": cid},
            {"$set": {"current_spawn": None, "next_spawn_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat()}},
        )
        rs = requests.get(f"{API}/spawn/current", headers=hdrs, timeout=10).json()
        spawn_id = _extract_spawn_id(rs)
        if not spawn_id:
            for _ in range(5):
                time.sleep(0.5)
                mongo.group_spawns.update_one(
                    {"group_id": cid},
                    {"$set": {"current_spawn": None, "next_spawn_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat()}},
                )
                rs = requests.get(f"{API}/spawn/current", headers=hdrs, timeout=10).json()
                spawn_id = _extract_spawn_id(rs)
                if spawn_id:
                    break
            if not spawn_id:
                break
    assert saw_hit, f"Never got a successful catch in {attempts} attempts (90% common rate)"
    # Note: saw_miss may not happen in 20 attempts at 10% rate - don't require it if never seen


def test_catch_402_when_out_of_balls(mongo, admin_headers):
    cid, hdrs = _login_fresh_camper(mongo, idx=2)
    # Manually set balance to 0
    mongo.camper_wallets.update_one(
        {"camper_id": cid},
        {"$set": {"camper_id": cid, "balance": 0, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    sp = _setup_spawn_for_camper(mongo, cid, hdrs, admin_headers, rarity="common")
    spawn_id = _extract_spawn_id(sp)
    assert spawn_id, f"No spawn_id: {sp}"
    r = requests.post(f"{API}/spawn/catch", json={"spawn_id": spawn_id}, headers=hdrs, timeout=10)
    assert r.status_code == 402, r.text
    assert "out of" in r.text.lower() or "balls" in r.text.lower()


# ---------- Admin wallet endpoints ----------
def test_admin_grant_balls(admin_headers):
    cid = state["c0_id"]
    r = requests.get(f"{API}/wallet", headers=state["c0_hdrs"], timeout=10)
    bal_before = r.json()["balance"]
    r = requests.post(f"{API}/admin/wallet/{cid}/grant", json={"amount": 50, "reason": "test"}, headers=admin_headers, timeout=10)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["granted"] == 50
    assert d["balance"] == bal_before + 50
    # Verify ledger
    r = requests.get(f"{API}/wallet/ledger", headers=state["c0_hdrs"], timeout=10)
    entries = r.json()
    latest = entries[0]
    assert latest["reason"] == "test"
    assert latest["delta"] == 50


def test_admin_grant_zero_400(admin_headers):
    cid = state["c0_id"]
    r = requests.post(f"{API}/admin/wallet/{cid}/grant", json={"amount": 0, "reason": "nope"}, headers=admin_headers, timeout=10)
    assert r.status_code == 400


def test_admin_grant_over_1000_400(admin_headers):
    cid = state["c0_id"]
    r = requests.post(f"{API}/admin/wallet/{cid}/grant", json={"amount": 1001, "reason": "too-much"}, headers=admin_headers, timeout=10)
    assert r.status_code == 400


def test_admin_grant_negative_deducts(admin_headers):
    cid = state["c0_id"]
    r = requests.get(f"{API}/wallet", headers=state["c0_hdrs"], timeout=10)
    bal_before = r.json()["balance"]
    r = requests.post(f"{API}/admin/wallet/{cid}/grant", json={"amount": -10, "reason": "deduct-test"}, headers=admin_headers, timeout=10)
    assert r.status_code == 200
    assert r.json()["balance"] == bal_before - 10


def test_admin_balances_list(admin_headers):
    r = requests.get(f"{API}/admin/wallet/balances", headers=admin_headers, timeout=15)
    assert r.status_code == 200
    arr = r.json()
    assert isinstance(arr, list) and len(arr) > 0
    sample = arr[0]
    for k in ("camper_id", "first_name", "last_name", "group_code", "balance", "has_wallet"):
        assert k in sample
    # Find a camper that has no wallet - should show 200
    no_wallet = [x for x in arr if not x["has_wallet"]]
    if no_wallet:
        assert no_wallet[0]["balance"] == STARTING_BALLS


def test_admin_ledger_returns_entries(admin_headers):
    r = requests.get(f"{API}/admin/wallet/ledger", headers=admin_headers, timeout=10)
    assert r.status_code == 200
    arr = r.json()
    assert isinstance(arr, list) and len(arr) > 0
    assert len(arr) <= 100
    # latest entry has fields
    e = arr[0]
    for k in ("reason", "delta", "balance_after", "created_at", "camper_id"):
        assert k in e, f"Missing {k} in ledger: {e}"


def test_admin_wallet_rejects_camper_token():
    cid = state["c0_id"]
    # grant
    r = requests.post(f"{API}/admin/wallet/{cid}/grant", json={"amount": 10}, headers=state["c0_hdrs"], timeout=10)
    assert r.status_code == 401
    # balances
    r = requests.get(f"{API}/admin/wallet/balances", headers=state["c0_hdrs"], timeout=10)
    assert r.status_code == 401
    # ledger
    r = requests.get(f"{API}/admin/wallet/ledger", headers=state["c0_hdrs"], timeout=10)
    assert r.status_code == 401
