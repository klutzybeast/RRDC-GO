import React, { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence, useMotionValue } from "framer-motion";
import { userApi, formatApiError } from "../lib/api";
import { useUserAuth } from "../contexts/AuthContext";
import CatchSuccessModal from "../components/CatchSuccessModal";
import PokemonOverlay from "../components/PokemonOverlay";
import RarityBadge from "../components/RarityBadge";
import RiverBall from "../components/RiverBall";
import CampBall from "../components/CampBall";
import BallSwitcher from "../components/BallSwitcher";
import BallWobbleSequence from "../components/BallWobbleSequence";
import ItemPicker from "../components/ItemPicker";
import TypeBadge from "../components/TypeBadge";
import ARFallbackScene from "../components/ARFallbackScene";
import { tryPlayCatch, tryPlayMiss } from "../lib/sounds";
import { sfx, playCry } from "../lib/soundFx";
import { toast } from "sonner";
import { Camera, CameraOff, LogOut, BackpackIcon } from "lucide-react";
import { Button } from "../components/ui/button";
import BallCounter from "../components/BallCounter";
import OutOfBallsModal from "../components/OutOfBallsModal";
import { useWallet } from "../hooks/useWallet";

function useCamera(videoRef, enabled) {
    const [status, setStatus] = useState("idle"); // idle | running | denied | error | unavailable | off
    const [err, setErr] = useState("");
    const streamRef = useRef(null);

    const start = useCallback(async () => {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            setStatus("unavailable");
            setErr("Camera not supported on this browser");
            return false;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: "environment" } },
                audio: false,
            });
            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                await videoRef.current.play().catch(() => {});
            }
            setStatus("running");
            return true;
        } catch (e) {
            setErr(e?.message || "Camera access denied");
            setStatus(e?.name === "NotAllowedError" ? "denied" : "error");
            return false;
        }
    }, [videoRef]);

    const stop = useCallback(() => {
        const stream = streamRef.current || videoRef.current?.srcObject;
        if (stream) stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (videoRef.current) videoRef.current.srcObject = null;
        setStatus("off");
    }, [videoRef]);

    useEffect(() => {
        if (enabled) start();
        else stop();
        return () => {
            const s = streamRef.current;
            if (s) s.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled]);

    return { status, err, start, stop };
}

export default function ARPage() {
    const { user, logout } = useUserAuth();
    const nav = useNavigate();
    const [params] = useSearchParams();
    const targetSpawnId = params.get("spawn");

    const videoRef = useRef(null);
    // Camera is OPT-IN. Default OFF so kids see the cheerful cartoon
    // background (ARFallbackScene) on every catch attempt without iOS
    // pestering them with a permission prompt. They can flip it on by
    // tapping the camera icon in the top-right; once they do, the choice
    // sticks across catches via localStorage.
    const [cameraOn, setCameraOnRaw] = useState(() => {
        try { return localStorage.getItem("rrdc:cameraOn") === "1"; } catch { return false; }
    });
    const setCameraOn = useCallback((v) => {
        const next = typeof v === "function" ? v(cameraOn) : v;
        setCameraOnRaw(next);
        try { localStorage.setItem("rrdc:cameraOn", next ? "1" : "0"); } catch { /* noop */ }
    }, [cameraOn]);
    const { status: camStatus, err: camErr, start: startCam, stop: stopCam } = useCamera(videoRef, cameraOn);

    // If iOS denies the prompt (or the browser doesn't support camera at all),
    // remember "off" so we don't try to start it again on the next AR visit.
    useEffect(() => {
        if (camStatus === "denied" || camStatus === "unavailable") {
            try { localStorage.setItem("rrdc:cameraOn", "0"); } catch { /* noop */ }
            setCameraOnRaw(false);
        }
    }, [camStatus]);

    const [spawn, setSpawn] = useState(null);
    const [activeSpawnId, setActiveSpawnId] = useState(targetSpawnId || null);
    const [missCount, setMissCount] = useState(0);
    const [throwing, setThrowing] = useState(false);
    const [result, setResult] = useState(null);
    const [showBallAnim, setShowBallAnim] = useState(false);
    const [wobble, setWobble] = useState(null); // { stages, success, ballId, pendingResult }
    const [flash, setFlash] = useState("");
    const [throwBanner, setThrowBanner] = useState(null); // { quality, curveball }
    const touchPathRef = useRef([]); // {x,y,t}
    const [ambient, setAmbient] = useState(null);
    const [selectedBall, setSelectedBall] = useState("pokeball");
    const pollRef = useRef(null);
    const announcedRef = useRef(false);

    // Wallet
    const { wallet, refresh: refreshWallet, claimDaily } = useWallet(true);
    const [showOutOfBalls, setShowOutOfBalls] = useState(false);

    // Inventory (razz berry + lucky egg). Refreshed after catches so the AR
    // screen shows the freshly-cleared `razz_berry_pending` flag and any
    // lucky-egg countdown lines up with the backend's clock.
    const [inventory, setInventory] = useState(null);
    const refreshInventory = useCallback(async () => {
        try {
            const r = await userApi.get("/inventory");
            setInventory(r.data);
        } catch { /* noop */ }
    }, []);
    useEffect(() => { refreshInventory(); }, [refreshInventory]);
    const razzPrimed = !!inventory?.buffs?.razz_berry_pending;
    const luckyActive = !!inventory?.buffs?.lucky_egg_active;

    // Auto-pick best ball the camper actually owns when wallet first loads,
    // preferring fancy balls so kids see the value of what they earned.
    useEffect(() => {
        if (!wallet?.balances) return;
        const bal = wallet.balances;
        const order = ["lunchball", "myrtleball", "rayball", "pokeball"];
        const owned = order.find((b) => Number(bal[b] || 0) > 0);
        if (owned && Number(bal[selectedBall] || 0) === 0) {
            setSelectedBall(owned);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [wallet?.balances]);

    const poll = useCallback(async () => {
        try {
            const res = await userApi.get("/spawn/current");
            const list = Array.isArray(res.data.spawns) ? res.data.spawns : [];
            // Pick the targeted spawn if still present; else fallback to first
            const desiredId = activeSpawnId || targetSpawnId;
            const match = desiredId ? list.find((s) => s.spawn_id === desiredId) : list[0];
            const chosen = match || list[0] || null;
            setSpawn(chosen);
            if (chosen && chosen.spawn_id !== activeSpawnId) {
                setActiveSpawnId(chosen.spawn_id);
            }
            if (chosen && !announcedRef.current) {
                announcedRef.current = true;
                if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
                sfx.spawnAppear();
                // Cry: use Pokémon's recorded clip if admin uploaded one,
                // otherwise fall back to a procedural warble seeded by the slot
                // number so each species sounds distinct + reproducible.
                const cryUrl = chosen.pokemon?.cry_audio_url;
                const seed = chosen.pokemon?.slot_number || (chosen.pokemon?.id || "x").length;
                playCry(cryUrl, seed);
            }
        } catch {
            // silent
        }
    }, [activeSpawnId, targetSpawnId]);

    const switchToSpawn = (sp) => {
        if (!sp || throwing) return;
        announcedRef.current = false;  // re-announce the new pokemon
        setSpawn(sp);
        setActiveSpawnId(sp.spawn_id);
        setMissCount(0);
    };

    useEffect(() => {
        poll();
        pollRef.current = setInterval(poll, 6000);
        return () => clearInterval(pollRef.current);
    }, [poll]);

    // Fetch ambient (weather + day/night) once on entry and refresh every 10 min.
    useEffect(() => {
        const fetchAmbient = (lat, lng) => {
            const params = lat != null && lng != null ? { lat, lng } : {};
            userApi.get("/ambient", { params }).then((r) => setAmbient(r.data)).catch(() => {});
        };
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => fetchAmbient(pos.coords.latitude, pos.coords.longitude),
                () => fetchAmbient(),
                { enableHighAccuracy: false, timeout: 4000, maximumAge: 5 * 60 * 1000 }
            );
        } else {
            fetchAmbient();
        }
        const id = setInterval(() => {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    (pos) => fetchAmbient(pos.coords.latitude, pos.coords.longitude),
                    () => fetchAmbient(),
                    { enableHighAccuracy: false, timeout: 4000, maximumAge: 5 * 60 * 1000 }
                );
            } else {
                fetchAmbient();
            }
        }, 10 * 60 * 1000);
        return () => clearInterval(id);
    }, []);

    // If no spawn exists after the FIRST few polling seconds, redirect to map.
    // Once we've seen any spawn, stay on AR even between polls so the screen
    // doesn't glitch back to /map after a catch / flee / network blip.
    const everHadSpawnRef = useRef(false);
    useEffect(() => {
        if (spawn) everHadSpawnRef.current = true;
    }, [spawn]);
    useEffect(() => {
        const t = setTimeout(() => {
            if (!spawn && !result && !throwing && !everHadSpawnRef.current) {
                nav("/map");
            }
        }, 6000);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const throwBall = async () => {
        if (!spawn || throwing) return;
        const balances = wallet?.balances || {};
        const totalBalls = Object.values(balances).reduce((s, n) => s + Number(n || 0), 0);
        if (totalBalls < 1) {
            setShowOutOfBalls(true);
            return;
        }
        // If the selected ball is empty, fall back to the first ball with stock
        let ball = selectedBall;
        if (Number(balances[ball] || 0) < 1) {
            ball = ["pokeball", "rayball", "myrtleball", "lunchball"].find((b) => Number(balances[b] || 0) > 0);
            if (ball) setSelectedBall(ball);
        }
        if (!ball) {
            setShowOutOfBalls(true);
            return;
        }
        // Throw quality (NICE/GREAT/EXCELLENT) is no longer sampled — the
        // visible rings were removed from the catch screen so giving a hidden
        // bonus would feel arbitrary. Throws are pure ball-type + curveball.
        const quality = null;
        // Detect curveball from the captured touch path: if total path is at
        // least 1.3x the straight-line distance AND has > 2 direction changes,
        // it's a curveball. Tap-throws (no path) → false.
        const path = touchPathRef.current;
        let curveball = false;
        if (path.length >= 4) {
            let total = 0;
            for (let i = 1; i < path.length; i++) {
                total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
            }
            const straight = Math.hypot(
                path[path.length - 1].x - path[0].x,
                path[path.length - 1].y - path[0].y
            );
            const ratio = straight > 8 ? total / straight : 1;
            // Direction changes
            let dirChanges = 0;
            for (let i = 2; i < path.length; i++) {
                const ax = path[i - 1].x - path[i - 2].x;
                const ay = path[i - 1].y - path[i - 2].y;
                const bx = path[i].x - path[i - 1].x;
                const by = path[i].y - path[i - 1].y;
                const cross = ax * by - ay * bx;
                if (Math.abs(cross) > 60) dirChanges++;
            }
            curveball = ratio > 1.3 && dirChanges >= 2;
        }
        touchPathRef.current = [];

        // Show banner immediately so kid feels rewarded for the skill shot
        if (quality || curveball) {
            setThrowBanner({ quality, curveball });
            setTimeout(() => setThrowBanner(null), 1100);
        }
        setThrowing(true);
        setShowBallAnim(true);
        sfx.ballThrow();
        // Match the ball-flight duration in the SVG below (~0.85s)
        await new Promise((r) => setTimeout(r, 850));
        sfx.ballHit();
        try {
            const res = await userApi.post("/spawn/catch", {
                spawn_id: spawn.spawn_id,
                ball_type: ball,
                throw_quality: quality,
                curveball,
            });
            refreshWallet();
            // Always show the 1-2-3 wobble sequence — backend tells us how it ends.
            const stages = Array.isArray(res.data.wobble_stages) && res.data.wobble_stages.length === 3
                ? res.data.wobble_stages
                : (res.data.success ? [true, true, true] : [false, false, false]);
            setWobble({
                stages,
                success: !!res.data.success,
                ballId: ball,
                pendingResult: res.data,
                pendingMessage: res.data.message,
            });
        } catch (e) {
            const msg = formatApiError(e);
            if (msg?.toLowerCase?.().includes("out of")) {
                setShowOutOfBalls(true);
            } else if (msg?.toLowerCase?.().includes("mismatch") || msg?.toLowerCase?.().includes("expired")) {
                // Don't yank the kid back to the map — just refresh and
                // surface the next spawn naturally.
                toast.error(msg);
                setSpawn(null);
                announcedRef.current = false;
                setActiveSpawnId(null);
            } else {
                toast.error(msg);
            }
            refreshWallet();
        } finally {
            setShowBallAnim(false);
        }
    };

    // Called after the wobble animation finishes — applies success/fail UI.
    const onWobbleDone = (caught) => {
        const w = wobble;
        if (!w) return;
        if (caught) {
            setResult(w.pendingResult);
            setSpawn(null);
            tryPlayCatch();
            // Legendary sting on top of the regular catch chime
            if (w.pendingResult.pokemon?.rarity === "legendary") {
                sfx.legendaryCatch();
            }
            const rewards = w.pendingResult.ball_rewards || {};
            Object.entries(rewards).forEach(([rb, n]) => {
                if (n > 0) toast.success(`+${n} ${rb} earned!`, { duration: 4000 });
            });
            if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200]);
        } else {
            // Pokemon dodged. Let the camper try again.
            setMissCount((n) => n + 1);
            setFlash(w.pendingMessage || "Dodged!");
            setTimeout(() => setFlash(""), 1200);
            tryPlayMiss();
            sfx.catchFail();
            if (navigator.vibrate) navigator.vibrate(200);
        }
        // Razz berry consumes on every throw (success OR escape) and lucky-egg
        // countdown drifts — pull the fresh inventory so the UI dot clears.
        refreshInventory();
        setWobble(null);
        setThrowing(false);
    };

    const ballY = useMotionValue(0);

    const onDragEnd = (_, info) => {
        if (info.offset.y < -60 && spawn && !throwing) throwBall();
    };

    const handleBack = () => {
        // Navigate away — the spawn stays active on the map.
        nav("/map");
    };

    const handleLogout = async () => {
        stopCam();
        await logout();
        nav("/");
    };

    const toggleCamera = () => setCameraOn((v) => !v);

    return (
        <div className="ar-layer" data-testid="ar-page">
            {/* Camera feed */}
            <video ref={videoRef} className="ar-video" playsInline muted autoPlay />

            {/* Cartoony Pokemon-GO-style fallback when camera is off / denied */}
            {camStatus !== "running" && <ARFallbackScene ambient={ambient} />}

            {/* Camera permission / unavailable prompt — only when the user WANTS camera on */}
            {cameraOn && (camStatus === "denied" || camStatus === "error" || camStatus === "unavailable") && (
                <div className="absolute inset-0 z-[5] flex items-center justify-center p-6 bg-black/70 text-white text-center">
                    <div className="max-w-sm">
                        <Camera className="w-12 h-12 mx-auto mb-4 text-river-400" />
                        <h2 className="font-heading text-2xl font-bold mb-2">Camera Needed</h2>
                        <p className="text-sm opacity-80 mb-4">
                            {camStatus === "denied"
                                ? "Please allow camera access in your browser settings to hunt Pokemon."
                                : camStatus === "unavailable"
                                ? "Your browser doesn't support camera access."
                                : camErr || "Requesting camera…"}
                        </p>
                        <div className="flex gap-2 justify-center">
                            <Button onClick={startCam} className="tactile-btn bg-river-500 hover:bg-river-600 text-white rounded-2xl" data-testid="retry-camera-btn">
                                Try Again
                            </Button>
                            <Button onClick={() => setCameraOn(false)} variant="outline" className="rounded-2xl bg-white/10 border-white/30 text-white hover:bg-white/20" data-testid="skip-camera-btn">
                                Skip Camera
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {spawn && !wobble && <PokemonOverlay imageUrl={spawn.pokemon.image_data_url || null} rarity={spawn.pokemon.rarity} />}

            {/* UI overlay */}
            <div className="ar-ui">
                {/* Top bar */}
                <div className="absolute top-4 left-4 right-4 flex items-start justify-between gap-2">
                    <button
                        onClick={handleBack}
                        className="glass-dark rounded-full px-4 py-2 text-sm font-bold flex items-center gap-2"
                        data-testid="back-to-map-btn"
                    >
                        ← Map
                    </button>
                    <div className="flex gap-2 items-center">
                        <BallCounter balance={wallet?.balance} onClick={() => setShowOutOfBalls(true)} />
                        <ItemPicker onConsume={refreshInventory} />
                        <button
                            onClick={toggleCamera}
                            className="glass-dark rounded-full p-2"
                            data-testid="toggle-camera-btn"
                            aria-label={cameraOn ? "Turn camera off" : "Turn camera on"}
                            title={cameraOn ? "Turn camera off" : "Turn camera on"}
                        >
                            {cameraOn ? <Camera className="w-4 h-4" /> : <CameraOff className="w-4 h-4" />}
                        </button>
                        <button
                            onClick={handleLogout}
                            className="glass-dark rounded-full p-2"
                            data-testid="logout-btn"
                            aria-label="Logout"
                        >
                            <LogOut className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Active buffs (razz/lucky) — top-right corner only. NO Pokemon
                    name, rarity, or type badge on the catch screen — keeps the
                    Pokemon image fully visible and uncluttered. */}
                {spawn && (razzPrimed || luckyActive) && (
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="absolute top-20 right-4 flex items-center gap-1.5 flex-wrap pointer-events-none"
                        data-testid="ar-active-buffs"
                    >
                        {razzPrimed && (
                            <span
                                className="px-2 py-1 rounded-full bg-rose-500/95 text-white text-[10px] font-black uppercase tracking-wider shadow ring-1 ring-rose-200/50 animate-pulse"
                                data-testid="razz-primed-chip"
                            >
                                🍓 +30%
                            </span>
                        )}
                        {luckyActive && (
                            <span
                                className="px-2 py-1 rounded-full bg-amber-400/95 text-amber-950 text-[10px] font-black uppercase tracking-wider shadow ring-1 ring-amber-200/60"
                                data-testid="lucky-active-chip"
                            >
                                🥚 2× balls
                            </span>
                        )}
                    </motion.div>
                )}
                {/* Hidden test hook — keeps existing automated tests passing. */}
                {spawn && <span className="sr-only" data-testid="active-spawn-name">{spawn.pokemon.name}</span>}

                {/* Bottom area: ball selector + throw ball */}
                <div className="absolute bottom-4 left-0 right-0 flex flex-col items-center gap-3 select-none">
                    {!spawn && (
                        <div className="glass-dark rounded-2xl px-5 py-3 text-center max-w-xs" data-testid="waiting-panel">
                            <div className="font-heading text-lg font-bold">Returning to map…</div>
                            <div className="text-xs opacity-80 mt-1">Walk around camp to find more Pokemon</div>
                        </div>
                    )}
                    {spawn && (
                        <>
                            <BallSwitcher
                                selected={selectedBall}
                                onSelect={setSelectedBall}
                                balances={wallet?.balances || {}}
                                earnProgress={wallet?.earn_progress || {}}
                            />
                            <motion.div
                                className="relative"
                                drag={!throwing ? "y" : false}
                                dragConstraints={{ top: -10, bottom: 0 }}
                                dragElastic={0.4}
                                onDragEnd={onDragEnd}
                                whileTap={{ scale: 0.92 }}
                                onClick={() => !throwing && throwBall()}
                                onTouchStart={(e) => {
                                    touchPathRef.current = [];
                                    const t = e.touches[0];
                                    if (t) touchPathRef.current.push({ x: t.clientX, y: t.clientY, t: performance.now() });
                                }}
                                onTouchMove={(e) => {
                                    const t = e.touches[0];
                                    if (!t) return;
                                    touchPathRef.current.push({ x: t.clientX, y: t.clientY, t: performance.now() });
                                    // Cap path length to last 30 samples
                                    if (touchPathRef.current.length > 30) touchPathRef.current.shift();
                                }}
                                style={{ y: ballY }}
                                data-testid="river-ball"
                            >
                                {!showBallAnim && <CampBall ballId={selectedBall} size={112} animate />}
                                <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 text-white text-xs font-bold uppercase tracking-widest opacity-90 whitespace-nowrap">
                                    Swipe up to throw
                                </div>
                            </motion.div>
                        </>
                    )}
                </div>

                {/* Spiral throw animation — ball arcs up FROM the bottom-center
                    swipe origin TO the Pokemon at screen center, shrinking + spinning.
                    Anchored at top:50% / left:50% so the final {x:0,y:0,scale:0.18}
                    actually lands ON the Pokemon image (which PokemonOverlay also
                    renders dead-center). */}
                <AnimatePresence>
                    {showBallAnim && (
                        <motion.div
                            className="absolute pointer-events-none"
                            style={{ left: "50%", top: "50%", x: "-50%", y: "-50%" }}
                            initial={{ x: "-50%", y: "calc(40vh - 50%)", scale: 1, opacity: 1, rotate: 0 }}
                            animate={{
                                x:     ["-50%",   "-46%",         "-52%",        "-50%"],
                                y:     ["calc(40vh - 50%)", "calc(10vh - 50%)", "calc(-12vh - 50%)", "-50%"],
                                scale: [1, 0.7, 0.4, 0.18],
                                rotate: [0, 540, 1080, 1620],
                                opacity: [1, 1, 1, 0.9],
                            }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.85, ease: [0.45, 0.05, 0.55, 0.95], times: [0, 0.35, 0.7, 1] }}
                        >
                            <CampBall ballId={selectedBall} size={96} animate={false} />
                        </motion.div>
                    )}
                </AnimatePresence>

                <AnimatePresence>
                    {throwBanner && (
                        <motion.div
                            className="absolute inset-0 flex items-center justify-center pointer-events-none z-[80]"
                            initial={{ opacity: 0, scale: 0.6 }}
                            animate={{ opacity: 1, scale: 1.05 }}
                            exit={{ opacity: 0, scale: 1.4 }}
                            transition={{ type: "spring", stiffness: 280, damping: 18 }}
                            data-testid="throw-banner"
                        >
                            <div className="flex flex-col items-center gap-1">
                                {throwBanner.quality && (
                                    <div
                                        className={`font-heading text-5xl font-black drop-shadow-2xl tracking-widest ${
                                            throwBanner.quality === "excellent" ? "text-yellow-300" :
                                            throwBanner.quality === "great" ? "text-blue-300" :
                                            "text-white"
                                        }`}
                                        data-testid={`throw-${throwBanner.quality}`}
                                        style={{ textShadow: "0 2px 14px rgba(0,0,0,0.85)" }}
                                    >
                                        {throwBanner.quality.toUpperCase()}!
                                    </div>
                                )}
                                {throwBanner.curveball && (
                                    <div
                                        className="font-heading text-3xl font-black text-fuchsia-300 drop-shadow-2xl tracking-widest"
                                        data-testid="throw-curveball"
                                        style={{ textShadow: "0 2px 14px rgba(0,0,0,0.85)" }}
                                    >
                                        CURVEBALL!
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                <AnimatePresence>
                    {flash && (
                        <motion.div
                            className="absolute inset-0 flex items-center justify-center pointer-events-none"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            data-testid="miss-flash"
                        >
                            <div className="glass-dark rounded-3xl px-8 py-5 font-heading text-3xl font-bold">
                                {flash}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {wobble && (
                <BallWobbleSequence
                    ballId={wobble.ballId}
                    stages={wobble.stages}
                    success={wobble.success}
                    onDone={onWobbleDone}
                    onFail={() => {
                        // optional vibrate trigger handled in onWobbleDone
                    }}
                />
            )}

            <CatchSuccessModal
                open={!!result}
                result={result}
                onClose={() => {
                    // After a catch, send the camper back to the map so they
                    // can pick the next Pokemon to chase (they liked seeing
                    // the map between catches).
                    setResult(null);
                    setMissCount(0);
                    announcedRef.current = false;
                    nav("/map");
                }}
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
                        setShowOutOfBalls(false);
                    }
                }}
            />
        </div>
    );
}
