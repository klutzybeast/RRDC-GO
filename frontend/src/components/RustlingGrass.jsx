import React from "react";
import { motion } from "framer-motion";

/**
 * Pokemon-GO-style "rustling grass" indicator. Used on the map for spawns
 * younger than a threshold age (e.g. 10s) to hint that something is
 * appearing here. Pure CSS — three concentric ripples at staggered delays.
 */
export default function RustlingGrass({ size = 96 }) {
    const rings = [0, 0.4, 0.8];
    return (
        <div
            className="absolute left-1/2 top-1/2 pointer-events-none"
            style={{ width: size, height: size, transform: "translate(-50%, -50%)" }}
            data-testid="rustling-grass"
        >
            {rings.map((delay, i) => (
                <motion.span
                    key={i}
                    className="absolute inset-0 rounded-full"
                    style={{
                        border: "3px solid rgba(34,197,94,0.85)",
                        boxShadow: "0 0 18px rgba(34,197,94,0.7)",
                    }}
                    initial={{ scale: 0.3, opacity: 0.85 }}
                    animate={{ scale: 1.15, opacity: 0 }}
                    transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut", delay }}
                />
            ))}
            {/* Center bump */}
            <motion.div
                className="absolute left-1/2 top-1/2"
                style={{ transform: "translate(-50%, -50%)", width: 18, height: 18 }}
                animate={{ scale: [1, 1.25, 1], opacity: [0.85, 1, 0.85] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
            >
                <div className="w-full h-full rounded-full bg-emerald-300 shadow-md ring-2 ring-emerald-500/70" />
            </motion.div>
        </div>
    );
}
