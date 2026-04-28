"""Iteration 9 backend tests: supervisor-challenge, analytics export CSV, wall-of-fame."""
import os
import io
import csv
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://river-catch-1.preview.emergentagent.com").rstrip("/")
ADMIN_USER = "admin"
ADMIN_PASS = "Camp1993"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/admin/auth/login",
                      json={"username": ADMIN_USER, "password": ADMIN_PASS}, timeout=20)
    assert r.status_code == 200, f"admin login failed: {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def camper_token():
    # Pick a group and camper
    g = requests.get(f"{BASE_URL}/api/groups", timeout=20)
    assert g.status_code == 200
    groups = g.json()
    assert len(groups) > 0, "no groups available"
    code = groups[0]["group_code"]
    c = requests.get(f"{BASE_URL}/api/groups/{code}/campers", timeout=20)
    assert c.status_code == 200
    campers = c.json()
    assert len(campers) > 0, "no campers in group"
    cid = campers[0]["id"]
    r = requests.post(f"{BASE_URL}/api/camper/login", json={"camper_id": cid}, timeout=20)
    assert r.status_code == 200
    return r.json()["access_token"], cid


# --- Supervisor Challenge ---
def test_supervisor_challenge_shape(camper_token):
    tok, _ = camper_token
    r = requests.get(f"{BASE_URL}/api/supervisor-challenge",
                     headers={"Authorization": f"Bearer {tok}"}, timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    for k in ("week_start", "supervisors", "caught", "total", "complete"):
        assert k in data, f"missing key {k}"
    assert isinstance(data["supervisors"], list)
    assert isinstance(data["total"], int)
    # JonG, Litwack, Mark are featured per problem statement
    assert data["total"] > 0, f"expected total>0, got {data}"
    # Each supervisor entry shape
    for s in data["supervisors"]:
        for k in ("pokemon_id", "name", "rarity", "image_data_url", "caught_this_week"):
            assert k in s, f"supervisor missing key {k}: {s}"


# --- Admin CSV export ---
def test_analytics_export_csv(admin_headers):
    r = requests.get(f"{BASE_URL}/api/admin/analytics/export",
                     headers=admin_headers, timeout=30)
    assert r.status_code == 200, r.text
    ct = r.headers.get("Content-Type", "")
    assert "text/csv" in ct, f"unexpected content-type: {ct}"
    cd = r.headers.get("Content-Disposition", "")
    assert "attachment" in cd.lower(), f"missing attachment header: {cd}"
    # First line check
    first_line = r.text.splitlines()[0] if r.text else ""
    expected = "caught_at,group_name,caught_by,camper_id,pokemon_name,rarity,power_rolled,pokemon_id"
    assert first_line == expected, f"header mismatch: {first_line!r}"
    # Verify well-formed CSV
    reader = csv.reader(io.StringIO(r.text))
    rows = list(reader)
    assert rows[0] == expected.split(",")


def test_analytics_export_unauth():
    r = requests.get(f"{BASE_URL}/api/admin/analytics/export", timeout=20)
    assert r.status_code == 401


# --- Wall of fame ---
def test_wall_of_fame_shape(admin_headers):
    r = requests.get(f"{BASE_URL}/api/admin/analytics/wall-of-fame",
                     headers=admin_headers, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "pokemon" in data
    assert isinstance(data["pokemon"], list)
    assert len(data["pokemon"]) > 0, "expected at least one featured pokemon"
    # Sorted by total_catches desc
    counts = [p.get("total_catches", 0) for p in data["pokemon"]]
    assert counts == sorted(counts, reverse=True), f"not sorted desc: {counts}"
    for p in data["pokemon"]:
        for k in ("pokemon_id", "name", "rarity", "image_data_url",
                  "total_catches", "unique_catchers", "first_caught_at", "last_caught_at"):
            assert k in p, f"wof entry missing key {k}: {list(p.keys())}"


def test_wall_of_fame_unauth():
    r = requests.get(f"{BASE_URL}/api/admin/analytics/wall-of-fame", timeout=20)
    assert r.status_code == 401


# --- Catch increments supervisor challenge counter ---
def test_supervisor_challenge_increments_after_catch(camper_token, admin_headers):
    tok, cid = camper_token
    headers = {"Authorization": f"Bearer {tok}"}

    # Snapshot current count
    r0 = requests.get(f"{BASE_URL}/api/supervisor-challenge", headers=headers, timeout=20).json()
    initial_caught = r0["caught"]

    # Get spawns; force featured by polling at camp coords
    rs = requests.get(f"{BASE_URL}/api/spawn/current?lat=40.6396&lng=-73.6665",
                      headers=headers, timeout=20)
    assert rs.status_code == 200
    spawns = rs.json().get("spawns", [])
    # Find featured spawn (matches supervisor pokemon_id)
    featured_pids = {s["pokemon_id"] for s in r0["supervisors"]}
    target = next((s for s in spawns if s["pokemon"]["id"] in featured_pids), None)
    if not target:
        pytest.skip("no featured spawn currently available")

    target_pid = target["pokemon"]["id"]

    # Already caught this week? skip increment check, but still verify caught_this_week=true after
    already_caught = any(s["pokemon_id"] == target_pid and s["caught_this_week"] for s in r0["supervisors"])

    # Try catching up to 8 times (catch rate ~ rarity-dependent; legendary 25%)
    success = False
    for _ in range(8):
        rc = requests.post(f"{BASE_URL}/api/spawn/catch",
                           json={"spawn_id": target["spawn_id"]},
                           headers=headers, timeout=20)
        if rc.status_code == 402:
            pytest.skip("camper out of balls; skipping increment test")
        if rc.status_code != 200:
            # spawn mismatch likely means it was caught and removed
            break
        if rc.json().get("success"):
            success = True
            break

    if not success:
        pytest.skip("could not catch within attempts (bad RNG)")

    r1 = requests.get(f"{BASE_URL}/api/supervisor-challenge", headers=headers, timeout=20).json()
    matched = next((s for s in r1["supervisors"] if s["pokemon_id"] == target_pid), None)
    assert matched is not None
    assert matched["caught_this_week"] is True
    if not already_caught:
        assert r1["caught"] >= initial_caught + 1, f"caught did not increment: {initial_caught}->{r1['caught']}"
