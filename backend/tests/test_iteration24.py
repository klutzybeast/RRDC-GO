"""
Iteration 24 — backend smoke for the iOS-tap / logout-off-screen UI fix.

Verifies that the user-facing endpoints touched by the recent UI work are
still healthy:
  * GET /api/inventory       (camper-token gated)
  * GET /api/admin/pokemon   (admin-token gated)
  * POST /api/admin/pokemon/bulk-upload-one (admin, multipart 1×PNG)

Also re-runs login flows (camper id-only + admin u/p) to confirm we still
get tokens back.
"""

import io
import os
import struct
import zlib

import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
ADMIN_USER = "admin"
ADMIN_PASS = "Camp1993"


def _tiny_png_bytes() -> bytes:
    """1x1 transparent PNG without external libs."""
    sig = b"\x89PNG\r\n\x1a\n"

    def _chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = _chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0))
    raw = b"\x00\x00\x00\x00\x00"  # filter byte + RGBA pixel
    idat = _chunk(b"IDAT", zlib.compress(raw))
    iend = _chunk(b"IEND", b"")
    return sig + ihdr + idat + iend


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(
        f"{BASE_URL}/api/admin/auth/login",
        json={"username": ADMIN_USER, "password": ADMIN_PASS},
        timeout=15,
    )
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token")
    assert tok, "no access_token in admin login response"
    return tok


@pytest.fixture(scope="module")
def camper_token():
    g = requests.get(f"{BASE_URL}/api/groups/B01/campers", timeout=15)
    assert g.status_code == 200, f"campers list failed: {g.status_code} {g.text}"
    campers = g.json()
    assert isinstance(campers, list) and campers, "no campers in B01"
    cid = campers[0]["id"]
    r = requests.post(
        f"{BASE_URL}/api/camper/login", json={"camper_id": cid}, timeout=15
    )
    assert r.status_code == 200, f"camper login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token")
    assert tok, "no access_token in camper login response"
    return tok


# ---------- inventory (camper) ----------
def test_inventory_returns_200_and_shape(camper_token):
    r = requests.get(
        f"{BASE_URL}/api/inventory",
        headers={"Authorization": f"Bearer {camper_token}"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "items" in body and isinstance(body["items"], dict)
    assert "buffs" in body and isinstance(body["buffs"], dict)


# ---------- admin pokemon list ----------
def test_admin_pokemon_list_returns_200(admin_token):
    r = requests.get(
        f"{BASE_URL}/api/admin/pokemon",
        headers={"Authorization": f"Bearer {admin_token}"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, list)


# ---------- admin bulk-upload-one ----------
def test_admin_bulk_upload_one_accepts_png(admin_token):
    files = {"file": ("test_iter24.png", io.BytesIO(_tiny_png_bytes()), "image/png")}
    r = requests.post(
        f"{BASE_URL}/api/admin/pokemon/bulk-upload-one",
        headers={"Authorization": f"Bearer {admin_token}"},
        files=files,
        timeout=30,
    )
    # 200 = matched, 201 = created, 422 = no match (still healthy endpoint).
    # Anything < 500 means the route is reachable and not crashing on a tiny PNG.
    assert r.status_code < 500, f"bulk-upload-one crashed: {r.status_code} {r.text}"
    assert r.headers.get("content-type", "").startswith("application/json")


# ---------- regression: groups list still works ----------
def test_groups_list_b01():
    r = requests.get(f"{BASE_URL}/api/groups/B01/campers", timeout=15)
    assert r.status_code == 200
    assert isinstance(r.json(), list)
