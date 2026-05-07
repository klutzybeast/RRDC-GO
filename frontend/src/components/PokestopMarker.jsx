import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";

const RR_LOGO_URL = "https://customer-assets.emergentagent.com/job_river-catch-1/artifacts/l5f6pokq_rr%20logo.png";

/**
 * Pokéstop marker — Rolling River branded badge rendered via Google Maps OverlayView.
 *
 * Visual states:
 *   READY + IN-RANGE   → vivid royal-blue badge, pulsing halo, white "TAP TO SPIN!" pill
 *   READY + OUT-OF-RANGE → faded royal-blue badge, "X ft · walk closer" pill
 *   COOLDOWN           → desaturated grey badge, "Ready in 1m23s" pill (live tick)
 *
 * Props:
 *   name            string — pin name (e.g. "Dining Hall")
 *   ready           bool   — backend says no cooldown active
 *   nextReadyAtIso  string — ISO datetime when cooldown ends (when !ready)
 *   distanceM       number — meters from camper to pin (null if no GPS yet)
 *   engageM         number — distance threshold to allow spinning (default 3 m)
 *   onSpin          fn     — invoked when camper taps a tappable pokéstop
 */
export default function PokestopMarker({
    name,
    ready,
    nextReadyAtIso,
    distanceM,
    engageM = 3,
    onSpin,
}) {
    // Live countdown re-render every second when on cooldown
    const [, force] = useState(0);
    useEffect(() => {
        if (ready || !nextReadyAtIso) return;
        const id = setInterval(() => force((n) => n + 1), 1000);
        return () => clearInterval(id);
    }, [ready, nextReadyAtIso]);

    const inRange = distanceM != null && distanceM <= engageM;
    const tappable = ready && inRange;

    let cooldownLabel = null;
    if (!ready && nextReadyAtIso) {
        const remaining = Math.max(0, Math.ceil((new Date(nextReadyAtIso).getTime() - Date.now()) / 1000));
        if (remaining > 0) {
            const m = Math.floor(remaining / 60);
            const s = remaining % 60;
            cooldownLabel = m ? `${m}m${String(s).padStart(2, "0")}s` : `${s}s`;
        }
    }

    const distFeet = distanceM != null ? Math.round(distanceM * 3.281) : null;
    const engageFeet = Math.round(engageM * 3.281);

    // Royal blue palette — Rolling River brand color: #1d4ed8 (blue-700)
    const ROYAL_DEEP = "#1d4ed8";
    const ROYAL_BRIGHT = "#2563eb";

    // Per-state visual treatment for the badge body
    const badgeStyle = tappable
        ? {
            background: `radial-gradient(circle at 32% 28%, #60a5fa 0%, ${ROYAL_BRIGHT} 55%, ${ROYAL_DEEP} 100%)`,
            boxShadow: `0 0 22px 6px rgba(37,99,235,0.55), 0 4px 14px rgba(0,0,0,0.35), inset 0 0 0 3px #ffffff, inset 0 -6px 12px rgba(0,0,0,0.25)`,
            filter: "saturate(1.15)",
        }
        : !ready
        ? {
            background: `radial-gradient(circle at 32% 28%, #94a3b8 0%, #64748b 55%, #475569 100%)`,
            boxShadow: `0 3px 10px rgba(0,0,0,0.3), inset 0 0 0 3px rgba(255,255,255,0.65), inset 0 -6px 12px rgba(0,0,0,0.25)`,
            filter: "saturate(0.4) brightness(0.85)",
        }
        : {
            background: `radial-gradient(circle at 32% 28%, #93c5fd 0%, ${ROYAL_BRIGHT} 55%, ${ROYAL_DEEP} 100%)`,
            boxShadow: `0 0 12px 2px rgba(37,99,235,0.3), 0 3px 10px rgba(0,0,0,0.3), inset 0 0 0 3px #ffffff, inset 0 -6px 12px rgba(0,0,0,0.25)`,
            filter: "saturate(0.85) brightness(0.92)",
        };

    return (
        <div
            className="relative -translate-x-1/2 -translate-y-full select-none"
            style={{ pointerEvents: "auto" }}
            data-testid={`pokestop-marker-${tappable ? "tappable" : ready ? "out-of-range" : "cooldown"}`}
        >
            {/* Pulsing ground halo — only when tappable */}
            {tappable && (
                <motion.div
                    className="absolute left-1/2 rounded-full"
                    style={{
                        bottom: -8,
                        width: 70,
                        height: 22,
                        translateX: "-50%",
                        background: "radial-gradient(ellipse at center, rgba(37,99,235,0.7), rgba(37,99,235,0) 70%)",
                    }}
                    animate={{ scale: [1, 1.4, 1], opacity: [0.85, 0.45, 0.85] }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                />
            )}

            {/* Pin name above the badge */}
            <div
                className="absolute left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-slate-900/80 text-white text-[9px] font-bold uppercase tracking-wider whitespace-nowrap shadow"
                style={{ top: -10, maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis" }}
                data-testid="pokestop-name-label"
            >
                {name || "Pokéstop"}
            </div>

            {/* The royal-blue circular badge */}
            <motion.button
                onClick={(e) => {
                    e.stopPropagation();
                    if (tappable && onSpin) onSpin();
                }}
                disabled={!tappable}
                className="relative mx-auto block rounded-full"
                style={{
                    width: 56,
                    height: 56,
                    marginBottom: 38,
                    cursor: tappable ? "pointer" : "not-allowed",
                    border: "none",
                    padding: 0,
                    ...badgeStyle,
                }}
                animate={tappable ? { y: [0, -3, 0] } : {}}
                transition={tappable ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" } : {}}
                whileTap={tappable ? { scale: 0.88 } : {}}
                data-testid={`pokestop-badge${tappable ? "-tappable" : ""}`}
            >
                {/* Logo inside a white inset disc so the multicolor logo is readable on blue */}
                <div
                    className="absolute inset-1.5 rounded-full bg-white flex items-center justify-center overflow-hidden"
                    style={{ boxShadow: "inset 0 1px 3px rgba(0,0,0,0.15)" }}
                >
                    <img
                        src={RR_LOGO_URL}
                        alt=""
                        draggable={false}
                        style={{
                            width: "92%",
                            height: "92%",
                            objectFit: "contain",
                            filter: !ready ? "grayscale(0.7) opacity(0.7)" : tappable ? "none" : "saturate(0.8)",
                        }}
                    />
                </div>

                {/* Top sheen highlight for that polished badge look */}
                <div
                    className="absolute rounded-full pointer-events-none"
                    style={{
                        top: 4,
                        left: 9,
                        width: 18,
                        height: 8,
                        background: "linear-gradient(180deg, rgba(255,255,255,0.85), rgba(255,255,255,0))",
                        filter: "blur(1px)",
                    }}
                />

                {/* Sparkles — only when tappable */}
                {tappable && (
                    <>
                        <motion.div
                            className="absolute w-2 h-2 rounded-full bg-white"
                            style={{ left: -4, top: 8, boxShadow: "0 0 6px 2px rgba(255,255,255,0.8)" }}
                            animate={{ opacity: [0, 1, 0], scale: [0.6, 1.3, 0.6] }}
                            transition={{ duration: 1.4, repeat: Infinity, delay: 0 }}
                        />
                        <motion.div
                            className="absolute w-1.5 h-1.5 rounded-full bg-white"
                            style={{ right: -2, top: 4, boxShadow: "0 0 5px 2px rgba(255,255,255,0.8)" }}
                            animate={{ opacity: [0, 1, 0], scale: [0.6, 1.4, 0.6] }}
                            transition={{ duration: 1.4, repeat: Infinity, delay: 0.5 }}
                        />
                        <motion.div
                            className="absolute w-1.5 h-1.5 rounded-full bg-amber-300"
                            style={{ left: 46, bottom: 0, boxShadow: "0 0 5px 2px rgba(252,211,77,0.9)" }}
                            animate={{ opacity: [0, 1, 0], scale: [0.6, 1.3, 0.6] }}
                            transition={{ duration: 1.4, repeat: Infinity, delay: 0.9 }}
                        />
                    </>
                )}
            </motion.button>

            {/* State label pill — sits under the badge */}
            <div className="absolute left-1/2 -translate-x-1/2" style={{ bottom: -10 }}>
                {tappable ? (
                    <motion.div
                        animate={{ scale: [1, 1.06, 1] }}
                        transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                        className="px-2.5 py-0.5 rounded-full bg-amber-400 text-amber-950 text-[10px] font-black uppercase tracking-widest whitespace-nowrap shadow-md ring-1 ring-amber-200"
                        data-testid="pokestop-tap-label"
                    >
                        Tap to spin!
                    </motion.div>
                ) : !ready ? (
                    <div
                        className="px-2.5 py-0.5 rounded-full bg-slate-700/95 text-white text-[10px] font-bold whitespace-nowrap shadow"
                        data-testid="pokestop-cooldown-label"
                    >
                        {cooldownLabel ? `Ready in ${cooldownLabel}` : "Cooling down…"}
                    </div>
                ) : distFeet != null ? (
                    <div
                        className="px-2.5 py-0.5 rounded-full bg-white/95 text-slate-700 text-[10px] font-bold whitespace-nowrap shadow ring-1 ring-slate-200"
                        data-testid="pokestop-distance-label"
                    >
                        {distFeet} ft · walk closer ({engageFeet} ft)
                    </div>
                ) : (
                    <div className="px-2.5 py-0.5 rounded-full bg-white/95 text-slate-600 text-[10px] font-bold whitespace-nowrap shadow ring-1 ring-slate-200">
                        Locating…
                    </div>
                )}
            </div>
        </div>
    );
}
