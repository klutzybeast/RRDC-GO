"""Iteration 6 — Checker-background stripping verification.

Tests:
  1. Admin login works and /api/admin/pokemon/fix-backgrounds returns JSON
     with {updated, failed}.
  2. Every active pokemon's image_data_url decodes to a PNG with >=35%
     transparent pixels AND >=8% opaque colorful pixels (body preserved).
  3. Synthetic unit-test in /tmp/test_bg_remover.py passes (checker stripped,
     red circle preserved).
  4. Leaderboard endpoint /api/leaderboard/weekly still returns 200 (no
     regression from server.py changes).
"""

import base64
import io
import os
import subprocess
import sys

import numpy as np
import pytest
import requests
from PIL import Image

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://river-catch-1.preview.emergentagent.com").rstrip("/")
ADMIN_USER = "admin"
ADMIN_PASS = "Camp1993"


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/admin/auth/login", json={"username": ADMIN_USER, "password": ADMIN_PASS}, timeout=30)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    token = r.json().get("access_token")
    assert token
    return token


@pytest.fixture(scope="module")
def camper_token():
    g = requests.get(f"{BASE_URL}/api/groups", timeout=30)
    if g.status_code != 200 or not g.json():
        pytest.skip("no groups available")
    group_code = g.json()[0].get("group_code") or g.json()[0].get("id")
    c = requests.get(f"{BASE_URL}/api/groups/{group_code}/campers", timeout=30)
    if c.status_code != 200 or not c.json():
        pytest.skip("no campers available")
    camper_id = c.json()[0]["id"]
    r = requests.post(f"{BASE_URL}/api/camper/login", json={"camper_id": camper_id}, timeout=30)
    assert r.status_code == 200
    return r.json()["access_token"]


# ---------- Helpers ----------
def _img_stats(data_url: str):
    assert ";base64," in data_url, "not a data URL"
    raw = base64.b64decode(data_url.split(";base64,", 1)[1])
    img = Image.open(io.BytesIO(raw)).convert("RGBA")
    arr = np.array(img)
    rgb = arr[..., :3].astype(np.int16)
    a = arr[..., 3]
    total = a.size
    transparent = (a == 0).sum() / total
    sat = rgb.max(-1) - rgb.min(-1)
    body = ((a >= 250) & (sat >= 60)).sum() / total
    return transparent, body


# ---------- Tests ----------
class TestFixBackgroundsEndpoint:
    def test_admin_auth_required(self):
        r = requests.post(f"{BASE_URL}/api/admin/pokemon/fix-backgrounds", timeout=60)
        assert r.status_code in (401, 403)

    def test_fix_backgrounds_runs(self, admin_token):
        r = requests.post(
            f"{BASE_URL}/api/admin/pokemon/fix-backgrounds",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=180,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        body = r.json()
        assert "updated" in body and "failed" in body
        assert isinstance(body["updated"], int) and isinstance(body["failed"], int)
        assert body["updated"] >= 1, "no pokemon were processed"
        assert body["failed"] == 0, f"{body['failed']} pokemon failed bg removal"


class TestAllPokemonTransparency:
    def test_every_active_pokemon_has_transparent_bg(self, admin_token):
        r = requests.get(
            f"{BASE_URL}/api/admin/pokemon",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=60,
        )
        assert r.status_code == 200
        pokemon = r.json()
        active = [p for p in pokemon if p.get("active") and p.get("image_data_url", "").startswith("data:image")]
        assert len(active) >= 1, "no active pokemon with images"

        failures_tp = []
        failures_body = []
        for p in active:
            try:
                tp, body = _img_stats(p["image_data_url"])
            except Exception as e:
                failures_tp.append((p.get("name"), f"decode error: {e}"))
                continue
            if tp < 0.35:
                failures_tp.append((p.get("name"), f"transparent={tp:.2%} (<35%)"))
            if body < 0.08:
                failures_body.append((p.get("name"), f"colorful-body={body:.2%} (<8%)"))

        print(f"\nChecked {len(active)} active pokemon")
        print(f"  transparency failures: {len(failures_tp)} → {failures_tp[:5]}")
        print(f"  body-preserve failures: {len(failures_body)} → {failures_body[:5]}")

        assert not failures_tp, f"{len(failures_tp)} pokemon have insufficient transparency: {failures_tp}"
        assert not failures_body, f"{len(failures_body)} pokemon have insufficient colored body: {failures_body}"


class TestSyntheticBgRemover:
    def test_synthetic_script_passes(self):
        script = "/tmp/test_bg_remover.py"
        if not os.path.exists(script):
            pytest.skip("synthetic test script missing")
        r = subprocess.run([sys.executable, script], capture_output=True, text=True, timeout=120)
        print(r.stdout)
        print(r.stderr)
        assert r.returncode == 0, f"synthetic tests failed:\n{r.stdout}\n{r.stderr}"


class TestLeaderboardRegression:
    def test_weekly_leaderboard_200(self, camper_token):
        r = requests.get(
            f"{BASE_URL}/api/leaderboard/weekly",
            headers={"Authorization": f"Bearer {camper_token}"},
            timeout=30,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        data = r.json()
        for key in ("top_catchers", "top_pokemon", "top_walkers", "week_start"):
            assert key in data
