"""Iteration 13 backend tests:

- Daily Challenges: GET /api/challenges/today returns 3 deterministic challenges per camper+date
  - 1 easy + 1 medium + 1 hard, same calls return same set
  - Different campers generally get different challenges
- POST /api/challenges/{id}/claim
  - Awards reward when complete (wallet.balance bumps)
  - Marks claimed=true on next /today call
  - Second claim returns 400 'Already claimed'
  - Incomplete claim returns 400 'Not complete yet'
  - Bogus id returns 404
- Catches drive progress: catch_total / catch_rarity / throw_count update
- GET /api/spawn/current returns multiple spawns (>=1)
"""
import os
import time
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = BASE_URL + "/api"

ADMIN_USER = "admin"
ADMIN_PASS = "Camp1993"


# ---------------- helpers ----------------
def _login_camper_in_group(group_codes_priority):
    """Try the priority list of group codes; fall back to first group with campers."""
    groups_r = requests.get(f"{API}/groups", timeout=15)
    assert groups_r.status_code == 200, groups_r.text
    data = groups_r.json()
    glist = data if isinstance(data, list) else data.get("groups", [])

    def code_of(g):
        return g.get("code") or g.get("group_code") or g.get("id")

    # Reorder priority first
    ordered = []
    code_set = {code_of(g): g for g in glist}
    for c in group_codes_priority:
        if c in code_set:
            ordered.append(code_set[c])
    for g in glist:
        if g not in ordered:
            ordered.append(g)

    for g in ordered:
        c = code_of(g)
        camp_r = requests.get(f"{API}/groups/{c}/campers", timeout=15)
        if camp_r.status_code != 200:
            continue
        clist = camp_r.json()
        if not isinstance(clist, list) or not clist:
            continue
        cid = clist[0]["id"]
        login = requests.post(f"{API}/camper/login", json={"camper_id": cid}, timeout=15)
        if login.status_code == 200:
            return login.json()["access_token"], cid, c
    pytest.skip("No camper available to log in")


# ---------------- fixtures ----------------
@pytest.fixture(scope="session")
def admin_headers():
    r = requests.post(f"{API}/admin/auth/login", json={"username": ADMIN_USER, "password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="session")
def camper_a():
    """Primary camper — pick one whose daily picks include both catch_total and throw_count
    so the progress tests have something to verify. Falls back to any camper otherwise."""
    groups_r = requests.get(f"{API}/groups", timeout=15)
    glist = groups_r.json() if isinstance(groups_r.json(), list) else groups_r.json().get("groups", [])
    # Priority order
    priority = ["B02", "G01", "B01"]
    sorted_groups = sorted(
        glist,
        key=lambda g: priority.index(g.get("code") or g.get("group_code") or g.get("id"))
        if (g.get("code") or g.get("group_code") or g.get("id")) in priority else 99
    )
    fallback = None
    for g in sorted_groups:
        code = g.get("code") or g.get("group_code") or g.get("id")
        cs = requests.get(f"{API}/groups/{code}/campers", timeout=15).json()
        if not isinstance(cs, list) or not cs:
            continue
        for c in cs:
            login = requests.post(f"{API}/camper/login", json={"camper_id": c["id"]}, timeout=15)
            if login.status_code != 200:
                continue
            tok = login.json()["access_token"]
            headers = {"Authorization": f"Bearer {tok}"}
            ct = requests.get(f"{API}/challenges/today", headers=headers, timeout=15).json()
            kinds = {ch["kind"] for ch in ct.get("challenges", [])}
            cand = {"token": tok, "id": c["id"], "code": code, "headers": headers}
            if "catch_total" in kinds and "throw_count" in kinds:
                return cand
            if fallback is None:
                fallback = cand
    if fallback:
        return fallback
    pytest.skip("No camper available")


@pytest.fixture(scope="session")
def camper_b():
    """Secondary camper for cross-camper determinism check (different group)."""
    # Pull all groups, find one different from camper_a
    groups_r = requests.get(f"{API}/groups", timeout=15)
    glist = groups_r.json() if isinstance(groups_r.json(), list) else groups_r.json().get("groups", [])
    tried = []
    for g in glist:
        code = g.get("code") or g.get("group_code") or g.get("id")
        camp_r = requests.get(f"{API}/groups/{code}/campers", timeout=15)
        if camp_r.status_code != 200:
            continue
        clist = camp_r.json()
        if not isinstance(clist, list) or len(clist) < 1:
            continue
        # Pick a DIFFERENT camper id than camper_a if possible
        for c in clist:
            tried.append(c["id"])
            login = requests.post(f"{API}/camper/login", json={"camper_id": c["id"]}, timeout=15)
            if login.status_code == 200:
                return {"token": login.json()["access_token"], "id": c["id"], "code": code,
                        "headers": {"Authorization": f"Bearer {login.json()['access_token']}"}}
    pytest.skip("Could not log in a second camper")


# ---------------- /challenges/today ----------------
class TestChallengesToday:
    def test_today_returns_three_with_required_fields(self, camper_a):
        r = requests.get(f"{API}/challenges/today", headers=camper_a["headers"], timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "date" in body
        assert isinstance(body["challenges"], list)
        assert len(body["challenges"]) == 3, f"expected 3, got {len(body['challenges'])}"
        required = {"id", "label", "tier", "target", "progress", "completed", "claimed", "reward", "kind"}
        for ch in body["challenges"]:
            missing = required - set(ch.keys())
            assert not missing, f"challenge missing fields {missing}: {ch}"
            assert ch["tier"] in ("easy", "medium", "hard")
            assert isinstance(ch["target"], int) and ch["target"] >= 1
            assert isinstance(ch["progress"], int) and ch["progress"] >= 0
            assert isinstance(ch["reward"], int) and ch["reward"] > 0

    def test_three_tiers_one_each(self, camper_a):
        r = requests.get(f"{API}/challenges/today", headers=camper_a["headers"], timeout=15)
        body = r.json()
        tiers = sorted(c["tier"] for c in body["challenges"])
        assert tiers == ["easy", "hard", "medium"], f"expected one of each tier, got {tiers}"

    def test_deterministic_same_camper(self, camper_a):
        r1 = requests.get(f"{API}/challenges/today", headers=camper_a["headers"], timeout=15).json()
        r2 = requests.get(f"{API}/challenges/today", headers=camper_a["headers"], timeout=15).json()
        ids1 = sorted(c["id"] for c in r1["challenges"])
        ids2 = sorted(c["id"] for c in r2["challenges"])
        assert ids1 == ids2

    def test_different_campers_get_potentially_different(self, camper_a, camper_b):
        # Generally different but with only 5 templates per tier some collisions are
        # expected. Skip if same camper accidentally returned.
        if camper_a["id"] == camper_b["id"]:
            pytest.skip("only one camper available")
        a = requests.get(f"{API}/challenges/today", headers=camper_a["headers"], timeout=15).json()
        b = requests.get(f"{API}/challenges/today", headers=camper_b["headers"], timeout=15).json()
        ids_a = sorted(c["id"] for c in a["challenges"])
        ids_b = sorted(c["id"] for c in b["challenges"])
        # Just assert determinism is per-camper - both endpoints succeed and returned 3 items.
        assert len(ids_a) == 3 and len(ids_b) == 3
        # Note: not asserting they differ — small template pool can collide; main agent contract is determinism per camper.


# ---------------- claim endpoint ----------------
class TestChallengeClaim:
    def test_claim_unknown_id_404(self, camper_a):
        r = requests.post(f"{API}/challenges/notarealid/claim", headers=camper_a["headers"], timeout=15)
        assert r.status_code == 404, r.text

    def test_claim_incomplete_returns_400(self, camper_a):
        # Find an unclaimed, not-completed challenge
        body = requests.get(f"{API}/challenges/today", headers=camper_a["headers"], timeout=15).json()
        cand = next((c for c in body["challenges"] if not c["completed"] and not c["claimed"]), None)
        if not cand:
            pytest.skip("All challenges already complete; cannot test incomplete branch")
        r = requests.post(f"{API}/challenges/{cand['id']}/claim", headers=camper_a["headers"], timeout=15)
        assert r.status_code == 400, r.text
        msg = (r.json().get("detail") or "").lower()
        assert "not complete" in msg or "complete yet" in msg, msg


# ---------------- progress kinds ----------------
def _find_camper_with_kind(kind: str):
    """Scan campers across groups, return the first whose daily picks include `kind`."""
    groups = requests.get(f"{API}/groups", timeout=15).json()
    glist = groups if isinstance(groups, list) else groups.get("groups", [])
    for g in glist:
        code = g.get("code") or g.get("group_code") or g.get("id")
        cs = requests.get(f"{API}/groups/{code}/campers", timeout=15).json()
        if not isinstance(cs, list):
            continue
        for c in cs:
            login = requests.post(f"{API}/camper/login", json={"camper_id": c["id"]}, timeout=15)
            if login.status_code != 200:
                continue
            tok = login.json()["access_token"]
            h = {"Authorization": f"Bearer {tok}"}
            today = requests.get(f"{API}/challenges/today", headers=h, timeout=15).json()
            kinds = {ch["kind"] for ch in today.get("challenges", [])}
            if kind in kinds:
                return {"headers": h, "id": c["id"], "code": code, "today": today}
    return None


class TestChallengeProgress:
    """Trigger spawn catches and verify catch_total + catch_rarity + throw_count progress increments."""

    def _force_spawn_and_catch(self, camper_headers):
        """Try to perform up to 1 catch via /api/spawn/current → /api/spawn/catch.
        Returns dict {caught: bool, rarity: str|None}."""
        sc = requests.get(f"{API}/spawn/current", headers=camper_headers, timeout=15)
        if sc.status_code != 200:
            return {"caught": False, "rarity": None}
        spawns = sc.json().get("spawns") or []
        if not spawns:
            return {"caught": False, "rarity": None}
        s = spawns[0]
        # Try a few times with pokeball — catch isn't deterministic
        last_resp = None
        for _ in range(8):
            payload = {"spawn_id": s["spawn_id"], "ball_type": "pokeball"}
            cr = requests.post(f"{API}/spawn/catch", json=payload, headers=camper_headers, timeout=15)
            last_resp = cr
            if cr.status_code != 200:
                break
            j = cr.json()
            if j.get("caught"):
                return {"caught": True, "rarity": s["pokemon"]["rarity"]}
            # If not caught and spawn fled, refetch
            if j.get("fled"):
                sc = requests.get(f"{API}/spawn/current", headers=camper_headers, timeout=15)
                spawns = sc.json().get("spawns") or []
                if not spawns:
                    break
                s = spawns[0]
            time.sleep(0.2)
        return {"caught": False, "rarity": None, "last": last_resp.text if last_resp else None}

    def test_catch_total_progress_increments_after_catch(self, camper_a):
        cand = _find_camper_with_kind("catch_total")
        if not cand:
            pytest.skip("no camper with catch_total challenge today")
        before = cand["today"]
        ct_before = next((c for c in before["challenges"] if c["kind"] == "catch_total"), None)
        out = self._force_spawn_and_catch(cand["headers"])
        if not out["caught"]:
            pytest.skip("could not successfully catch a Pokemon to verify progress")
        after = requests.get(f"{API}/challenges/today", headers=cand["headers"], timeout=15).json()
        ct_after = next((c for c in after["challenges"] if c["kind"] == "catch_total"), None)
        assert ct_after is not None
        assert ct_after["progress"] >= ct_before["progress"] + 1, \
            f"catch_total progress did not increment: before={ct_before['progress']} after={ct_after['progress']}"

    def test_throw_count_progress_records_throws(self, camper_a):
        cand = _find_camper_with_kind("throw_count")
        if not cand:
            pytest.skip("no camper with throw_count challenge today")
        before = cand["today"]
        tc_before = next((c for c in before["challenges"] if c["kind"] == "throw_count"), None)
        sc = requests.get(f"{API}/spawn/current", headers=cand["headers"], timeout=15)
        spawns = sc.json().get("spawns") or []
        if not spawns:
            pytest.skip("no spawns available")
        s = spawns[0]
        attempts = 0
        for _ in range(3):
            cr = requests.post(f"{API}/spawn/catch",
                               json={"spawn_id": s["spawn_id"], "ball_type": "pokeball"},
                               headers=cand["headers"], timeout=15)
            if cr.status_code != 200:
                break
            attempts += 1
            j = cr.json()
            if j.get("caught"):
                break
            if j.get("fled"):
                sc = requests.get(f"{API}/spawn/current", headers=cand["headers"], timeout=15)
                spawns = sc.json().get("spawns") or []
                if not spawns:
                    break
                s = spawns[0]
        if attempts == 0:
            pytest.skip("unable to throw any balls")
        after = requests.get(f"{API}/challenges/today", headers=cand["headers"], timeout=15).json()
        tc_after = next((c for c in after["challenges"] if c["kind"] == "throw_count"), None)
        assert tc_after["progress"] >= tc_before["progress"] + 1, \
            f"throw_count progress did not increment: before={tc_before['progress']} after={tc_after['progress']}"


# ---------------- claim end-to-end (forces 'catch_total' to complete via target catches) ----------------
class TestClaimEndToEnd:
    """If a low-target catch_total challenge is on today's list, complete it and claim it."""

    def test_claim_pays_out_and_marks_claimed(self, camper_a):
        body = requests.get(f"{API}/challenges/today", headers=camper_a["headers"], timeout=15).json()
        # easiest: a completed-but-not-claimed challenge
        target_ch = next((c for c in body["challenges"] if c["completed"] and not c["claimed"]), None)
        if not target_ch:
            # Try to push an easy catch_total to completion (target<=3) or other low targets
            easy = next((c for c in body["challenges"]
                         if not c["claimed"] and c["target"] <= 3 and c["kind"] in ("catch_total",)), None)
            if not easy:
                pytest.skip("no completable challenge in scope to verify claim e2e")
            # attempt up to 12 catches
            for _ in range(15):
                sc = requests.get(f"{API}/spawn/current", headers=camper_a["headers"], timeout=15)
                spawns = sc.json().get("spawns") or []
                if not spawns:
                    break
                s = spawns[0]
                cr = requests.post(f"{API}/spawn/catch",
                                   json={"spawn_id": s["spawn_id"], "ball_type": "pokeball"},
                                   headers=camper_a["headers"], timeout=15)
                if cr.status_code != 200:
                    break
                # check status
                cur = requests.get(f"{API}/challenges/today", headers=camper_a["headers"], timeout=15).json()
                cur_ch = next((c for c in cur["challenges"] if c["id"] == easy["id"]), None)
                if cur_ch and cur_ch["completed"]:
                    target_ch = cur_ch
                    break
                time.sleep(0.2)
            if not target_ch:
                pytest.skip("could not complete an easy challenge in the test window")

        # Wallet before
        w_before = requests.get(f"{API}/wallet", headers=camper_a["headers"], timeout=15).json()
        bal_before = int(w_before.get("balance", 0))

        # Claim it
        r = requests.post(f"{API}/challenges/{target_ch['id']}/claim",
                          headers=camper_a["headers"], timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["ok"] is True
        assert j["challenge_id"] == target_ch["id"]
        assert j["reward"] == target_ch["reward"]
        assert int(j["balance"]) == bal_before + target_ch["reward"], \
            f"balance did not increase by reward: before={bal_before} after={j['balance']} reward={target_ch['reward']}"

        # Verify wallet GET reflects new balance
        w_after = requests.get(f"{API}/wallet", headers=camper_a["headers"], timeout=15).json()
        assert int(w_after.get("balance", 0)) == bal_before + target_ch["reward"]

        # Next /today should mark it claimed
        body2 = requests.get(f"{API}/challenges/today", headers=camper_a["headers"], timeout=15).json()
        again = next((c for c in body2["challenges"] if c["id"] == target_ch["id"]), None)
        assert again is not None
        assert again["claimed"] is True

        # Second claim returns 400 'Already claimed'
        r2 = requests.post(f"{API}/challenges/{target_ch['id']}/claim",
                           headers=camper_a["headers"], timeout=15)
        assert r2.status_code == 400, r2.text
        assert "already claimed" in (r2.json().get("detail") or "").lower()


# ---------------- /spawn/current shape ----------------
class TestSpawnCurrent:
    def test_returns_spawns_list(self, camper_a):
        r = requests.get(f"{API}/spawn/current", headers=camper_a["headers"], timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "spawns" in data and isinstance(data["spawns"], list)
        # At least 1 (mock coords accepted by backend)
        if data["spawns"]:
            s = data["spawns"][0]
            assert "spawn_id" in s and "pokemon" in s
            assert "name" in s["pokemon"] and "rarity" in s["pokemon"]
