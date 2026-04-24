import React from "react";
import { motion } from "framer-motion";

const RARITY_GLOW = {
    common: "rgba(148, 163, 184, 0.35)",
    uncommon: "rgba(34, 197, 94, 0.4)",
    rare: "rgba(59, 130, 246, 0.45)",
    legendary: "rgba(251, 191, 36, 0.55)",
};

/**
 * Renders a floating Pokemon image over the camera feed without Three.js.
 * Uses CSS 3D transforms + framer-motion for a gentle bob + rotate effect.
 *
 * Visual rules (user requested):
 *  - Main image is FULL COLOR, never dimmed or tinted
 *  - Background behind image is fully transparent (no solid box, no white square)
 *  - Only an airy radial glow sits behind the transparent PNG
 *  - No harsh drop shadow that creates "dot" artifacts on camera feed
 */
export default function PokemonOverlay({ imageUrl, rarity = "common" }) {
    const glow = RARITY_GLOW[rarity] || RARITY_GLOW.common;
    return (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
            <motion.div
                className="relative"
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 120, damping: 14 }}
            >
                {/* Soft radial glow — fully faded edges (no solid halo ring) */}
                <motion.div
                    className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none"
                    style={{
                        width: "80vmin",
                        height: "80vmin",
                        background: `radial-gradient(circle, ${glow} 0%, transparent 65%)`,
                        filter: "blur(28px)",
                    }}
                    animate={{ scale: [1, 1.08, 1], opacity: [0.7, 0.95, 0.7] }}
                    transition={{ repeat: Infinity, duration: 2.6, ease: "easeInOut" }}
                />
                {/* Floating image with bob + gentle yaw */}
                <motion.div
                    animate={{ y: [0, -14, 0], rotate: [-3, 3, -3] }}
                    transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
                    className="relative"
                >
                    {imageUrl ? (
                        <img
                            src={imageUrl}
                            alt=""
                            draggable={false}
                            className="max-w-[60vw] max-h-[55vh] object-contain"
                            style={{
                                imageRendering: "auto",
                                // Light drop shadow only — no dark blob that looks like "dots"
                                filter: "drop-shadow(0 8px 14px rgba(0,0,0,0.35))",
                            }}
                        />
                    ) : (
                        <div className="w-60 h-60 rounded-full bg-white/20 backdrop-blur-sm" />
                    )}
                </motion.div>
            </motion.div>
        </div>
    );
}
