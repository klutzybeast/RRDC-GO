# RRDC GO — Rolling River Pokemon AR Catcher PWA

## Original Problem Statement
Build a multi-user AR Pokemon catching game for Rolling River Day Camp campers on iPads. Three main surfaces: camper login, AR catch experience, private director panel. PWA installed to iPad home screen, full-screen camera AR overlay, server-driven spawns shared per squad.

## User Personas
- **Camper / Squad**: Logs in with shared squad credentials (no self-signup) on an iPad. Hunts Pokemon through camera + throws Rolling River Ball, views shared collection.
- **Camp Director / Admin**: Manages users, uploads Pokemon images, tunes spawn config, watches analytics.

## Architecture
- **Backend**: FastAPI + MongoDB. JWT Bearer auth (separate tokens for user vs admin). Bcrypt password hashing. Startup seeds: admin user in DB (admin/Camp1993), 60 empty Pokemon slots, default spawn config.
- **Frontend**: React 19 PWA + Tailwind + Shadcn UI + @react-three/fiber + framer-motion + sonner. Custom Fredoka/Nunito typography, Rolling River blue/green palette.
- **Spawn engine**: Lazy per-group state (`group_spawns` collection). On `/api/spawn/current` poll, server creates spawn if due and active hours match. Catch success rate driven by rarity (Common 90 / Uncommon 70 / Rare 40 / Legendary 15).
- **Image storage**: Base64 data URLs in MongoDB (JPEG/PNG/WEBP, 5MB cap).

## Core Requirements (Implemented 2026-02-21)
- [x] Group (squad) login with shared Pokemon bank
- [x] AR catch screen — getUserMedia full-screen camera + Three.js textured plane with bobbing/rotation animation + rarity glow halo
- [x] Rolling River Ball (camp Pokeball) — tap or swipe-up drag, arc throw animation, vibration + tone + toast on spawn
- [x] Synchronized spawns across iPads in same squad (server-driven)
- [x] Catch success modal with Pokemon image, name, rolled power, rarity badge, caught_by
- [x] My Collection bank — grid with rarity filter + sort (recent/power/rarity)
- [x] Director Panel at `/admin` (admin/Camp1993 in MongoDB, bcrypt)
  - [x] Camper CRUD (username, password, squad name, last login)
  - [x] Pokemon roster (60 pre-seeded slots) — edit name/power 1-1000/rarity/description/active, upload image
  - [x] Spawn config — global on/off, min/max interval, active hour window, spawn TTL, rarity weights
  - [x] Analytics — totals, top squads, rarity distribution, most-caught, recent 50 catches table
- [x] Rarity badges: Common (slate), Uncommon (green), Rare (blue), Legendary (amber w/ pulse)
- [x] PWA manifest, apple-mobile-web-app meta tags, custom theme color
- [x] JWT + bcrypt + 8-attempt 10-minute brute-force lockout
- [x] All interactive elements have `data-testid`

## Quality
- Backend pytest: 24/24 pass
- Frontend flows: all tested pass (login, AR camera fallback, collection, admin all 4 tabs)
- Lint: Python + JavaScript clean

## Prioritized Backlog
### P1 (high value next)
- Sound effects library (catch success chime, miss sound, legendary fanfare)
- Leaderboard screen visible to campers (by squad, by day)
- Catch log page per squad with pagination
- Admin "Create new pokemon slot" button (currently only edits 60 seeded slots)

### P2
- Scheduled activation windows per pokemon (e.g. only on Wednesdays)
- Push notification when a legendary spawns
- Export analytics CSV
- Bulk image upload (drag-and-drop N images → creates N slots)
- iPad-specific orientation lock

### P3
- True offline fallback PWA screen with service worker cache
- Server-side timezone (not `.astimezone()`) to honour camp's local hours reliably across server regions

## File Map
- `/app/backend/server.py` — entire backend API
- `/app/frontend/src/App.js` — routes
- `/app/frontend/src/pages/LoginPage.jsx`, `ARPage.jsx`, `CollectionPage.jsx`, `AdminLoginPage.jsx`, `AdminPage.jsx`
- `/app/frontend/src/pages/admin/{UsersTab,PokemonTab,SpawnConfigTab,AnalyticsTab}.jsx`
- `/app/frontend/src/components/{PokemonModel,CatchSuccessModal,RarityBadge}.jsx`
- `/app/frontend/src/contexts/AuthContext.jsx`
- `/app/frontend/src/lib/api.js`

## Test Credentials
See `/app/memory/test_credentials.md` (admin/Camp1993).

---

## Iteration 2 — Roster-driven login + Google Maps (2026-02-21)

### Changes
- **No more passwords for campers**: login flow is now `Group cards → Camper list → Play button`. Driven by live CamperSnap roster (852 campers / 39 groups).
- **Per-camper banks** (replaces group-shared bank). Each camper's catches are their own.
- **Google Maps as main post-login screen** (`/map`). Pokemon spawns render as bobbing markers on hybrid-view Google Map. Tap the marker → AR catch screen.
- **Admin-configurable camp map pins**: click-to-place on map in Director Panel; spawns pick a random active pin.
- **Nightly roster sync** via APScheduler at 00:00 America/New_York. Runs on startup if last sync > 12h old. Admin "Sync Now" button for manual refresh.
- **Director Panel tabs**: Analytics · Roster · Pokemon · Map Pins · Spawns (Campers tab removed).
- **New login background**: Stingray Bay camp illustration (user-uploaded).

### New API surface
- `GET /api/groups`, `GET /api/groups/{code}/campers`, `POST /api/camper/login`
- `POST /api/admin/roster-sync`, `GET /api/admin/roster-status`, `GET /api/admin/roster`
- `GET/POST/PATCH/DELETE /api/admin/map-pins`, `GET /api/map-pins` (camper view, active only)

### New env vars
- Backend: `CAMPER_API_URL`, `SYNC_TIMEZONE`
- Frontend: `REACT_APP_GOOGLE_MAPS_KEY`

### Quality
- Backend 21/21 pytest pass · all critical frontend flows pass
- Known minor: React duplicate-key warning on RosterTab (fixed with composite key) · test-id naming `admin-tab-pins` (functional)

### P1 Backlog (new)
- Nearby-campers battle system (GPS proximity detection between campers in same group)
- Camper profile picture from CamperSnap (if CamperSnap exposes photos later)
- Map pin "radius" — only allow catching if camper is within N meters (real Pokemon-Go feel)
- Daily/weekly leaderboard (per group, per individual)


---

## Iteration 4 — Multi-spawn, kid-friendly catch, clean visuals (2026-02-21)

### Changes
- **Multi-spawn**: `/api/spawn/current` now returns `spawns: CurrentSpawn[]` (up to `max_active_spawns=5`) jittered around the camper when `lat`/`lng` query params are supplied. Legacy single-spawn clients still work (endpoint no longer writes `current_spawn` singleton).
- **Rarity weights** default: common 55 / uncommon 28 / rare 12 / legendary 5 (~1-in-20 legendary).
- **Kid-friendly catch rates**: Common 0.95, Uncommon 0.80, Rare 0.55, Legendary 0.25 (`CATCH_RATES` constant in `/app/backend/server.py`).
- **No flee on miss**: `/api/spawn/catch` on failure keeps the spawn in `current_spawns` so the camper can keep throwing (still deducts 1 ball). Successful catches remove only the caught spawn, leaving the others active.
- **`/api/spawn/flee`** accepts `{spawn_id}` to flee only one spawn; without body, flees all (used when the screen is closed).
- **No catch timer**: spawn TTL bumped to 1h (migration auto-bumps legacy `<1800s` configs). All "Countdown" UI removed from ARPage and simplified in MapPage.
- **Camera toggle on AR page** (`data-testid="toggle-camera-btn"`): stops the `MediaStream` track and falls back to a camp-themed radial gradient. Separate "Skip camera" button when permission is denied.
- **Transparent visuals**:
  - MapPage markers: removed the solid colored circle + white border. Only a soft `radial-gradient` glow sits behind the transparent Pokemon PNG.
  - `PokemonOverlay` (AR): removed harsh drop-shadow that created "dot" artifacts on the camera feed. Added airy rarity glow behind the image.
  - Pokeball: replaced the hardcoded white-background PNG (`RIVER_BALL` URL) with a pure SVG component (`/app/frontend/src/components/RiverBall.jsx`) — zero background, Rolling River blue/cream/emerald palette.
- AR entry now uses `/ar?spawn=<spawn_id>` so a specific spawn can be targeted from the map.

### Quality
- Backend pytest: 15/15 pass (iteration_4 suite).
- Frontend Playwright flows: all pass (multi-marker render, toggle camera, miss-stays, transparent visuals).

### Known behavior notes
- `maybe_create_spawn` caps new spawns at 3 per call even when `max_active_spawns=5`; subsequent polls fill the remaining slots.
- ARPage has a 4-second safety that redirects to `/map` if no spawn is found on mount — does not affect active throws.


---

## Iteration 5 — Camper Weekly Leaderboard (2026-02-21)

### Changes
- **New camper-facing page `/leaderboard`** with 3 tabs:
  1. **Most Catches** — top 10 campers by total catches this week (plus badge for legendaries/rares).
  2. **Top Pokemon** — most-caught species this week (with image thumbnail & unique-catchers count).
  3. **Most Distance** — top 10 campers by meters walked this week.
- **My rank card** at the top of the Catches and Distance tabs shows the viewer's personal rank and total, even if they're not in the top-10 slice.
- **Trophy button** added to MapPage top bar (`data-testid=open-leaderboard-btn`) opens the leaderboard.
- **Back button** (`data-testid=leaderboard-back-btn`) returns to `/map`.
- **ISO week scoping**: everything is scoped to the current ISO week (Monday 00:00 UTC) via `_week_start_iso()`.

### New backend
- `GET /api/leaderboard/weekly` (camper auth) returns `{week_start, top_catchers[], top_pokemon[], top_walkers[], me}`.
- `POST /api/camper/position` now accumulates walked meters per day into the new collection `camper_distance_daily` (capped 5m < step < 200m to filter GPS jumps and parked-still polls).
- New indexes: `camper_distance_daily({camper_id, date_ymd})` unique, and `camper_distance_daily(date_ymd)`.

### New frontend
- `/app/frontend/src/pages/LeaderboardPage.jsx` — 3-tab UI with medal emojis 🥇🥈🥉, highlighted "You" row, colored me-rank card, empty states.
- Route registered in `/app/frontend/src/App.js` under auth-protected `/leaderboard`.

### Quality
- Backend pytest: 8/8 pass (iteration_5 suite) — auth required, week_start = Monday 00:00 UTC, catch/pokemon/walker shapes, is_me flag, step_meters cap.
- Frontend Playwright: 7/7 flows pass (route protected, 3 tabs render, testids present, nav buttons).
- Known note: Sonner spawn-toasts can momentarily overlap the MapPage trophy button on narrow screens — not a functional issue on real devices since toasts dismiss in ~3.5s.


---

## Iteration 6 — Checker-pattern background remover (2026-02-21)

### Problem
Gemini Nano Banana generated Pokemon PNGs with a literal gray/white **checkerboard pattern** drawn into the pixel data (the "transparency indicator" rendered as actual RGB content). The old edge-flood-fill remover could only strip solid borders, so the checker trapped around each creature's glow stayed visible on map markers and the AR view.

### Fix
Rewrote `_remove_white_background()` in `/app/backend/server.py` using numpy:
1. Samples a wide border strip and clusters into top-N dominant colors at 16-step quantization.
2. If 2+ near-gray tones dominate the border → checker signature → treat BOTH as background and remove matching pixels globally across the image (not just flood-reachable from edges).
3. Saturation guard (chroma >= 40) protects colorful foreground pixels so the Pokemon body is never eaten.
4. Soft 28–56 color-distance feather for a clean alpha edge.
5. Honors any pre-existing alpha via min().

**Verified transparency jump** on real assets:
- Starfire Owl (legendary): 11.91% → 77.6% transparent.
- Across all 23 active Pokemon: 46.6%–85.8% transparent; 12.2%–40.2% colorful body preserved. 0 failures.

### New admin endpoints
- POST `/api/admin/pokemon/fix-backgrounds` now returns 202 `{status: started}` immediately and runs reprocessing in a background asyncio task (no more 60s ingress 502s).
- GET `/api/admin/pokemon/fix-backgrounds/status` polls `{status, updated, failed, total, started_at, finished_at}`.

Also updated the Nano Banana system prompt to request solid-white (never checker) backgrounds for future generations.

### Quality
- Iteration_6 testing agent: all 23 pokemon pass transparency + body-preservation thresholds. No regressions on leaderboard, spawn, catch, auth endpoints.
- Synthetic unit test `/tmp/test_bg_remover.py` passes (79.99% stripped on a checker+red-circle, 100% red preserved).
