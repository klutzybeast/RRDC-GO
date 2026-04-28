import React from "react";
import { motion } from "framer-motion";

/**
 * Camp Trainer Avatar — replaces the standard "blue dot" location marker
 * with a Pokemon GO–style 3D-feeling chibi character. Pure SVG so it scales
 * cleanly and has a transparent background.
 *
 * Visuals: river-blue baseball cap, cream face, emerald shirt with "RR" badge,
 * navy shorts. Bobs gently in place + a soft footprint ring underneath.
 */
export default function TrainerAvatar({ size = 88, walking = false }) {
    return (
        <motion.div
            className="relative pointer-events-none select-none"
            style={{ width: size, height: size }}
            animate={{ y: [0, -3, 0] }}
            transition={{ repeat: Infinity, duration: 1.4, ease: "easeInOut" }}
            data-testid="trainer-avatar"
        >
            {/* Footprint glow ring — Pokemon GO style "you are here" */}
            <motion.div
                className="absolute inset-x-0 -bottom-2 mx-auto rounded-full"
                style={{
                    width: size * 0.85,
                    height: size * 0.28,
                    background: "radial-gradient(ellipse at center, rgba(56,189,248,0.55) 0%, rgba(56,189,248,0) 65%)",
                    filter: "blur(2px)",
                }}
                animate={{ scale: [1, 1.08, 1], opacity: [0.7, 1, 0.7] }}
                transition={{ repeat: Infinity, duration: 1.6 }}
            />
            <svg
                viewBox="0 0 100 120"
                width={size}
                height={size}
                style={{
                    display: "block",
                    overflow: "visible",
                    filter: "drop-shadow(0 6px 6px rgba(0,0,0,0.35))",
                }}
            >
                <defs>
                    <radialGradient id="ta-skin" cx="40%" cy="35%" r="65%">
                        <stop offset="0%" stopColor="#FFE3C2" />
                        <stop offset="100%" stopColor="#F2BC8F" />
                    </radialGradient>
                    <radialGradient id="ta-shirt" cx="40%" cy="30%" r="80%">
                        <stop offset="0%" stopColor="#34D399" />
                        <stop offset="100%" stopColor="#0E8F5E" />
                    </radialGradient>
                    <radialGradient id="ta-cap" cx="40%" cy="30%" r="80%">
                        <stop offset="0%" stopColor="#60A5FA" />
                        <stop offset="100%" stopColor="#1D4ED8" />
                    </radialGradient>
                    <radialGradient id="ta-shorts" cx="40%" cy="30%" r="80%">
                        <stop offset="0%" stopColor="#1E3A8A" />
                        <stop offset="100%" stopColor="#0B1A4A" />
                    </radialGradient>
                </defs>

                {/* Shadow on the ground (slightly darker) */}
                <ellipse cx="50" cy="115" rx="22" ry="4" fill="rgba(0,0,0,0.25)" />

                {/* LEGS */}
                <g>
                    <motion.rect
                        x="38" y="86" width="9" height="22" rx="3"
                        fill="url(#ta-shorts)" stroke="#0B1A4A" strokeWidth="1.2"
                        animate={walking ? { y: [86, 84, 86, 88, 86] } : {}}
                        transition={{ repeat: Infinity, duration: 0.6 }}
                    />
                    <motion.rect
                        x="53" y="86" width="9" height="22" rx="3"
                        fill="url(#ta-shorts)" stroke="#0B1A4A" strokeWidth="1.2"
                        animate={walking ? { y: [86, 88, 86, 84, 86] } : {}}
                        transition={{ repeat: Infinity, duration: 0.6 }}
                    />
                    {/* Sneakers */}
                    <ellipse cx="42.5" cy="111" rx="6.5" ry="3" fill="#FFFFFF" stroke="#0F172A" strokeWidth="1.2" />
                    <ellipse cx="57.5" cy="111" rx="6.5" ry="3" fill="#FFFFFF" stroke="#0F172A" strokeWidth="1.2" />
                </g>

                {/* TORSO — emerald shirt with RR badge */}
                <path
                    d="M30 60 Q30 52 50 52 Q70 52 70 60 L72 90 Q60 95 50 95 Q40 95 28 90 Z"
                    fill="url(#ta-shirt)"
                    stroke="#0F4836"
                    strokeWidth="1.4"
                />
                {/* Belt accent */}
                <rect x="29" y="86" width="42" height="4" rx="1" fill="#0F4836" opacity="0.7" />
                {/* RR badge */}
                <circle cx="50" cy="72" r="6.5" fill="#FFFFFF" stroke="#0F4836" strokeWidth="1.2" />
                <text x="50" y="75.5" textAnchor="middle" fontSize="7" fontWeight="900" fill="#0F4836" fontFamily="Arial Black, sans-serif">RR</text>

                {/* ARMS */}
                <motion.g
                    animate={walking ? { rotate: [0, -6, 0, 6, 0] } : {}}
                    transition={{ repeat: Infinity, duration: 0.6 }}
                    style={{ originX: "50px", originY: "60px" }}
                >
                    <ellipse cx="26" cy="68" rx="5.5" ry="11" fill="url(#ta-shirt)" stroke="#0F4836" strokeWidth="1.4" />
                    <circle cx="24" cy="78" r="4" fill="url(#ta-skin)" stroke="#8C5A2A" strokeWidth="1" />
                </motion.g>
                <motion.g
                    animate={walking ? { rotate: [0, 6, 0, -6, 0] } : {}}
                    transition={{ repeat: Infinity, duration: 0.6 }}
                    style={{ originX: "50px", originY: "60px" }}
                >
                    <ellipse cx="74" cy="68" rx="5.5" ry="11" fill="url(#ta-shirt)" stroke="#0F4836" strokeWidth="1.4" />
                    <circle cx="76" cy="78" r="4" fill="url(#ta-skin)" stroke="#8C5A2A" strokeWidth="1" />
                </motion.g>

                {/* NECK */}
                <rect x="46" y="48" width="8" height="6" fill="url(#ta-skin)" />

                {/* HEAD */}
                <circle cx="50" cy="38" r="14" fill="url(#ta-skin)" stroke="#8C5A2A" strokeWidth="1.2" />
                {/* Hair tuft */}
                <path d="M40 33 Q42 26 50 25 Q58 26 60 33 Q56 31 50 31 Q44 31 40 33 Z" fill="#3B2A1A" />

                {/* CAP — river blue with white visor */}
                <path
                    d="M36 33 Q36 22 50 22 Q64 22 64 33 L64 36 L36 36 Z"
                    fill="url(#ta-cap)"
                    stroke="#0B2545"
                    strokeWidth="1.4"
                />
                {/* Cap visor */}
                <path d="M34 36 Q35 38 50 38 Q65 38 66 36 L62 35 L38 35 Z" fill="#0B2545" />
                {/* Cap front emblem */}
                <circle cx="50" cy="29" r="3.4" fill="#FFFAE8" stroke="#0B2545" strokeWidth="1" />
                <circle cx="50" cy="29" r="1.6" fill="#10B981" />

                {/* Eyes (smile-style) */}
                <circle cx="44.5" cy="40" r="1.5" fill="#0F172A" />
                <circle cx="55.5" cy="40" r="1.5" fill="#0F172A" />
                <circle cx="44.7" cy="39.4" r="0.5" fill="#FFFFFF" />
                <circle cx="55.7" cy="39.4" r="0.5" fill="#FFFFFF" />

                {/* Smile */}
                <path d="M45 45 Q50 48 55 45" stroke="#0F172A" strokeWidth="1.4" fill="none" strokeLinecap="round" />
                {/* Cheeks */}
                <circle cx="42" cy="44" r="2" fill="#F87171" opacity="0.6" />
                <circle cx="58" cy="44" r="2" fill="#F87171" opacity="0.6" />
            </svg>
        </motion.div>
    );
}
