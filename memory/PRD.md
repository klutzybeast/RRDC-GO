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


---

## Iteration 10 — Spawn DB crash fix + Live Camper Map + Scheduled Windows (2026-04-28)

### P0 — DocumentTooLarge crash fixed
With multi-spawn bursts (5–6 Pokémon at once) and 2–4 MB base64 images per Pokémon, the per-group `group_spawns` document blew past MongoDB's 16 MB hard limit and every poll started returning 500. Fix:
1. Stripped `image_data_url` from the slim pokemon copy embedded in `group_spawns.current_spawns` (line 683 in `server.py`).
2. `GET /api/spawn/current` now bulk-fetches images from the `pokemon` collection by `pokemon_id` and re-attaches them on read.
3. `POST /api/spawn/catch` now re-fetches the image before persisting the catch row and returning to the client (so the catch modal still gets the full data URL).
4. Wiped 28 already-bloated `group_spawns` documents post-deploy.

Verified by iteration_10 testing agent: 5+10 sequential polls under load — zero 500s, all spawns return non-empty image_data_url, catches succeed with image attached.

### P1 — Admin Live Camper Map
New "Live Map" tab in the Director Panel (`/app/frontend/src/pages/admin/CamperMapTab.jsx`). Polls `/api/admin/camper-positions` every 5 s and shows each active camper as a colored initial-marker on a Pokémon-GO-styled Google Map, with a sortable sidebar list, group filter dropdown, max-age selector, and "Fit to campers" button. Camp center pin is loaded from spawn config.

### P2 — Scheduled activation windows
`SpawnConfig.scheduled_windows: list` field added — each entry is `{label, start, end}` ISO datetimes. `is_within_active_hours()` rewritten so:
- If any window covers NOW → enabled.
- Else if any window is in the future → strictly gated (off until next window).
- Else (all past or empty) → fall back to daily `active_hours_start/end`.

Admin UI in `SpawnConfigTab.jsx`: "+ Add window" appends a row with label / `datetime-local` start / `datetime-local` end / Remove. Saved together with the rest of the config via `PUT /admin/spawn-config`.

### Backlog (now P2/P3)
- Refactor 2416-line `server.py` into `/app/backend/routers/{auth,spawn,admin,camper,analytics}.py`.
- ScheduledWindow Pydantic submodel for stricter validation + max-count guard on `PUT /admin/spawn-config`.
- Migrate `google.maps.Marker` → `AdvancedMarkerElement` (deprecation warning, non-blocking).
- TZ field on SpawnConfig so daily-hours fallback isn't tied to server local time.
- Index `camper_positions.updated_at` and apply `$gte` filter at query time for very large rosters.

---

## Iteration 11 — GPS-required spawns + Live Weather AR scene (2026-04-29)

### P0 — "Pokémon spawning miles away" complaint
With multi-tenant play (800 kids logging in from anywhere — backyards, parks, cars on the way to camp), the previous spawn engine had two bugs:

1. **Race-condition first poll**: MapPage's first `/spawn/current` call fired before browser geolocation had resolved → backend planted spawns at camp NY pins (or fallback camp center) → kid in California saw spawns 4500 km away.
2. **No relocation on movement**: Once spawns were placed, they stayed for the 1-hour TTL even if the camper moved across the map (or even across the country in extreme cases).

**Fix**:
- Backend `maybe_create_spawn` now bails out early with an empty list if `camper_lat/lng` is missing — no GPS, no spawns.
- New haversine helper `haversine_m()` plus a `STALE_SPAWN_RELOCATE_M = 250` constant. Every poll with fresh GPS auto-prunes any existing spawn farther than 250 m from the camper, so the next refill spawns Pokémon right around them.
- Removed the dead `pick_map_pin()` and `camp_latitude/longitude` fallback branches in placement — every spawn is now lat/lng-anchored to the camper.
- Frontend `MapPage` no longer fires the early "warm-up" `/spawn/current` ping without coords (the leftover that triggered the bad placement).

Verified by iteration_11 testing agent: SF camper → all 5 spawns within 50 m. Move to Seattle (1100 km away) → next poll ALL 5 spawns within 250 m of new location. Polls without lat/lng return empty.

### P1 — Live weather + day/night AR fallback scene
The user's reference screenshot was Pokémon GO's night scene (dark navy sky, forest silhouette, lit grass). Built a full theming system:

1. **New `/api/ambient` backend endpoint** (auth required) — calls **Open-Meteo** (free, keyless) and maps WMO weather codes into 10 simple buckets:
   `sunny | partly_cloudy | cloudy | rain | thunder | snow | fog | windy | cold_clear | clear_night`
   Cached 10 minutes per ~1 km cell so 800 kids polling won't hammer upstream.
2. **`ARFallbackScene` rewrite** — accepts `ambient` prop and renders:
   - Sky gradient per condition + day/night
   - Animated SVG forest silhouette (matches user's reference)
   - Sun (rotating rays) on clear days, moon + twinkling stars on clear nights
   - Drifting clouds (slow on cloudy, fast on windy) or heavy storm clouds
   - Animated rain droplets, snow (with drift), lightning flash on thunder, fog overlay
   - Tilt-sway intensity scales with wind/storm
   - Snow blanket on the foreground grass when snowing
3. **`ARPage` wiring** — fetches `/ambient` on mount with browser geolocation, refreshes every 10 minutes, passes to scene component.

### Backlog unchanged from iteration 10
- Refactor 2500+ line `server.py` into `/app/backend/routers/`.
- ScheduledWindow Pydantic submodel.
- TZ field on SpawnConfig.
- AdvancedMarkerElement migration.
- Camper "stationary >15 min" alert on admin Live Map (safety signal).


---

## Iteration 12 — Pokemon types + 4 ball variants + spiral throw (2026-04-29)

### Pokemon types (11)
Added `type` field to the Pokemon model and surfaced it everywhere:
`normal | fire | water | grass | electric | rock | psychic | dark | ice | ghost | fighting`.
Each type has its own colored badge (with emoji icon) shown in:
- AR spawn card
- CatchSuccessModal
- CollectionPage cards + detail modal
- Admin Pokemon list cards
- Admin Pokemon edit dialog (new Type Select)
- Admin Bulk-upload row (per-image Type Select; new `types` form-array)

### Four ball variants
| Ball | Multiplier | How earned |
|---|---|---|
| `pokeball` | 1.0× | 200 starter, +1/uncommon, +2/rare, +5 daily, +5/pin |
| `rayball` | 1.4× | every **5 uncommons** caught |
| `myrtleball` | 1.8× | every **3 rares** caught |
| `lunchball` | 2.5× | every **1 legendary** caught |

Implementation:
- New `wallet.balances` dict (per-ball counts). `wallet.balance` kept as a legacy mirror of pokeball.
- `adjust_ball(ball_type, delta, ...)` + back-compat `adjust_balls()` alias.
- `POST /spawn/catch` accepts `ball_type` and applies `BALL_CATCH_MULT` to the rarity catch rate (capped at 0.97). Auto-falls back to pokeball if camper is out of the chosen ball.
- Milestone rewards calculated on every successful catch — count of catches of that rarity since the last milestone-ledger entry. Surfaced in `CatchSuccessModal` via `ball_rewards` and toasted in real time.
- `GET /wallet` returns `earn_progress` so the UI can show "2/3 rares" under each locked fancy ball.

### Spiral throw animation
- New `BallSelector` component above the throw ball — 4 round buttons with the live count under each. Locked balls show grayscale with a "X/N rarity" progress hint.
- Tap-or-swipe-up on the ball still works; ball flies in a slight curving arc with rotation accelerating to **1620°** total over 0.85s, scale 1→0.22, with x jitter for a "spin" feel.
- Auto-selects the fanciest ball the camper actually owns when wallet first loads.
- Existing `RiverBall` import kept as a thin wrapper around `CampBall` — no breakage.

### Backend test pass: 9/9
- Wallet shape, ball-type substitution, milestone rewards (correct ball, correct rarity threshold), Pokemon type CRUD round-trip, bulk upload `types` array, GET /bank returning type — all verified.


---

## Iteration 13 — Daily Challenges + "Other Pokemon" strip on AR (2026-04-29)

### Daily Challenges
- 15 hand-tuned challenge templates spanning easy / medium / hard. Each camper gets 1 of each tier, picked deterministically from `sha1(camper_id|ymd)` so the same person always sees the same 3 today, and a new mix tomorrow at midnight.
- Templates cover: total catches today, catches by rarity (uncommon/rare/legendary), featured supervisor catch, throw count, fancy-ball use, walking distance, pin claim, distinct-types-caught (2 or 3).
- Progress is computed live at read-time from existing collections (`catches`, `ball_ledger`, `camper_positions`) — no separate counter to fall out of sync.
- `POST /challenges/{id}/claim` awards Pokeballs into the wallet (`adjust_ball(..., reason="challenge_complete")`) so the existing ledger system handles audit + double-claim guard.
- Frontend `ChallengesCard` — pill on the map (top-right) shows a "N ready" badge when complete. Tap opens a modal with progress bars, tier chips, and per-row "Claim +N balls" button.

### "Also nearby" strip on AR
- The AR page now keeps the full active spawn list and renders OTHER spawns as a horizontal thumbnail strip above the BallSelector. Each thumb is rarity-ringed (slate/emerald/river/amber). Tapping switches the active target without leaving the AR page.
- `switchToSpawn()` resets miss count and re-announces the new Pokémon. Polling honors the new active spawn id so it doesn't bounce back.

### Process-restart determinism (testing-agent feedback)
- Replaced `hash((camper_id, ymd))` with `sha1(camper_id|ymd)[:8]` because Python's hash() is salted per process via `PYTHONHASHSEED`. Now backend restarts (deploys, scaling, restarts) keep the same 3 challenges for the day. Verified via 3 sequential `/challenges/today` calls returning identical id sets.

### Backlog unchanged
- Refactor 2900-line `server.py` into `/app/backend/routers/`.
- "Stationary kid >15 min" alert on admin Live Map.
- Camper position trail on Live Map.
- Type-effectiveness twist (myrtleball vs grass etc).


---

## Iteration 14 — 4-tab Challenges (Daily / Weekly / Monthly / Expert) (2026-04-29)

### What changed
- Pill on the map now reads "**N available**" (count of challenges) instead of "up to +N balls". When any are completed-but-unclaimed it switches to a pulsing amber "**N ready**".
- Modal got 4 tabs: **Daily / Weekly / Monthly / Expert**.

### Templates (45 total)
- **Daily (15 templates → 6 picked)** — 2 easy + 2 medium + 2 hard. Resets at local midnight.
- **Weekly (10 templates → 6 picked)** — same 2/2/2 split. Resets Monday 00:00 local.
- **Monthly (8 templates → 7 picked)** — 1 easy + 3 medium + 3 hard. Resets on the 1st 00:00 local.
- **Expert (12 templates, sequential)** — kid sees only the next-up. Claim advances to the next. After all 12 they get a "Rolling River legend" splash.

### Implementation
- `period` field added to every template; `EXPERT_SEQUENCE` is the ordered list of expert ids.
- Deterministic per-period selection via `sha1(camper_id|period|period_key)` so refreshes/restarts never reshuffle within a period; new period auto-rotates the picks.
- Period keys: `YYYY-MM-DD` / `YYYY-Www` / `YYYY-MM` / `all-time`.
- `_period_cutoff_iso(period)` + `walk_meters` aggregation off `db.camper_distance_daily` for week/month sums (daily still uses live `camper_positions.daily_distance_m`).
- Claims store `meta.period` + `meta.period_key` so a daily challenge claimed yesterday becomes claimable again today, but a weekly one only once per ISO week.
- New `GET /api/challenges` returns the grouped object + `totals: {available, ready_to_claim}`. Old `GET /api/challenges/today` preserved for back-compat (still serves daily flat list with `date` field).

### Test pass: 17/17 backend pytest + 100% frontend
Verified shape, counts, tier distribution per period, key formats, determinism, back-compat, claim 404/400 paths, expert sequence advancement (e_first → e_50 after one claim, empty list after 12 claims), modal scroll, and all `data-testid` selectors across the new tab UI.

### Backlog unchanged
- Refactor 2900-line `server.py` into routers.
- Stationary-kid alert + position trail on admin Live Map.
- Type-effectiveness twist.
- Per-camp leaderboards (would now sit naturally on the new monthly tab).

