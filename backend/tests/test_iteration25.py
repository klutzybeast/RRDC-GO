"""Iteration 25 backend smoke regression — mobile audit pass.

Smoke: GET /api/inventory (auth), GET /api/admin/pokemon (admin auth),
POST /api/admin/wallet/bulk-grant validation, GET /api/admin/camper-positions
returns stationary_minutes shape.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://river-catch-1.preview.emergentagent.com").rstrip("/")
ADMIN_USER = "admin"
ADMIN_PASS = "Camp1993"


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/admin/auth/login", json={"username": ADMIN_USER, "password": ADMIN_PASS}, timeout=10)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="session")
def camper_token():
    """Log in as the first camper of group B01 for /api/inventory test."""
    g = requests.get(f"{BASE_URL}/api/groups/B01/campers", timeout=10)
    if g.status_code != 200:
        pytest.skip(f"group B01 campers not available: {g.status_code}")
    campers = g.json()
    if not campers:
        pytest.skip("no campers in B01")
    cid = campers[0]["id"]
    r = requests.post(f"{BASE_URL}/api/camper/login", json={"camper_id": cid}, timeout=10)
    assert r.status_code == 200, f"camper login: {r.status_code} {r.text}"
    return r.json()["access_token"]


# ---------- inventory ----------
def test_inventory_requires_auth():
    r = requests.get(f"{BASE_URL}/api/inventory", timeout=10)
    assert r.status_code in (401, 403), f"unexpected: {r.status_code}"


def test_inventory_authenticated(camper_token):
    r = requests.get(f"{BASE_URL}/api/inventory", headers={"Authorization": f"Bearer {camper_token}"}, timeout=10)
    assert r.status_code == 200, f"inventory failed: {r.status_code} {r.text}"
    data = r.json()
    # shape: must contain ball counts
    assert isinstance(data, dict)
    # tolerate either a flat dict of ball->count or nested under 'balls'
    body = data.get("balls", data)
    assert isinstance(body, dict), f"unexpected inventory shape: {data}"


# ---------- admin pokemon ----------
def test_admin_pokemon_list(admin_headers):
    r = requests.get(f"{BASE_URL}/api/admin/pokemon", headers=admin_headers, timeout=10)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert len(data) > 0, "expected at least one seeded pokemon"
    p = data[0]
    for k in ("id", "name", "rarity", "slot_number"):
        assert k in p, f"pokemon missing key {k}: {p.keys()}"


# ---------- bulk-grant validation matrix ----------
class TestBulkGrantValidation:
    """POST /api/admin/wallet/bulk-grant validation cases."""

    def _post(self, headers, body):
        return requests.post(f"{BASE_URL}/api/admin/wallet/bulk-grant", headers=headers, json=body, timeout=10)

    def test_missing_required_fields(self, admin_headers):
        # missing both group_code and amount
        r = self._post(admin_headers, {"ball_type": "poke_ball"})
        assert r.status_code in (400, 422), f"expected validation err, got {r.status_code} {r.text}"

    def test_negative_amount(self, admin_headers):
        r = self._post(admin_headers, {"group_code": "B01", "ball_type": "poke_ball", "amount": -3})
        assert r.status_code in (400, 422), f"expected err, got {r.status_code} {r.text}"

    def test_unauthenticated(self):
        r = requests.post(f"{BASE_URL}/api/admin/wallet/bulk-grant", json={"group_code": "B01", "ball_type": "poke_ball", "amount": 1}, timeout=10)
        assert r.status_code in (401, 403)

    def test_valid_grant_to_group(self, admin_headers):
        r = self._post(admin_headers, {"group_code": "B01", "ball_type": "poke_ball", "amount": 1})
        assert r.status_code in (200, 201, 204), f"valid grant rejected: {r.status_code} {r.text}"


# ---------- camper-positions w/ stationary_minutes ----------
def test_camper_positions_shape(admin_headers):
    r = requests.get(f"{BASE_URL}/api/admin/camper-positions", headers=admin_headers, timeout=10)
    assert r.status_code == 200, f"{r.status_code} {r.text}"
    data = r.json()
    assert isinstance(data, dict)
    assert "positions" in data, f"missing 'positions': keys={list(data.keys())}"
    assert "count" in data
    if data["positions"]:
        pos = data["positions"][0]
        # The patch added stationary_minutes — verify the key is present
        assert "stationary_minutes" in pos, f"stationary_minutes missing: {pos.keys()}"
