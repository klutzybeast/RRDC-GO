from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import uuid
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


async def maybe_create_spawn(group_id: str, cfg: dict) -> dict:
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

    # Pick a map pin (optional - if none, spawn still works without location)
    pin = await pick_map_pin()
    lat, lng, pin_name, pin_id = None, None, None, None
    if pin:
        lat = pin.get("latitude")
        lng = pin.get("longitude")
        pin_name = pin.get("name")
        pin_id = pin.get("id")

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
async def spawn_current(user=Depends(get_current_user)):
    cfg = await load_spawn_config()
    state = await maybe_create_spawn(user["id"], cfg)
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

    pokemon = cur["pokemon"]
    rarity = pokemon.get("rarity", "common")
    base_rate = CATCH_RATES.get(rarity, 0.5)
    success = random.random() < base_rate

    # Pick next spawn time
    gap_min = random.uniform(cfg["min_interval_min"], cfg["max_interval_min"])
    next_at = (now_utc() + timedelta(minutes=gap_min)).isoformat()

    if not success:
        await db.group_spawns.update_one(
            {"group_id": user["id"]},
            {"$set": {"current_spawn": None, "next_spawn_at": next_at}},
        )
        return CatchResult(success=False, message=f"{pokemon['name']} got away!")

    # Roll power level: between 70% and 100% of base
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
        message=f"Caught {pokemon['name']}!",
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


# Mount router
app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
