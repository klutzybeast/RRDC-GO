import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GoogleMap, Marker, OverlayView } from "@react-google-maps/api";
import { motion } from "framer-motion";
import { userApi } from "../lib/api";
import { useUserAuth } from "../contexts/AuthContext";
import { useGoogleMaps } from "../contexts/GoogleMapsContext";
import { LogOut, BackpackIcon, Sparkles, Crosshair, HelpCircle, Trophy } from "lucide-react";
import RarityBadge from "../components/RarityBadge";
import { Button } from "../components/ui/button";
import OnboardingModal from "../components/OnboardingModal";
import BallCounter from "../components/BallCounter";
import OutOfBallsModal from "../components/OutOfBallsModal";
import RiverBall from "../components/RiverBall";
import { useWallet } from "../hooks/useWallet";
import { toast } from "sonner";

const rarityGlow = {
    common: "rgba(148, 163, 184, 0.55)",
    uncommon: "rgba(34, 197, 94, 0.55)",
    rare: "rgba(59, 130, 246, 0.6)",
    legendary: "rgba(251, 191, 36, 0.75)",
};

const mapStyles = [
    { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
    { featureType: "transit", elementType: "labels", stylers: [{ visibility: "off" }] },
];

const CATCH_RADIUS_METERS = 40;

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
    const [enabled, setEnabled] = useState(true);
    const [pins, setPins] = useState([]);
    const [center, setCenter] = useState({ lat: 40.6396, lng: -73.6665 });
    const [zoom, setZoom] = useState(18);
    const [myLocation, setMyLocation] = useState(null);
    const [geoError, setGeoError] = useState("");
    const [geoBlocked, setGeoBlocked] = useState(false);
    const mapRef = useRef(null);
    const pollRef = useRef(null);
    const seenSpawnIdsRef = useRef(new Set());

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
            // Toast for any newly-appeared spawn this session
            const seen = seenSpawnIdsRef.current;
            for (const s of list) {
                if (!seen.has(s.spawn_id)) {
                    seen.add(s.spawn_id);
                    toast.success(`A wild ${s.pokemon.name} appeared!`, { duration: 3500 });
                    if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
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

    // Fetch pins + spawn config (for camp center fallback)
    useEffect(() => {
        userApi.get("/map-pins").then((r) => {
            setPins(r.data);
            if (r.data.length > 0) {
                const lat = r.data.reduce((s, p) => s + p.latitude, 0) / r.data.length;
                const lng = r.data.reduce((s, p) => s + p.longitude, 0) / r.data.length;
                setCenter({ lat, lng });
            } else {
                // No pins — fall back to admin-configured camp center
                userApi.get("/spawn/current").catch(() => {});
            }
        }).catch(() => {});
        // Load camp center from public config endpoint
        userApi.get("/camp-center").then((r) => {
            if (r.data?.latitude && r.data?.longitude) {
                setCenter({ lat: r.data.latitude, lng: r.data.longitude });
                if (r.data.default_zoom) setZoom(r.data.default_zoom);
            }
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
                setGeoError("");
                setGeoBlocked(false);
                persistPosition(loc.lat, loc.lng, pos.coords.accuracy);
                // Always re-center the map on the camper — map only moves when they walk
                if (mapRef.current) {
                    mapRef.current.panTo(loc);
                    if (!locatedOnce) {
                        mapRef.current.setZoom(19);
                        setLocatedOnce(true);
                    }
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
    const activeInRange = activeSpawn && activeSpawn._distance_m != null && activeSpawn._distance_m <= CATCH_RADIUS_METERS;

    const openCatchFor = (s) => {
        if (!s) return;
        if (!myLocation) {
            toast.error("Need your location to catch Pokemon. Tap the location button to enable.");
            return;
        }
        const dist = metersBetween(myLocation, { lat: s.latitude, lng: s.longitude });
        if (isFinite(dist) && dist > CATCH_RADIUS_METERS) {
            toast.error(`Walk closer — you're ${Math.round(dist)} m away (need to be within ${CATCH_RADIUS_METERS} m)`);
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
                        styles: mapStyles,
                        disableDefaultUI: true,
                        zoomControl: false,
                        scrollwheel: false,
                        clickableIcons: false,
                        draggable: false,
                        gestureHandling: "none",
                        keyboardShortcuts: false,
                        disableDoubleClickZoom: true,
                        mapTypeId: "roadmap",
                    }}
                    onLoad={(m) => (mapRef.current = m)}
                >
                    {myLocation && (
                        <OverlayView position={myLocation} mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}>
                            <div className="relative" style={{ transform: "translate(-50%, -50%)" }}>
                                <div className="w-5 h-5 rounded-full bg-river-500 border-2 border-white shadow-lg" />
                                <div className="absolute inset-0 rounded-full bg-river-500/30 animate-ping" />
                            </div>
                        </OverlayView>
                    )}

                    {pins.map((p) => (
                        <Marker
                            key={p.id}
                            position={{ lat: p.latitude, lng: p.longitude }}
                            title={p.name}
                            icon={{
                                path: window.google?.maps?.SymbolPath?.CIRCLE,
                                scale: 6,
                                fillColor: "#22C55E",
                                fillOpacity: 0.5,
                                strokeWeight: 1,
                                strokeColor: "#16A34A",
                            }}
                        />
                    ))}

                    {rankedSpawns.map((s) => {
                        if (s.latitude == null || s.longitude == null) return null;
                        const dist = s._distance_m;
                        const inRange = dist != null && dist <= CATCH_RADIUS_METERS;
                        const glow = rarityGlow[s.pokemon.rarity] || rarityGlow.common;
                        return (
                            <OverlayView
                                key={s.spawn_id}
                                position={{ lat: s.latitude, lng: s.longitude }}
                                mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                            >
                                <div
                                    onClick={() => openCatchFor(s)}
                                    className="relative cursor-pointer select-none"
                                    style={{ transform: "translate(-50%, -100%)" }}
                                    data-testid="spawn-marker"
                                >
                                    <motion.div
                                        animate={{ y: [0, -8, 0] }}
                                        transition={{ repeat: Infinity, duration: 1.6 }}
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
                                </div>
                            </OverlayView>
                        );
                    })}
                </GoogleMap>
            )}

            {/* Locate me FAB */}
            <button
                onClick={recenterOnMe}
                className={`absolute bottom-32 right-4 z-10 w-12 h-12 rounded-full flex items-center justify-center shadow-lg tactile-btn ${myLocation ? "bg-white text-river-600" : "bg-slate-300 text-slate-600"}`}
                title={myLocation ? "Center on me" : "Enable location"}
                data-testid="locate-me-btn"
            >
                <Crosshair className="w-5 h-5" />
            </button>

            {/* Top bar */}
            <div className="absolute top-2 sm:top-3 left-2 sm:left-3 right-2 sm:right-3 flex items-center justify-between gap-2 z-10 pointer-events-none safe-top">
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
                        className="glass-dark rounded-full p-2"
                        aria-label="Help"
                        data-testid="show-onboarding-btn"
                    >
                        <HelpCircle className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => nav("/leaderboard")}
                        className="glass-dark rounded-full p-2"
                        aria-label="Leaderboard"
                        data-testid="open-leaderboard-btn"
                        title="Weekly leaderboard"
                    >
                        <Trophy className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => nav("/collection")}
                        className="glass-dark rounded-full px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-bold flex items-center gap-1.5 sm:gap-2"
                        data-testid="open-collection-btn"
                    >
                        <BackpackIcon className="w-4 h-4" />
                        <span className="hidden xs:inline">Pokedex</span>
                    </button>
                    <button onClick={handleLogout} className="glass-dark rounded-full p-2" aria-label="Logout" data-testid="logout-btn">
                        <LogOut className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Bottom hud */}
            <div className="absolute bottom-3 left-2 right-2 sm:bottom-4 sm:left-3 sm:right-3 flex items-end justify-between gap-2 z-10 safe-bottom">
                <div className="glass-dark rounded-2xl px-4 py-3 max-w-[260px]" data-testid="hud-status">
                    {spawns.length > 0 ? (
                        <>
                            <div className="text-[10px] uppercase tracking-widest opacity-70">Nearby ({spawns.length})</div>
                            <div className="font-heading text-lg font-bold">
                                {activeSpawn?.pokemon?.name}
                            </div>
                            <div className="mt-1 flex items-center gap-2 flex-wrap">
                                {activeSpawn && <RarityBadge rarity={activeSpawn.pokemon.rarity} className="text-[10px] px-2 py-0" />}
                                {activeSpawn?._distance_m != null && (
                                    <span className="text-[11px] opacity-80">
                                        {Math.round(activeSpawn._distance_m)} m
                                    </span>
                                )}
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="text-[10px] uppercase tracking-widest opacity-70">Spawns</div>
                            <div className="font-heading text-lg font-bold">
                                {enabled ? "Keep walking!" : "Paused"}
                            </div>
                            <div className="text-[11px] opacity-70 mt-0.5">Pokemon will appear nearby</div>
                        </>
                    )}
                </div>

                {activeSpawn && (
                    <motion.button
                        onClick={openCatch}
                        whileTap={{ scale: 0.92 }}
                        disabled={!activeInRange}
                        className={`relative ${!activeInRange ? "opacity-60" : ""}`}
                        data-testid="open-catch-btn"
                    >
                        <RiverBall size={96} animate={activeInRange} />
                        <div className={`absolute -bottom-2 left-1/2 -translate-x-1/2 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full whitespace-nowrap ${activeInRange ? "bg-amber-300 text-slate-900" : "bg-slate-700 text-white"}`}>
                            {activeInRange ? "Tap to catch" : activeSpawn._distance_m != null ? `${Math.round(activeSpawn._distance_m)} m away` : "Walk closer"}
                        </div>
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
                            className="rounded-full h-9 text-xs bg-white/20 hover:bg-white/30 text-white border-white/40 font-bold px-4"
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
        </div>
    );
}
