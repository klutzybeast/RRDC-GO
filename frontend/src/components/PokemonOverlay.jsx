import React from "react";
import { motion } from "framer-motion";

const RARITY_GLOW = {
    common: "rgba(148, 163, 184, 0.55)",
    uncommon: "rgba(34, 197, 94, 0.55)",
    rare: "rgba(59, 130, 246, 0.6)",
    legendary: "rgba(251, 191, 36, 0.7)",
};

/**
 * Renders a floating Pokemon image over the camera feed without Three.js.
 * Uses CSS 3D transforms + framer-motion for a gentle bob + rotate effect.
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
                {/* Rarity glow halo */}
                <motion.div
                    className="absolute -inset-10 rounded-full blur-3xl"
                    style={{ background: glow }}
                    animate={{ scale: [1, 1.1, 1], opacity: [0.6, 0.9, 0.6] }}
                    transition={{ repeat: Infinity, duration: 2.4, ease: "easeInOut" }}
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
                            className="max-w-[60vw] max-h-[55vh] object-contain drop-shadow-[0_20px_40px_rgba(0,0,0,0.7)]"
                            style={{ imageRendering: "auto" }}
                        />
                    ) : (
                        <div className="w-60 h-60 rounded-full bg-white/40 backdrop-blur" />
                    )}
                </motion.div>
                {/* Shadow below */}
                <motion.div
                    className="absolute left-1/2 -translate-x-1/2 -bottom-4 w-32 h-4 bg-black/40 rounded-full blur-md"
                    animate={{ scale: [0.9, 1.1, 0.9], opacity: [0.5, 0.3, 0.5] }}
                    transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
                />
            </motion.div>
        </div>
    );
}
