from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
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
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, UploadFile, File, Form
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
CATCH_RATES = {"common": 0.90, "uncommon": 0.70, "rare": 0.40, "legendary": 0.15}
DEFAULT_RARITY_WEIGHTS = {"common": 55, "uncommon": 25, "rare": 15, "legendary": 5}


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
    description: str = ""
    image_data_url: str = ""
    active: bool = False


class PokemonUpdate(BaseModel):
    name: Optional[str] = None
    power_level: Optional[int] = None
    rarity: Optional[Rarity] = None
    description: Optional[str] = None
    active: Optional[bool] = None
    image_data_url: Optional[str] = None


class SpawnConfig(BaseModel):
    enabled: bool = True
    min_interval_min: float = 3.0
    max_interval_min: float = 8.0
    active_hours_start: int = 9  # 24h
    active_hours_end: int = 15
    spawn_ttl_seconds: int = 120
    rarity_weights: dict = Field(default_factory=lambda: DEFAULT_RARITY_WEIGHTS.copy())
    camp_latitude: float = 40.6396
    camp_longitude: float = -73.6665
    camp_default_zoom: int = 18


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
    spawn: Optional[CurrentSpawn] = None
    next_spawn_at: Optional[datetime] = None
    enabled: bool = True


class CatchAttemptReq(BaseModel):
    spawn_id: str


class CatchResult(BaseModel):
    success: bool
    pokemon: Optional[PokemonOut] = None
    power_rolled: Optional[int] = None
    caught_by: Optional[str] = None
    caught_at: Optional[datetime] = None
    message: str = ""


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
        scheduler.add_job(sync_roster, CronTrigger(hour=0, minute=0), id="nightly-roster-sync", replace_existing=True)
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
    start = cfg.get("active_hours_start", 0)
    end = cfg.get("active_hours_end", 24)
    h = now_utc().astimezone().hour  # server local - okay for camp day
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


async def pick_spawn_pokemon(cfg: dict) -> Optional[dict]:
    weights = cfg.get("rarity_weights") or DEFAULT_RARITY_WEIGHTS
    # Try up to 4 times to get a rarity with actual active pokemon
    for _ in range(4):
        rarity = pick_rarity(weights)
        pipeline = [
            {"$match": {"active": True, "rarity": rarity}},
            {"$sample": {"size": 1}},
            {"$project": {"_id": 0}},
        ]
        docs = await db.pokemon.aggregate(pipeline).to_list(1)
        if docs:
            return docs[0]
    # Fallback: any active pokemon
    docs = await db.pokemon.aggregate([
        {"$match": {"active": True}},
        {"$sample": {"size": 1}},
        {"$project": {"_id": 0}},
    ]).to_list(1)
    return docs[0] if docs else None


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


async def maybe_create_spawn(group_id: str, cfg: dict, camper_lat: Optional[float] = None, camper_lng: Optional[float] = None) -> dict:
    """Return the refreshed group state, creating a spawn if due."""
    state = await get_or_create_group_state(group_id)

    # Clean expired current spawn
    cur = state.get("current_spawn")
    if cur:
        exp = datetime.fromisoformat(cur["expires_at"])
        if exp <= now_utc():
            # Expired uncaught -> set next spawn
            gap_min = random.uniform(cfg["min_interval_min"], cfg["max_interval_min"])
            next_at = now_utc() + timedelta(minutes=gap_min)
            state["current_spawn"] = None
            state["next_spawn_at"] = next_at.isoformat()
            await db.group_spawns.update_one(
                {"group_id": group_id},
                {"$set": {"current_spawn": None, "next_spawn_at": next_at.isoformat()}},
            )

    if not cfg.get("enabled", True) or not is_within_active_hours(cfg):
        return state

    if state.get("current_spawn"):
        return state

    next_at = datetime.fromisoformat(state["next_spawn_at"])
    if now_utc() < next_at:
        return state

    pokemon = await pick_spawn_pokemon(cfg)
    if not pokemon:
        await db.group_spawns.update_one(
            {"group_id": group_id},
            {"$set": {"next_spawn_at": (now_utc() + timedelta(minutes=1)).isoformat()}},
        )
        state["next_spawn_at"] = (now_utc() + timedelta(minutes=1)).isoformat()
        return state

    # Pick spawn location: prefer camper's current GPS (jittered) → pin → camp center
    lat, lng, pin_name, pin_id = None, None, None, None
    if camper_lat is not None and camper_lng is not None:
        lat, lng = jitter_location(float(camper_lat), float(camper_lng))
        pin_name = "Nearby"
    else:
        pin = await pick_map_pin()
        if pin:
            lat = pin.get("latitude")
            lng = pin.get("longitude")
            pin_name = pin.get("name")
            pin_id = pin.get("id")
        else:
            lat = float(cfg.get("camp_latitude", 40.6396))
            lng = float(cfg.get("camp_longitude", -73.6665))
            lat, lng = jitter_location(lat, lng, 10, 40)
            pin_name = "Camp"

    ttl = int(cfg.get("spawn_ttl_seconds", 120))
    spawn = {
        "spawn_id": str(uuid.uuid4()),
        "pokemon_id": pokemon["id"],
        "pokemon": pokemon,
        "started_at": now_utc().isoformat(),
        "expires_at": (now_utc() + timedelta(seconds=ttl)).isoformat(),
        "latitude": lat,
        "longitude": lng,
        "pin_name": pin_name,
        "pin_id": pin_id,
    }
    await db.group_spawns.update_one(
        {"group_id": group_id},
        {"$set": {"current_spawn": spawn}},
    )
    state["current_spawn"] = spawn
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
        description=doc.get("description", ""),
        image_data_url=doc.get("image_data_url", ""),
        active=bool(doc.get("active", False)),
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
    b64 = base64.b64encode(data).decode()
    data_url = f"data:{file.content_type};base64,{b64}"
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
    resp = SpawnPollResponse(enabled=bool(cfg.get("enabled", True)))
    cur = state.get("current_spawn")
    if cur:
        resp.spawn = CurrentSpawn(
            spawn_id=cur["spawn_id"],
            pokemon=pokemon_to_out(cur["pokemon"]),
            started_at=datetime.fromisoformat(cur["started_at"]),
            expires_at=datetime.fromisoformat(cur["expires_at"]),
            latitude=cur.get("latitude"),
            longitude=cur.get("longitude"),
            pin_name=cur.get("pin_name"),
        )
    if state.get("next_spawn_at"):
        resp.next_spawn_at = datetime.fromisoformat(state["next_spawn_at"])
    return resp


@api.post("/spawn/catch", response_model=CatchResult)
async def spawn_catch(req: CatchAttemptReq, user=Depends(get_current_user)):
    cfg = await load_spawn_config()
    state = await db.group_spawns.find_one({"group_id": user["id"]}, {"_id": 0})
    if not state or not state.get("current_spawn"):
        raise HTTPException(400, "No active spawn")
    cur = state["current_spawn"]
    if cur["spawn_id"] != req.spawn_id:
        raise HTTPException(400, "Spawn mismatch (already caught or expired)")
    if datetime.fromisoformat(cur["expires_at"]) <= now_utc():
        raise HTTPException(400, "Spawn expired")

    # Require at least one ball to throw
    wallet = await get_or_init_wallet(user["id"])
    if int(wallet["balance"]) < 1:
        raise HTTPException(402, "You're out of Rolling River Balls! Earn more by walking to a camp pin or come back tomorrow.")

    pokemon = cur["pokemon"]
    rarity = pokemon.get("rarity", "common")
    base_rate = CATCH_RATES.get(rarity, 0.5)
    success = random.random() < base_rate

    # Deduct one ball for the throw
    wallet = await adjust_balls(user["id"], -1, "throw", {"spawn_id": cur["spawn_id"], "rarity": rarity})

    # Pick next spawn time
    gap_min = random.uniform(cfg["min_interval_min"], cfg["max_interval_min"])
    next_at = (now_utc() + timedelta(minutes=gap_min)).isoformat()

    if not success:
        await db.group_spawns.update_one(
            {"group_id": user["id"]},
            {"$set": {"current_spawn": None, "next_spawn_at": next_at}},
        )
        return CatchResult(success=False, message=f"{pokemon['name']} got away!", power_rolled=wallet["balance"])

    # Catch rewards
    reward = CATCH_REWARD.get(rarity, 0)
    wallet = await adjust_balls(user["id"], reward, "catch_reward", {"rarity": rarity, "pokemon_id": pokemon["id"]})

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
        "rarity": rarity,
        "power_rolled": power_rolled,
        "caught_at": caught_at,
    }
    await db.catches.insert_one(catch_doc)
    await db.group_spawns.update_one(
        {"group_id": user["id"]},
        {"$set": {"current_spawn": None, "next_spawn_at": next_at}},
    )
    return CatchResult(
        success=True,
        pokemon=pokemon_to_out(pokemon),
        power_rolled=power_rolled,
        caught_by=user["username"],
        caught_at=datetime.fromisoformat(caught_at),
        message=f"Caught {pokemon['name']}! +{reward} balls",
    )


@api.post("/spawn/flee")
async def spawn_flee(user=Depends(get_current_user)):
    cfg = await load_spawn_config()
    gap_min = random.uniform(cfg["min_interval_min"], cfg["max_interval_min"])
    next_at = (now_utc() + timedelta(minutes=gap_min)).isoformat()
    await db.group_spawns.update_one(
        {"group_id": user["id"]},
        {"$set": {"current_spawn": None, "next_spawn_at": next_at}},
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
            power_level=int(d.get("best_power", 0)),
            description=d.get("description", "") or "",
            count=int(d["count"]),
            last_caught_at=datetime.fromisoformat(d["last_caught_at"]),
            best_power=int(d.get("best_power", 0)),
        ))
    return out


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
    return RosterStatus(
        last_synced_at=datetime.fromisoformat(meta["last_synced_at"]) if meta.get("last_synced_at") else None,
        camper_count=int(meta.get("camper_count", 0) or await db.campers.count_documents({})),
        group_count=int(meta.get("group_count", 0)),
        last_error=meta.get("last_error"),
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
    }


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
    if moved > 5 meters from last known or last write was > 20 s ago."""
    now = now_utc()
    prev = await db.camper_positions.find_one({"camper_id": user["id"]}, {"_id": 0})
    should_write = True
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
    return {"saved": should_write}


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
    """Generate a PNG image via Gemini Nano Banana, return data: URL or None on failure."""
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception as e:
        logger.error(f"emergentintegrations import failed: {e}")
        return None
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        logger.error("EMERGENT_LLM_KEY missing")
        return None
    chat = (LlmChat(api_key=api_key, session_id=f"pokemon-{uuid.uuid4()}", system_message="You generate cute cartoon Pokemon-style creature images.")
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
    mime = img.get("mime_type") or "image/png"
    if not b64:
        return None
    return f"data:{mime};base64,{b64}"


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


async def get_or_init_wallet(camper_id: str) -> dict:
    w = await db.camper_wallets.find_one({"camper_id": camper_id}, {"_id": 0})
    if w:
        return w
    now = now_utc().isoformat()
    w = {"camper_id": camper_id, "balance": STARTING_BALLS, "starting_granted": True, "updated_at": now, "created_at": now}
    await db.camper_wallets.insert_one(w)
    await db.ball_ledger.insert_one({
        "id": str(uuid.uuid4()),
        "camper_id": camper_id,
        "delta": STARTING_BALLS,
        "reason": "starter",
        "meta": {},
        "balance_after": STARTING_BALLS,
        "created_at": now,
    })
    return w


async def adjust_balls(camper_id: str, delta: int, reason: str, meta: dict = None) -> dict:
    """Atomically update balance and record ledger entry. Returns updated wallet."""
    wallet = await get_or_init_wallet(camper_id)
    new_balance = max(0, int(wallet["balance"]) + int(delta))
    now = now_utc().isoformat()
    await db.camper_wallets.update_one(
        {"camper_id": camper_id},
        {"$set": {"balance": new_balance, "updated_at": now}},
    )
    await db.ball_ledger.insert_one({
        "id": str(uuid.uuid4()),
        "camper_id": camper_id,
        "delta": int(delta),
        "reason": reason,
        "meta": meta or {},
        "balance_after": new_balance,
        "created_at": now,
    })
    wallet["balance"] = new_balance
    return wallet


async def last_ledger_by_reason(camper_id: str, reason: str, since: Optional[datetime] = None) -> Optional[dict]:
    q = {"camper_id": camper_id, "reason": reason}
    if since:
        q["created_at"] = {"$gte": since.isoformat()}
    doc = await db.ball_ledger.find_one(q, {"_id": 0}, sort=[("created_at", -1)])
    return doc


class WalletOut(BaseModel):
    balance: int
    starting_balance: int = STARTING_BALLS
    daily_bonus: int = DAILY_BONUS
    pin_bonus: int = PIN_BONUS
    catch_reward: dict = CATCH_REWARD
    can_claim_daily: bool = True
    next_daily_at: Optional[datetime] = None


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
    return WalletOut(balance=int(w["balance"]), can_claim_daily=can, next_daily_at=next_at)


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


# Mount router
app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
