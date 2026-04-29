from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import hashlib
import uuid
import math
import random
import logging
import base64
import asyncio
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal

import bcrypt
import jwt
import httpx
import pytz
from io import BytesIO
from PIL import Image
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, UploadFile, File, Form, Body
from fastapi.responses import Response
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, ConfigDict

# --- Config ---
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET"]
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Camp1993")
CAMPER_API_URL = os.environ.get("CAMPER_API_URL", "https://camp-staff-guide.preview.emergentagent.com/api/groups/campers")
SYNC_TIMEZONE = os.environ.get("SYNC_TIMEZONE", "America/New_York")
JWT_ALGO = "HS256"
ACCESS_TTL_HOURS = 24

# --- Scheduler ---
scheduler: Optional[AsyncIOScheduler] = None

# --- DB ---
client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="RRDC GO API")
api = APIRouter(prefix="/api")
logger = logging.getLogger("rrdc")
logging.basicConfig(level=logging.INFO)


# ----------------------
# Models
# ----------------------
Rarity = Literal["common", "uncommon", "rare", "legendary"]
# Kid-friendly catch rates — higher per throw, and Pokemon don't flee on miss
# (they stay around so the camper can keep throwing until they catch).
CATCH_RATES = {"common": 0.40, "uncommon": 0.35, "rare": 0.28, "legendary": 0.30}
# ~1-in-20 legendary spawns. Common/uncommon dominate.
DEFAULT_RARITY_WEIGHTS = {"common": 55, "uncommon": 28, "rare": 12, "legendary": 5}


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: str
    username: str
    group_name: str
    last_login: Optional[datetime] = None


class AdminOut(BaseModel):
    id: str
    username: str
    role: str = "admin"


class UserCreateReq(BaseModel):
    username: str
    password: str
    group_name: str


class UserUpdateReq(BaseModel):
    password: Optional[str] = None
    group_name: Optional[str] = None


class PokemonOut(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    slot_number: int
    name: str
    power_level: int
    rarity: Rarity
    type: str = "normal"
    description: str = ""
    image_data_url: str = ""
    active: bool = False
    featured: bool = False


class PokemonUpdate(BaseModel):
    name: Optional[str] = None
    power_level: Optional[int] = None
    rarity: Optional[Rarity] = None
    type: Optional[str] = None
    description: Optional[str] = None
    active: Optional[bool] = None
    image_data_url: Optional[str] = None
    featured: Optional[bool] = None


class SpawnConfig(BaseModel):
    enabled: bool = True
    min_interval_min: float = 0.25  # 15 s
    max_interval_min: float = 0.75  # 45 s
    active_hours_start: int = 9  # 24h
    active_hours_end: int = 15
    spawn_ttl_seconds: int = 3600  # 1h — effectively no timer during play
    max_active_spawns: int = 6
    rarity_weights: dict = Field(default_factory=lambda: DEFAULT_RARITY_WEIGHTS.copy())
    catch_rates: dict = Field(default_factory=lambda: CATCH_RATES.copy())
    catch_radius_meters: int = 40  # How close a camper must be to a spawn to catch it
    featured_weight_multiplier: float = 3.0  # admin-marked "supervisor" pokemon spawn 3x more often
    camp_latitude: float = 40.6396
    camp_longitude: float = -73.6665
    camp_default_zoom: int = 18
    # Optional list of one-off scheduled windows when the game is "on". Each
    # entry is {label, start, end} where start/end are ISO datetime strings
    # (with timezone). If ANY window is non-empty for today, the game is
    # gated by the windows instead of (or in addition to) active_hours_*.
    scheduled_windows: list = Field(default_factory=list)


class CamperOut(BaseModel):
    id: str
    first_name: str
    last_name: str
    group_code: str


class GroupSummary(BaseModel):
    group_code: str
    camper_count: int


class GroupDetail(BaseModel):
    group_code: str
    campers: List[CamperOut]


class CamperLoginReq(BaseModel):
    camper_id: str


class MapPinOut(BaseModel):
    id: str
    name: str
    latitude: float
    longitude: float
    active: bool = True


class MapPinReq(BaseModel):
    name: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    active: Optional[bool] = None


class RosterStatus(BaseModel):
    last_synced_at: Optional[datetime] = None
    camper_count: int = 0
    group_count: int = 0
    last_error: Optional[str] = None
    next_sync_at: Optional[datetime] = None
    sync_timezone: str = "America/New_York"


class MapSpawnOut(BaseModel):
    spawn_id: str
    pokemon_name: str
    rarity: str
    latitude: float
    longitude: float
    expires_at: datetime


class CurrentSpawn(BaseModel):
    spawn_id: str
    pokemon: PokemonOut
    started_at: datetime
    expires_at: datetime
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    pin_name: Optional[str] = None


class SpawnPollResponse(BaseModel):
    spawns: List[CurrentSpawn] = Field(default_factory=list)
    next_spawn_at: Optional[datetime] = None
    enabled: bool = True
    max_active_spawns: int = 5


class CatchAttemptReq(BaseModel):
    spawn_id: str
    ball_type: Optional[str] = "pokeball"


class CatchResult(BaseModel):
    success: bool
    pokemon: Optional[PokemonOut] = None
    power_rolled: Optional[int] = None
    caught_by: Optional[str] = None
    caught_at: Optional[datetime] = None
    message: str = ""
    ball_used: Optional[str] = None
    ball_rewards: dict = Field(default_factory=dict)  # {ball_type: count_added}
    balances: dict = Field(default_factory=dict)  # current balances after


class CatchRecord(BaseModel):
    id: str
    pokemon_id: str
    pokemon_name: str
    pokemon_image: str
    rarity: Rarity
    power_rolled: int
    caught_by: str
    caught_at: datetime


class BankEntry(BaseModel):
    pokemon_id: str
    name: str
    image_data_url: str
    rarity: Rarity
    type: str = "normal"
    power_level: int
    description: str = ""
    count: int
    last_caught_at: datetime
    best_power: int


# ----------------------
# Auth helpers
# ----------------------
def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False


def create_token(sub: str, role: str, extra: dict = None) -> str:
    payload = {
        "sub": sub,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=ACCESS_TTL_HOURS),
        "iat": datetime.now(timezone.utc),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")


def extract_bearer(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Not authenticated")
    return auth[7:]


async def get_current_user(request: Request) -> dict:
    payload = decode_token(extract_bearer(request))
    role = payload.get("role")
    if role == "camper":
        camper = await db.campers.find_one({"id": payload["sub"]}, {"_id": 0})
        if not camper:
            raise HTTPException(401, "Camper not found")
        return {
            "id": camper["id"],
            "username": f"{camper.get('first_name','').strip()} {camper.get('last_name','').strip()}".strip(),
            "group_name": camper.get("group_code", ""),
            "first_name": camper.get("first_name", ""),
            "last_name": camper.get("last_name", ""),
            "role": "camper",
        }
    if role == "user":
        user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
        if not user:
            raise HTTPException(401, "User not found")
        return user
    raise HTTPException(401, "Invalid role")


async def get_current_admin(request: Request) -> dict:
    payload = decode_token(extract_bearer(request))
    if payload.get("role") != "admin":
        raise HTTPException(401, "Admin only")
    admin = await db.admins.find_one({"id": payload["sub"]}, {"_id": 0})
    if not admin:
        raise HTTPException(401, "Admin not found")
    return admin


# ----------------------
# Brute-force lockout
# ----------------------
LOCKOUT_MAX = 8
LOCKOUT_MIN = 10


async def check_lockout(identifier: str):
    rec = await db.login_attempts.find_one({"identifier": identifier})
    if rec and rec.get("count", 0) >= LOCKOUT_MAX:
        locked_until = rec.get("locked_until")
        if locked_until and datetime.fromisoformat(locked_until) > datetime.now(timezone.utc):
            raise HTTPException(429, "Too many attempts. Try again later.")


async def record_failure(identifier: str):
    rec = await db.login_attempts.find_one({"identifier": identifier})
    count = (rec.get("count", 0) if rec else 0) + 1
    update = {"count": count, "updated_at": datetime.now(timezone.utc).isoformat()}
    if count >= LOCKOUT_MAX:
        update["locked_until"] = (datetime.now(timezone.utc) + timedelta(minutes=LOCKOUT_MIN)).isoformat()
    await db.login_attempts.update_one({"identifier": identifier}, {"$set": update}, upsert=True)


async def clear_failures(identifier: str):
    await db.login_attempts.delete_one({"identifier": identifier})


# ----------------------
# Seeding
# ----------------------
async def seed_admin():
    existing = await db.admins.find_one({"username": ADMIN_USERNAME})
    if not existing:
        await db.admins.insert_one({
            "id": str(uuid.uuid4()),
            "username": ADMIN_USERNAME,
            "password_hash": hash_password(ADMIN_PASSWORD),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        logger.info(f"Seeded admin '{ADMIN_USERNAME}'")
    elif not verify_password(ADMIN_PASSWORD, existing["password_hash"]):
        await db.admins.update_one(
            {"username": ADMIN_USERNAME},
            {"$set": {"password_hash": hash_password(ADMIN_PASSWORD)}},
        )
        logger.info("Admin password updated from env")


async def seed_pokemon_slots():
    count = await db.pokemon.count_documents({})
    if count >= 60:
        return
    to_create = 60 - count
    existing_slots = set()
    async for p in db.pokemon.find({}, {"slot_number": 1}):
        existing_slots.add(p.get("slot_number"))
    next_slot = 1
    docs = []
    for _ in range(to_create):
        while next_slot in existing_slots:
            next_slot += 1
        docs.append({
            "id": str(uuid.uuid4()),
            "slot_number": next_slot,
            "name": f"Pokemon Slot #{next_slot}",
            "power_level": 100,
            "rarity": "common",
            "description": "",
            "image_data_url": "",
            "active": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        existing_slots.add(next_slot)
        next_slot += 1
    if docs:
        await db.pokemon.insert_many(docs)
        logger.info(f"Seeded {len(docs)} empty Pokemon slots")


async def seed_spawn_config():
    existing = await db.spawn_config.find_one({"id": "singleton"})
    if not existing:
        cfg = SpawnConfig().model_dump()
        cfg["id"] = "singleton"
        await db.spawn_config.insert_one(cfg)


async def ensure_indexes():
    await db.users.create_index("username", unique=True)
    await db.admins.create_index("username", unique=True)
    await db.pokemon.create_index("slot_number", unique=True)
    await db.catches.create_index("group_id")
    await db.catches.create_index("caught_at")
    await db.group_spawns.create_index("group_id", unique=True)
    await db.campers.create_index("id", unique=True)
    await db.campers.create_index("group_code")
    await db.map_pins.create_index("id", unique=True)
    await db.camper_positions.create_index("camper_id", unique=True)
    await db.camper_positions.create_index("updated_at")
    await db.camper_distance_daily.create_index([("camper_id", 1), ("date_ymd", 1)], unique=True)
    await db.camper_distance_daily.create_index("date_ymd")
    await db.camper_wallets.create_index("camper_id", unique=True)
    await db.ball_ledger.create_index("camper_id")
    await db.ball_ledger.create_index("created_at")


@app.on_event("startup")
async def startup():
    await ensure_indexes()
    await seed_admin()
    await seed_pokemon_slots()
    await seed_spawn_config()
    # Auto-sync on startup if never synced or older than 12h
    try:
        meta = await db.sync_meta.find_one({"id": "roster"}, {"_id": 0})
        needs_sync = True
        if meta and meta.get("last_synced_at"):
            last = datetime.fromisoformat(meta["last_synced_at"])
            if now_utc() - last < timedelta(hours=12):
                needs_sync = False
        if needs_sync:
            asyncio.create_task(sync_roster())
    except Exception as e:
        logger.error(f"Startup sync check failed: {e}")
    # Start nightly scheduler
    global scheduler
    try:
        scheduler = AsyncIOScheduler(timezone=pytz.timezone(SYNC_TIMEZONE))
        scheduler.add_job(
            sync_roster,
            CronTrigger(hour=0, minute=0, timezone=pytz.timezone(SYNC_TIMEZONE)),
            id="nightly-roster-sync",
            replace_existing=True,
        )
        scheduler.start()
        logger.info(f"Scheduler started; nightly sync at 00:00 {SYNC_TIMEZONE}")
    except Exception as e:
        logger.error(f"Failed to start scheduler: {e}")


@app.on_event("shutdown")
async def shutdown():
    global scheduler
    if scheduler:
        try:
            scheduler.shutdown(wait=False)
        except Exception:
            pass
    client.close()


# ----------------------
# Helper: spawn logic
# ----------------------
def pick_rarity(weights: dict) -> str:
    items = [(k, max(0, v)) for k, v in weights.items()]
    total = sum(w for _, w in items)
    if total <= 0:
        return "common"
    r = random.uniform(0, total)
    acc = 0
    for k, w in items:
        acc += w
        if r <= acc:
            return k
    return items[-1][0]


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def is_within_active_hours(cfg: dict) -> bool:
    """
    A spawn is allowed when:
      • Any scheduled_windows entry is currently active (overrides hours), OR
      • If there are NO upcoming/today windows defined, fall back to the
        daily active_hours_start/end window.
    """
    now = now_utc()
    windows = cfg.get("scheduled_windows") or []
    if windows:
        any_today_or_future = False
        for w in windows:
            try:
                s = datetime.fromisoformat(w.get("start"))
                e = datetime.fromisoformat(w.get("end"))
            except Exception:
                continue
            if s.tzinfo is None:
                s = s.replace(tzinfo=timezone.utc)
            if e.tzinfo is None:
                e = e.replace(tzinfo=timezone.utc)
            if e >= now:
                any_today_or_future = True
            if s <= now <= e:
                return True
        # If at least one window exists in the future, gate strictly by windows.
        if any_today_or_future:
            return False
        # All windows are in the past — fall through to daily hours.
    start = cfg.get("active_hours_start", 0)
    end = cfg.get("active_hours_end", 24)
    h = now.astimezone().hour  # server local - okay for camp day
    if start <= end:
        return start <= h < end
    return h >= start or h < end


async def load_spawn_config() -> dict:
    cfg = await db.spawn_config.find_one({"id": "singleton"}, {"_id": 0})
    if not cfg:
        cfg = SpawnConfig().model_dump()
        cfg["id"] = "singleton"
        await db.spawn_config.insert_one(cfg)
        return cfg
    # Migration: old deployments had a short 600s TTL that caused Pokemon to
    # "time out" mid-catch. Bump to 1h so catching is not time-gated.
    updates = {}
    if int(cfg.get("spawn_ttl_seconds", 0)) < 1800:
        updates["spawn_ttl_seconds"] = 3600
    if not cfg.get("catch_rates"):
        updates["catch_rates"] = CATCH_RATES.copy()
    if not cfg.get("catch_radius_meters"):
        updates["catch_radius_meters"] = 40
    if updates:
        await db.spawn_config.update_one({"id": "singleton"}, {"$set": updates})
        cfg.update(updates)
    return cfg


async def pick_spawn_pokemon(cfg: dict, force_featured: bool = False, exclude_ids: Optional[set] = None) -> Optional[dict]:
    weights = cfg.get("rarity_weights") or DEFAULT_RARITY_WEIGHTS
    featured_boost = float(cfg.get("featured_weight_multiplier", 10.0))
    exclude_ids = exclude_ids or set()

    # If force_featured: pick UNIFORMLY from active featured pokemon (excluding any
    # already in the burst). This guarantees JonG, Mark, and any other supervisor
    # uploads get equal representation — not biased by their rarity weight.
    if force_featured:
        feat_docs = await db.pokemon.find(
            {"active": True, "featured": True},
            {"_id": 0},
        ).to_list(500)
        # Prefer ones we haven't placed in this burst yet
        fresh = [d for d in feat_docs if d["id"] not in exclude_ids]
        pool = fresh if fresh else feat_docs
        if pool:
            return random.choice(pool)
        # Fall through to normal pick if no featured exist

    # Try up to 6 times to get a rarity with actual active pokemon AND
    # a candidate that hasn't already been placed in this burst.
    for _ in range(6):
        rarity = pick_rarity(weights)
        docs = await db.pokemon.find(
            {"active": True, "rarity": rarity},
            {"_id": 0},
        ).to_list(500)
        if not docs:
            continue
        # Prefer pokemon not already in the burst — VARIETY over featured boost.
        fresh = [d for d in docs if d["id"] not in exclude_ids]
        pool = fresh if fresh else docs
        # Featured weighting is gentler now (×3) so non-supervisor pokemon
        # actually show up regularly.
        weights_list = [featured_boost if d.get("featured") else 1.0 for d in pool]
        return random.choices(pool, weights=weights_list, k=1)[0]
    # Fallback: any active pokemon, still excluding duplicates if possible
    docs = await db.pokemon.find({"active": True}, {"_id": 0}).to_list(1000)
    if not docs:
        return None
    fresh = [d for d in docs if d["id"] not in exclude_ids]
    pool = fresh if fresh else docs
    weights_list = [featured_boost if d.get("featured") else 1.0 for d in pool]
    return random.choices(pool, weights=weights_list, k=1)[0]


async def get_or_create_group_state(group_id: str) -> dict:
    state = await db.group_spawns.find_one({"group_id": group_id}, {"_id": 0})
    if not state:
        state = {
            "group_id": group_id,
            "next_spawn_at": now_utc().isoformat(),
            "current_spawn": None,
        }
        await db.group_spawns.insert_one(state)
    return state


async def pick_map_pin() -> Optional[dict]:
    docs = await db.map_pins.aggregate([
        {"$match": {"active": True}},
        {"$sample": {"size": 1}},
        {"$project": {"_id": 0}},
    ]).to_list(1)
    return docs[0] if docs else None


def jitter_location(lat: float, lng: float, min_m: float = 8.0, max_m: float = 30.0) -> (float, float):
    """Return a random point within [min_m, max_m] meters of (lat, lng)."""
    # 1 deg lat ~ 111_111 m; 1 deg lng ~ 111_111 * cos(lat) m
    distance_m = random.uniform(min_m, max_m)
    bearing = random.uniform(0, 2 * math.pi)
    dx = distance_m * math.cos(bearing)  # east-west offset in meters
    dy = distance_m * math.sin(bearing)  # north-south offset in meters
    dlat = dy / 111_111.0
    dlng = dx / (111_111.0 * max(math.cos(math.radians(lat)), 0.000001))
    return lat + dlat, lng + dlng


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance between two points in meters."""
    R = 6371000.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


# How far an existing spawn can be from the camper before we relocate it.
# Anything past this gets dropped so a fresh spawn appears near the camper.
STALE_SPAWN_RELOCATE_M = 250.0


async def maybe_create_spawn(group_id: str, cfg: dict, camper_lat: Optional[float] = None, camper_lng: Optional[float] = None) -> dict:
    """Return the refreshed group state, creating new spawns up to max_active_spawns."""
    state = await get_or_create_group_state(group_id)

    # Normalize to new schema: current_spawns is a list
    current = state.get("current_spawns")
    if current is None:
        legacy = state.get("current_spawn")
        current = [legacy] if legacy else []

    # Filter expired
    fresh = []
    for s in current:
        try:
            if s and datetime.fromisoformat(s["expires_at"]) > now_utc():
                fresh.append(s)
        except Exception:
            pass
    current = fresh

    # If we have a current GPS fix, drop any spawn that is too far away
    # (camper has clearly moved). This guarantees Pokemon always appear near
    # whoever is actively playing — not at camp coords or some old pin.
    if camper_lat is not None and camper_lng is not None:
        try:
            clat = float(camper_lat)
            clng = float(camper_lng)
            current = [
                s for s in current
                if s.get("latitude") is not None
                and s.get("longitude") is not None
                and haversine_m(clat, clng, float(s["latitude"]), float(s["longitude"])) <= STALE_SPAWN_RELOCATE_M
            ]
        except (TypeError, ValueError):
            pass

    if not cfg.get("enabled", True) or not is_within_active_hours(cfg):
        state["current_spawns"] = current
        await db.group_spawns.update_one(
            {"group_id": group_id},
            {"$set": {"current_spawns": current, "current_spawn": None}},
        )
        return state

    # CRITICAL: with 800 kids playing from anywhere, we MUST know where the
    # camper actually is before placing a spawn. If no GPS yet, return the
    # current (possibly empty) list and wait for the next poll. This prevents
    # spawns from ever landing at camp coords / map pins for a kid who's
    # somewhere completely different.
    if camper_lat is None or camper_lng is None:
        state["current_spawns"] = current
        await db.group_spawns.update_one(
            {"group_id": group_id},
            {"$set": {"current_spawns": current, "current_spawn": None}},
        )
        return state

    max_active = int(cfg.get("max_active_spawns", 5))
    next_at = None
    try:
        next_at = datetime.fromisoformat(state.get("next_spawn_at") or now_utc().isoformat())
    except Exception:
        next_at = now_utc()

    # Decide how many to create RIGHT NOW.
    #   - If under cap: create enough to reach min(max_active, 5) immediately so
    #     the camper sees Pokemon as soon as they open the app.
    #   - Then space out further spawns by min/max interval.
    burst_target = min(max_active, 5)
    needed = max(0, burst_target - len(current))
    can_burst_now = now_utc() >= next_at and needed > 0
    if not can_burst_now and now_utc() >= next_at and len(current) < max_active:
        # Trickle one in at the scheduled time
        needed = 1

    # How many active "supervisor" (featured) pokemon does the camp have?
    # Force at most HALF of the burst to be featured supervisors so the rest
    # are filled with regular pokemon — gives the camper variety in the air
    # at the same time.
    featured_count = await db.pokemon.count_documents({"active": True, "featured": True})
    forced_featured_remaining = min(featured_count, max(1, needed // 2))
    placed_ids = {s.get("pokemon_id") for s in current if s}

    created = 0
    while needed > 0 and len(current) < max_active:
        force_featured = forced_featured_remaining > 0
        pokemon = await pick_spawn_pokemon(cfg, force_featured=force_featured, exclude_ids=placed_ids)
        if not pokemon:
            break
        if pokemon.get("featured") and forced_featured_remaining > 0:
            forced_featured_remaining -= 1
        placed_ids.add(pokemon["id"])

        lat, lng = jitter_location(float(camper_lat), float(camper_lng), 3, 15)
        pin_name = "Nearby"
        pin_id = None

        ttl = int(cfg.get("spawn_ttl_seconds", 600))
        # Store a SLIM pokemon (no image) to avoid blowing past Mongo's 16MB
        # document size limit. The image is re-attached when serving the spawn.
        slim_pokemon = {k: v for k, v in pokemon.items() if k != "image_data_url"}
        spawn = {
            "spawn_id": str(uuid.uuid4()),
            "pokemon_id": pokemon["id"],
            "pokemon": slim_pokemon,
            "started_at": now_utc().isoformat(),
            "expires_at": (now_utc() + timedelta(seconds=ttl)).isoformat(),
            "latitude": lat,
            "longitude": lng,
            "pin_name": pin_name,
            "pin_id": pin_id,
        }
        current.append(spawn)
        created += 1
        needed -= 1

    if created > 0:
        gap = random.uniform(cfg["min_interval_min"], cfg["max_interval_min"])
        next_at = now_utc() + timedelta(minutes=gap)

    await db.group_spawns.update_one(
        {"group_id": group_id},
        {"$set": {
            "current_spawns": current,
            "current_spawn": None,
            "next_spawn_at": next_at.isoformat() if next_at else now_utc().isoformat(),
        }},
    )
    state["current_spawns"] = current
    state["next_spawn_at"] = next_at.isoformat() if next_at else now_utc().isoformat()
    return state


# ----------------------
# AUTH ENDPOINTS
# ----------------------
@api.post("/auth/login", response_model=TokenResponse)
async def user_login(req: LoginRequest, request: Request):
    ident = f"user:{req.username.lower()}"
    await check_lockout(ident)
    user = await db.users.find_one({"username": req.username.lower()})
    if not user or not verify_password(req.password, user["password_hash"]):
        await record_failure(ident)
        raise HTTPException(401, "Invalid username or password")
    await clear_failures(ident)
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"last_login": now_utc().isoformat()}},
    )
    token = create_token(user["id"], "user", {"group_name": user["group_name"]})
    return TokenResponse(access_token=token)


@api.get("/auth/me", response_model=UserOut)
async def user_me(user=Depends(get_current_user)):
    return UserOut(
        id=user["id"],
        username=user["username"],
        group_name=user["group_name"],
        last_login=datetime.fromisoformat(user["last_login"]) if user.get("last_login") else None,
    )


@api.post("/auth/logout")
async def user_logout(user=Depends(get_current_user)):
    return {"ok": True}


@api.post("/admin/auth/login", response_model=TokenResponse)
async def admin_login(req: LoginRequest):
    ident = f"admin:{req.username.lower()}"
    await check_lockout(ident)
    admin = await db.admins.find_one({"username": req.username})
    if not admin or not verify_password(req.password, admin["password_hash"]):
        await record_failure(ident)
        raise HTTPException(401, "Invalid admin credentials")
    await clear_failures(ident)
    token = create_token(admin["id"], "admin")
    return TokenResponse(access_token=token)


@api.get("/admin/auth/me", response_model=AdminOut)
async def admin_me(admin=Depends(get_current_admin)):
    return AdminOut(id=admin["id"], username=admin["username"])


# ----------------------
# ADMIN - USERS
# ----------------------
@api.get("/admin/users", response_model=List[UserOut])
async def admin_list_users(admin=Depends(get_current_admin)):
    out = []
    async for u in db.users.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", -1):
        out.append(UserOut(
            id=u["id"],
            username=u["username"],
            group_name=u["group_name"],
            last_login=datetime.fromisoformat(u["last_login"]) if u.get("last_login") else None,
        ))
    return out


@api.post("/admin/users", response_model=UserOut)
async def admin_create_user(req: UserCreateReq, admin=Depends(get_current_admin)):
    if len(req.username) < 2 or len(req.password) < 3:
        raise HTTPException(400, "Username/password too short")
    username = req.username.lower().strip()
    if await db.users.find_one({"username": username}):
        raise HTTPException(409, "Username already exists")
    doc = {
        "id": str(uuid.uuid4()),
        "username": username,
        "password_hash": hash_password(req.password),
        "group_name": req.group_name.strip() or username,
        "created_at": now_utc().isoformat(),
        "last_login": None,
    }
    await db.users.insert_one(doc)
    return UserOut(id=doc["id"], username=doc["username"], group_name=doc["group_name"])


@api.patch("/admin/users/{user_id}", response_model=UserOut)
async def admin_update_user(user_id: str, req: UserUpdateReq, admin=Depends(get_current_admin)):
    updates = {}
    if req.password:
        updates["password_hash"] = hash_password(req.password)
    if req.group_name is not None:
        updates["group_name"] = req.group_name.strip()
    if not updates:
        raise HTTPException(400, "No changes provided")
    res = await db.users.update_one({"id": user_id}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(404, "User not found")
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    return UserOut(
        id=u["id"],
        username=u["username"],
        group_name=u["group_name"],
        last_login=datetime.fromisoformat(u["last_login"]) if u.get("last_login") else None,
    )


@api.delete("/admin/users/{user_id}")
async def admin_delete_user(user_id: str, admin=Depends(get_current_admin)):
    res = await db.users.delete_one({"id": user_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "User not found")
    # Clean up group_spawns & catches
    await db.group_spawns.delete_one({"group_id": user_id})
    return {"ok": True}


# ----------------------
# ADMIN - POKEMON
# ----------------------
def pokemon_to_out(doc: dict) -> PokemonOut:
    return PokemonOut(
        id=doc["id"],
        slot_number=doc.get("slot_number", 0),
        name=doc.get("name", ""),
        power_level=int(doc.get("power_level", 0)),
        rarity=doc.get("rarity", "common"),
        type=doc.get("type", "normal"),
        description=doc.get("description", ""),
        image_data_url=doc.get("image_data_url", ""),
        active=bool(doc.get("active", False)),
        featured=bool(doc.get("featured", False)),
    )


@api.get("/admin/pokemon", response_model=List[PokemonOut])
async def admin_list_pokemon(admin=Depends(get_current_admin)):
    out = []
    async for p in db.pokemon.find({}, {"_id": 0}).sort("slot_number", 1):
        out.append(pokemon_to_out(p))
    return out


@api.patch("/admin/pokemon/{pokemon_id}", response_model=PokemonOut)
async def admin_update_pokemon(pokemon_id: str, req: PokemonUpdate, admin=Depends(get_current_admin)):
    updates = {k: v for k, v in req.model_dump(exclude_unset=True).items() if v is not None}
    if "power_level" in updates:
        pl = int(updates["power_level"])
        if pl < 1 or pl > 1000:
            raise HTTPException(400, "Power level must be 1-1000")
        updates["power_level"] = pl
    if not updates:
        raise HTTPException(400, "No changes")
    res = await db.pokemon.update_one({"id": pokemon_id}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(404, "Pokemon not found")
    doc = await db.pokemon.find_one({"id": pokemon_id}, {"_id": 0})
    return pokemon_to_out(doc)


@api.post("/admin/pokemon/{pokemon_id}/image", response_model=PokemonOut)
async def admin_upload_pokemon_image(
    pokemon_id: str,
    file: UploadFile = File(...),
    admin=Depends(get_current_admin),
):
    if file.content_type not in ("image/jpeg", "image/png", "image/webp"):
        raise HTTPException(400, "Only JPEG, PNG, or WEBP allowed")
    data = await file.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(400, "Image too large (max 5MB)")
    # Auto-remove white background so Pokemon float nicely on the map / AR
    try:
        data = _remove_white_background(data)
        mime = "image/png"
    except Exception as e:
        logger.warning(f"Background removal failed, keeping original: {e}")
        mime = file.content_type
    b64 = base64.b64encode(data).decode()
    data_url = f"data:{mime};base64,{b64}"
    res = await db.pokemon.update_one({"id": pokemon_id}, {"$set": {"image_data_url": data_url}})
    if res.matched_count == 0:
        raise HTTPException(404, "Pokemon not found")
    doc = await db.pokemon.find_one({"id": pokemon_id}, {"_id": 0})
    return pokemon_to_out(doc)


@api.post("/admin/pokemon", response_model=PokemonOut)
async def admin_create_pokemon(req: PokemonUpdate, admin=Depends(get_current_admin)):
    # Find next slot
    last = await db.pokemon.find_one({}, sort=[("slot_number", -1)])
    next_slot = (last.get("slot_number", 0) if last else 0) + 1
    doc = {
        "id": str(uuid.uuid4()),
        "slot_number": next_slot,
        "name": req.name or f"Pokemon Slot #{next_slot}",
        "power_level": int(req.power_level or 100),
        "rarity": req.rarity or "common",
        "type": req.type or "normal",
        "description": req.description or "",
        "image_data_url": req.image_data_url or "",
        "active": bool(req.active) if req.active is not None else False,
        "created_at": now_utc().isoformat(),
    }
    await db.pokemon.insert_one(doc)
    return pokemon_to_out(doc)


@api.delete("/admin/pokemon/{pokemon_id}")
async def admin_delete_pokemon(pokemon_id: str, admin=Depends(get_current_admin)):
    res = await db.pokemon.delete_one({"id": pokemon_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Pokemon not found")
    return {"ok": True}


@api.post("/admin/pokemon/bulk-upload")
async def admin_bulk_upload_pokemon(
    files: List[UploadFile] = File(...),
    names: List[str] = Form([]),
    rarities: List[str] = Form([]),
    types: List[str] = Form([]),
    descriptions: List[str] = Form([]),
    active: bool = Form(True),
    featured: bool = Form(True),
    admin=Depends(get_current_admin),
):
    """Upload many images at once. Optional per-image overrides via parallel arrays:
       `names[i]`, `rarities[i]`, `types[i]`, `descriptions[i]`. Falls back to filename for the
       name and "common" for the rarity / "normal" type when not provided."""
    if not files:
        raise HTTPException(400, "No files provided")
    valid_rarities = {"common", "uncommon", "rare", "legendary"}
    valid_types = {"normal", "fire", "water", "grass", "electric", "rock", "psychic", "dark", "ice", "ghost", "fighting"}

    last = await db.pokemon.find_one({}, sort=[("slot_number", -1)])
    next_slot = (last.get("slot_number", 0) if last else 0) + 1

    created = []
    failed = []
    for i, f in enumerate(files):
        try:
            if f.content_type not in ("image/jpeg", "image/png", "image/webp"):
                failed.append({"name": f.filename, "error": "unsupported file type"})
                continue
            data = await f.read()
            if not data:
                failed.append({"name": f.filename, "error": "empty file"})
                continue
            if len(data) > 8 * 1024 * 1024:
                failed.append({"name": f.filename, "error": "too large (max 8MB)"})
                continue
            try:
                data = _remove_white_background(data)
                mime = "image/png"
            except Exception as e:
                logger.warning(f"bulk upload bg-strip failed for {f.filename}: {e}")
                mime = f.content_type
            b64 = base64.b64encode(data).decode()
            data_url = f"data:{mime};base64,{b64}"

            # Per-file name override; fall back to filename
            override_name = names[i].strip() if i < len(names) and names[i] else ""
            base_name = override_name or (f.filename or f"Pokemon {next_slot}").rsplit(".", 1)[0]
            base_name = base_name.replace("_", " ").replace("-", " ").strip()[:60] or f"Pokemon {next_slot}"

            # Per-file rarity override; fall back to "common"
            this_rarity = rarities[i].strip().lower() if i < len(rarities) and rarities[i] else "common"
            if this_rarity not in valid_rarities:
                this_rarity = "common"

            # Per-file type override; fall back to "normal"
            this_type = types[i].strip().lower() if i < len(types) and types[i] else "normal"
            if this_type not in valid_types:
                this_type = "normal"

            # Per-file description; fall back to default
            this_desc = descriptions[i].strip() if i < len(descriptions) and descriptions[i] else f"Uploaded by admin on {now_utc().date().isoformat()}"

            doc = {
                "id": str(uuid.uuid4()),
                "slot_number": next_slot,
                "name": base_name,
                "power_level": 150 if featured else 100,
                "rarity": this_rarity,
                "type": this_type,
                "description": this_desc[:500],
                "image_data_url": data_url,
                "active": bool(active),
                "featured": bool(featured),
                "is_seed": False,
                "created_at": now_utc().isoformat(),
            }
            await db.pokemon.insert_one(doc)
            created.append(pokemon_to_out(doc).model_dump())
            next_slot += 1
        except Exception as e:
            logger.error(f"bulk upload failed for {f.filename}: {e}")
            failed.append({"name": f.filename, "error": str(e)})

    return {"created": created, "failed": failed, "created_count": len(created), "failed_count": len(failed)}


# ----------------------
# ADMIN - SPAWN CONFIG
# ----------------------
@api.get("/admin/spawn-config", response_model=SpawnConfig)
async def admin_get_spawn_config(admin=Depends(get_current_admin)):
    cfg = await load_spawn_config()
    return SpawnConfig(**{k: v for k, v in cfg.items() if k in SpawnConfig.model_fields})


@api.put("/admin/spawn-config", response_model=SpawnConfig)
async def admin_update_spawn_config(cfg: SpawnConfig, admin=Depends(get_current_admin)):
    if cfg.min_interval_min <= 0 or cfg.max_interval_min < cfg.min_interval_min:
        raise HTTPException(400, "Invalid interval range")
    if not (0 <= cfg.active_hours_start <= 24) or not (0 <= cfg.active_hours_end <= 24):
        raise HTTPException(400, "Active hours must be 0-24")
    doc = cfg.model_dump()
    doc["id"] = "singleton"
    await db.spawn_config.update_one({"id": "singleton"}, {"$set": doc}, upsert=True)
    return cfg


# ----------------------
# ADMIN - ANALYTICS
# ----------------------
@api.get("/admin/analytics")
async def admin_analytics(admin=Depends(get_current_admin)):
    total_catches = await db.catches.count_documents({})
    # By group
    by_group = await db.catches.aggregate([
        {"$group": {"_id": "$group_name", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]).to_list(100)
    # Most caught pokemon
    most_caught = await db.catches.aggregate([
        {"$group": {"_id": {"pid": "$pokemon_id", "name": "$pokemon_name", "image": "$pokemon_image", "rarity": "$rarity"}, "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 10},
    ]).to_list(10)
    # Rarity distribution
    by_rarity = await db.catches.aggregate([
        {"$group": {"_id": "$rarity", "count": {"$sum": 1}}},
    ]).to_list(10)
    # Recent
    recent = []
    async for c in db.catches.find({}, {"_id": 0}).sort("caught_at", -1).limit(50):
        recent.append({
            "id": c["id"],
            "pokemon_name": c["pokemon_name"],
            "pokemon_image": c.get("pokemon_image", ""),
            "rarity": c["rarity"],
            "power_rolled": c["power_rolled"],
            "caught_by": c["caught_by"],
            "group_name": c["group_name"],
            "caught_at": c["caught_at"],
        })
    users_count = await db.users.count_documents({})
    active_pokemon = await db.pokemon.count_documents({"active": True})
    return {
        "total_catches": total_catches,
        "users_count": users_count,
        "active_pokemon": active_pokemon,
        "by_group": [{"group_name": g["_id"] or "Unknown", "count": g["count"]} for g in by_group],
        "most_caught": [{
            "pokemon_id": m["_id"]["pid"],
            "name": m["_id"]["name"],
            "image": m["_id"].get("image", ""),
            "rarity": m["_id"].get("rarity", "common"),
            "count": m["count"],
        } for m in most_caught],
        "by_rarity": [{"rarity": r["_id"], "count": r["count"]} for r in by_rarity],
        "recent": recent,
    }


@api.get("/admin/analytics/export")
async def admin_analytics_export(admin=Depends(get_current_admin)):
    """Stream a CSV of every catch in the system."""
    import csv
    from io import StringIO
    buf = StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "caught_at", "group_name", "caught_by", "camper_id",
        "pokemon_name", "rarity", "power_rolled", "pokemon_id",
    ])
    async for c in db.catches.find({}, {"_id": 0}).sort("caught_at", 1):
        writer.writerow([
            c.get("caught_at", ""),
            c.get("group_name", ""),
            c.get("caught_by", ""),
            c.get("group_id", ""),
            c.get("pokemon_name", ""),
            c.get("rarity", ""),
            c.get("power_rolled", 0),
            c.get("pokemon_id", ""),
        ])
    csv_bytes = buf.getvalue().encode("utf-8")
    fname = f"rrdc_catches_{now_utc().strftime('%Y%m%d_%H%M%S')}.csv"
    return Response(
        content=csv_bytes,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@api.get("/admin/analytics/wall-of-fame")
async def admin_wall_of_fame(admin=Depends(get_current_admin)):
    """Aggregate stats per featured (supervisor) pokemon for the Wall of Fame page."""
    feat_docs = await db.pokemon.find({"featured": True}, {"_id": 0}).to_list(500)
    pid_to_doc = {d["id"]: d for d in feat_docs}
    pids = list(pid_to_doc.keys())
    if not pids:
        return {"pokemon": []}
    pipeline = [
        {"$match": {"pokemon_id": {"$in": pids}}},
        {"$group": {
            "_id": "$pokemon_id",
            "total_catches": {"$sum": 1},
            "first_caught_at": {"$min": "$caught_at"},
            "last_caught_at": {"$max": "$caught_at"},
            "unique_catchers": {"$addToSet": "$group_id"},
            "top_catcher": {"$first": "$caught_by"},
        }},
        {"$addFields": {"unique_catcher_count": {"$size": "$unique_catchers"}}},
        {"$project": {"unique_catchers": 0}},
    ]
    rows = await db.catches.aggregate(pipeline).to_list(500)
    by_id = {r["_id"]: r for r in rows}
    out = []
    for pid, doc in pid_to_doc.items():
        s = by_id.get(pid, {})
        out.append({
            "pokemon_id": pid,
            "name": doc.get("name", ""),
            "rarity": doc.get("rarity", "common"),
            "image_data_url": doc.get("image_data_url", ""),
            "description": doc.get("description", ""),
            "active": doc.get("active", False),
            "total_catches": int(s.get("total_catches", 0)),
            "unique_catchers": int(s.get("unique_catcher_count", 0)),
            "first_caught_at": s.get("first_caught_at"),
            "last_caught_at": s.get("last_caught_at"),
        })
    out.sort(key=lambda x: (-x["total_catches"], x["name"]))
    return {"pokemon": out}


@api.get("/supervisor-challenge")
async def supervisor_challenge(user=Depends(get_current_user)):
    """Camper-facing weekly 'Catch all supervisors' progress."""
    week_start = _week_start_iso()
    feat = await db.pokemon.find(
        {"active": True, "featured": True},
        {"_id": 0, "id": 1, "name": 1, "rarity": 1, "image_data_url": 1},
    ).to_list(500)
    if not feat:
        return {"week_start": week_start, "supervisors": [], "caught": 0, "total": 0, "complete": False}
    pids = [p["id"] for p in feat]
    caught_pids = set()
    async for c in db.catches.find(
        {"group_id": user["id"], "pokemon_id": {"$in": pids}, "caught_at": {"$gte": week_start}},
        {"_id": 0, "pokemon_id": 1},
    ):
        caught_pids.add(c["pokemon_id"])
    supervisors = []
    for p in feat:
        supervisors.append({
            "pokemon_id": p["id"],
            "name": p.get("name", ""),
            "rarity": p.get("rarity", "common"),
            "image_data_url": p.get("image_data_url", ""),
            "caught_this_week": p["id"] in caught_pids,
        })
    supervisors.sort(key=lambda s: (not s["caught_this_week"], s["name"]))
    caught = sum(1 for s in supervisors if s["caught_this_week"])
    total = len(supervisors)
    return {
        "week_start": week_start,
        "supervisors": supervisors,
        "caught": caught,
        "total": total,
        "complete": caught == total and total > 0,
    }


# ----------------------
# USER - SPAWN
# ----------------------
@api.get("/spawn/current", response_model=SpawnPollResponse)
async def spawn_current(
    user=Depends(get_current_user),
    lat: Optional[float] = None,
    lng: Optional[float] = None,
):
    cfg = await load_spawn_config()
    state = await maybe_create_spawn(user["id"], cfg, camper_lat=lat, camper_lng=lng)
    resp = SpawnPollResponse(
        enabled=bool(cfg.get("enabled", True)),
        max_active_spawns=int(cfg.get("max_active_spawns", 5)),
    )
    spawns_list = state.get("current_spawns") or []
    # Bulk-fetch images for all referenced pokemon at once (we don't store images
    # in the spawn doc to stay under Mongo's 16MB doc limit).
    pids = [s.get("pokemon_id") for s in spawns_list if s.get("pokemon_id")]
    image_by_id = {}
    if pids:
        async for p in db.pokemon.find({"id": {"$in": pids}}, {"_id": 0, "id": 1, "image_data_url": 1}):
            image_by_id[p["id"]] = p.get("image_data_url", "")
    for cur in spawns_list:
        try:
            poke = dict(cur["pokemon"])
            poke["image_data_url"] = image_by_id.get(cur.get("pokemon_id"), poke.get("image_data_url", ""))
            resp.spawns.append(CurrentSpawn(
                spawn_id=cur["spawn_id"],
                pokemon=pokemon_to_out(poke),
                started_at=datetime.fromisoformat(cur["started_at"]),
                expires_at=datetime.fromisoformat(cur["expires_at"]),
                latitude=cur.get("latitude"),
                longitude=cur.get("longitude"),
                pin_name=cur.get("pin_name"),
            ))
        except Exception:
            continue
    if state.get("next_spawn_at"):
        try:
            resp.next_spawn_at = datetime.fromisoformat(state["next_spawn_at"])
        except Exception:
            pass
    return resp


@api.post("/spawn/catch", response_model=CatchResult)
async def spawn_catch(req: CatchAttemptReq, user=Depends(get_current_user)):
    cfg = await load_spawn_config()
    state = await db.group_spawns.find_one({"group_id": user["id"]}, {"_id": 0})
    if not state:
        raise HTTPException(400, "No active spawn")

    # Normalize: support both new list schema and legacy singleton schema
    spawns = state.get("current_spawns")
    if spawns is None:
        legacy = state.get("current_spawn")
        spawns = [legacy] if legacy else []

    cur = next((s for s in spawns if s and s.get("spawn_id") == req.spawn_id), None)
    if not cur:
        raise HTTPException(400, "Spawn mismatch (already caught or expired)")
    try:
        if datetime.fromisoformat(cur["expires_at"]) <= now_utc():
            raise HTTPException(400, "Spawn expired")
    except (KeyError, ValueError):
        pass

    # Determine which ball to throw
    ball_type = (req.ball_type or "pokeball").lower()
    if ball_type not in BALL_TYPES:
        ball_type = "pokeball"
    # Require at least one of THAT ball to throw
    wallet = await get_or_init_wallet(user["id"])
    if int((wallet.get("balances") or {}).get(ball_type, 0)) < 1:
        # Fall back to pokeball if user is out of fancy ball
        if ball_type != "pokeball" and int((wallet.get("balances") or {}).get("pokeball", 0)) >= 1:
            ball_type = "pokeball"
        else:
            raise HTTPException(402, "You're out of Rolling River Balls! Earn more by walking to a camp pin or come back tomorrow.")

    # The spawn doc holds a SLIM pokemon (no image_data_url) to stay under
    # MongoDB's 16MB doc limit. Re-attach the image from the pokemon collection
    # so it can be saved on the catch record and returned to the camper.
    pokemon = dict(cur["pokemon"])
    if not pokemon.get("image_data_url"):
        full = await db.pokemon.find_one({"id": cur.get("pokemon_id")}, {"_id": 0, "image_data_url": 1, "type": 1})
        if full:
            pokemon["image_data_url"] = full.get("image_data_url", "")
            if "type" in full and not pokemon.get("type"):
                pokemon["type"] = full.get("type")
    rarity = pokemon.get("rarity", "common")
    effective_rates = cfg.get("catch_rates") or CATCH_RATES
    base_rate = float(effective_rates.get(rarity, CATCH_RATES.get(rarity, 0.5)))
    ball_mult = float(BALL_CATCH_MULT.get(ball_type, 1.0))
    success = random.random() < min(0.97, base_rate * ball_mult)

    # Deduct one of the chosen ball
    wallet = await adjust_ball(user["id"], ball_type, -1, "throw", {"spawn_id": cur["spawn_id"], "rarity": rarity})

    if not success:
        # Track misses on this spawn — flee chance escalates so the Pokemon
        # CAN still be caught at any throw count, but might run as misses pile up.
        misses = int(cur.get("miss_count", 0)) + 1
        # Gentler flee scaling for harder rarities — kids should reliably
        # catch legendaries when a supervisor spawns. Legendaries flee less
        # often per miss and cap lower so they don't run before the kid lands one.
        FLEE_PER_MISS = {"common": 0.03, "uncommon": 0.03, "rare": 0.025, "legendary": 0.018}
        FLEE_CAP = {"common": 0.35, "uncommon": 0.30, "rare": 0.22, "legendary": 0.15}
        per = FLEE_PER_MISS.get(rarity, 0.03)
        cap = FLEE_CAP.get(rarity, 0.30)
        flee_chance = min(cap, max(0.0, (misses - 1) * per))
        fled = random.random() < flee_chance

        if fled:
            # Remove this spawn from the active list so the camper has to find
            # a new one. Other spawns stay active.
            remaining = [s for s in spawns if s and s.get("spawn_id") != cur["spawn_id"]]
            await db.group_spawns.update_one(
                {"group_id": user["id"]},
                {"$set": {"current_spawns": remaining, "current_spawn": None}},
            )
            return CatchResult(
                success=False,
                message=f"{pokemon['name']} fled after {misses} miss{'es' if misses != 1 else ''}!",
                power_rolled=int(wallet.get("balance", 0)),
                ball_used=ball_type,
                balances=wallet.get("balances") or {},
            )

        # Persist the new miss count back into the spawn doc
        for s in spawns:
            if s and s.get("spawn_id") == cur["spawn_id"]:
                s["miss_count"] = misses
                break
        await db.group_spawns.update_one(
            {"group_id": user["id"]},
            {"$set": {"current_spawns": spawns}},
        )
        return CatchResult(
            success=False,
            message=f"{pokemon['name']} dodged! Try again.",
            power_rolled=int(wallet.get("balance", 0)),
            ball_used=ball_type,
            balances=wallet.get("balances") or {},
        )

    # Catch rewards — pokeballs + maybe fancy ball milestone
    reward = CATCH_REWARD.get(rarity, 0)
    if reward > 0:
        wallet = await adjust_ball(user["id"], "pokeball", reward, "catch_reward", {"rarity": rarity, "pokemon_id": pokemon["id"]})
    ball_rewards = {}
    # Award fancy balls based on rarity milestones
    for fancy_ball, rule in BALL_EARN_THRESHOLDS.items():
        if rule["rarity"] != rarity:
            continue
        per = int(rule["catches_per_ball"])
        # Count catches of this rarity since the last milestone reward (inclusive of the one
        # we're about to insert).
        last_award = await db.ball_ledger.find_one(
            {"camper_id": user["id"], "ball_type": fancy_ball, "reason": f"{rarity}_milestone"},
            {"_id": 0},
            sort=[("created_at", -1)],
        )
        cutoff = last_award["created_at"] if last_award else None
        q = {"group_id": user["id"], "rarity": rarity}
        if cutoff:
            q["caught_at"] = {"$gt": cutoff}
        existing = await db.catches.count_documents(q)
        # +1 for the catch we're about to record
        if (existing + 1) >= per:
            wallet = await adjust_ball(user["id"], fancy_ball, 1, f"{rarity}_milestone", {"pokemon_id": pokemon["id"]})
            ball_rewards[fancy_ball] = ball_rewards.get(fancy_ball, 0) + 1

    base_pl = int(pokemon.get("power_level", 100))
    power_rolled = max(1, min(1000, random.randint(max(1, int(base_pl * 0.7)), base_pl)))

    catch_id = str(uuid.uuid4())
    caught_at = now_utc().isoformat()
    catch_doc = {
        "id": catch_id,
        "group_id": user["id"],
        "group_name": user["group_name"],
        "caught_by": user["username"],
        "pokemon_id": pokemon["id"],
        "pokemon_name": pokemon["name"],
        "pokemon_image": pokemon.get("image_data_url", ""),
        "pokemon_description": pokemon.get("description", ""),
        "pokemon_type": pokemon.get("type", "normal"),
        "rarity": rarity,
        "ball_type": ball_type,
        "power_rolled": power_rolled,
        "caught_at": caught_at,
    }
    await db.catches.insert_one(catch_doc)

    # Remove ONLY the caught spawn from the list; keep the rest active.
    remaining = [s for s in spawns if s and s.get("spawn_id") != cur["spawn_id"]]
    # Pick next spawn time for the replacement to spawn back in
    gap_min = random.uniform(cfg["min_interval_min"], cfg["max_interval_min"])
    next_at = (now_utc() + timedelta(minutes=gap_min)).isoformat()
    await db.group_spawns.update_one(
        {"group_id": user["id"]},
        {"$set": {
            "current_spawns": remaining,
            "current_spawn": None,
            "next_spawn_at": next_at,
        }},
    )
    bonus_text = ""
    if ball_rewards:
        parts = [f"+{n} {b}" for b, n in ball_rewards.items()]
        bonus_text = " — " + ", ".join(parts) + "!"
    return CatchResult(
        success=True,
        pokemon=pokemon_to_out(pokemon),
        power_rolled=power_rolled,
        caught_by=user["username"],
        caught_at=datetime.fromisoformat(caught_at),
        message=f"Caught {pokemon['name']}! +{reward} balls{bonus_text}",
        ball_used=ball_type,
        ball_rewards=ball_rewards,
        balances=wallet.get("balances") or {},
    )


@api.post("/spawn/flee")
async def spawn_flee(
    user=Depends(get_current_user),
    req: Optional[CatchAttemptReq] = Body(None),
):
    """Explicit flee — remove a specific spawn from the active list (or all if none specified)."""
    state = await db.group_spawns.find_one({"group_id": user["id"]}, {"_id": 0})
    if not state:
        return {"ok": True}
    spawns = state.get("current_spawns")
    if spawns is None:
        legacy = state.get("current_spawn")
        spawns = [legacy] if legacy else []
    spawn_id = req.spawn_id if req else None
    if spawn_id:
        remaining = [s for s in spawns if s and s.get("spawn_id") != spawn_id]
    else:
        remaining = []
    cfg = await load_spawn_config()
    gap_min = random.uniform(cfg["min_interval_min"], cfg["max_interval_min"])
    next_at = (now_utc() + timedelta(minutes=gap_min)).isoformat()
    await db.group_spawns.update_one(
        {"group_id": user["id"]},
        {"$set": {"current_spawns": remaining, "current_spawn": None, "next_spawn_at": next_at}},
        upsert=True,
    )
    return {"ok": True}


# ----------------------
# USER - BANK / CATCHES
# ----------------------
@api.get("/catches", response_model=List[CatchRecord])
async def list_catches(user=Depends(get_current_user), limit: int = 200):
    out = []
    async for c in db.catches.find({"group_id": user["id"]}, {"_id": 0}).sort("caught_at", -1).limit(limit):
        out.append(CatchRecord(
            id=c["id"],
            pokemon_id=c["pokemon_id"],
            pokemon_name=c["pokemon_name"],
            pokemon_image=c.get("pokemon_image", ""),
            rarity=c["rarity"],
            power_rolled=c["power_rolled"],
            caught_by=c["caught_by"],
            caught_at=datetime.fromisoformat(c["caught_at"]),
        ))
    return out


@api.get("/bank", response_model=List[BankEntry])
async def bank(user=Depends(get_current_user)):
    pipeline = [
        {"$match": {"group_id": user["id"]}},
        {"$sort": {"caught_at": -1}},
        {"$group": {
            "_id": "$pokemon_id",
            "name": {"$first": "$pokemon_name"},
            "image": {"$first": "$pokemon_image"},
            "description": {"$first": "$pokemon_description"},
            "rarity": {"$first": "$rarity"},
            "type": {"$first": "$pokemon_type"},
            "count": {"$sum": 1},
            "last_caught_at": {"$first": "$caught_at"},
            "best_power": {"$max": "$power_rolled"},
            "avg_power": {"$avg": "$power_rolled"},
        }},
    ]
    docs = await db.catches.aggregate(pipeline).to_list(500)
    out = []
    for d in docs:
        out.append(BankEntry(
            pokemon_id=d["_id"],
            name=d["name"],
            image_data_url=d.get("image", "") or "",
            rarity=d.get("rarity", "common"),
            type=d.get("type") or "normal",
            power_level=int(d.get("best_power", 0)),
            description=d.get("description", "") or "",
            count=int(d["count"]),
            last_caught_at=datetime.fromisoformat(d["last_caught_at"]),
            best_power=int(d.get("best_power", 0)),
        ))
    return out


# ----------------------
# USER - WEEKLY LEADERBOARD (kid-facing)
# ----------------------
def _week_start_iso() -> str:
    """Start of the current ISO week (Monday 00:00 UTC)."""
    now = now_utc()
    monday = now - timedelta(days=now.weekday())
    monday = monday.replace(hour=0, minute=0, second=0, microsecond=0)
    return monday.isoformat()


async def _resolve_camper_names(camper_ids: List[str]) -> dict:
    """Map camper_id -> display name. Uses campers collection, then falls back
    to any recorded names on catch/distance rows when campers row is missing."""
    out = {}
    if not camper_ids:
        return out
    async for c in db.campers.find({"id": {"$in": camper_ids}}, {"_id": 0, "id": 1, "first_name": 1, "last_name": 1, "group_code": 1}):
        out[c["id"]] = {
            "first_name": c.get("first_name", ""),
            "last_name": c.get("last_name", ""),
            "group_code": c.get("group_code", ""),
        }
    return out


@api.get("/leaderboard/weekly")
async def weekly_leaderboard(user=Depends(get_current_user), limit: int = 10):
    """Kid-facing weekly standings: top catchers, most-caught pokemon, longest walkers.
    Scoped to the current ISO week (Mon 00:00 UTC). Also returns `me` = viewer's
    personal stats + rank in each category."""
    week_start = _week_start_iso()
    me_id = user["id"]

    # --- TOP CATCHERS (by catch count this week) ---
    catch_pipeline = [
        {"$match": {"caught_at": {"$gte": week_start}}},
        {"$group": {
            "_id": "$group_id",  # group_id == camper_id in this app's model
            "count": {"$sum": 1},
            "caught_by": {"$first": "$caught_by"},
            "group_name": {"$first": "$group_name"},
            "last_caught_at": {"$max": "$caught_at"},
            "best_rarity_legendary": {"$sum": {"$cond": [{"$eq": ["$rarity", "legendary"]}, 1, 0]}},
            "best_rarity_rare": {"$sum": {"$cond": [{"$eq": ["$rarity", "rare"]}, 1, 0]}},
        }},
        {"$sort": {"count": -1, "last_caught_at": 1}},
    ]
    catch_rows = await db.catches.aggregate(catch_pipeline).to_list(500)
    camper_ids = [r["_id"] for r in catch_rows if r.get("_id")]
    names = await _resolve_camper_names(camper_ids)
    top_catchers = []
    me_catch_rank = None
    me_catch_count = 0
    for idx, r in enumerate(catch_rows):
        cid = r["_id"]
        nm = names.get(cid, {})
        entry = {
            "camper_id": cid,
            "first_name": nm.get("first_name") or r.get("caught_by") or "Camper",
            "last_name": nm.get("last_name", ""),
            "group_code": nm.get("group_code") or r.get("group_name", ""),
            "catches": int(r["count"]),
            "legendaries": int(r.get("best_rarity_legendary", 0)),
            "rares": int(r.get("best_rarity_rare", 0)),
            "is_me": cid == me_id,
        }
        if cid == me_id:
            me_catch_rank = idx + 1
            me_catch_count = int(r["count"])
        if idx < limit:
            top_catchers.append({**entry, "rank": idx + 1})

    # --- MOST-CAUGHT POKEMON (species this week, across all campers) ---
    poke_pipeline = [
        {"$match": {"caught_at": {"$gte": week_start}}},
        {"$group": {
            "_id": "$pokemon_id",
            "name": {"$first": "$pokemon_name"},
            "image": {"$first": "$pokemon_image"},
            "rarity": {"$first": "$rarity"},
            "count": {"$sum": 1},
            "unique_catchers": {"$addToSet": "$group_id"},
        }},
        {"$addFields": {"unique_catcher_count": {"$size": "$unique_catchers"}}},
        {"$project": {"unique_catchers": 0}},
        {"$sort": {"count": -1, "name": 1}},
        {"$limit": limit},
    ]
    top_pokemon_rows = await db.catches.aggregate(poke_pipeline).to_list(limit)
    top_pokemon = [
        {
            "rank": i + 1,
            "pokemon_id": r["_id"],
            "name": r.get("name", ""),
            "image_data_url": r.get("image", "") or "",
            "rarity": r.get("rarity", "common"),
            "count": int(r.get("count", 0)),
            "unique_catchers": int(r.get("unique_catcher_count", 0)),
        }
        for i, r in enumerate(top_pokemon_rows)
    ]

    # --- TOP WALKERS (meters accumulated this week) ---
    week_ymd = (now_utc() - timedelta(days=now_utc().weekday())).strftime("%Y-%m-%d")
    walk_pipeline = [
        {"$match": {"date_ymd": {"$gte": week_ymd}}},
        {"$group": {
            "_id": "$camper_id",
            "meters": {"$sum": "$meters"},
            "first_name": {"$first": "$first_name"},
            "last_name": {"$first": "$last_name"},
            "group_code": {"$first": "$group_code"},
        }},
        {"$sort": {"meters": -1}},
    ]
    walk_rows = await db.camper_distance_daily.aggregate(walk_pipeline).to_list(500)
    walker_ids = [r["_id"] for r in walk_rows if r.get("_id")]
    walker_names = await _resolve_camper_names(walker_ids)
    top_walkers = []
    me_walk_rank = None
    me_meters = 0.0
    for idx, r in enumerate(walk_rows):
        cid = r["_id"]
        nm = walker_names.get(cid, {})
        entry = {
            "camper_id": cid,
            "first_name": nm.get("first_name") or r.get("first_name") or "Camper",
            "last_name": nm.get("last_name") or r.get("last_name", ""),
            "group_code": nm.get("group_code") or r.get("group_code", ""),
            "meters": float(r.get("meters", 0)),
            "is_me": cid == me_id,
        }
        if cid == me_id:
            me_walk_rank = idx + 1
            me_meters = float(r.get("meters", 0))
        if idx < limit:
            top_walkers.append({**entry, "rank": idx + 1})

    return {
        "week_start": week_start,
        "top_catchers": top_catchers,
        "top_pokemon": top_pokemon,
        "top_walkers": top_walkers,
        "me": {
            "camper_id": me_id,
            "catches": me_catch_count,
            "catch_rank": me_catch_rank,
            "meters": round(me_meters, 1),
            "walk_rank": me_walk_rank,
            "total_campers_with_catches": len(catch_rows),
            "total_campers_walking": len(walk_rows),
        },
    }


# ----------------------
# Health
# ----------------------
@api.get("/")
async def root():
    return {"ok": True, "service": "RRDC GO"}


@api.get("/health")
async def health():
    return {"status": "ok", "time": now_utc().isoformat()}


# ----------------------
# CAMPERSNAP ROSTER SYNC
# ----------------------
def _camper_id(first_name: str, last_name: str, group_code: str) -> str:
    """Stable deterministic id so re-sync keeps same identity for a kid."""
    base = f"{(first_name or '').strip().lower()}|{(last_name or '').strip().lower()}|{(group_code or '').strip().upper()}"
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"rrdc-camper::{base}"))


async def sync_roster() -> dict:
    """Fetch CamperSnap roster and upsert into campers collection."""
    started_at = now_utc()
    logger.info(f"Starting roster sync from {CAMPER_API_URL}")
    result = {"camper_count": 0, "group_count": 0, "added": 0, "updated": 0, "removed": 0, "error": None}
    try:
        async with httpx.AsyncClient(timeout=30.0) as hx:
            r = await hx.get(CAMPER_API_URL)
            r.raise_for_status()
            data = r.json()
        groups = data.get("groups") or {}
        seen_ids = set()
        added = 0
        updated = 0
        for group_code, campers in groups.items():
            gc = (group_code or "").upper().strip()
            if not gc:
                continue
            for c in campers:
                first = (c.get("first_name") or "").strip()
                last = (c.get("last_name") or "").strip()
                if not first and not last:
                    continue
                cid = _camper_id(first, last, gc)
                seen_ids.add(cid)
                existing = await db.campers.find_one({"id": cid}, {"_id": 0})
                doc = {
                    "id": cid,
                    "first_name": first,
                    "last_name": last,
                    "group_code": gc,
                    "updated_at": now_utc().isoformat(),
                }
                if existing:
                    await db.campers.update_one({"id": cid}, {"$set": doc})
                    updated += 1
                else:
                    doc["created_at"] = now_utc().isoformat()
                    await db.campers.insert_one(doc)
                    added += 1
        removed = 0
        if seen_ids:
            del_res = await db.campers.delete_many({"id": {"$nin": list(seen_ids)}})
            removed = del_res.deleted_count

        total = await db.campers.count_documents({})
        groups_count = len(groups)
        await db.sync_meta.update_one(
            {"id": "roster"},
            {"$set": {
                "last_synced_at": now_utc().isoformat(),
                "camper_count": total,
                "group_count": groups_count,
                "last_error": None,
                "last_duration_ms": int((now_utc() - started_at).total_seconds() * 1000),
            }},
            upsert=True,
        )
        result.update({"camper_count": total, "group_count": groups_count, "added": added, "updated": updated, "removed": removed})
        logger.info(f"Roster sync complete: {result}")
        return result
    except Exception as e:
        logger.error(f"Roster sync failed: {e}")
        await db.sync_meta.update_one(
            {"id": "roster"},
            {"$set": {"last_error": str(e), "last_error_at": now_utc().isoformat()}},
            upsert=True,
        )
        result["error"] = str(e)
        return result


# ----------------------
# PUBLIC - GROUPS & CAMPERS (for login flow)
# ----------------------
@api.get("/groups", response_model=List[GroupSummary])
async def public_groups():
    pipeline = [
        {"$group": {"_id": "$group_code", "count": {"$sum": 1}}},
        {"$sort": {"_id": 1}},
    ]
    out = []
    async for g in db.campers.aggregate(pipeline):
        out.append(GroupSummary(group_code=g["_id"], camper_count=g["count"]))
    return out


@api.get("/groups/{group_code}/campers", response_model=List[CamperOut])
async def public_group_campers(group_code: str):
    code = group_code.upper().strip()
    out = []
    async for c in db.campers.find({"group_code": code}, {"_id": 0}).sort([("last_name", 1), ("first_name", 1)]):
        out.append(CamperOut(
            id=c["id"],
            first_name=c.get("first_name", ""),
            last_name=c.get("last_name", ""),
            group_code=c.get("group_code", ""),
        ))
    return out


@api.post("/camper/login", response_model=TokenResponse)
async def camper_login(req: CamperLoginReq):
    camper = await db.campers.find_one({"id": req.camper_id}, {"_id": 0})
    if not camper:
        raise HTTPException(404, "Camper not found")
    token = create_token(camper["id"], "camper", {"group_code": camper.get("group_code", ""), "name": f"{camper.get('first_name','')} {camper.get('last_name','')}".strip()})
    return TokenResponse(access_token=token)


# ----------------------
# ADMIN - ROSTER
# ----------------------
@api.get("/admin/roster-status", response_model=RosterStatus)
async def admin_roster_status(admin=Depends(get_current_admin)):
    meta = await db.sync_meta.find_one({"id": "roster"}, {"_id": 0}) or {}
    next_at = None
    try:
        if scheduler and scheduler.running:
            job = scheduler.get_job("nightly-roster-sync")
            if job and job.next_run_time:
                next_at = job.next_run_time
    except Exception as e:
        logger.error(f"get next_run_time failed: {e}")
    return RosterStatus(
        last_synced_at=datetime.fromisoformat(meta["last_synced_at"]) if meta.get("last_synced_at") else None,
        camper_count=int(meta.get("camper_count", 0) or await db.campers.count_documents({})),
        group_count=int(meta.get("group_count", 0)),
        last_error=meta.get("last_error"),
        next_sync_at=next_at,
        sync_timezone=SYNC_TIMEZONE,
    )


@api.post("/admin/roster-sync")
async def admin_roster_sync(admin=Depends(get_current_admin)):
    result = await sync_roster()
    return result


@api.get("/admin/roster")
async def admin_roster_list(admin=Depends(get_current_admin)):
    pipeline = [
        {"$group": {"_id": "$group_code", "campers": {"$push": {"id": "$id", "first_name": "$first_name", "last_name": "$last_name"}}, "count": {"$sum": 1}}},
        {"$sort": {"_id": 1}},
    ]
    out = []
    async for g in db.campers.aggregate(pipeline):
        campers = sorted(g["campers"], key=lambda x: (x.get("last_name", ""), x.get("first_name", "")))
        out.append({"group_code": g["_id"], "count": g["count"], "campers": campers})
    return out


# ----------------------
# ADMIN - MAP PINS
# ----------------------
@api.get("/admin/map-pins", response_model=List[MapPinOut])
async def admin_list_pins(admin=Depends(get_current_admin)):
    out = []
    async for p in db.map_pins.find({}, {"_id": 0}).sort("name", 1):
        out.append(MapPinOut(
            id=p["id"],
            name=p.get("name", ""),
            latitude=float(p.get("latitude", 0)),
            longitude=float(p.get("longitude", 0)),
            active=bool(p.get("active", True)),
        ))
    return out


@api.post("/admin/map-pins", response_model=MapPinOut)
async def admin_create_pin(req: MapPinReq, admin=Depends(get_current_admin)):
    if req.latitude is None or req.longitude is None:
        raise HTTPException(400, "latitude/longitude required")
    doc = {
        "id": str(uuid.uuid4()),
        "name": req.name or "Camp pin",
        "latitude": float(req.latitude),
        "longitude": float(req.longitude),
        "active": True if req.active is None else bool(req.active),
        "created_at": now_utc().isoformat(),
    }
    await db.map_pins.insert_one(doc)
    return MapPinOut(id=doc["id"], name=doc["name"], latitude=doc["latitude"], longitude=doc["longitude"], active=doc["active"])


@api.patch("/admin/map-pins/{pin_id}", response_model=MapPinOut)
async def admin_update_pin(pin_id: str, req: MapPinReq, admin=Depends(get_current_admin)):
    updates = {k: v for k, v in req.model_dump(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(400, "No changes")
    res = await db.map_pins.update_one({"id": pin_id}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(404, "Pin not found")
    p = await db.map_pins.find_one({"id": pin_id}, {"_id": 0})
    return MapPinOut(id=p["id"], name=p.get("name", ""), latitude=float(p["latitude"]), longitude=float(p["longitude"]), active=bool(p.get("active", True)))


@api.delete("/admin/map-pins/{pin_id}")
async def admin_delete_pin(pin_id: str, admin=Depends(get_current_admin)):
    res = await db.map_pins.delete_one({"id": pin_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Pin not found")
    return {"ok": True}


@api.get("/map-pins", response_model=List[MapPinOut])
async def user_list_pins(user=Depends(get_current_user)):
    out = []
    async for p in db.map_pins.find({"active": True}, {"_id": 0}):
        out.append(MapPinOut(
            id=p["id"],
            name=p.get("name", ""),
            latitude=float(p.get("latitude", 0)),
            longitude=float(p.get("longitude", 0)),
            active=True,
        ))
    return out


@api.get("/camp-center")
async def get_camp_center(user=Depends(get_current_user)):
    cfg = await load_spawn_config()
    return {
        "latitude": float(cfg.get("camp_latitude", 40.6396)),
        "longitude": float(cfg.get("camp_longitude", -73.6665)),
        "default_zoom": int(cfg.get("camp_default_zoom", 18)),
        "catch_radius_meters": int(cfg.get("catch_radius_meters", 40)),
        "catch_rates": cfg.get("catch_rates") or CATCH_RATES,
    }


# ----------------------
# AMBIENT (weather + day/night) — powers the AR fallback scene theming.
# Open-Meteo is free + keyless. Results cached for 10 minutes per
# rounded coordinate so 800 kids polling don't hammer the upstream.
# ----------------------
_AMBIENT_CACHE: dict = {}
_AMBIENT_TTL_SEC = 600


def _wmo_to_condition(code: int, is_day: int, temp_c: float, wind_kmh: float) -> str:
    """Map Open-Meteo WMO weather code → simple scene bucket the frontend
    knows how to render. See https://open-meteo.com/en/docs (WMO codes)."""
    c = int(code or 0)
    if c in (95, 96, 99):
        return "thunder"
    if c in (71, 73, 75, 77, 85, 86):
        return "snow"
    if c in (51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82):
        return "rain"
    if c in (45, 48):
        return "fog"
    if c in (3,):
        return "cloudy"
    if c in (1, 2):
        return "partly_cloudy"
    # 0 = clear sky
    if wind_kmh and wind_kmh >= 30:
        return "windy"
    if temp_c is not None and temp_c <= 4:
        return "cold_clear"
    return "sunny" if int(is_day or 0) == 1 else "clear_night"


@api.get("/ambient")
async def get_ambient(
    user=Depends(get_current_user),
    lat: Optional[float] = None,
    lng: Optional[float] = None,
):
    """Return current sky/weather context for the camper's location."""
    if lat is None or lng is None:
        # No GPS — give a generic daytime sunny default so the scene still looks nice.
        h = now_utc().astimezone().hour
        return {
            "is_day": 6 <= h < 19,
            "condition": "sunny" if 6 <= h < 19 else "clear_night",
            "temperature_c": None,
            "wind_kmh": None,
            "weather_code": 0,
            "source": "fallback",
        }

    # Round to ~1 km cells so close-by kids share a cache hit.
    key = f"{round(float(lat), 2)},{round(float(lng), 2)}"
    cached = _AMBIENT_CACHE.get(key)
    now_ts = now_utc().timestamp()
    if cached and (now_ts - cached["t"]) < _AMBIENT_TTL_SEC:
        return cached["data"]

    try:
        async with httpx.AsyncClient(timeout=4.0) as hx:
            r = await hx.get(
                "https://api.open-meteo.com/v1/forecast",
                params={
                    "latitude": float(lat),
                    "longitude": float(lng),
                    "current": "temperature_2m,weather_code,wind_speed_10m,is_day",
                    "wind_speed_unit": "kmh",
                    "timezone": "auto",
                },
            )
            r.raise_for_status()
            j = r.json()
        cur = j.get("current") or {}
        temp_c = cur.get("temperature_2m")
        wind = cur.get("wind_speed_10m")
        is_day = cur.get("is_day", 1)
        code = cur.get("weather_code", 0)
        condition = _wmo_to_condition(code, is_day, temp_c, wind)
        data = {
            "is_day": bool(is_day),
            "condition": condition,
            "temperature_c": float(temp_c) if temp_c is not None else None,
            "wind_kmh": float(wind) if wind is not None else None,
            "weather_code": int(code),
            "source": "open-meteo",
        }
    except Exception as e:
        logger.warning(f"ambient fetch failed for {key}: {e}")
        h = now_utc().astimezone().hour
        data = {
            "is_day": 6 <= h < 19,
            "condition": "sunny" if 6 <= h < 19 else "clear_night",
            "temperature_c": None,
            "wind_kmh": None,
            "weather_code": 0,
            "source": "fallback",
        }
    _AMBIENT_CACHE[key] = {"t": now_ts, "data": data}
    return data



# ----------------------
# CAMPER POSITION CACHE (reduces chatter; enables future nearby features)
# ----------------------
class PositionReq(BaseModel):
    latitude: float
    longitude: float
    accuracy: Optional[float] = None


@api.post("/camper/position")
async def save_camper_position(req: PositionReq, user=Depends(get_current_user)):
    """Persist the camper's current position. Throttled server-side: only writes
    if moved > 5 meters from last known or last write was > 20 s ago.
    Also accumulates a daily 'meters walked' counter for the leaderboard."""
    now = now_utc()
    prev = await db.camper_positions.find_one({"camper_id": user["id"]}, {"_id": 0})
    should_write = True
    dist_m = 0.0
    if prev:
        last_at = datetime.fromisoformat(prev.get("updated_at", now.isoformat()))
        dt = (now - last_at).total_seconds()
        # Distance in meters (equirectangular, fine for short distances)
        dlat = (req.latitude - prev["latitude"]) * 111_111.0
        dlng = (req.longitude - prev["longitude"]) * 111_111.0 * math.cos(math.radians(req.latitude))
        dist_m = (dlat * dlat + dlng * dlng) ** 0.5
        if dt < 20 and dist_m < 5.0:
            should_write = False
    if should_write:
        await db.camper_positions.update_one(
            {"camper_id": user["id"]},
            {"$set": {
                "camper_id": user["id"],
                "group_code": user.get("group_name", ""),
                "first_name": user.get("first_name", ""),
                "last_name": user.get("last_name", ""),
                "latitude": float(req.latitude),
                "longitude": float(req.longitude),
                "accuracy": float(req.accuracy) if req.accuracy is not None else None,
                "updated_at": now.isoformat(),
            }},
            upsert=True,
        )
        # Accumulate walked meters for today (cap per-step to 200m to filter GPS jumps)
        if prev and 0 < dist_m < 200:
            ymd = now.strftime("%Y-%m-%d")
            await db.camper_distance_daily.update_one(
                {"camper_id": user["id"], "date_ymd": ymd},
                {
                    "$inc": {"meters": float(dist_m)},
                    "$setOnInsert": {
                        "camper_id": user["id"],
                        "group_code": user.get("group_name", ""),
                        "first_name": user.get("first_name", ""),
                        "last_name": user.get("last_name", ""),
                        "date_ymd": ymd,
                    },
                    "$set": {"updated_at": now.isoformat()},
                },
                upsert=True,
            )
    return {"saved": should_write, "step_meters": round(dist_m, 2)}


@api.get("/admin/camper-positions")
async def admin_camper_positions(admin=Depends(get_current_admin), max_age_min: int = 30):
    cutoff = now_utc() - timedelta(minutes=max_age_min)
    out = []
    async for p in db.camper_positions.find({}, {"_id": 0}):
        try:
            ts = datetime.fromisoformat(p.get("updated_at"))
            if ts < cutoff:
                continue
        except Exception:
            continue
        out.append({
            "camper_id": p["camper_id"],
            "first_name": p.get("first_name", ""),
            "last_name": p.get("last_name", ""),
            "group_code": p.get("group_code", ""),
            "latitude": float(p["latitude"]),
            "longitude": float(p["longitude"]),
            "accuracy": p.get("accuracy"),
            "updated_at": p["updated_at"],
        })
    return {"count": len(out), "positions": out}


# ----------------------
# ADMIN - TEST POKEMON SEED (Nano Banana image generation)
# ----------------------
TEST_POKEMON_SEED = [
    {"name": "Otterpaw", "rarity": "common", "power_level": 120, "description": "Playful river otter who juggles stones.", "prompt": "A cute cartoon Pokemon creature: a friendly baby river otter with big sparkling eyes, sleek brown fur, a cream belly, holding a tiny smooth pebble, centered, full-body, transparent background, bold outline, flat vibrant colors, kawaii camp mascot style"},
    {"name": "Pinesprout", "rarity": "common", "power_level": 110, "description": "A tiny pinecone sprite bouncing through the forest.", "prompt": "A cute cartoon Pokemon creature: a plump pinecone with round cheeks, tiny stubby legs, green pine-needle tuft on top, bright innocent eyes, centered, full-body, transparent background, flat vibrant colors, kawaii forest spirit style"},
    {"name": "Sunnybug", "rarity": "common", "power_level": 130, "description": "A ladybug that glows in the noon sun.", "prompt": "A cute cartoon Pokemon creature: a round smiling ladybug with golden sun-ray wings, red shell with yellow dots, big friendly eyes, centered, full-body, transparent background, flat vibrant colors, kawaii summer camp style"},
    {"name": "Splashling", "rarity": "uncommon", "power_level": 260, "description": "A living water droplet from the camp pool.", "prompt": "A cute cartoon Pokemon creature: an anthropomorphic water droplet with rosy cheeks and a curled wave on top, translucent aqua blue, big friendly eyes, tiny water-fin arms, centered, full-body, transparent background, flat vibrant colors"},
    {"name": "Mossmouse", "rarity": "uncommon", "power_level": 280, "description": "A mouse wearing a moss cloak.", "prompt": "A cute cartoon Pokemon creature: a tiny field mouse wrapped in a bright green moss cape with tiny mushrooms, acorn cap hat, playful curious expression, centered, full-body, transparent background, flat vibrant colors, kawaii woodland creature"},
    {"name": "Campfly", "rarity": "uncommon", "power_level": 300, "description": "A firefly with a lantern tail.", "prompt": "A cute cartoon Pokemon creature: a big round firefly with a glowing amber lantern abdomen, translucent wings, friendly round eyes, centered, full-body, transparent background, flat vibrant colors, kawaii night camp style"},
    {"name": "Ember Ash", "rarity": "rare", "power_level": 480, "description": "A friendly campfire ember that hops around.", "prompt": "A cute cartoon Pokemon creature: a small living campfire flame with a warm orange-yellow body, cheerful face, tiny twig arms, crackling sparks around it, centered, full-body, transparent background, flat vibrant colors, kawaii fire elemental"},
    {"name": "Canoebeak", "rarity": "rare", "power_level": 520, "description": "A bird whose beak is a wooden canoe.", "prompt": "A cute cartoon Pokemon creature: a plump waterbird with a wooden canoe-shaped beak, blue-gray feathers, paddle-shaped wings, friendly eyes, centered, full-body, transparent background, flat vibrant colors, kawaii lake creature"},
    {"name": "Sky Glider", "rarity": "rare", "power_level": 560, "description": "A flying squirrel with kite ears.", "prompt": "A cute cartoon Pokemon creature: a cheerful flying squirrel with oversized triangular kite-like ears, fluffy tail trailing, warm amber fur, big sparkling eyes, mid-glide pose, centered, full-body, transparent background, flat vibrant colors"},
    {"name": "Totem Tusk", "rarity": "legendary", "power_level": 820, "description": "Guardian of the camp trails — rare sighting.", "prompt": "A legendary cartoon Pokemon creature: a majestic forest deer with glowing turquoise antlers that resemble tree branches, pale ivory fur with subtle tribal markings, soft aura of floating leaves, centered, full-body, transparent background, vibrant colors, epic mythical creature style"},
    {"name": "Rainbow Koi", "rarity": "legendary", "power_level": 880, "description": "A rainbow koi blessing the lake — super rare.", "prompt": "A legendary cartoon Pokemon creature: a magnificent koi fish with a rainbow shimmering scale pattern, flowing silk-like fins, water droplet aura around it, centered, full-body, transparent background, vibrant holographic colors, majestic style"},
    {"name": "Starfire Owl", "rarity": "legendary", "power_level": 920, "description": "A golden owl that only appears at dusk.", "prompt": "A legendary cartoon Pokemon creature: a regal horned owl with golden star-dust feathers, crescent moon chest mark, warm glowing eyes, soft radiant aura, perched pose, centered, full-body, transparent background, vibrant mythical colors"},
]


async def _generate_pokemon_image(prompt: str) -> Optional[str]:
    """Generate a PNG image via Gemini Nano Banana, strip white background,
    and return a transparent data: URL (or None on failure)."""
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception as e:
        logger.error(f"emergentintegrations import failed: {e}")
        return None
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        logger.error("EMERGENT_LLM_KEY missing")
        return None
    chat = (LlmChat(api_key=api_key, session_id=f"pokemon-{uuid.uuid4()}", system_message="You generate cute cartoon Pokemon-style creature images on a solid pure-white background (never a checker/transparency-indicator pattern). The white background will be keyed out to transparency, so the creature must have strong saturated colors that clearly differ from white.")
            .with_model("gemini", "gemini-3.1-flash-image-preview")
            .with_params(modalities=["image", "text"]))
    try:
        _, images = await chat.send_message_multimodal_response(UserMessage(text=prompt))
    except Exception as e:
        logger.error(f"Image generation failed: {e}")
        return None
    if not images:
        return None
    img = images[0]
    b64 = img.get("data") or ""
    if not b64:
        return None
    try:
        raw = base64.b64decode(b64)
        transparent = _remove_white_background(raw)
        return f"data:image/png;base64,{base64.b64encode(transparent).decode()}"
    except Exception as e:
        logger.error(f"Background removal failed, returning raw image: {e}")
        mime = img.get("mime_type") or "image/png"
        return f"data:{mime};base64,{b64}"


def _remove_white_background(png_bytes: bytes, _threshold_unused: int = 0) -> bytes:
    """Strip ALL background colors (including baked-in checker patterns that
    represent "transparency" in generated images) from a PNG.

    Strategy:
      1. Detect up to 4 dominant edge colors from a wide border strip.
      2. If they're all low-saturation (grays/whites → classic checker), treat
         each as a background color and remove pixels matching ANY of them
         across the whole image (not just flood-fill from edges).
      3. Protect colorful (high-saturation) pixels so we never eat the
         Pokemon's actual body.
      4. Feather edges with a soft ramp for a clean alpha cut.
    """
    import numpy as np
    from collections import Counter

    img = Image.open(BytesIO(png_bytes)).convert("RGBA")
    w, h = img.size
    arr = np.array(img)
    rgb = arr[..., :3].astype(np.int16)
    existing_alpha = arr[..., 3].astype(np.int16)

    # --- 1. Sample a wide border to find background colors ---
    border_w = max(6, min(w, h) // 20)
    border_pixels = np.concatenate([
        rgb[:border_w, :, :].reshape(-1, 3),
        rgb[-border_w:, :, :].reshape(-1, 3),
        rgb[:, :border_w, :].reshape(-1, 3),
        rgb[:, -border_w:, :].reshape(-1, 3),
    ])
    # Quantize to 16-step grid for clustering
    quant = (border_pixels // 16) * 16
    ctr = Counter(map(tuple, map(tuple, quant.tolist())))
    top = [tuple(int(v) for v in c) for c, _n in ctr.most_common(6)]

    def is_desaturated(c, thresh=28):
        return max(c) - min(c) <= thresh

    desat_top = [c for c in top if is_desaturated(c)]
    if len(desat_top) >= 2:
        # Likely a checker pattern (2+ gray tones dominate the border)
        bg_colors = desat_top[:4]
    elif desat_top:
        bg_colors = desat_top[:2]
    else:
        # Fall back to the single most-common edge color (solid bg)
        bg_colors = [top[0]] if top else [(255, 255, 255)]

    # --- 2. Build alpha mask across the WHOLE image ---
    HARD = 28   # fully transparent within this color distance
    SOFT = 56   # feather up to this distance

    mask_alpha = np.full((h, w), 255, dtype=np.float32)
    rgbf = rgb.astype(np.float32)
    for bc in bg_colors:
        dr = rgbf[..., 0] - bc[0]
        dg = rgbf[..., 1] - bc[1]
        db = rgbf[..., 2] - bc[2]
        d = np.sqrt(dr * dr + dg * dg + db * db)
        # 0 if d<=HARD, ramp to 255 between HARD..SOFT, else 255
        this_alpha = np.where(
            d <= HARD,
            0.0,
            np.where(
                d <= SOFT,
                (d - HARD) / max(1.0, (SOFT - HARD)) * 255.0,
                255.0,
            ),
        )
        # Take the min — most aggressive per pixel wins (pixel is bg if ANY bg color matches)
        mask_alpha = np.minimum(mask_alpha, this_alpha)

    # --- 3. Protect colorful foreground (saturated) pixels ---
    max_ch = rgb.max(axis=-1)
    min_ch = rgb.min(axis=-1)
    saturation = (max_ch - min_ch).astype(np.int16)
    COLORFUL = 40  # Chroma difference above which a pixel is "clearly colored"
    colorful_mask = saturation >= COLORFUL
    mask_alpha = np.where(colorful_mask, 255.0, mask_alpha)

    # --- 4. Combine with existing alpha (respect any real transparency already present) ---
    final_alpha = np.minimum(existing_alpha, mask_alpha.astype(np.int16))
    final_alpha = np.clip(final_alpha, 0, 255).astype(np.uint8)

    arr[..., 3] = final_alpha
    out_img = Image.fromarray(arr, mode="RGBA")
    out = BytesIO()
    out_img.save(out, format="PNG", optimize=True)
    return out.getvalue()


@api.post("/admin/seed-test-pokemon")
async def admin_seed_test_pokemon(admin=Depends(get_current_admin)):
    """Generate 12 cartoon Pokemon images using Nano Banana and save into existing empty slots as active."""
    # Find the first 12 empty slots (no image yet) sorted by slot_number
    empty_slots = []
    async for p in db.pokemon.find({"image_data_url": ""}, {"_id": 0}).sort("slot_number", 1).limit(len(TEST_POKEMON_SEED)):
        empty_slots.append(p)
    if len(empty_slots) < len(TEST_POKEMON_SEED):
        # Fall back to just the available ones
        logger.info(f"Only {len(empty_slots)} empty slots available; using those.")

    async def seed_one(slot: dict, seed: dict):
        data_url = await _generate_pokemon_image(seed["prompt"])
        if not data_url:
            return {"slot": slot["slot_number"], "ok": False, "error": "image generation failed"}
        await db.pokemon.update_one(
            {"id": slot["id"]},
            {"$set": {
                "name": seed["name"],
                "rarity": seed["rarity"],
                "power_level": int(seed["power_level"]),
                "description": seed["description"],
                "image_data_url": data_url,
                "active": True,
                "is_seed": True,
                "featured": False,
            }},
        )
        return {"slot": slot["slot_number"], "ok": True, "name": seed["name"]}

    # Run in parallel with a concurrency cap
    sem = asyncio.Semaphore(3)
    async def bounded(slot, seed):
        async with sem:
            return await seed_one(slot, seed)

    tasks = [bounded(slot, seed) for slot, seed in zip(empty_slots, TEST_POKEMON_SEED)]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    cleaned = []
    for r in results:
        if isinstance(r, Exception):
            cleaned.append({"ok": False, "error": str(r)})
        else:
            cleaned.append(r)
    success_count = sum(1 for r in cleaned if isinstance(r, dict) and r.get("ok"))
    return {
        "seeded": success_count,
        "attempted": len(tasks),
        "results": cleaned,
    }


# ----------------------
# BALL WALLET ECONOMY
# ----------------------
STARTING_BALLS = 200
DAILY_BONUS = 25
PIN_BONUS = 5
PIN_PROXIMITY_METERS = 15  # server-side validation radius
CATCH_REWARD = {"common": 1, "uncommon": 2, "rare": 5, "legendary": 15}

# Ball types — kids unlock the fancier ones by catching pokemon of that rarity.
# - pokeball: standard, 1.0x catch rate.
# - rayball: earned every N uncommons, 1.4x catch rate.
# - myrtleball: earned every N rares, 1.8x catch rate.
# - lunchball: earned 1-for-1 per legendary caught, 2.5x catch rate.
BALL_TYPES = ["pokeball", "rayball", "myrtleball", "lunchball"]
BALL_CATCH_MULT = {
    "pokeball":   1.0,
    "rayball":    1.4,
    "myrtleball": 1.8,
    "lunchball":  2.5,
}
# Catch this many of the rarity to earn one of the fancier ball.
BALL_EARN_THRESHOLDS = {
    "rayball":    {"rarity": "uncommon",  "catches_per_ball": 5},
    "myrtleball": {"rarity": "rare",      "catches_per_ball": 3},
    "lunchball":  {"rarity": "legendary", "catches_per_ball": 1},
}


def empty_balances() -> dict:
    return {b: 0 for b in BALL_TYPES}


async def get_or_init_wallet(camper_id: str) -> dict:
    w = await db.camper_wallets.find_one({"camper_id": camper_id}, {"_id": 0})
    now = now_utc().isoformat()
    if w:
        # Migration: ensure balances dict exists and back-compat balance maps
        # to pokeball. Do an in-place upgrade once per wallet.
        balances = w.get("balances")
        legacy = int(w.get("balance", 0))
        if not isinstance(balances, dict):
            balances = empty_balances()
            balances["pokeball"] = legacy
            await db.camper_wallets.update_one(
                {"camper_id": camper_id},
                {"$set": {"balances": balances, "updated_at": now}},
            )
        else:
            # Make sure all keys are present
            changed = False
            for b in BALL_TYPES:
                if b not in balances:
                    balances[b] = 0
                    changed = True
            if changed:
                await db.camper_wallets.update_one(
                    {"camper_id": camper_id},
                    {"$set": {"balances": balances, "updated_at": now}},
                )
        w["balances"] = balances
        # Keep legacy single field reflecting pokeball count.
        w["balance"] = int(balances.get("pokeball", 0))
        return w
    balances = empty_balances()
    balances["pokeball"] = STARTING_BALLS
    w = {
        "camper_id": camper_id,
        "balance": STARTING_BALLS,  # legacy mirror of pokeball
        "balances": balances,
        "starting_granted": True,
        "updated_at": now,
        "created_at": now,
    }
    await db.camper_wallets.insert_one(w)
    await db.ball_ledger.insert_one({
        "id": str(uuid.uuid4()),
        "camper_id": camper_id,
        "ball_type": "pokeball",
        "delta": STARTING_BALLS,
        "reason": "starter",
        "meta": {},
        "balance_after": STARTING_BALLS,
        "created_at": now,
    })
    return w


async def adjust_ball(camper_id: str, ball_type: str, delta: int, reason: str, meta: dict = None) -> dict:
    """Atomically update one ball-type balance and record ledger entry."""
    if ball_type not in BALL_TYPES:
        raise HTTPException(400, f"Unknown ball type: {ball_type}")
    wallet = await get_or_init_wallet(camper_id)
    balances = dict(wallet["balances"])
    new_count = max(0, int(balances.get(ball_type, 0)) + int(delta))
    balances[ball_type] = new_count
    now = now_utc().isoformat()
    update_doc = {"balances": balances, "updated_at": now}
    if ball_type == "pokeball":
        # Legacy mirror so any older code reading wallet["balance"] still works.
        update_doc["balance"] = new_count
    await db.camper_wallets.update_one(
        {"camper_id": camper_id},
        {"$set": update_doc},
    )
    await db.ball_ledger.insert_one({
        "id": str(uuid.uuid4()),
        "camper_id": camper_id,
        "ball_type": ball_type,
        "delta": int(delta),
        "reason": reason,
        "meta": meta or {},
        "balance_after": new_count,
        "created_at": now,
    })
    wallet["balances"] = balances
    if ball_type == "pokeball":
        wallet["balance"] = new_count
    return wallet


async def adjust_balls(camper_id: str, delta: int, reason: str, meta: dict = None) -> dict:
    """Back-compat: legacy 'balls' adjustment maps to the pokeball pool."""
    return await adjust_ball(camper_id, "pokeball", delta, reason, meta)


async def last_ledger_by_reason(camper_id: str, reason: str, since: Optional[datetime] = None) -> Optional[dict]:
    q = {"camper_id": camper_id, "reason": reason}
    if since:
        q["created_at"] = {"$gte": since.isoformat()}
    doc = await db.ball_ledger.find_one(q, {"_id": 0}, sort=[("created_at", -1)])
    return doc


class WalletOut(BaseModel):
    balance: int  # legacy = pokeball count
    balances: dict = Field(default_factory=empty_balances)
    starting_balance: int = STARTING_BALLS
    daily_bonus: int = DAILY_BONUS
    pin_bonus: int = PIN_BONUS
    catch_reward: dict = CATCH_REWARD
    can_claim_daily: bool = True
    next_daily_at: Optional[datetime] = None
    ball_catch_mult: dict = Field(default_factory=lambda: BALL_CATCH_MULT.copy())
    ball_earn_thresholds: dict = Field(default_factory=lambda: BALL_EARN_THRESHOLDS.copy())
    earn_progress: dict = Field(default_factory=dict)


@api.get("/wallet", response_model=WalletOut)
async def get_wallet(user=Depends(get_current_user)):
    w = await get_or_init_wallet(user["id"])
    since = now_utc() - timedelta(hours=24)
    last_daily = await last_ledger_by_reason(user["id"], "daily_bonus", since=since)
    can = last_daily is None
    next_at = None
    if last_daily:
        last_at = datetime.fromisoformat(last_daily["created_at"])
        next_at = last_at + timedelta(hours=24)
    # Compute progress towards next earned ball — count catches per rarity
    # since the last fancy-ball reward of that type (or all-time if never).
    progress = {}
    for ball, rule in BALL_EARN_THRESHOLDS.items():
        rarity = rule["rarity"]
        per = int(rule["catches_per_ball"])
        last_award = await db.ball_ledger.find_one(
            {"camper_id": user["id"], "ball_type": ball, "reason": f"{rarity}_milestone"},
            {"_id": 0},
            sort=[("created_at", -1)],
        )
        cutoff = last_award["created_at"] if last_award else None
        q = {"group_id": user["id"], "rarity": rarity}
        if cutoff:
            q["caught_at"] = {"$gt": cutoff}
        catches_since = await db.catches.count_documents(q)
        progress[ball] = {"have": catches_since % per, "need": per, "rarity": rarity}
    return WalletOut(
        balance=int(w.get("balance", w.get("balances", {}).get("pokeball", 0))),
        balances=w.get("balances") or empty_balances(),
        can_claim_daily=can,
        next_daily_at=next_at,
        earn_progress=progress,
    )


@api.post("/wallet/claim-daily")
async def claim_daily(user=Depends(get_current_user)):
    since = now_utc() - timedelta(hours=24)
    last = await last_ledger_by_reason(user["id"], "daily_bonus", since=since)
    if last:
        last_at = datetime.fromisoformat(last["created_at"])
        remaining = (last_at + timedelta(hours=24)) - now_utc()
        hrs = max(0, int(remaining.total_seconds() // 3600))
        raise HTTPException(429, f"Daily already claimed. Come back in ~{hrs} hours.")
    wallet = await adjust_balls(user["id"], DAILY_BONUS, "daily_bonus")
    return {"granted": DAILY_BONUS, "balance": wallet["balance"]}


@api.post("/wallet/claim-pin/{pin_id}")
async def claim_pin(pin_id: str, user=Depends(get_current_user)):
    pin = await db.map_pins.find_one({"id": pin_id, "active": True}, {"_id": 0})
    if not pin:
        raise HTTPException(404, "Pin not found or inactive")
    # Rate limit: once per pin per 24h per camper
    since = now_utc() - timedelta(hours=24)
    last = await db.ball_ledger.find_one({
        "camper_id": user["id"],
        "reason": "pin_bonus",
        "meta.pin_id": pin_id,
        "created_at": {"$gte": since.isoformat()},
    }, {"_id": 0})
    if last:
        raise HTTPException(429, "Already claimed this pin today")
    # Validate camper is actually near the pin
    pos = await db.camper_positions.find_one({"camper_id": user["id"]}, {"_id": 0})
    if not pos:
        raise HTTPException(400, "Your location hasn't been shared yet.")
    dlat = (float(pos["latitude"]) - float(pin["latitude"])) * 111_111.0
    dlng = (float(pos["longitude"]) - float(pin["longitude"])) * 111_111.0 * math.cos(math.radians(float(pos["latitude"])))
    dist_m = (dlat * dlat + dlng * dlng) ** 0.5
    if dist_m > PIN_PROXIMITY_METERS:
        raise HTTPException(400, f"Walk closer to '{pin.get('name','the pin')}' — you're ~{int(dist_m)} m away.")
    wallet = await adjust_balls(user["id"], PIN_BONUS, "pin_bonus", {"pin_id": pin_id, "pin_name": pin.get("name")})
    return {"granted": PIN_BONUS, "balance": wallet["balance"], "pin_name": pin.get("name")}


@api.get("/wallet/ledger")
async def wallet_ledger(user=Depends(get_current_user), limit: int = 25):
    out = []
    async for e in db.ball_ledger.find({"camper_id": user["id"]}, {"_id": 0}).sort("created_at", -1).limit(limit):
        out.append(e)
    return out


# --------- Admin wallet endpoints ---------
class GrantReq(BaseModel):
    amount: int
    reason: Optional[str] = "counselor_award"


@api.post("/admin/wallet/{camper_id}/grant")
async def admin_grant_balls(camper_id: str, req: GrantReq, admin=Depends(get_current_admin)):
    camper = await db.campers.find_one({"id": camper_id}, {"_id": 0})
    if not camper:
        raise HTTPException(404, "Camper not found")
    if req.amount == 0:
        raise HTTPException(400, "Amount must be non-zero")
    if abs(req.amount) > 1000:
        raise HTTPException(400, "Amount out of range")
    wallet = await adjust_balls(camper_id, int(req.amount), req.reason or "counselor_award", {"admin": admin.get("username", "admin")})
    return {"balance": wallet["balance"], "granted": req.amount, "camper": f"{camper.get('first_name','')} {camper.get('last_name','')}".strip()}


@api.get("/admin/wallet/balances")
async def admin_list_balances(admin=Depends(get_current_admin)):
    balances = {}
    async for w in db.camper_wallets.find({}, {"_id": 0}):
        balances[w["camper_id"]] = int(w.get("balance", 0))
    # Merge with campers list so admin sees campers with no wallet yet
    out = []
    async for c in db.campers.find({}, {"_id": 0}).sort([("group_code", 1), ("last_name", 1)]):
        out.append({
            "camper_id": c["id"],
            "first_name": c.get("first_name", ""),
            "last_name": c.get("last_name", ""),
            "group_code": c.get("group_code", ""),
            "balance": int(balances.get(c["id"], STARTING_BALLS)),
            "has_wallet": c["id"] in balances,
        })
    return out


@api.get("/admin/wallet/ledger")
async def admin_ledger(admin=Depends(get_current_admin), limit: int = 100):
    out = []
    async for e in db.ball_ledger.find({}, {"_id": 0}).sort("created_at", -1).limit(limit):
        out.append(e)
    return out


_fix_bg_job_state = {"status": "idle", "updated": 0, "failed": 0, "total": 0, "started_at": None, "finished_at": None}


async def _run_fix_backgrounds_job():
    """Background worker that reprocesses all pokemon images."""
    global _fix_bg_job_state
    _fix_bg_job_state.update({"status": "running", "updated": 0, "failed": 0, "total": 0, "started_at": now_utc().isoformat(), "finished_at": None})
    try:
        total = await db.pokemon.count_documents({"image_data_url": {"$regex": "^data:image"}})
        _fix_bg_job_state["total"] = total
        async for p in db.pokemon.find({"image_data_url": {"$regex": "^data:image"}}, {"_id": 0}):
            try:
                url = p.get("image_data_url", "")
                if ";base64," not in url:
                    continue
                raw = base64.b64decode(url.split(";base64,", 1)[1])
                out = _remove_white_background(raw)
                new_url = f"data:image/png;base64,{base64.b64encode(out).decode()}"
                await db.pokemon.update_one({"id": p["id"]}, {"$set": {"image_data_url": new_url}})
                _fix_bg_job_state["updated"] += 1
            except Exception as e:
                logger.error(f"bg fix failed for {p.get('name')}: {e}")
                _fix_bg_job_state["failed"] += 1
    finally:
        _fix_bg_job_state["status"] = "done"
        _fix_bg_job_state["finished_at"] = now_utc().isoformat()


@api.post("/admin/pokemon/fix-backgrounds")
async def admin_fix_pokemon_backgrounds(admin=Depends(get_current_admin)):
    """Kick off a background re-process of all pokemon images.

    Returns immediately with 202. Poll GET /api/admin/pokemon/fix-backgrounds/status
    to check progress. Running it again while in-progress is a no-op.
    """
    if _fix_bg_job_state.get("status") == "running":
        return {"status": "already_running", **_fix_bg_job_state}
    asyncio.create_task(_run_fix_backgrounds_job())
    return {"status": "started"}


@api.get("/admin/pokemon/fix-backgrounds/status")
async def admin_fix_backgrounds_status(admin=Depends(get_current_admin)):
    return _fix_bg_job_state


# ----------------------
# CHALLENGES (Daily / Weekly / Monthly / Expert)
# Templates per period, picked deterministically from sha1(camper_id|key).
# Daily key = YYYY-MM-DD, Weekly = ISO YYYY-WW, Monthly = YYYY-MM. Expert is a
# fixed sequence — kid sees ONE expert challenge at a time and only advances
# once they claim it.
# ----------------------
CHALLENGE_TEMPLATES = [
    # DAILY (15)
    {"id": "d_catch_3",        "label": "Catch any 3 Pokemon today",       "target": 3,  "reward": 10, "tier": "easy",   "kind": "catch_total",     "period": "daily"},
    {"id": "d_catch_5",        "label": "Catch any 5 Pokemon today",       "target": 5,  "reward": 20, "tier": "medium", "kind": "catch_total",     "period": "daily"},
    {"id": "d_catch_8",        "label": "Catch 8 Pokemon today",           "target": 8,  "reward": 40, "tier": "hard",   "kind": "catch_total",     "period": "daily"},
    {"id": "d_uncommon",       "label": "Catch an uncommon Pokemon",       "target": 1,  "reward": 8,  "tier": "easy",   "kind": "catch_rarity",    "rarity": "uncommon",  "period": "daily"},
    {"id": "d_rare",           "label": "Catch a rare Pokemon",            "target": 1,  "reward": 15, "tier": "medium", "kind": "catch_rarity",    "rarity": "rare",      "period": "daily"},
    {"id": "d_legendary",      "label": "Catch a LEGENDARY",               "target": 1,  "reward": 50, "tier": "hard",   "kind": "catch_rarity",    "rarity": "legendary", "period": "daily"},
    {"id": "d_supervisor",     "label": "Catch a featured supervisor",     "target": 1,  "reward": 12, "tier": "medium", "kind": "catch_featured",  "period": "daily"},
    {"id": "d_throw_10",       "label": "Throw 10 Rolling River Balls",    "target": 10, "reward": 6,  "tier": "easy",   "kind": "throw_count",     "period": "daily"},
    {"id": "d_throw_20",       "label": "Throw 20 balls today",            "target": 20, "reward": 15, "tier": "medium", "kind": "throw_count",     "period": "daily"},
    {"id": "d_use_fancy",      "label": "Catch one with a fancy ball",     "target": 1,  "reward": 12, "tier": "medium", "kind": "use_fancy_ball",  "period": "daily"},
    {"id": "d_walk_500",       "label": "Walk 500m around camp",           "target": 500, "reward": 8, "tier": "easy",   "kind": "walk_meters",     "period": "daily"},
    {"id": "d_walk_1500",      "label": "Walk 1500m today",                "target": 1500,"reward": 25,"tier": "hard",   "kind": "walk_meters",     "period": "daily"},
    {"id": "d_pin",            "label": "Find and claim a camp pin",       "target": 1,  "reward": 5,  "tier": "easy",   "kind": "pin_claim",       "period": "daily"},
    {"id": "d_two_types",      "label": "Catch 2 different types today",   "target": 2,  "reward": 12, "tier": "medium", "kind": "distinct_types",  "period": "daily"},
    {"id": "d_three_types",    "label": "Catch 3 different types today",   "target": 3,  "reward": 25, "tier": "hard",   "kind": "distinct_types",  "period": "daily"},

    # WEEKLY (10)
    {"id": "w_catch_20",       "label": "Catch 20 Pokemon this week",      "target": 20, "reward": 30,  "tier": "easy",   "kind": "catch_total",     "period": "weekly"},
    {"id": "w_catch_40",       "label": "Catch 40 Pokemon this week",      "target": 40, "reward": 80,  "tier": "medium", "kind": "catch_total",     "period": "weekly"},
    {"id": "w_catch_60",       "label": "Catch 60 Pokemon this week",      "target": 60, "reward": 140, "tier": "hard",   "kind": "catch_total",     "period": "weekly"},
    {"id": "w_5_rares",        "label": "Catch 5 rare Pokemon this week",  "target": 5,  "reward": 75,  "tier": "medium", "kind": "catch_rarity",    "rarity": "rare",      "period": "weekly"},
    {"id": "w_2_legendary",    "label": "Catch 2 legendaries this week",   "target": 2,  "reward": 120, "tier": "hard",   "kind": "catch_rarity",    "rarity": "legendary", "period": "weekly"},
    {"id": "w_walk_5km",       "label": "Walk 5 km this week",             "target": 5000,"reward": 40, "tier": "easy",   "kind": "walk_meters",     "period": "weekly"},
    {"id": "w_walk_10km",      "label": "Walk 10 km this week",            "target": 10000,"reward": 90,"tier": "medium", "kind": "walk_meters",     "period": "weekly"},
    {"id": "w_5_types",        "label": "Catch 5 different types this week","target": 5, "reward": 60,  "tier": "medium", "kind": "distinct_types",  "period": "weekly"},
    {"id": "w_10_supervisors", "label": "Catch 10 supervisors this week",  "target": 10, "reward": 100, "tier": "hard",   "kind": "catch_featured",  "period": "weekly"},
    {"id": "w_fancy_10",       "label": "Use 10 fancy balls this week",    "target": 10, "reward": 80,  "tier": "medium", "kind": "use_fancy_ball",  "period": "weekly"},

    # MONTHLY (8)
    {"id": "m_catch_100",      "label": "Catch 100 Pokemon this month",    "target": 100,  "reward": 100, "tier": "easy",   "kind": "catch_total",    "period": "monthly"},
    {"id": "m_catch_200",      "label": "Catch 200 Pokemon this month",    "target": 200,  "reward": 250, "tier": "medium", "kind": "catch_total",    "period": "monthly"},
    {"id": "m_5_legendaries",  "label": "Catch 5 legendaries this month",  "target": 5,    "reward": 400, "tier": "hard",   "kind": "catch_rarity",   "rarity": "legendary", "period": "monthly"},
    {"id": "m_25_distinct",    "label": "Catch 25 different Pokemon",      "target": 25,   "reward": 300, "tier": "hard",   "kind": "distinct_pokemon","period": "monthly"},
    {"id": "m_walk_30km",      "label": "Walk 30 km this month",           "target": 30000,"reward": 250, "tier": "medium", "kind": "walk_meters",    "period": "monthly"},
    {"id": "m_50_supervisors", "label": "Catch 50 supervisors this month", "target": 50,   "reward": 400, "tier": "hard",   "kind": "catch_featured", "period": "monthly"},
    {"id": "m_8_types",        "label": "Catch 8 different types",         "target": 8,    "reward": 200, "tier": "medium", "kind": "distinct_types", "period": "monthly"},
    {"id": "m_fancy_25",       "label": "Use 25 fancy balls this month",   "target": 25,   "reward": 200, "tier": "medium", "kind": "use_fancy_ball", "period": "monthly"},

    # EXPERT (12) — sequential. Kid sees ONE at a time, advancing on claim.
    {"id": "e_first",          "label": "Catch your very first Pokemon",   "target": 1,    "reward": 5,   "tier": "easy",   "kind": "catch_total",     "period": "expert"},
    {"id": "e_50",             "label": "Catch 50 Pokemon (lifetime)",     "target": 50,   "reward": 50,  "tier": "easy",   "kind": "catch_total",     "period": "expert"},
    {"id": "e_first_rare",     "label": "Catch your first rare",           "target": 1,    "reward": 20,  "tier": "easy",   "kind": "catch_rarity",    "rarity": "rare",      "period": "expert"},
    {"id": "e_first_leg",      "label": "Catch your first LEGENDARY",      "target": 1,    "reward": 100, "tier": "medium", "kind": "catch_rarity",    "rarity": "legendary", "period": "expert"},
    {"id": "e_200",            "label": "Catch 200 Pokemon (lifetime)",    "target": 200,  "reward": 150, "tier": "medium", "kind": "catch_total",     "period": "expert"},
    {"id": "e_5_types",        "label": "Catch 5 different types ever",    "target": 5,    "reward": 100, "tier": "medium", "kind": "distinct_types",  "period": "expert"},
    {"id": "e_500",            "label": "Catch 500 Pokemon (lifetime)",    "target": 500,  "reward": 300, "tier": "hard",   "kind": "catch_total",     "period": "expert"},
    {"id": "e_10_types",       "label": "Catch 10 different types ever",   "target": 10,   "reward": 250, "tier": "hard",   "kind": "distinct_types",  "period": "expert"},
    {"id": "e_5_legendaries",  "label": "Catch 5 legendaries (lifetime)",  "target": 5,    "reward": 400, "tier": "hard",   "kind": "catch_rarity",    "rarity": "legendary", "period": "expert"},
    {"id": "e_walk_50km",      "label": "Walk 50 km cumulative",           "target": 50000,"reward": 400, "tier": "hard",   "kind": "walk_meters",     "period": "expert"},
    {"id": "e_1000",           "label": "Catch 1,000 Pokemon (lifetime)",  "target": 1000, "reward": 600, "tier": "hard",   "kind": "catch_total",     "period": "expert"},
    {"id": "e_25_legendaries", "label": "Catch 25 legendaries (lifetime)", "target": 25,   "reward": 1500,"tier": "hard",   "kind": "catch_rarity",    "rarity": "legendary", "period": "expert"},
]

EXPERT_SEQUENCE = [c["id"] for c in CHALLENGE_TEMPLATES if c["period"] == "expert"]
TEMPLATES_BY_ID = {c["id"]: c for c in CHALLENGE_TEMPLATES}


def _today_ymd() -> str:
    return now_utc().astimezone().date().isoformat()


def _today_start_iso() -> str:
    """Start of the local day, returned as an ISO string for direct compare
    against caught_at strings stored in the catches collection."""
    local = now_utc().astimezone()
    start = local.replace(hour=0, minute=0, second=0, microsecond=0)
    return start.astimezone(timezone.utc).isoformat()


def _week_key() -> str:
    iso = now_utc().astimezone().isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"


def _week_start_iso() -> str:
    """Start of the current ISO week (Monday 00:00 local) as UTC ISO string."""
    local = now_utc().astimezone()
    monday = (local - timedelta(days=local.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    return monday.astimezone(timezone.utc).isoformat()


def _month_key() -> str:
    return now_utc().astimezone().strftime("%Y-%m")


def _month_start_iso() -> str:
    local = now_utc().astimezone()
    first = local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return first.astimezone(timezone.utc).isoformat()


def _period_cutoff_iso(period: str) -> Optional[str]:
    if period == "daily":
        return _today_start_iso()
    if period == "weekly":
        return _week_start_iso()
    if period == "monthly":
        return _month_start_iso()
    if period == "expert":
        return None  # lifetime
    return None


def _period_key(period: str) -> str:
    return {
        "daily":   _today_ymd(),
        "weekly":  _week_key(),
        "monthly": _month_key(),
        "expert":  "all-time",
    }.get(period, "")


def _seeded_rng(camper_id: str, period: str) -> random.Random:
    """Deterministic RNG for picking which templates appear in this period."""
    key = f"{camper_id}|{period}|{_period_key(period)}"
    seed_bytes = hashlib.sha1(key.encode()).digest()
    return random.Random(int.from_bytes(seed_bytes[:8], "big"))


def _pick_period_challenges(camper_id: str, period: str, count_by_tier: dict) -> List[dict]:
    """Pick `count_by_tier[tier]` distinct challenges per tier deterministically."""
    rng = _seeded_rng(camper_id, period)
    pool_by_tier = {"easy": [], "medium": [], "hard": []}
    for c in CHALLENGE_TEMPLATES:
        if c.get("period") == period:
            pool_by_tier[c["tier"]].append(c)
    picks = []
    for tier, n in count_by_tier.items():
        pool = pool_by_tier.get(tier, [])[:]
        rng.shuffle(pool)
        picks.extend(pool[:n])
    return picks


async def _expert_index(camper_id: str) -> int:
    """How many expert challenges this camper has already claimed."""
    return await db.ball_ledger.count_documents({
        "camper_id": camper_id,
        "reason": "challenge_complete",
        "meta.period": "expert",
    })


async def _picks_for_period(camper_id: str, period: str) -> List[dict]:
    if period == "daily":
        return _pick_period_challenges(camper_id, "daily", {"easy": 2, "medium": 2, "hard": 2})
    if period == "weekly":
        return _pick_period_challenges(camper_id, "weekly", {"easy": 2, "medium": 2, "hard": 2})
    if period == "monthly":
        # Monthly pool has fewer easy templates — match what's available.
        return _pick_period_challenges(camper_id, "monthly", {"easy": 1, "medium": 3, "hard": 3})
    if period == "expert":
        idx = await _expert_index(camper_id)
        if idx >= len(EXPERT_SEQUENCE):
            return []
        return [TEMPLATES_BY_ID[EXPERT_SEQUENCE[idx]]]
    return []


async def _challenge_progress(user: dict, ch: dict) -> int:
    """Compute current progress count for one challenge from live data."""
    cid = user["id"]
    period = ch.get("period", "daily")
    cutoff = _period_cutoff_iso(period)
    kind = ch["kind"]

    base_q = {"group_id": cid}
    if cutoff:
        base_q["caught_at"] = {"$gte": cutoff}

    if kind == "catch_total":
        return await db.catches.count_documents(base_q)
    if kind == "catch_rarity":
        q = dict(base_q)
        q["rarity"] = ch["rarity"]
        return await db.catches.count_documents(q)
    if kind == "catch_featured":
        fids = [p["id"] async for p in db.pokemon.find({"featured": True}, {"id": 1, "_id": 0})]
        if not fids:
            return 0
        q = dict(base_q)
        q["pokemon_id"] = {"$in": fids}
        return await db.catches.count_documents(q)
    if kind == "throw_count":
        q = {"camper_id": cid, "reason": "throw"}
        if cutoff:
            q["created_at"] = {"$gte": cutoff}
        return await db.ball_ledger.count_documents(q)
    if kind == "use_fancy_ball":
        q = {"camper_id": cid, "reason": "throw", "ball_type": {"$in": ["rayball", "myrtleball", "lunchball"]}}
        if cutoff:
            q["created_at"] = {"$gte": cutoff}
        return await db.ball_ledger.count_documents(q)
    if kind == "walk_meters":
        if period == "daily":
            pos = await db.camper_positions.find_one({"camper_id": cid}, {"_id": 0})
            if not pos:
                return 0
            if pos.get("date_ymd") != _today_ymd():
                return 0
            return int(pos.get("daily_distance_m", 0))
        # week / month / expert: sum from camper_distance_daily
        if period == "weekly":
            since = (now_utc().astimezone() - timedelta(days=now_utc().astimezone().weekday())).date().isoformat()
        elif period == "monthly":
            since = now_utc().astimezone().replace(day=1).date().isoformat()
        else:
            since = "0000-00-00"  # all-time
        agg = await db.camper_distance_daily.aggregate([
            {"$match": {"camper_id": cid, "date_ymd": {"$gte": since}}},
            {"$group": {"_id": None, "total": {"$sum": "$meters"}}},
        ]).to_list(1)
        return int(agg[0]["total"]) if agg else 0
    if kind == "pin_claim":
        q = {"camper_id": cid, "reason": "pin_bonus"}
        if cutoff:
            q["created_at"] = {"$gte": cutoff}
        return await db.ball_ledger.count_documents(q)
    if kind == "distinct_types":
        types = await db.catches.distinct("pokemon_type", base_q)
        return len([t for t in types if t])
    if kind == "distinct_pokemon":
        ids = await db.catches.distinct("pokemon_id", base_q)
        return len(ids)
    return 0


async def _was_claimed(camper_id: str, challenge_id: str, period: str, period_key: str) -> bool:
    """A challenge is 'claimed' once per period instance. Daily resets every
    YYYY-MM-DD, weekly every YYYY-WW, etc. Expert only once ever."""
    q = {
        "camper_id": camper_id,
        "reason": "challenge_complete",
        "meta.challenge_id": challenge_id,
    }
    if period != "expert":
        q["meta.period_key"] = period_key
    doc = await db.ball_ledger.find_one(q, {"_id": 0})
    return doc is not None


@api.get("/challenges")
async def get_all_challenges(user=Depends(get_current_user)):
    """Returns daily / weekly / monthly / expert buckets."""
    out = {}
    for period in ("daily", "weekly", "monthly", "expert"):
        picks = await _picks_for_period(user["id"], period)
        period_key = _period_key(period)
        items = []
        for ch in picks:
            progress = await _challenge_progress(user, ch)
            claimed = await _was_claimed(user["id"], ch["id"], period, period_key)
            items.append({
                "id": ch["id"],
                "label": ch["label"],
                "tier": ch["tier"],
                "target": ch["target"],
                "progress": min(progress, ch["target"]),
                "completed": progress >= ch["target"],
                "claimed": claimed,
                "reward": ch["reward"],
                "kind": ch["kind"],
                "period": period,
            })
        out[period] = {"key": period_key, "challenges": items}
    # Total count across periods for the pill badge
    total = sum(len(out[p]["challenges"]) for p in out)
    ready = sum(1 for p in out for c in out[p]["challenges"] if c["completed"] and not c["claimed"])
    out["totals"] = {"available": total, "ready_to_claim": ready}
    return out


# Back-compat: original GET /challenges/today now returns the daily bucket only.
@api.get("/challenges/today")
async def challenges_today(user=Depends(get_current_user)):
    picks = await _picks_for_period(user["id"], "daily")
    period_key = _period_key("daily")
    out = []
    for ch in picks:
        progress = await _challenge_progress(user, ch)
        claimed = await _was_claimed(user["id"], ch["id"], "daily", period_key)
        out.append({
            "id": ch["id"],
            "label": ch["label"],
            "tier": ch["tier"],
            "target": ch["target"],
            "progress": min(progress, ch["target"]),
            "completed": progress >= ch["target"],
            "claimed": claimed,
            "reward": ch["reward"],
            "kind": ch["kind"],
        })
    return {"date": period_key, "challenges": out}


@api.post("/challenges/{challenge_id}/claim")
async def challenges_claim(challenge_id: str, user=Depends(get_current_user)):
    ch = TEMPLATES_BY_ID.get(challenge_id)
    if not ch:
        raise HTTPException(404, "Challenge not found")
    period = ch["period"]
    # Verify this challenge is currently active for the camper
    active = await _picks_for_period(user["id"], period)
    if not any(c["id"] == challenge_id for c in active):
        raise HTTPException(404, "Challenge not active for you right now")
    period_key = _period_key(period)
    if await _was_claimed(user["id"], challenge_id, period, period_key):
        raise HTTPException(400, "Already claimed")
    progress = await _challenge_progress(user, ch)
    if progress < ch["target"]:
        raise HTTPException(400, f"Not complete yet ({progress}/{ch['target']})")
    wallet = await adjust_ball(
        user["id"], "pokeball", int(ch["reward"]),
        "challenge_complete",
        {
            "challenge_id": challenge_id,
            "period": period,
            "period_key": period_key,
            "label": ch["label"],
        },
    )
    return {
        "ok": True,
        "challenge_id": challenge_id,
        "period": period,
        "reward": int(ch["reward"]),
        "balance": int(wallet.get("balance", 0)),
        "balances": wallet.get("balances") or {},
    }


# Mount router
app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
