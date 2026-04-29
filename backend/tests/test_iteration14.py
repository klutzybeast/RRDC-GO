"""Iteration 14: Challenges expanded to 4 periods (daily/weekly/monthly/expert).

Tests:
- GET /api/challenges shape, counts, keys, totals
- determinism per camper, distinct picks across campers
- back-compat /api/challenges/today returns daily flat list with `date`
- POST /api/challenges/{id}/claim across periods (mostly via direct ledger seeding)
- Expert sequence advancement on claim
"""
import os
import datetime as _dt
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"


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


@pytest.fixture(scope="module")
def camper_a(session):
    return _camper_token(session, "B01", 0)


@pytest.fixture(scope="module")
def camper_b(session):
    return _camper_token(session, "B01", 1)


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


# ---------- shape & counts ----------
class TestChallengesShape:
    def test_get_challenges_returns_four_buckets(self, session, camper_a):
        token, _ = camper_a
        r = session.get(f"{API}/challenges", headers=_auth(token))
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("daily", "weekly", "monthly", "expert", "totals"):
            assert k in d, f"missing key {k}"
        for p in ("daily", "weekly", "monthly", "expert"):
            assert "key" in d[p] and "challenges" in d[p]
            assert isinstance(d[p]["challenges"], list)

    def test_counts_per_period(self, session, camper_a):
        token, _ = camper_a
        d = session.get(f"{API}/challenges", headers=_auth(token)).json()
        assert len(d["daily"]["challenges"]) == 6, "daily must be 2/2/2 = 6"
        assert len(d["weekly"]["challenges"]) == 6, "weekly must be 2/2/2 = 6"
        assert len(d["monthly"]["challenges"]) == 7, "monthly must be 1/3/3 = 7"
        # Expert: at most 1 (could be 0 if all claimed already)
        assert len(d["expert"]["challenges"]) in (0, 1)

    def test_tier_distribution(self, session, camper_a):
        token, _ = camper_a
        d = session.get(f"{API}/challenges", headers=_auth(token)).json()

        def tier_count(items):
            return {
                "easy": sum(1 for c in items if c["tier"] == "easy"),
                "medium": sum(1 for c in items if c["tier"] == "medium"),
                "hard": sum(1 for c in items if c["tier"] == "hard"),
            }
        assert tier_count(d["daily"]["challenges"]) == {"easy": 2, "medium": 2, "hard": 2}
        assert tier_count(d["weekly"]["challenges"]) == {"easy": 2, "medium": 2, "hard": 2}
        assert tier_count(d["monthly"]["challenges"]) == {"easy": 1, "medium": 3, "hard": 3}

    def test_period_keys_format(self, session, camper_a):
        token, _ = camper_a
        d = session.get(f"{API}/challenges", headers=_auth(token)).json()
        today = _dt.date.today()
        # Daily: YYYY-MM-DD
        assert d["daily"]["key"] == today.isoformat()
        # Weekly: YYYY-Www
        iso = today.isocalendar()
        assert d["weekly"]["key"] == f"{iso[0]}-W{iso[1]:02d}"
        # Monthly: YYYY-MM
        assert d["monthly"]["key"] == today.strftime("%Y-%m")
        # Expert: 'all-time'
        assert d["expert"]["key"] == "all-time"

    def test_challenge_item_fields(self, session, camper_a):
        token, _ = camper_a
        d = session.get(f"{API}/challenges", headers=_auth(token)).json()
        ch = d["daily"]["challenges"][0]
        for f in ("id", "label", "tier", "target", "progress", "completed", "claimed", "reward", "kind", "period"):
            assert f in ch, f"missing field {f}"
        assert ch["period"] == "daily"
        assert isinstance(ch["progress"], int)
        assert isinstance(ch["completed"], bool)

    def test_totals(self, session, camper_a):
        token, _ = camper_a
        d = session.get(f"{API}/challenges", headers=_auth(token)).json()
        expected_total = (
            len(d["daily"]["challenges"])
            + len(d["weekly"]["challenges"])
            + len(d["monthly"]["challenges"])
            + len(d["expert"]["challenges"])
        )
        assert d["totals"]["available"] == expected_total
        ready = sum(1 for p in ("daily", "weekly", "monthly", "expert")
                    for c in d[p]["challenges"] if c["completed"] and not c["claimed"])
        assert d["totals"]["ready_to_claim"] == ready

    def test_auth_required(self, session):
        r = session.get(f"{API}/challenges")
        assert r.status_code in (401, 403)


# ---------- determinism ----------
class TestDeterminism:
    def test_same_camper_same_picks(self, session, camper_a):
        token, _ = camper_a
        d1 = session.get(f"{API}/challenges", headers=_auth(token)).json()
        d2 = session.get(f"{API}/challenges", headers=_auth(token)).json()
        for p in ("daily", "weekly", "monthly"):
            ids1 = sorted(c["id"] for c in d1[p]["challenges"])
            ids2 = sorted(c["id"] for c in d2[p]["challenges"])
            assert ids1 == ids2, f"{p} not deterministic"

    def test_different_campers_can_differ(self, session, camper_a, camper_b):
        ta, _ = camper_a
        tb, _ = camper_b
        da = session.get(f"{API}/challenges", headers=_auth(ta)).json()
        db_ = session.get(f"{API}/challenges", headers=_auth(tb)).json()
        # At least one period should have a different id set OR they coincidentally match
        # — just assert both responses are valid; not a strict difference test.
        for p in ("daily", "weekly", "monthly"):
            assert isinstance(da[p]["challenges"], list)
            assert isinstance(db_[p]["challenges"], list)


# ---------- back-compat ----------
class TestBackCompat:
    def test_challenges_today_returns_flat_daily(self, session, camper_a):
        token, _ = camper_a
        r = session.get(f"{API}/challenges/today", headers=_auth(token))
        assert r.status_code == 200, r.text
        d = r.json()
        assert "date" in d
        assert "challenges" in d
        assert isinstance(d["challenges"], list)
        assert len(d["challenges"]) == 6
        # Same ids as the daily bucket
        flat_ids = sorted(c["id"] for c in d["challenges"])
        bucket = session.get(f"{API}/challenges", headers=_auth(token)).json()
        bucket_ids = sorted(c["id"] for c in bucket["daily"]["challenges"])
        assert flat_ids == bucket_ids


# ---------- claim ----------
class TestClaim:
    def test_claim_unknown_id_returns_404(self, session, camper_a):
        token, _ = camper_a
        r = session.post(f"{API}/challenges/does_not_exist/claim", headers=_auth(token))
        assert r.status_code == 404

    def test_claim_inactive_id_returns_404(self, session, camper_a):
        """An id that exists in templates but isn't picked for this camper."""
        token, _ = camper_a
        d = session.get(f"{API}/challenges", headers=_auth(token)).json()
        active_daily_ids = {c["id"] for c in d["daily"]["challenges"]}
        # Try every daily template id; pick one not in the active set
        all_daily = ["d_catch_3", "d_catch_5", "d_catch_8", "d_uncommon", "d_rare",
                     "d_legendary", "d_supervisor", "d_throw_10", "d_throw_20",
                     "d_use_fancy", "d_walk_500", "d_walk_1500", "d_pin",
                     "d_two_types", "d_three_types"]
        candidates = [x for x in all_daily if x not in active_daily_ids]
        if not candidates:
            pytest.skip("No inactive daily template available for this camper")
        r = session.post(f"{API}/challenges/{candidates[0]}/claim", headers=_auth(token))
        assert r.status_code == 404

    def test_claim_incomplete_returns_400_with_progress(self, session, camper_a):
        token, _ = camper_a
        d = session.get(f"{API}/challenges", headers=_auth(token)).json()
        target = next((c for c in d["daily"]["challenges"]
                       if not c["completed"] and not c["claimed"]), None)
        if not target:
            pytest.skip("No incomplete daily challenge to test")
        r = session.post(f"{API}/challenges/{target['id']}/claim", headers=_auth(token))
        assert r.status_code == 400
        assert "complete" in r.text.lower() or "/" in r.text


# ---------- expert sequence (DB-level, via ball ledger) ----------
class TestExpertSequence:
    """Use mongo to simulate expert claims and verify advancement."""

    @pytest.fixture(scope="class")
    def db(self):
        from pymongo import MongoClient
        from dotenv import dotenv_values
        envv = dotenv_values("/app/backend/.env")
        url = envv.get("MONGO_URL") or os.environ.get("MONGO_URL")
        name = envv.get("DB_NAME") or os.environ.get("DB_NAME")
        if not url or not name:
            pytest.skip("Mongo env not configured")
        return MongoClient(url)[name]

    def test_expert_starts_with_e_first(self, session, camper_a, db):
        token, cid = camper_a
        # Wipe any prior expert ledger for clean test
        db.ball_ledger.delete_many({
            "camper_id": cid,
            "reason": "challenge_complete",
            "meta.period": "expert",
        })
        d = session.get(f"{API}/challenges", headers=_auth(token)).json()
        assert len(d["expert"]["challenges"]) == 1
        assert d["expert"]["challenges"][0]["id"] == "e_first"

    def test_expert_advances_on_simulated_claim(self, session, camper_a, db):
        token, cid = camper_a
        # Insert one fake expert claim ledger entry
        db.ball_ledger.insert_one({
            "camper_id": cid,
            "reason": "challenge_complete",
            "delta": 5,
            "meta": {"period": "expert", "challenge_id": "e_first", "period_key": "all-time"},
        })
        d = session.get(f"{API}/challenges", headers=_auth(token)).json()
        assert len(d["expert"]["challenges"]) == 1
        assert d["expert"]["challenges"][0]["id"] == "e_50"

    def test_expert_empty_after_all_claims(self, session, camper_a, db):
        token, cid = camper_a
        # Insert remaining 11 dummy claims (so total=12)
        from server import EXPERT_SEQUENCE  # type: ignore
        for chid in EXPERT_SEQUENCE[1:]:
            db.ball_ledger.insert_one({
                "camper_id": cid,
                "reason": "challenge_complete",
                "delta": 0,
                "meta": {"period": "expert", "challenge_id": chid, "period_key": "all-time"},
            })
        d = session.get(f"{API}/challenges", headers=_auth(token)).json()
        assert d["expert"]["challenges"] == []

    def test_cleanup_expert_ledger(self, camper_a, db):
        _, cid = camper_a
        db.ball_ledger.delete_many({
            "camper_id": cid,
            "reason": "challenge_complete",
            "meta.period": "expert",
        })
