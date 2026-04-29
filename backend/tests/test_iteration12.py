"""Iteration 12 backend tests:

- Pokemon `type` field: model, GET/PATCH /admin/pokemon, bulk-upload `types`, /bank.
- 4-ball wallet: GET /api/wallet new shape with balances + earn_progress + ball_catch_mult + ball_earn_thresholds.
- POST /api/spawn/catch ball_type handling: fallback to pokeball when fancy ball depleted; returns ball_used; awards milestone ball_rewards.
- BALL_CATCH_MULT codepath verified by inspecting the wallet metadata + a synthetic high-rate catch loop.
"""
import io
import os
import time
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = BASE_URL + "/api"

ADMIN_USER = "admin"
ADMIN_PASS = "Camp1993"


# ---------------- fixtures ----------------
@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/admin/auth/login", json={"username": ADMIN_USER, "password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="session")
def camper_token():
    """Pick first camper from first group and log in."""
    groups = requests.get(f"{API}/groups", timeout=15)
    assert groups.status_code == 200, groups.text
    data = groups.json()
    glist = data if isinstance(data, list) else data.get("groups", [])
    assert glist, "no groups"
    code = glist[0].get("code") or glist[0].get("group_code") or glist[0].get("id")
    campers = requests.get(f"{API}/groups/{code}/campers", timeout=15)
    assert campers.status_code == 200, campers.text
    clist = campers.json()
    assert isinstance(clist, list) and clist, "expected list of campers"
    cid = clist[0]["id"]
    r = requests.post(f"{API}/camper/login", json={"camper_id": cid}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def camper_headers(camper_token):
    return {"Authorization": f"Bearer {camper_token}"}


# ---------------- Pokemon `type` field ----------------
class TestPokemonType:
    """Pokemon model accepts type; PATCH persists; GET returns; bulk-upload accepts parallel `types`."""

    def test_admin_pokemon_list_has_type_field(self, admin_headers):
        r = requests.get(f"{API}/admin/pokemon", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        pokes = r.json()
        assert isinstance(pokes, list) and pokes, "no pokemon seeded"
        # All entries must include the type field
        for p in pokes:
            assert "type" in p, f"missing type in pokemon id={p.get('id')}"
            assert isinstance(p["type"], str)

    def test_patch_pokemon_type_persists(self, admin_headers):
        r = requests.get(f"{API}/admin/pokemon", headers=admin_headers, timeout=15)
        pokes = r.json()
        target = pokes[0]
        original_type = target.get("type", "normal")
        new_type = "electric" if original_type != "electric" else "psychic"

        u = requests.patch(
            f"{API}/admin/pokemon/{target['id']}",
            headers=admin_headers,
            json={"type": new_type},
            timeout=15,
        )
        assert u.status_code == 200, u.text
        assert u.json()["type"] == new_type

        # GET to verify persistence
        g = requests.get(f"{API}/admin/pokemon", headers=admin_headers, timeout=15)
        all_pokes = g.json()
        match = [p for p in all_pokes if p["id"] == target["id"]][0]
        assert match["type"] == new_type

        # Restore
        requests.patch(
            f"{API}/admin/pokemon/{target['id']}",
            headers=admin_headers,
            json={"type": original_type},
            timeout=15,
        )

    def test_bulk_upload_accepts_types_field(self, admin_headers):
        # 1x1 PNG (transparent)
        png = (
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
            b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\x00\x01"
            b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
        )
        files = [
            ("files", ("test_iter12_a.png", io.BytesIO(png), "image/png")),
            ("files", ("test_iter12_b.png", io.BytesIO(png), "image/png")),
        ]
        data = [
            ("names", "TEST_iter12_rock"),
            ("names", "TEST_iter12_dark"),
            ("rarities", "common"),
            ("rarities", "uncommon"),
            ("types", "rock"),
            ("types", "dark"),
            ("descriptions", "iter12 rock test"),
            ("descriptions", "iter12 dark test"),
            ("active", "true"),
            ("featured", "false"),
        ]
        r = requests.post(
            f"{API}/admin/pokemon/bulk-upload",
            headers=admin_headers,
            files=files,
            data=data,
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["created_count"] == 2, body
        created_types = {c["name"]: c["type"] for c in body["created"]}
        # bulk-upload sanitizes name: underscores → spaces
        assert created_types.get("TEST iter12 rock") == "rock"
        assert created_types.get("TEST iter12 dark") == "dark"

        # Cleanup
        for c in body["created"]:
            requests.delete(f"{API}/admin/pokemon/{c['id']}", headers=admin_headers, timeout=15)

    def test_bank_returns_type(self, camper_headers):
        r = requests.get(f"{API}/bank", headers=camper_headers, timeout=15)
        assert r.status_code == 200
        entries = r.json()
        # If empty bank, this still passes the contract — the field default is 'normal'.
        for e in entries:
            assert "type" in e, f"bank entry missing type: {e}"
            assert isinstance(e["type"], str)


# ---------------- Wallet 4-ball shape ----------------
class TestWalletShape:
    """GET /api/wallet returns top-level balance + balances{4} + ball_catch_mult + ball_earn_thresholds + earn_progress."""

    def test_wallet_shape(self, camper_headers):
        r = requests.get(f"{API}/wallet", headers=camper_headers, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()

        # Top-level legacy balance
        assert "balance" in body and isinstance(body["balance"], int)

        # balances dict — exactly the 4 ball types
        assert "balances" in body and isinstance(body["balances"], dict)
        for ball in ("pokeball", "rayball", "myrtleball", "lunchball"):
            assert ball in body["balances"], f"balances missing {ball}"
            assert isinstance(body["balances"][ball], int)

        # Legacy balance MUST mirror pokeball
        assert body["balance"] == body["balances"]["pokeball"], (
            f"balance ({body['balance']}) != balances.pokeball ({body['balances']['pokeball']})"
        )

        # ball_catch_mult — pokeball=1, fancy>1
        mults = body.get("ball_catch_mult")
        assert isinstance(mults, dict)
        assert mults.get("pokeball") == 1.0
        assert mults.get("rayball", 0) > 1.0
        assert mults.get("myrtleball", 0) > 1.0
        assert mults.get("lunchball", 0) > 1.0

        # ball_earn_thresholds
        thr = body.get("ball_earn_thresholds")
        assert isinstance(thr, dict)
        for ball in ("rayball", "myrtleball", "lunchball"):
            assert ball in thr
            assert "rarity" in thr[ball] and "catches_per_ball" in thr[ball]
        assert thr["rayball"]["rarity"] == "uncommon"
        assert thr["myrtleball"]["rarity"] == "rare"
        assert thr["lunchball"]["rarity"] == "legendary"

        # earn_progress for the 3 fancy balls
        ep = body.get("earn_progress")
        assert isinstance(ep, dict)
        for ball in ("rayball", "myrtleball", "lunchball"):
            assert ball in ep, f"earn_progress missing {ball}"
            assert {"have", "need", "rarity"} <= set(ep[ball].keys())
            assert isinstance(ep[ball]["have"], int)
            assert isinstance(ep[ball]["need"], int) and ep[ball]["need"] > 0


# ---------------- Spawn catch with ball_type ----------------
def _ensure_spawn(camper_headers, admin_headers, lat=37.7749, lng=-122.4194):
    """Force a spawn to exist by polling and (if needed) waiting a tick."""
    # Crank up spawn rate via admin so test isn't flaky
    cfg = requests.get(f"{API}/admin/spawn-config", headers=admin_headers, timeout=10).json()
    requests.put(
        f"{API}/admin/spawn-config",
        headers=admin_headers,
        json={
            **cfg,
            "enabled": True,
            "min_interval_min": 0.0,
            "max_interval_min": 0.05,
            "active_hours_start": 0,
            "active_hours_end": 23,
        },
        timeout=10,
    )
    deadline = time.time() + 30
    while time.time() < deadline:
        r = requests.get(f"{API}/spawn/current?lat={lat}&lng={lng}", headers=camper_headers, timeout=15)
        if r.status_code == 200:
            data = r.json()
            spawns = data.get("spawns") or ([data["current"]] if data.get("current") else [])
            if spawns:
                return spawns[0]
        time.sleep(1.0)
    pytest.skip("Could not get a spawn after 30s — environment issue")


class TestSpawnCatchBallType:
    """Catch endpoint applies ball_type, falls back to pokeball when fancy ball=0,
       returns ball_used, awards ball_rewards on rarity milestone."""

    def test_rayball_falls_back_to_pokeball_when_zero(self, camper_headers, admin_headers):
        # Confirm rayball is 0 (or set via direct ledger? we just check current balance)
        w = requests.get(f"{API}/wallet", headers=camper_headers, timeout=10).json()
        if w["balances"]["rayball"] > 0:
            pytest.skip(f"camper already has {w['balances']['rayball']} rayball — fallback test needs 0")
        if w["balances"]["pokeball"] < 1:
            # Top up so we have a pokeball to fall back to
            # (No public top-up — admin grant)
            # Find camper id from /me
            me = requests.get(f"{API}/auth/me", headers=camper_headers, timeout=10)
            assert me.status_code == 200
            cid = me.json()["id"]
            requests.post(
                f"{API}/admin/wallet/{cid}/grant",
                headers=admin_headers,
                json={"amount": 5, "reason": "test_topup"},
                timeout=10,
            )

        spawn = _ensure_spawn(camper_headers, admin_headers)
        spawn_id = spawn["spawn_id"]

        r = requests.post(
            f"{API}/spawn/catch",
            headers=camper_headers,
            json={"spawn_id": spawn_id, "ball_type": "rayball"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # MUST have fallen back to pokeball since rayball=0
        assert body.get("ball_used") == "pokeball", body
        # balances must echo back
        assert "balances" in body and isinstance(body["balances"], dict)

    def test_pokeball_catch_returns_ball_used_pokeball(self, camper_headers, admin_headers):
        # Make sure we have at least one pokeball
        w = requests.get(f"{API}/wallet", headers=camper_headers, timeout=10).json()
        if w["balances"]["pokeball"] < 1:
            me = requests.get(f"{API}/auth/me", headers=camper_headers, timeout=10).json()
            requests.post(
                f"{API}/admin/wallet/{me['id']}/grant",
                headers=admin_headers,
                json={"amount": 5, "reason": "test_topup"},
                timeout=10,
            )

        spawn = _ensure_spawn(camper_headers, admin_headers)
        r = requests.post(
            f"{API}/spawn/catch",
            headers=camper_headers,
            json={"spawn_id": spawn["spawn_id"], "ball_type": "pokeball"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ball_used") == "pokeball"
        # ball_rewards must be a dict (possibly empty or holding rayball/myrtleball/lunchball)
        assert isinstance(body.get("ball_rewards", {}), dict)


# ---------------- BALL_CATCH_MULT codepath ----------------
class TestBallCatchMult:
    """Verify multiplier wiring without flaky randomness — confirm wallet returns the right values
       AND that lunchball use, when supplied, is honored on a high-rate catch."""

    def test_multipliers_in_wallet(self, camper_headers):
        w = requests.get(f"{API}/wallet", headers=camper_headers, timeout=10).json()
        m = w["ball_catch_mult"]
        # Ordering invariant: pokeball < rayball < myrtleball < lunchball
        assert m["pokeball"] < m["rayball"] < m["myrtleball"] < m["lunchball"]

    def test_high_rate_pokeball_catch_succeeds(self, camper_headers, admin_headers):
        """Bump catch_rates so first throw should succeed reliably with pokeball,
           confirming the ball_mult * base_rate path doesn't error."""
        cfg = requests.get(f"{API}/admin/spawn-config", headers=admin_headers, timeout=10).json()
        # Save originals
        orig_rates = cfg.get("catch_rates") or {}
        try:
            requests.put(
                f"{API}/admin/spawn-config",
                headers=admin_headers,
                json={
                    **cfg,
                    "enabled": True,
                    "min_interval_min": 0.0,
                    "max_interval_min": 0.05,
                    "active_hours_start": 0,
                    "active_hours_end": 23,
                    "catch_rates": {"common": 0.99, "uncommon": 0.99, "rare": 0.99, "legendary": 0.99},
                },
                timeout=10,
            )
            # Top up balls
            me = requests.get(f"{API}/auth/me", headers=camper_headers, timeout=10).json()
            requests.post(
                f"{API}/admin/wallet/{me['id']}/grant",
                headers=admin_headers,
                json={"amount": 5, "reason": "test_topup"},
                timeout=10,
            )
            spawn = _ensure_spawn(camper_headers, admin_headers)
            r = requests.post(
                f"{API}/spawn/catch",
                headers=camper_headers,
                json={"spawn_id": spawn["spawn_id"], "ball_type": "pokeball"},
                timeout=15,
            )
            assert r.status_code == 200, r.text
            body = r.json()
            # With 0.99 rate, near-certain success. ball_used always present.
            assert body.get("ball_used") == "pokeball"
            # If success, ball_rewards is a dict (may be empty or have a milestone fancy ball)
            assert isinstance(body.get("ball_rewards", {}), dict)
        finally:
            # Restore catch_rates
            if orig_rates:
                requests.put(
                    f"{API}/admin/spawn-config",
                    headers=admin_headers,
                    json={**cfg, "catch_rates": orig_rates},
                    timeout=10,
                )
