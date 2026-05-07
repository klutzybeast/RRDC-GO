import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GoogleMap, Marker, OverlayView } from "@react-google-maps/api";
import { motion } from "framer-motion";
import { userApi } from "../lib/api";
import { useUserAuth } from "../contexts/AuthContext";
import { useGoogleMaps } from "../contexts/GoogleMapsContext";
import { LogOut, BackpackIcon, Sparkles, Crosshair, HelpCircle, Trophy, Plus, Minus, Shirt, Users as UsersIcon } from "lucide-react";
import RarityBadge from "../components/RarityBadge";
import { Button } from "../components/ui/button";
import OnboardingModal from "../components/OnboardingModal";
import BallCounter from "../components/BallCounter";
import OutOfBallsModal from "../components/OutOfBallsModal";
import TrainerAvatar from "../components/TrainerAvatar";
import TrainerCustomizer, { loadAvatarColors } from "../components/TrainerCustomizer";
import SupervisorChallenge from "../components/SupervisorChallenge";
import ChallengesCard from "../components/ChallengesCard";
import NearbyPanel from "../components/NearbyPanel";
import Minimap from "../components/Minimap";
import RustlingGrass from "../components/RustlingGrass";
import ActiveEventBanner from "../components/ActiveEventBanner";
import BuddyStrip from "../components/BuddyStrip";
import GroupCampersOverlay from "../components/GroupCampersOverlay";
import RaidsOverlay from "../components/RaidsOverlay";
import MuteToggle from "../components/MuteToggle";
import PokestopMarker from "../components/PokestopMarker";
import { sfx } from "../lib/soundFx";
import pokemonGoMapStyle from "../lib/pokemonGoMapStyle";
import { tryPlaySpawn, tryPlayLegendary } from "../lib/sounds";
import { useWallet } from "../hooks/useWallet";
import { toast } from "sonner";

const rarityGlow = {
    common: "rgba(148, 163, 184, 0.55)",
    uncommon: "rgba(34, 197, 94, 0.55)",
    rare: "rgba(59, 130, 246, 0.6)",
    legendary: "rgba(251, 191, 36, 0.75)",
};

const DEFAULT_CATCH_RADIUS_METERS = 40;

function metersBetween(a, b) {
    if (!a || !b) return Infinity;
    const dlat = (b.lat - a.lat) * 111111;
    const dlng = (b.lng - a.lng) * 111111 * Math.cos((a.lat * Math.PI) / 180);
    return Math.sqrt(dlat * dlat + dlng * dlng);
}

export default function MapPage() {
    const { user, logout } = useUserAuth();
    const { isLoaded, loadError } = useGoogleMaps();
    const nav = useNavigate();
    const [spawns, setSpawns] = useState([]);
    const [catchRadius, setCatchRadius] = useState(DEFAULT_CATCH_RADIUS_METERS);
    const [pokestopEngageM, setPokestopEngageM] = useState(3);
    const [enabled, setEnabled] = useState(true);
    const [pins, setPins] = useState([]);
    const [center, setCenter] = useState({ lat: 40.6396, lng: -73.6665 });
    const [zoom, setZoom] = useState(18);
    const [myLocation, setMyLocation] = useState(null);
    const [gpsAccuracy, setGpsAccuracy] = useState(null); // meters; from pos.coords.accuracy
    const [inventory, setInventory] = useState(null);
    const [geoError, setGeoError] = useState("");
    const [geoBlocked, setGeoBlocked] = useState(false);
    const mapRef = useRef(null);
    const pollRef = useRef(null);
    const seenSpawnIdsRef = useRef(new Set());

    // Trainer avatar customization (per-camper, persisted in localStorage)
    const [avatarColors, setAvatarColors] = useState(() => loadAvatarColors(user?.id));
    const [showCustomizer, setShowCustomizer] = useState(false);
    const [legendaryAlert, setLegendaryAlert] = useState(null);
    // Legacy `soundOn` state removed — `<MuteToggle />` now controls audio
    // via the unified `soundFx` module. The old toggle-sound-btn was a
    // duplicate UI control sharing the same localStorage key.
    useEffect(() => { setAvatarColors(loadAvatarColors(user?.id)); }, [user?.id]);

    // Onboarding: show once per camper per device
    const onboardingKey = user?.id ? `rrdc_onboarded_${user.id}` : null;
    const [showOnboarding, setShowOnboarding] = useState(false);
    useEffect(() => {
        if (!onboardingKey) return;
        if (!localStorage.getItem(onboardingKey)) setShowOnboarding(true);
    }, [onboardingKey]);
    const dismissOnboarding = () => {
        if (onboardingKey) localStorage.setItem(onboardingKey, "1");
        setShowOnboarding(false);
    };

    // Wallet
    const { wallet, refresh: refreshWallet, claimDaily, claimPin } = useWallet(true);
    const [ballDelta, setBallDelta] = useState(null);
    const [showOutOfBalls, setShowOutOfBalls] = useState(false);
    const flashDelta = (d) => {
        setBallDelta(d);
        setTimeout(() => setBallDelta(null), 1500);
    };

    const lastLocRef = useRef(null);
    const [isWalking, setIsWalking] = useState(false);
    const [bearing, setBearing] = useState(0);
    useEffect(() => {
        if (!myLocation) return;
        if (lastLocRef.current) {
            const moved = metersBetween(lastLocRef.current, myLocation);
            if (moved >= 1) {
                // Bearing in degrees (0 = north, clockwise) from prev → current
                const dy = myLocation.lat - lastLocRef.current.lat;
                const dx = (myLocation.lng - lastLocRef.current.lng) * Math.cos((myLocation.lat * Math.PI) / 180);
                const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
                setBearing(((deg % 360) + 360) % 360);
                setIsWalking(true);
                clearTimeout(lastLocRef.current._stopTimer);
                const t = setTimeout(() => setIsWalking(false), 2500);
                lastLocRef.current = { ...myLocation, _stopTimer: t };
                return;
            }
        }
        lastLocRef.current = { ...myLocation };
    }, [myLocation?.lat, myLocation?.lng]);

    // Daily streak — fetch on mount + after every catch (poll every 60s as fallback)
    const [streak, setStreak] = useState(null);
    const refreshStreak = React.useCallback(() => {
        userApi.get("/streak").then((r) => setStreak(r.data)).catch(() => {});
    }, []);
    useEffect(() => {
        refreshStreak();
        const t = setInterval(refreshStreak, 60000);
        const onVis = () => { if (!document.hidden) refreshStreak(); };
        document.addEventListener("visibilitychange", onVis);
        return () => {
            clearInterval(t);
            document.removeEventListener("visibilitychange", onVis);
        };
    }, [refreshStreak]);

    // Periodic re-render so per-marker spawn-age transitions (rustling → reveal)
    // happen smoothly without waiting for the 4s poll.
    const [, _setTick] = useState(0);
    useEffect(() => {
        const t = setInterval(() => _setTick((n) => (n + 1) % 1000), 1500);
        return () => clearInterval(t);
    }, []);

    // Pokéstop cooldown statuses (per-pin). Polled with the same cadence as
    // spawns (4s) so the marker color updates as cooldowns expire.
    const [pokestopStatus, setPokestopStatus] = useState({});
    const refreshPokestopStatus = React.useCallback(() => {
        userApi.get("/pokestops/status").then((r) => {
            const m = {};
            (r.data || []).forEach((row) => { m[row.pin_id] = row; });
            setPokestopStatus(m);
        }).catch(() => {});
    }, []);
    useEffect(() => {
        refreshPokestopStatus();
        const t = setInterval(refreshPokestopStatus, 8000);
        return () => clearInterval(t);
    }, [refreshPokestopStatus]);

    const spinPokestop = React.useCallback(async (pin) => {
        // Client-side proximity guard — gives instant feedback without a server roundtrip.
        // The backend re-checks too, so this is purely UX.
        if (myLocation) {
            const dist = metersBetween({ lat: myLocation.lat, lng: myLocation.lng }, { lat: pin.latitude, lng: pin.longitude });
            if (isFinite(dist) && dist > pokestopEngageM) {
                const feet = Math.round(dist * 3.281);
                const needFt = Math.round(pokestopEngageM * 3.281);
                toast.error(`Walk closer — ${feet} ft away (need to be within ${needFt} ft)`);
                return;
            }
        }
        try {
            const r = await userApi.post(`/pin/spin/${pin.id}`);
            const balls = r.data.balls || 0;
            const items = r.data.items || {};
            const itemsTxt = Object.entries(items).map(([k, n]) => `+${n} ${k.replace("_", " ")}`).join(", ");
            toast.success(`📍 ${pin.name}: +${balls} balls${itemsTxt ? " · " + itemsTxt : ""}`);
            flashDelta(balls);
            refreshWallet();
            refreshPokestopStatus();
            refreshInventory();
            sfx.pokestopSpin();
            if (navigator.vibrate) navigator.vibrate([30, 30, 60]);
        } catch (e) {
            const msg = e?.response?.data?.detail || "Could not spin Pokéstop";
            toast.error(msg);
        }
    }, [refreshPokestopStatus, refreshWallet, myLocation, pokestopEngageM]);

    // Auto-claim daily bonus on mount
    useEffect(() => {
        if (wallet?.can_claim_daily) {
            claimDaily().then((r) => {
                if (r.ok) {
                    toast.success(`Daily bonus! +${r.granted} balls`);
                    flashDelta(r.granted);
                }
            });
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [wallet?.can_claim_daily]);

    // Auto-claim nearby pin (within ~12m) once per pin per 12h client-side
    const pinClaimsRef = useRef({}); // {pinId: timestamp}
    useEffect(() => {
        if (!myLocation || pins.length === 0) return;
        for (const p of pins) {
            if (!p.active) continue;
            const last = pinClaimsRef.current[p.id];
            if (last && Date.now() - last < 12 * 60 * 60 * 1000) continue;
            const dlat = (myLocation.lat - p.latitude) * 111111;
            const dlng = (myLocation.lng - p.longitude) * 111111 * Math.cos((myLocation.lat * Math.PI) / 180);
            const dist = Math.sqrt(dlat * dlat + dlng * dlng);
            if (dist <= 12) {
                pinClaimsRef.current[p.id] = Date.now();
                claimPin(p.id).then((r) => {
                    if (r.ok) {
                        toast.success(`📍 ${r.pin_name}: +${r.granted} balls`);
                        flashDelta(r.granted);
                    }
                });
                break; // one at a time
            }
        }
    }, [myLocation, pins, claimPin]);

    // Poll spawns — pass camper GPS when available so spawns appear near them.
    // Backend returns a LIST of active spawns (4-6 at a time w/ mixed rarities).
    const myLocRef = useRef(null);
    useEffect(() => { myLocRef.current = myLocation; }, [myLocation]);
    const poll = React.useCallback(async () => {
        try {
            const params = {};
            if (myLocRef.current) {
                params.lat = myLocRef.current.lat;
                params.lng = myLocRef.current.lng;
            }
            const res = await userApi.get("/spawn/current", { params });
            setEnabled(res.data.enabled);
            const list = Array.isArray(res.data.spawns) ? res.data.spawns : [];
            setSpawns(list);
            // Quietly track newly-appeared spawns. We don't toast a banner
            // anymore — the markers on the map and the Nearby panel already
            // tell the camper what's around. We still trigger the legendary
            // sound + visual banner because that's a special moment.
            const seen = seenSpawnIdsRef.current;
            for (const s of list) {
                if (!seen.has(s.spawn_id)) {
                    seen.add(s.spawn_id);
                    if (s.pokemon.rarity === "legendary") {
                        setLegendaryAlert({
                            id: s.spawn_id,
                            name: s.pokemon.name,
                            image: s.pokemon.image_data_url,
                        });
                        setTimeout(() => setLegendaryAlert(null), 7000);
                        tryPlayLegendary();
                        if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]);
                    } else {
                        tryPlaySpawn();
                        if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
                    }
                }
            }
            // Prune seen ids not present anymore so we re-announce if it respawns
            const active = new Set(list.map((s) => s.spawn_id));
            for (const id of Array.from(seen)) {
                if (!active.has(id)) seen.delete(id);
            }
        } catch (e) {
            // silent
        }
    }, []);

    useEffect(() => {
        poll();
        pollRef.current = setInterval(poll, 4000);
        return () => clearInterval(pollRef.current);
    }, [poll]);

    // Fetch pins + camp center config
    useEffect(() => {
        userApi.get("/map-pins").then((r) => {
            setPins(r.data);
            if (r.data.length > 0) {
                const lat = r.data.reduce((s, p) => s + p.latitude, 0) / r.data.length;
                const lng = r.data.reduce((s, p) => s + p.longitude, 0) / r.data.length;
                setCenter({ lat, lng });
            }
        }).catch(() => {});
        // Load camp center from public config endpoint
        userApi.get("/camp-center").then((r) => {
            if (r.data?.latitude && r.data?.longitude) {
                setCenter({ lat: r.data.latitude, lng: r.data.longitude });
                if (r.data.default_zoom) setZoom(r.data.default_zoom);
            }
            if (r.data?.catch_radius_meters) setCatchRadius(Number(r.data.catch_radius_meters));
            if (r.data?.pokestop_engage_meters) setPokestopEngageM(Number(r.data.pokestop_engage_meters));
        }).catch(() => {});
    }, []);

    // Watch geolocation — trust the browser, not a pre-check
    const [locatedOnce, setLocatedOnce] = useState(false);
    const [inIframe] = useState(() => {
        try { return window.self !== window.top; } catch { return true; }
    });

    const openInNewTab = () => {
        const url = window.location.href;
        try {
            if (window.top) window.top.location.href = url;
        } catch {}
        window.open(url, "_blank", "noopener,noreferrer");
    };

    // Throttled position persister — only sends to backend if moved > 5m or 20s elapsed.
    // Backend double-checks and discards redundant writes.
    const lastPositionSentRef = useRef({ lat: null, lng: null, at: 0 });
    const persistPosition = React.useCallback((lat, lng, accuracy) => {
        const prev = lastPositionSentRef.current;
        const now = Date.now();
        const dt = now - prev.at;
        let dist = Infinity;
        if (prev.lat != null) {
            const dlat = (lat - prev.lat) * 111111;
            const dlng = (lng - prev.lng) * 111111 * Math.cos((lat * Math.PI) / 180);
            dist = Math.sqrt(dlat * dlat + dlng * dlng);
        }
        if (dt < 15000 && dist < 5) return; // client-side throttle
        lastPositionSentRef.current = { lat, lng, at: now };
        userApi.post("/camper/position", { latitude: lat, longitude: lng, accuracy }).catch(() => {});
    }, []);

    useEffect(() => {
        if (!navigator.geolocation) {
            setGeoError("This browser doesn't support location services.");
            return;
        }
        const id = navigator.geolocation.watchPosition(
            (pos) => {
                const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                setMyLocation(loc);
                setGpsAccuracy(typeof pos.coords.accuracy === "number" ? pos.coords.accuracy : null);
                setGeoError("");
                setGeoBlocked(false);
                persistPosition(loc.lat, loc.lng, pos.coords.accuracy);
                // Only auto-center once on the first GPS fix. After that, the
                // camper controls the camera and only the "Locate me" button
                // re-centers — prevents the map from constantly jumping.
                if (mapRef.current && !locatedOnce) {
                    mapRef.current.panTo(loc);
                    mapRef.current.setZoom(19);
                    setLocatedOnce(true);
                }
            },
            (err) => {
                const code = err?.code;
                if (code === 1) {
                    setGeoBlocked(true);
                    setGeoError("Location permission was denied. Enable it in your browser or device settings for this site.");
                } else if (code === 2) {
                    setGeoError("Can't get your location. Try moving outside for a better signal.");
                } else if (code === 3) {
                    setGeoError("Location request timed out — still trying…");
                } else {
                    setGeoError(err?.message || "Location unavailable.");
                }
            },
            { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
        );
        return () => navigator.geolocation.clearWatch(id);
    }, [locatedOnce]);

    const recenterOnMe = () => {
        if (myLocation && mapRef.current) {
            mapRef.current.panTo(myLocation);
            mapRef.current.setZoom(19);
            return;
        }
        if (!navigator.geolocation) {
            toast.error("This browser doesn't support location services.");
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                setMyLocation(loc);
                setGpsAccuracy(typeof pos.coords.accuracy === "number" ? pos.coords.accuracy : null);
                setGeoBlocked(false);
                setGeoError("");
                if (mapRef.current) {
                    mapRef.current.panTo(loc);
                    mapRef.current.setZoom(19);
                }
            },
            (err) => {
                if (err?.code === 1) {
                    setGeoBlocked(true);
                    setGeoError("Location permission was denied. Enable GPS access for this site in your browser or device settings.");
                } else {
                    setGeoError(err?.message || "Location unavailable.");
                }
            },
            { enableHighAccuracy: true, timeout: 20000 }
        );
    };

    // Note: we no longer auto-recenter when a spawn arrives — the camper stays
    // centered on themselves and walks toward the Pokemon like real Pokemon GO.

    const handleLogout = async () => {
        await logout();
        nav("/");
    };

    // Pick the closest in-range spawn (within CATCH_RADIUS_METERS) for the
    // bottom catch button. If none in range, use the closest one overall so
    // the UI can show "X m away".
    const rankedSpawns = React.useMemo(() => {
        return spawns
            .map((s) => {
                const dist = (s.latitude != null && myLocation)
                    ? metersBetween(myLocation, { lat: s.latitude, lng: s.longitude })
                    : null;
                return { ...s, _distance_m: dist };
            })
            .sort((a, b) => (a._distance_m ?? 1e9) - (b._distance_m ?? 1e9));
    }, [spawns, myLocation]);

    const activeSpawn = rankedSpawns[0] || null;
    const activeInRange = activeSpawn && activeSpawn._distance_m != null && activeSpawn._distance_m <= catchRadius;

    const openCatchFor = (s) => {
        if (!s) return;
        if (!myLocation) {
            toast.error("Need your location to catch Pokemon. Tap the location button to enable.");
            return;
        }
        const dist = metersBetween(myLocation, { lat: s.latitude, lng: s.longitude });
        if (isFinite(dist) && dist > catchRadius) {
            toast.error(`Walk closer — you're ${Math.round(dist)} m away (need to be within ${catchRadius} m)`);
            return;
        }
        nav(`/ar?spawn=${encodeURIComponent(s.spawn_id)}`);
    };

    const openCatch = () => openCatchFor(activeSpawn);

    const campCenter = myLocation || center;

    return (
        <div className="relative w-full bg-slate-900" style={{ height: "100vh", minHeight: "100dvh" }} data-testid="map-page">
            {loadError ? (
                <div className="absolute inset-0 flex items-center justify-center text-white text-center p-6">
                    <div>
                        <div className="font-heading text-2xl font-bold mb-2">Map failed to load</div>
                        <div className="text-sm opacity-80">Check Google Maps API key and network.</div>
                    </div>
                </div>
            ) : !isLoaded ? (
                <div className="absolute inset-0 flex items-center justify-center text-white">Loading map…</div>
            ) : (
                <GoogleMap
                    mapContainerStyle={{ width: "100%", height: "100%" }}
                    center={campCenter}
                    zoom={zoom}
                    options={{
                        styles: pokemonGoMapStyle,
                        disableDefaultUI: true,
                        zoomControl: false,
                        scrollwheel: true,
                        clickableIcons: false,
                        draggable: true,
                        gestureHandling: "greedy",  // pinch + drag on touch, scroll on desktop
                        keyboardShortcuts: false,
                        disableDoubleClickZoom: false,
                        mapTypeId: "roadmap",
                        minZoom: 16,
                        maxZoom: 20,
                        backgroundColor: "#a8e6a3",
                        tilt: 0,
                    }}
                    onLoad={(m) => (mapRef.current = m)}
                    onZoomChanged={() => {
                        if (mapRef.current) setZoom(mapRef.current.getZoom());
                    }}
                >
                    {myLocation && (
                        <OverlayView position={myLocation} mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}>
                            <div
                                className="relative"
                                style={{ transform: "translate(-50%, -90%)" }}
                                data-testid="my-location-avatar"
                            >
                                <motion.div
                                    animate={{ rotate: isWalking ? bearing : 0 }}
                                    transition={{ type: "spring", stiffness: 90, damping: 16 }}
                                    style={{ transformOrigin: "50% 75%" }}
                                >
                                    <TrainerAvatar size={88} walking={isWalking} colors={avatarColors} />
                                </motion.div>
                            </div>
                        </OverlayView>
                    )}

                    {pins.map((p) => {
                        const status = pokestopStatus[p.id];
                        const ready = !status || status.ready;
                        const distM = myLocation
                            ? metersBetween({ lat: myLocation.lat, lng: myLocation.lng }, { lat: p.latitude, lng: p.longitude })
                            : null;
                        return (
                            <OverlayView
                                key={p.id}
                                position={{ lat: p.latitude, lng: p.longitude }}
                                mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                            >
                                <PokestopMarker
                                    name={p.name}
                                    ready={ready}
                                    nextReadyAtIso={status?.next_ready_at}
                                    distanceM={distM}
                                    engageM={pokestopEngageM}
                                    onSpin={() => spinPokestop(p)}
                                />
                            </OverlayView>
                        );
                    })}
                    {/* Same-group peer campers (kid-safe: first-name only, admin-gated) */}
                    <GroupCampersOverlay />
                    {/* Active raids on this map (kid-safe scoping handled server-side) */}
                    <RaidsOverlay onPick={(r) => nav(`/raid/${r.id}`)} />

                    {rankedSpawns.map((s) => {
                        if (s.latitude == null || s.longitude == null) return null;
                        const dist = s._distance_m;
                        const inRange = dist != null && dist <= catchRadius;
                        const glow = rarityGlow[s.pokemon.rarity] || rarityGlow.common;
                        // Rustling-grass for the first 10s of a spawn's life — hints at
                        // an arrival before the Pokemon "pops in" with appear animation.
                        const startedAt = s.started_at ? new Date(s.started_at).getTime() : 0;
                        const ageMs = startedAt ? Date.now() - startedAt : 999999;
                        const isRustling = ageMs >= 0 && ageMs < 10000;
                        // Pokemon-GO style: scale down faraway markers, pulse the close ones.
                        let scale = 1.0;
                        let opacity = 1.0;
                        if (dist != null) {
                            if (dist > 100) { scale = 0.7; opacity = 0.7; }
                            else if (dist > 50) { scale = 0.85; opacity = 0.85; }
                            else if (dist > 20) { scale = 1.0; opacity = 1.0; }
                            else { scale = 1.1; opacity = 1.0; }
                        }
                        // Per-rarity ring color (sits OUTSIDE the radial halo for that
                        // unmistakable "this is rare" silhouette ring).
                        const ringColor = {
                            common: "rgba(148,163,184,0.55)",
                            uncommon: "rgba(34,197,94,0.7)",
                            rare: "rgba(59,130,246,0.8)",
                            legendary: "rgba(251,191,36,0.95)",
                        }[s.pokemon.rarity] || "rgba(148,163,184,0.55)";
                        const ringPulse = {
                            common: { duration: 2.4, scale: [1, 1.06, 1] },
                            uncommon: { duration: 2.0, scale: [1, 1.10, 1] },
                            rare: { duration: 1.6, scale: [1, 1.14, 1] },
                            legendary: { duration: 1.2, scale: [1, 1.20, 1] },
                        }[s.pokemon.rarity] || { duration: 2.4, scale: [1, 1.06, 1] };
                        // Stagger start times so adjacent markers don't bob in lock-step
                        const seed = (s.spawn_id || "").split("").reduce((n, c) => n + c.charCodeAt(0), 0);
                        const bobDelay = (seed % 100) / 100;
                        const ringDelay = (seed % 73) / 73;
                        return (
                            <OverlayView
                                key={s.spawn_id}
                                position={{ lat: s.latitude, lng: s.longitude }}
                                mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                            >
                                <motion.div
                                    onClick={() => openCatchFor(s)}
                                    className="relative cursor-pointer select-none"
                                    style={{ transform: "translate(-50%, -100%)" }}
                                    animate={{ scale, opacity }}
                                    transition={{ type: "spring", stiffness: 120, damping: 18 }}
                                    data-testid="spawn-marker"
                                >
                                    {isRustling ? (
                                        <div className="relative w-24 h-24">
                                            <RustlingGrass size={92} />
                                        </div>
                                    ) : (
                                    <>
                                    {/* Rarity pulse ring — sits beneath the bob animation */}
                                    <motion.div
                                        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none"
                                        style={{
                                            width: "108%",
                                            height: "108%",
                                            border: `3px solid ${ringColor}`,
                                            boxShadow: `0 0 18px ${ringColor}`,
                                        }}
                                        animate={{ scale: ringPulse.scale, opacity: [0.55, 0.95, 0.55] }}
                                        transition={{ repeat: Infinity, duration: ringPulse.duration, ease: "easeInOut", delay: ringDelay }}
                                    />
                                    <motion.div
                                        animate={{ y: [0, -8, 0], rotate: [-3, 3, -3] }}
                                        transition={{ repeat: Infinity, duration: 1.6 + bobDelay * 0.8, ease: "easeInOut", delay: bobDelay }}
                                        className="relative w-24 h-24 flex items-center justify-center"
                                    >
                                        {/* Soft radial glow behind the transparent PNG — no solid box, no white border */}
                                        <div
                                            className="absolute inset-0 rounded-full blur-2xl"
                                            style={{ background: `radial-gradient(circle, ${glow} 0%, transparent 70%)` }}
                                        />
                                        {s.pokemon.rarity === "legendary" && (
                                            <motion.div
                                                className="absolute inset-0 rounded-full"
                                                animate={{ scale: [1, 1.15, 1], opacity: [0.4, 0.8, 0.4] }}
                                                transition={{ repeat: Infinity, duration: 1.8 }}
                                                style={{ background: `radial-gradient(circle, ${glow} 0%, transparent 60%)`, filter: "blur(10px)" }}
                                            />
                                        )}
                                        {s.pokemon.image_data_url ? (
                                            <img
                                                src={s.pokemon.image_data_url}
                                                alt=""
                                                className={`relative w-full h-full object-contain transition-all ${!inRange ? "grayscale opacity-70" : ""}`}
                                                style={{ filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.45))" }}
                                                draggable={false}
                                            />
                                        ) : (
                                            <Sparkles className="relative w-10 h-10 text-white" style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.6))" }} />
                                        )}
                                    </motion.div>
                                    {!inRange && dist != null && (
                                        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 bg-slate-900/90 text-white text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full whitespace-nowrap">
                                            {Math.round(dist)} m
                                        </div>
                                    )}
                                    </>
                                    )}
                                </motion.div>
                            </OverlayView>
                        );
                    })}
                </GoogleMap>
            )}

            {/* Minimap radar — top right (top: 60px) so it sits below the menu */}
            <Minimap myLocation={myLocation} spawns={rankedSpawns} bearing={bearing} range={200} />

            {/* Zoom controls (Pokemon GO style stack) */}
            <div className="absolute bottom-48 right-4 z-10 flex flex-col gap-2">
                <button
                    onClick={() => {
                        if (!mapRef.current) return;
                        const z = Math.min(20, (mapRef.current.getZoom() || 18) + 1);
                        mapRef.current.setZoom(z);
                        setZoom(z);
                    }}
                    className="w-11 h-11 rounded-full bg-white shadow-lg flex items-center justify-center tactile-btn text-slate-700 hover:text-river-600"
                    aria-label="Zoom in"
                    data-testid="zoom-in-btn"
                >
                    <Plus className="w-5 h-5" />
                </button>
                <button
                    onClick={() => {
                        if (!mapRef.current) return;
                        const z = Math.max(16, (mapRef.current.getZoom() || 18) - 1);
                        mapRef.current.setZoom(z);
                        setZoom(z);
                    }}
                    className="w-11 h-11 rounded-full bg-white shadow-lg flex items-center justify-center tactile-btn text-slate-700 hover:text-river-600"
                    aria-label="Zoom out"
                    data-testid="zoom-out-btn"
                >
                    <Minus className="w-5 h-5" />
                </button>
            </div>

            {/* Locate me FAB */}
            <button
                onClick={recenterOnMe}
                className={`absolute bottom-32 right-4 z-10 w-12 h-12 rounded-full flex items-center justify-center shadow-lg tactile-btn ${myLocation ? "bg-white text-river-600" : "bg-slate-300 text-slate-600"}`}
                title={myLocation ? "Center on me" : "Enable location"}
                data-testid="locate-me-btn"
            >
                <Crosshair className="w-5 h-5" />
            </button>

            {/* Customize avatar FAB */}
            <button
                onClick={() => setShowCustomizer(true)}
                className="absolute bottom-32 right-20 z-10 w-12 h-12 rounded-full flex items-center justify-center shadow-lg tactile-btn bg-gradient-to-br from-amber-400 to-amber-500 text-slate-900"
                title="Customize my trainer"
                data-testid="customize-trainer-btn"
            >
                <Shirt className="w-5 h-5" />
            </button>

            {/* Top bar */}
            <div className={`absolute top-2 sm:top-3 left-2 sm:left-3 right-2 sm:right-3 flex items-center justify-between gap-2 z-10 safe-top transition-opacity ${showOnboarding ? "opacity-0 pointer-events-none" : "pointer-events-none"}`} aria-hidden={showOnboarding}>
                <div className="glass-dark rounded-full px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-bold flex items-center gap-2 pointer-events-auto min-w-0" data-testid="camper-badge">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                    <span className="truncate max-w-[34vw] sm:max-w-none">
                        {user?.first_name ? `${user.first_name} ${user.last_name}` : user?.username}
                    </span>
                    <span className="text-[10px] uppercase tracking-widest bg-white/20 rounded-full px-2 py-0.5 ml-1 shrink-0">{user?.group_name}</span>
                </div>
                <div className="flex gap-1.5 sm:gap-2 pointer-events-auto items-center">
                    <BallCounter
                        balance={wallet?.balance}
                        delta={ballDelta}
                        onClick={() => setShowOutOfBalls(true)}
                    />
                    <button
                        onClick={() => setShowOnboarding(true)}
                        className="glass-dark rounded-full p-2.5"
                        aria-label="Help"
                        data-testid="show-onboarding-btn"
                    >
                        <HelpCircle className="w-5 h-5" />
                    </button>
                    <button
                        onClick={() => nav("/leaderboard")}
                        className="glass-dark rounded-full p-2.5"
                        aria-label="Leaderboard"
                        data-testid="open-leaderboard-btn"
                        title="Weekly leaderboard"
                    >
                        <Trophy className="w-5 h-5" />
                    </button>
                    <button
                        onClick={() => nav("/friends")}
                        className="glass-dark rounded-full p-2.5"
                        aria-label="Friends, trades & gifts"
                        data-testid="open-friends-btn"
                        title="Friends, trades & gifts"
                    >
                        <UsersIcon className="w-5 h-5" />
                    </button>
                    <button
                        onClick={() => nav("/collection")}
                        className="glass-dark rounded-full px-3 py-2 text-xs sm:text-sm font-bold flex items-center gap-1.5 sm:gap-2"
                        data-testid="open-collection-btn"
                    >
                        <BackpackIcon className="w-5 h-5" />
                        <span className="hidden xs:inline">Pokedex</span>
                    </button>
                    <button onClick={handleLogout} className="glass-dark rounded-full p-2.5" aria-label="Logout" data-testid="logout-btn">
                        <LogOut className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* Supervisor challenge banner + Daily challenges + Nearby */}
            <div className={`absolute top-16 left-2 right-2 z-10 sm:left-3 sm:right-3 max-w-md mx-auto space-y-2 ${showOnboarding ? "opacity-0 pointer-events-none" : "pointer-events-auto"}`} aria-hidden={showOnboarding}>
                <ActiveEventBanner />
                <SupervisorChallenge compact />
                <div className="flex justify-end gap-2 flex-wrap">
                    {streak && (streak.current_streak > 0 || streak.caught_today) && (
                        <motion.div
                            initial={{ scale: 0.85, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="relative bg-white/95 backdrop-blur-sm rounded-full px-3 py-2 shadow-lg flex items-center gap-1.5"
                            data-testid="streak-pill"
                            title={streak.at_risk ? "Catch one today to keep your streak alive!" : "Daily catch streak"}
                        >
                            <motion.span
                                className="text-base"
                                animate={streak.caught_today ? { scale: [1, 1.18, 1] } : { scale: 1 }}
                                transition={{ repeat: streak.caught_today ? Infinity : 0, duration: 1.6 }}
                            >🔥</motion.span>
                            <span className="text-sm font-black text-slate-900 tabular-nums">
                                {streak.current_streak}
                            </span>
                            <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
                                d
                            </span>
                            {streak.at_risk && !streak.caught_today && (
                                <span className="absolute -top-1 -right-1 bg-amber-500 text-white text-[9px] font-bold rounded-full px-1.5 h-[18px] min-w-[18px] flex items-center justify-center" data-testid="streak-at-risk">
                                    !
                                </span>
                            )}
                        </motion.div>
                    )}
                    <NearbyPanel
                        spawns={spawns}
                        myLocation={myLocation}
                        catchRadius={catchRadius}
                        onPick={openCatchFor}
                    />
                    <BuddyStrip onTap={() => nav("/collection")} />
                    <ChallengesCard onRewardClaimed={() => refreshWallet()} />
                    {inventory && (() => {
                        const razz = Number(inventory.items?.razz_berry || 0);
                        const lucky = Number(inventory.items?.lucky_egg || 0);
                        const razzPending = !!inventory.buffs?.razz_berry_pending;
                        const luckyActive = !!inventory.buffs?.lucky_egg_active;
                        if (razz === 0 && lucky === 0 && !razzPending && !luckyActive) return null;
                        return (
                            <div
                                title="You can use these on the AR catch screen — tap a Pokémon to start, then tap the items button"
                                className="flex items-center gap-1.5 rounded-full bg-white/95 backdrop-blur px-2 py-1 shadow ring-1 ring-slate-200"
                                data-testid="map-inventory-pill"
                            >
                                {(razz > 0 || razzPending) && (
                                    <span className={`flex items-center gap-0.5 text-[11px] font-black ${razzPending ? "text-rose-600" : "text-rose-500"}`}>
                                        <span aria-hidden>🍓</span>
                                        <span className="tabular-nums">{razz}</span>
                                    </span>
                                )}
                                {(lucky > 0 || luckyActive) && (
                                    <span className={`flex items-center gap-0.5 text-[11px] font-black ${luckyActive ? "text-amber-600" : "text-amber-500"}`}>
                                        <span aria-hidden>🥚</span>
                                        <span className="tabular-nums">{lucky}</span>
                                    </span>
                                )}
                            </div>
                        );
                    })()}
                    {gpsAccuracy != null && (() => {
                        // Browser geolocation accuracy: lower = better. Buckets:
                        //   <=10m → green ("Strong")
                        //   <=25m → amber ("OK")
                        //   >25m  → rose ("Weak — move to open sky")
                        const acc = Math.round(gpsAccuracy);
                        const tier = acc <= 10 ? "strong" : acc <= 25 ? "ok" : "weak";
                        const palette = {
                            strong: { bg: "bg-emerald-500/95", ring: "ring-emerald-200", label: "Strong" },
                            ok: { bg: "bg-amber-400/95 text-amber-950", ring: "ring-amber-200", label: "OK" },
                            weak: { bg: "bg-rose-500/95", ring: "ring-rose-200", label: "Weak" },
                        }[tier];
                        return (
                            <div
                                title={tier === "weak" ? "GPS is weak — move to open sky for better catches" : `GPS accuracy ±${acc} m`}
                                className={`flex items-center gap-1 rounded-full ${palette.bg} ${tier === "ok" ? "" : "text-white"} text-[10px] font-black uppercase tracking-wider px-2 py-1 shadow ring-1 ${palette.ring}`}
                                data-testid="gps-accuracy-badge"
                                data-tier={tier}
                            >
                                <Crosshair className="w-3 h-3" />
                                ±{acc}m
                            </div>
                        );
                    })()}
                    <MuteToggle />
                </div>
            </div>

            {/* Bottom hud */}
            <div className="absolute bottom-3 left-2 right-2 sm:bottom-4 sm:left-3 sm:right-3 flex items-end justify-end gap-2 z-10 safe-bottom">
                {activeSpawn && (
                    <motion.button
                        onClick={openCatch}
                        whileTap={{ scale: 0.95 }}
                        disabled={!activeInRange}
                        className={`relative px-5 py-3 rounded-full font-heading text-base font-black uppercase tracking-wider shadow-xl tactile-btn ${
                            activeInRange
                                ? "bg-amber-400 text-slate-900 hover:bg-amber-300"
                                : "bg-slate-700/80 text-white opacity-80 cursor-not-allowed"
                        }`}
                        data-testid="open-catch-btn"
                    >
                        {activeInRange
                            ? `Catch ${activeSpawn.pokemon?.name || ""}!`
                            : activeSpawn._distance_m != null
                                ? `${Math.round(activeSpawn._distance_m)} m away — walk closer`
                                : "Walk closer"}
                    </motion.button>
                )}
            </div>

            {(geoError || geoBlocked) && !myLocation && (
                <div className="absolute top-16 left-1/2 -translate-x-1/2 glass-dark rounded-2xl px-4 py-3 text-xs font-bold max-w-[92%] sm:max-w-md text-center z-20" data-testid="geo-error">
                    <div className="mb-1">📍 {geoError || "Location permission needed"}</div>
                    {inIframe && geoBlocked && (
                        <div className="text-[11px] opacity-80 mb-2 leading-relaxed">
                            GPS is blocked inside this preview window. Open the app in a full browser tab to use your location.
                        </div>
                    )}
                    <div className="flex flex-col sm:flex-row gap-2 items-stretch mt-2 justify-center">
                        {inIframe && (
                            <Button
                                onClick={openInNewTab}
                                size="sm"
                                className="tactile-btn rounded-full h-9 text-xs bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold px-4"
                                data-testid="open-in-browser-btn"
                            >
                                Open in full browser
                            </Button>
                        )}
                        <Button
                            onClick={recenterOnMe}
                            size="sm"
                            variant="outline"
                            className="rounded-full h-11 text-sm bg-white/20 hover:bg-white/30 text-white border-white/40 font-bold px-5"
                            data-testid="enable-location-btn"
                        >
                            Try again
                        </Button>
                    </div>
                </div>
            )}

            <OnboardingModal
                open={showOnboarding}
                camperName={user?.first_name ? `${user.first_name} ${user.last_name}` : user?.username}
                onFinish={dismissOnboarding}
            />
            <OutOfBallsModal
                open={showOutOfBalls}
                onClose={() => setShowOutOfBalls(false)}
                canClaimDaily={wallet?.can_claim_daily}
                nextDailyAt={wallet?.next_daily_at}
                daily={wallet?.daily_bonus ?? 25}
                pinBonus={wallet?.pin_bonus ?? 5}
                onClaimDaily={async () => {
                    const r = await claimDaily();
                    if (r.ok) {
                        toast.success(`+${r.granted} balls`);
                        flashDelta(r.granted);
                        setShowOutOfBalls(false);
                    } else {
                        toast.error(r.error);
                    }
                }}
            />
            <TrainerCustomizer
                open={showCustomizer}
                camperId={user?.id}
                onClose={() => setShowCustomizer(false)}
                onSave={(c) => setAvatarColors(c)}
            />

            {/* Camp-wide legendary banner */}
            {legendaryAlert && (
                <motion.div
                    initial={{ y: -100, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -100, opacity: 0 }}
                    className="absolute top-3 left-1/2 -translate-x-1/2 z-30 max-w-[90vw]"
                    data-testid="legendary-alert-banner"
                >
                    <div className="rounded-2xl bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-400 text-slate-900 px-4 py-2.5 shadow-2xl border-2 border-amber-600 flex items-center gap-3 animate-pulse">
                        {legendaryAlert.image ? (
                            <img src={legendaryAlert.image} alt="" className="w-10 h-10 object-contain" draggable={false} />
                        ) : (
                            <Sparkles className="w-8 h-8" />
                        )}
                        <div>
                            <div className="text-[9px] uppercase tracking-widest font-black">⚡ Legendary Spotted</div>
                            <div className="font-heading text-lg font-black leading-none">{legendaryAlert.name}</div>
                            <div className="text-[10px] font-bold opacity-80">Catch it before it's gone!</div>
                        </div>
                    </div>
                </motion.div>
            )}
        </div>
    );
}
