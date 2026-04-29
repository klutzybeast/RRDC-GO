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
import BallSelector from "../components/BallSelector";
import TypeBadge from "../components/TypeBadge";
import ARFallbackScene from "../components/ARFallbackScene";
import { tryPlayCatch, tryPlayMiss } from "../lib/sounds";
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
            return;
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
        } catch (e) {
            setErr(e?.message || "Camera access denied");
            setStatus(e?.name === "NotAllowedError" ? "denied" : "error");
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
    const [cameraOn, setCameraOn] = useState(true);
    const { status: camStatus, err: camErr, start: startCam, stop: stopCam } = useCamera(videoRef, cameraOn);

    const [spawn, setSpawn] = useState(null);
    const [otherSpawns, setOtherSpawns] = useState([]);
    const [activeSpawnId, setActiveSpawnId] = useState(targetSpawnId || null);
    const [missCount, setMissCount] = useState(0);
    const [throwing, setThrowing] = useState(false);
    const [result, setResult] = useState(null);
    const [showBallAnim, setShowBallAnim] = useState(false);
    const [flash, setFlash] = useState("");
    const [ambient, setAmbient] = useState(null);
    const [selectedBall, setSelectedBall] = useState("pokeball");
    const pollRef = useRef(null);
    const announcedRef = useRef(false);

    // Wallet
    const { wallet, refresh: refreshWallet, claimDaily } = useWallet(true);
    const [showOutOfBalls, setShowOutOfBalls] = useState(false);

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
            // Other spawns = everything except the active one
            setOtherSpawns(list.filter((s) => s.spawn_id !== chosen?.spawn_id));
            if (chosen && !announcedRef.current) {
                announcedRef.current = true;
                toast.success(`A wild ${chosen.pokemon.name} appeared!`, { duration: 3500 });
                if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
                try {
                    const ctx = new (window.AudioContext || window.webkitAudioContext)();
                    const o = ctx.createOscillator();
                    const g = ctx.createGain();
                    o.frequency.value = 880;
                    o.connect(g); g.connect(ctx.destination);
                    g.gain.setValueAtTime(0.0001, ctx.currentTime);
                    g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.03);
                    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
                    o.start(); o.stop(ctx.currentTime + 0.6);
                } catch {}
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
        setOtherSpawns((prev) => prev.filter((s) => s.spawn_id !== sp.spawn_id));
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

    // If no spawn exists after a few seconds, redirect back to map
    useEffect(() => {
        const t = setTimeout(() => {
            if (!spawn && !result) nav("/map");
        }, 4000);
        return () => clearTimeout(t);
    }, [spawn, result, nav]);

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
        setThrowing(true);
        setShowBallAnim(true);
        // Match the ball-flight duration in the SVG below (~0.85s)
        await new Promise((r) => setTimeout(r, 850));
        try {
            const res = await userApi.post("/spawn/catch", { spawn_id: spawn.spawn_id, ball_type: ball });
            refreshWallet();
            if (res.data.success) {
                setResult(res.data);
                setSpawn(null);
                tryPlayCatch();
                // Toast any fancy-ball rewards earned on this catch
                const rewards = res.data.ball_rewards || {};
                Object.entries(rewards).forEach(([rb, n]) => {
                    if (n > 0) toast.success(`+${n} ${rb} earned!`, { duration: 4000 });
                });
            } else {
                // Pokemon did NOT flee — it dodged. Let the camper try again.
                setMissCount((n) => n + 1);
                setFlash(res.data.message || "Dodged!");
                setTimeout(() => setFlash(""), 1200);
                tryPlayMiss();
            }
        } catch (e) {
            const msg = formatApiError(e);
            if (msg?.toLowerCase?.().includes("out of")) {
                setShowOutOfBalls(true);
            } else if (msg?.toLowerCase?.().includes("mismatch") || msg?.toLowerCase?.().includes("expired")) {
                toast.error(msg);
                nav("/map");
            } else {
                toast.error(msg);
            }
            refreshWallet();
        } finally {
            setShowBallAnim(false);
            setThrowing(false);
        }
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

            {spawn && <PokemonOverlay imageUrl={spawn.pokemon.image_data_url || null} rarity={spawn.pokemon.rarity} />}

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
                            onClick={() => nav("/collection")}
                            className="glass-dark rounded-full px-3 py-2 text-sm font-bold flex items-center gap-2"
                            data-testid="open-collection-btn"
                        >
                            <BackpackIcon className="w-4 h-4" /> Pokedex
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

                {/* Spawn info */}
                {spawn && (
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="absolute top-20 left-1/2 -translate-x-1/2 glass-dark rounded-2xl px-5 py-3 text-center"
                    >
                        <div className="text-xs uppercase tracking-widest opacity-80">A wild</div>
                        <div className="font-heading text-2xl font-bold" data-testid="active-spawn-name">{spawn.pokemon.name}</div>
                        <div className="mt-1 flex items-center justify-center gap-2 flex-wrap">
                            <RarityBadge rarity={spawn.pokemon.rarity} />
                            {spawn.pokemon.type && spawn.pokemon.type !== "normal" && (
                                <TypeBadge type={spawn.pokemon.type} size="sm" />
                            )}
                            {missCount > 0 && (
                                <span className="text-xs opacity-75">misses: {missCount}</span>
                            )}
                        </div>
                    </motion.div>
                )}

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
                            {/* Other active spawns — kid can switch which one to chase */}
                            {otherSpawns.length > 0 && (
                                <div className="w-full max-w-md px-3" data-testid="other-spawns-strip">
                                    <div className="text-[10px] uppercase tracking-widest text-white/80 font-bold mb-1.5 text-center">
                                        Also nearby ({otherSpawns.length})
                                    </div>
                                    <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1 no-scrollbar">
                                        {otherSpawns.map((s) => {
                                            const rarity = s.pokemon?.rarity || "common";
                                            const ringColor = {
                                                common:    "ring-slate-300",
                                                uncommon:  "ring-emerald-400",
                                                rare:      "ring-river-400",
                                                legendary: "ring-amber-400",
                                            }[rarity] || "ring-slate-300";
                                            return (
                                                <button
                                                    key={s.spawn_id}
                                                    onClick={() => switchToSpawn(s)}
                                                    className={`flex-shrink-0 w-16 rounded-2xl bg-black/45 backdrop-blur-sm ring-2 ${ringColor} p-1.5 hover:bg-black/60 transition-colors`}
                                                    data-testid={`other-spawn-${s.spawn_id}`}
                                                    aria-label={`Switch to ${s.pokemon.name}`}
                                                >
                                                    <div className="aspect-square w-full bg-white/10 rounded-xl overflow-hidden flex items-center justify-center">
                                                        {s.pokemon?.image_data_url ? (
                                                            <img
                                                                src={s.pokemon.image_data_url}
                                                                alt={s.pokemon.name}
                                                                className="w-full h-full object-contain"
                                                                loading="lazy"
                                                            />
                                                        ) : (
                                                            <div className="text-xl">?</div>
                                                        )}
                                                    </div>
                                                    <div className="text-[10px] font-bold text-white text-center mt-1 leading-tight truncate" title={s.pokemon.name}>
                                                        {s.pokemon.name}
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                            <BallSelector
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

                {/* Spiral throw animation — ball arcs up, spirals inward toward the
                    Pokemon (center of screen), shrinking + spinning aggressively. */}
                <AnimatePresence>
                    {showBallAnim && (
                        <motion.div
                            className="absolute pointer-events-none"
                            style={{ left: "calc(50% - 48px)", bottom: "8rem" }}
                            initial={{ x: 0, y: 0, scale: 1, opacity: 1, rotate: 0 }}
                            animate={{
                                // Curving arc — ball rises, curves slightly to mimic a spin throw,
                                // and lands in the center where the Pokemon is.
                                x: [0, 14, -6, 0],
                                y: [0, -180, -300, -380],
                                scale: [1, 0.8, 0.5, 0.22],
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

            <CatchSuccessModal
                open={!!result}
                result={result}
                onClose={() => { setResult(null); nav("/map"); }}
                onGoToCollection={() => { setResult(null); nav("/collection"); }}
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
