import React, { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * Pokemon-GO style minimap / radar. Circular, sits at the bottom-left of the
 * map. Self at center, spawns rendered as colored silhouettes within a 200m
 * radius. Tap to expand; tap again to collapse.
 */
const RARITY_DOT = {
    common: "#94a3b8",
    uncommon: "#22c55e",
    rare: "#3b82f6",
    legendary: "#f59e0b",
};

function metersBetween(a, b) {
    if (!a || !b) return Infinity;
    const dlat = (b.lat - a.lat) * 111111;
    const dlng = (b.lng - a.lng) * 111111 * Math.cos((a.lat * Math.PI) / 180);
    return Math.sqrt(dlat * dlat + dlng * dlng);
}

// Returns x/y in 0..1 inside the radar disc (origin = center).
function projectToRadar(myLoc, spawn, range) {
    if (!myLoc || !spawn?.latitude || !spawn?.longitude) return null;
    const dy = (spawn.latitude - myLoc.lat) * 111111;
    const dx = (spawn.longitude - myLoc.lng) * 111111 * Math.cos((myLoc.lat * Math.PI) / 180);
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > range) return null;
    // Map -range..range to 0..1
    return {
        x: 0.5 + (dx / range) * 0.5,
        y: 0.5 - (dy / range) * 0.5, // y inverted (north up)
        dist,
    };
}

export default function Minimap({ myLocation, spawns = [], bearing = 0, range = 200 }) {
    const [expanded, setExpanded] = useState(false);
    const points = useMemo(() => {
        return (spawns || [])
            .map((s) => {
                const proj = projectToRadar(myLocation, s, range);
                if (!proj) return null;
                return { spawn: s, ...proj };
            })
            .filter(Boolean);
    }, [spawns, myLocation, range]);

    const SIZE = expanded ? 220 : 116;
    const PAD = SIZE * 0.06;

    return (
        <div className="absolute bottom-44 left-3 z-20" data-testid="minimap-container">
            <motion.button
                onClick={() => setExpanded((v) => !v)}
                whileTap={{ scale: 0.95 }}
                className="relative rounded-full bg-slate-900/85 backdrop-blur-sm shadow-2xl ring-2 ring-white/30 overflow-hidden focus:outline-none"
                style={{ width: SIZE, height: SIZE }}
                animate={{ width: SIZE, height: SIZE }}
                transition={{ type: "spring", stiffness: 220, damping: 22 }}
                data-testid="minimap-pill"
                aria-label="Toggle radar"
            >
                {/* Compass cardinal letters */}
                <span className="absolute top-1 left-1/2 -translate-x-1/2 text-[8px] font-black text-white/90">N</span>
                <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[8px] font-black text-white/60">S</span>
                <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[8px] font-black text-white/60">W</span>
                <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[8px] font-black text-white/60">E</span>

                {/* Inner radar disc */}
                <div
                    className="absolute rounded-full"
                    style={{
                        inset: PAD,
                        background: "radial-gradient(circle, rgba(34,197,94,0.18) 0%, rgba(15,23,42,0.55) 70%)",
                        boxShadow: "inset 0 0 18px rgba(34,197,94,0.35)",
                    }}
                />

                {/* Scan-line sweep */}
                <motion.div
                    className="absolute left-1/2 top-1/2 origin-bottom-left pointer-events-none"
                    style={{
                        width: SIZE / 2 - PAD,
                        height: SIZE / 2 - PAD,
                        background: "conic-gradient(from 0deg, rgba(34,197,94,0.55), rgba(34,197,94,0) 30%)",
                        transformOrigin: "0% 0%",
                    }}
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, ease: "linear", duration: 4 }}
                />

                {/* Self at center (with bearing arrow) */}
                <motion.div
                    className="absolute left-1/2 top-1/2"
                    animate={{ rotate: bearing }}
                    transition={{ type: "spring", stiffness: 100, damping: 16 }}
                    style={{ transform: "translate(-50%, -50%)" }}
                    data-testid="minimap-self"
                >
                    <div className="w-3 h-3 rounded-full bg-river-400 ring-2 ring-white shadow-lg" />
                </motion.div>

                {/* Spawn dots */}
                {points.map(({ spawn, x, y }) => {
                    const dotPx = expanded ? 14 : 9;
                    const seen = !!spawn._seen;
                    return (
                        <motion.div
                            key={spawn.spawn_id}
                            className="absolute rounded-full"
                            style={{
                                left: `${x * 100}%`,
                                top: `${y * 100}%`,
                                width: dotPx,
                                height: dotPx,
                                marginLeft: -dotPx / 2,
                                marginTop: -dotPx / 2,
                                background: RARITY_DOT[spawn.pokemon?.rarity] || RARITY_DOT.common,
                                border: "1.5px solid rgba(255,255,255,0.8)",
                                opacity: seen ? 1 : 0.85,
                            }}
                            animate={{ scale: [1, 1.25, 1] }}
                            transition={{ repeat: Infinity, duration: 1.4, ease: "easeInOut" }}
                            data-testid={`minimap-dot-${spawn.spawn_id}`}
                        />
                    );
                })}
            </motion.button>

            <AnimatePresence>
                {expanded && (
                    <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        className="mt-2 text-right text-[10px] font-bold uppercase tracking-widest text-white drop-shadow-lg"
                    >
                        {points.length} within {range} m
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
