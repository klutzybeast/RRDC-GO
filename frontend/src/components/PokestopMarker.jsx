import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";

/**
 * Pokéstop marker rendered via Google Maps OverlayView.
 *
 * Visual states:
 *   READY + IN-RANGE   → glowing cyan cube spinning on a beam, gold "TAP" pulse
 *   READY + OUT-OF-RANGE → desaturated cube + "Walk closer" pill with feet remaining
 *   COOLDOWN           → grey cube, lid-half open, "Ready in 1m23s" pill
 *
 * Props:
 *   name            string — the pin name (e.g. "Dining Hall")
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

    // Cube + halo colors per state
    const palette = tappable
        ? { core: "#22d3ee", edge: "#0e7490", glow: "rgba(34,211,238,0.55)", beam: "linear-gradient(180deg, rgba(34,211,238,0.0), rgba(34,211,238,0.55) 50%, rgba(34,211,238,0.85))" }
        : !ready
        ? { core: "#94a3b8", edge: "#475569", glow: "rgba(148,163,184,0.35)", beam: "linear-gradient(180deg, rgba(148,163,184,0.0), rgba(148,163,184,0.4))" }
        : { core: "#7dd3fc", edge: "#0369a1", glow: "rgba(125,211,252,0.35)", beam: "linear-gradient(180deg, rgba(125,211,252,0.0), rgba(125,211,252,0.35))" };

    const distFeet = distanceM != null ? Math.round(distanceM * 3.281) : null;
    const engageFeet = Math.round(engageM * 3.281);

    return (
        <div
            className="relative -translate-x-1/2 -translate-y-full select-none"
            style={{ pointerEvents: "auto" }}
            data-testid={`pokestop-marker-${tappable ? "tappable" : ready ? "out-of-range" : "cooldown"}`}
        >
            {/* Beam of light from the ground up to the cube */}
            <div
                className="absolute left-1/2 -translate-x-1/2"
                style={{
                    bottom: 0,
                    width: 14,
                    height: 64,
                    background: palette.beam,
                    filter: "blur(2px)",
                    opacity: tappable ? 1 : 0.7,
                }}
            />

            {/* Pulsing ground halo */}
            {tappable && (
                <motion.div
                    className="absolute left-1/2 rounded-full"
                    style={{
                        bottom: -6,
                        width: 56,
                        height: 18,
                        translateX: "-50%",
                        background: "radial-gradient(ellipse at center, rgba(34,211,238,0.65), rgba(34,211,238,0) 70%)",
                    }}
                    animate={{ scale: [1, 1.35, 1], opacity: [0.9, 0.5, 0.9] }}
                    transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                />
            )}

            {/* The cube — rotates when ready+in-range, slow when ready+far, frozen on cooldown */}
            <motion.div
                onClick={(e) => {
                    e.stopPropagation();
                    if (tappable && onSpin) onSpin();
                }}
                className="relative mx-auto cursor-pointer"
                style={{
                    width: 38,
                    height: 38,
                    marginBottom: 60,
                    cursor: tappable ? "pointer" : "not-allowed",
                }}
                animate={tappable ? { rotateY: [0, 360] } : !ready ? { rotateY: 0 } : { rotateY: [0, 60, 0] }}
                transition={tappable ? { duration: 2.4, repeat: Infinity, ease: "linear" } : !ready ? {} : { duration: 4, repeat: Infinity, ease: "easeInOut" }}
                whileTap={tappable ? { scale: 0.85 } : {}}
                data-testid={`pokestop-cube${tappable ? "-tappable" : ""}`}
            >
                {/* Cube faces — simulated with stacked layers for a 2.5D feel */}
                <div
                    className="absolute inset-0 rounded-md"
                    style={{
                        background: `linear-gradient(135deg, ${palette.core} 0%, ${palette.edge} 100%)`,
                        boxShadow: `0 0 18px 4px ${palette.glow}, inset 0 0 0 2px rgba(255,255,255,0.45), inset 0 -8px 0 rgba(0,0,0,0.18)`,
                        transform: "rotate(45deg)",
                        filter: tappable ? "saturate(1.2)" : "saturate(0.55) brightness(0.85)",
                    }}
                />
                {/* Inner gem cross */}
                <div
                    className="absolute inset-0 flex items-center justify-center pointer-events-none"
                    style={{ transform: "rotate(45deg)" }}
                >
                    <div className="w-1.5 h-5 bg-white/85 rounded-full" />
                    <div className="absolute w-5 h-1.5 bg-white/85 rounded-full" />
                </div>
                {/* Sparkle dots — only when tappable */}
                {tappable && (
                    <>
                        <motion.div
                            className="absolute w-1.5 h-1.5 rounded-full bg-white"
                            style={{ left: -6, top: 8 }}
                            animate={{ opacity: [0, 1, 0], scale: [0.6, 1.2, 0.6] }}
                            transition={{ duration: 1.6, repeat: Infinity, delay: 0 }}
                        />
                        <motion.div
                            className="absolute w-1 h-1 rounded-full bg-white"
                            style={{ right: -4, top: 4 }}
                            animate={{ opacity: [0, 1, 0], scale: [0.6, 1.4, 0.6] }}
                            transition={{ duration: 1.6, repeat: Infinity, delay: 0.5 }}
                        />
                        <motion.div
                            className="absolute w-1 h-1 rounded-full bg-white"
                            style={{ left: 30, bottom: -2 }}
                            animate={{ opacity: [0, 1, 0], scale: [0.6, 1.3, 0.6] }}
                            transition={{ duration: 1.6, repeat: Infinity, delay: 1.0 }}
                        />
                    </>
                )}
            </motion.div>

            {/* State label pill — sits between cube and ground. Width-capped so adjacent stops don't overlap. */}
            <div className="absolute left-1/2 -translate-x-1/2" style={{ bottom: -10 }}>
                {tappable ? (
                    <motion.div
                        animate={{ y: [0, -2, 0] }}
                        transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                        className="px-2 py-0.5 rounded-full bg-amber-400 text-amber-950 text-[10px] font-black uppercase tracking-widest whitespace-nowrap shadow-md ring-1 ring-amber-200"
                        data-testid="pokestop-tap-label"
                    >
                        Tap to spin!
                    </motion.div>
                ) : !ready ? (
                    <div
                        className="px-2 py-0.5 rounded-full bg-slate-700/90 text-white text-[10px] font-bold whitespace-nowrap shadow"
                        data-testid="pokestop-cooldown-label"
                    >
                        {cooldownLabel ? `Ready in ${cooldownLabel}` : "Cooling down…"}
                    </div>
                ) : distFeet != null ? (
                    <div
                        className="px-2 py-0.5 rounded-full bg-white/95 text-slate-700 text-[10px] font-bold whitespace-nowrap shadow ring-1 ring-slate-200"
                        data-testid="pokestop-distance-label"
                    >
                        {distFeet} ft · walk closer ({engageFeet} ft)
                    </div>
                ) : (
                    <div className="px-2 py-0.5 rounded-full bg-white/95 text-slate-600 text-[10px] font-bold whitespace-nowrap shadow ring-1 ring-slate-200">
                        Locating…
                    </div>
                )}
            </div>

            {/* Pin name - tiny text above the cube so kids see "Dining Hall" etc. */}
            <div
                className="absolute left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-slate-900/75 text-white text-[9px] font-bold uppercase tracking-wider whitespace-nowrap"
                style={{ top: -8, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }}
                data-testid="pokestop-name-label"
            >
                {name || "Pokéstop"}
            </div>
        </div>
    );
}
