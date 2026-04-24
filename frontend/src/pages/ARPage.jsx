import React, { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence, useMotionValue } from "framer-motion";
import { userApi, formatApiError } from "../lib/api";
import { useUserAuth } from "../contexts/AuthContext";
import CatchSuccessModal from "../components/CatchSuccessModal";
import PokemonOverlay from "../components/PokemonOverlay";
import RarityBadge from "../components/RarityBadge";
import { toast } from "sonner";
import { Camera, LogOut, BackpackIcon, X } from "lucide-react";
import { Button } from "../components/ui/button";
import BallCounter from "../components/BallCounter";
import OutOfBallsModal from "../components/OutOfBallsModal";
import { useWallet } from "../hooks/useWallet";

const RIVER_BALL = "https://static.prod-images.emergentagent.com/jobs/5b062d42-aa16-478f-9904-4c1a14748b37/images/0e5d9cd254c7af67a52924c927b4fb710091bea4bdb211921ad2c64510b4c327.png";

function useCamera(videoRef) {
    const [status, setStatus] = useState("idle"); // idle | running | denied | error | unavailable
    const [err, setErr] = useState("");

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
        const stream = videoRef.current?.srcObject;
        if (stream) stream.getTracks().forEach((t) => t.stop());
        if (videoRef.current) videoRef.current.srcObject = null;
    }, [videoRef]);

    return { status, err, start, stop };
}

function Countdown({ until }) {
    const [, setTick] = useState(0);
    useEffect(() => {
        const id = setInterval(() => setTick((x) => x + 1), 1000);
        return () => clearInterval(id);
    }, []);
    if (!until) return null;
    const ms = new Date(until).getTime() - Date.now();
    if (ms <= 0) return <span>now</span>;
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    return <span>{mins > 0 ? `${mins}m ` : ""}{secs}s</span>;
}

export default function ARPage() {
    const { user, logout } = useUserAuth();
    const nav = useNavigate();
    const videoRef = useRef(null);
    const { status: camStatus, err: camErr, start: startCam, stop: stopCam } = useCamera(videoRef);

    const [spawn, setSpawn] = useState(null);
    const [nextSpawnAt, setNextSpawnAt] = useState(null);
    const [enabled, setEnabled] = useState(true);
    const [throwing, setThrowing] = useState(false);
    const [result, setResult] = useState(null);
    const [showBallAnim, setShowBallAnim] = useState(false);
    const [flash, setFlash] = useState(""); // "miss"
    const pollRef = useRef(null);
    const prevSpawnRef = useRef(null);

    // Wallet
    const { wallet, refresh: refreshWallet, claimDaily } = useWallet(true);
    const [showOutOfBalls, setShowOutOfBalls] = useState(false);

    useEffect(() => {
        startCam();
        return () => stopCam();
    }, [startCam, stopCam]);

    const poll = useCallback(async () => {
        try {
            const res = await userApi.get("/spawn/current");
            setEnabled(res.data.enabled);
            setNextSpawnAt(res.data.next_spawn_at);
            const newSpawn = res.data.spawn;
            const prevId = prevSpawnRef.current?.spawn_id;
            setSpawn(newSpawn);
            if (newSpawn && newSpawn.spawn_id !== prevId) {
                prevSpawnRef.current = newSpawn;
                // New spawn notification
                toast.success(`A wild ${newSpawn.pokemon.name} appeared!`, { duration: 4000 });
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
            } else if (!newSpawn) {
                prevSpawnRef.current = null;
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

    // If no spawn exists on mount, redirect back to map
    useEffect(() => {
        const t = setTimeout(() => {
            if (!spawn && !result) nav("/map");
        }, 3000);
        return () => clearTimeout(t);
    }, [spawn, result, nav]);

    const throwBall = async () => {
        if (!spawn || throwing) return;
        if ((wallet?.balance ?? 0) < 1) {
            setShowOutOfBalls(true);
            return;
        }
        setThrowing(true);
        setShowBallAnim(true);
        await new Promise((r) => setTimeout(r, 700));
        try {
            const res = await userApi.post("/spawn/catch", { spawn_id: spawn.spawn_id });
            refreshWallet();
            if (res.data.success) {
                setResult(res.data);
                setSpawn(null);
                prevSpawnRef.current = null;
            } else {
                setFlash(res.data.message || "Got away!");
                setTimeout(() => {
                    setFlash("");
                    nav("/map");
                }, 1800);
                setSpawn(null);
                prevSpawnRef.current = null;
            }
        } catch (e) {
            const msg = formatApiError(e);
            if (msg?.toLowerCase?.().includes("out of")) {
                setShowOutOfBalls(true);
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
        if (info.offset.y < -60 && spawn && !throwing) {
            throwBall();
        }
    };

    const handleFlee = async () => {
        try { await userApi.post("/spawn/flee"); } catch {}
        setSpawn(null);
        prevSpawnRef.current = null;
        nav("/map");
    };

    const handleLogout = async () => {
        stopCam();
        await logout();
        nav("/");
    };

    return (
        <div className="ar-layer" data-testid="ar-page">
            <video ref={videoRef} className="ar-video" playsInline muted autoPlay />

            {camStatus !== "running" && (
                <div className="absolute inset-0 z-[5] flex items-center justify-center p-6 bg-black/80 text-white text-center">
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
                        <Button onClick={startCam} className="tactile-btn bg-river-500 hover:bg-river-600 text-white rounded-2xl" data-testid="retry-camera-btn">
                            Try Again
                        </Button>
                    </div>
                </div>
            )}

            {spawn && <PokemonOverlay imageUrl={spawn.pokemon.image_data_url || null} rarity={spawn.pokemon.rarity} />}

            {/* UI overlay */}
            <div className="ar-ui">
                {/* Top bar */}
                <div className="absolute top-4 left-4 right-4 flex items-start justify-between gap-2">
                    <button
                        onClick={() => nav("/map")}
                        className="glass-dark rounded-full px-4 py-2 text-sm font-bold flex items-center gap-2"
                        data-testid="back-to-map-btn"
                    >
                        ← Map
                    </button>
                    <div className="flex gap-2 items-center">
                        <BallCounter balance={wallet?.balance} onClick={() => setShowOutOfBalls(true)} />
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
                        <div className="mt-1 flex items-center justify-center gap-2">
                            <RarityBadge rarity={spawn.pokemon.rarity} />
                            <button
                                onClick={handleFlee}
                                className="text-xs opacity-80 hover:opacity-100 underline"
                                data-testid="flee-btn"
                            >
                                Flee
                            </button>
                        </div>
                    </motion.div>
                )}

                {/* Bottom ball */}
                <div className="absolute bottom-6 left-0 right-0 flex items-center justify-center select-none">
                    {!spawn && (
                        <div className="glass-dark rounded-2xl px-5 py-3 text-center max-w-xs" data-testid="waiting-panel">
                            <div className="font-heading text-lg font-bold">
                                {enabled ? "Keep hunting!" : "Spawns paused"}
                            </div>
                            <div className="text-xs opacity-80 mt-1">
                                {enabled ? (
                                    <>Next spawn in <Countdown until={nextSpawnAt} /></>
                                ) : (
                                    "The director has paused the game"
                                )}
                            </div>
                        </div>
                    )}
                    {spawn && (
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
                            {!showBallAnim && (
                                <motion.img
                                    src={RIVER_BALL}
                                    alt="Rolling River Ball"
                                    className="w-28 h-28 drop-shadow-[0_10px_20px_rgba(0,0,0,0.5)] cursor-pointer"
                                    animate={{ y: [0, -6, 0] }}
                                    transition={{ repeat: Infinity, duration: 2 }}
                                    draggable={false}
                                />
                            )}
                            <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-white text-xs font-bold uppercase tracking-widest opacity-90 whitespace-nowrap">
                                Tap or swipe up
                            </div>
                        </motion.div>
                    )}
                </div>

                {/* Ball throw animation */}
                <AnimatePresence>
                    {showBallAnim && (
                        <motion.img
                            src={RIVER_BALL}
                            alt=""
                            className="absolute w-24 h-24 pointer-events-none"
                            style={{ left: "calc(50% - 3rem)", bottom: "6rem" }}
                            initial={{ y: 0, scale: 1, opacity: 1, rotate: 0 }}
                            animate={{ y: -400, scale: 0.2, opacity: 1, rotate: 720 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.7, ease: "easeOut" }}
                        />
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
