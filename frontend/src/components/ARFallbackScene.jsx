import React from "react";
import { motion } from "framer-motion";

/**
 * Cartoony Pokemon-GO-inspired backdrop shown on the AR page when the user
 * turns off the camera. Pure SVG + CSS — no external assets, scales perfectly,
 * and animates gently (clouds drift, sun rays pulse, grass blades sway).
 */
export default function ARFallbackScene() {
    return (
        <div className="absolute inset-0 z-[1] overflow-hidden" data-testid="ar-fallback-scene">
            {/* Sky gradient */}
            <div
                className="absolute inset-0"
                style={{
                    background:
                        "linear-gradient(180deg, #6BCBFF 0%, #B6E6FF 35%, #DFF7FA 55%, #C7EFA4 65%, #93D87A 85%, #5BB258 100%)",
                }}
            />

            {/* Sun with rays */}
            <motion.div
                className="absolute"
                style={{ top: "10%", right: "12%", width: 120, height: 120 }}
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 60, ease: "linear" }}
            >
                <svg viewBox="0 0 120 120" width="120" height="120">
                    {[...Array(12)].map((_, i) => (
                        <rect
                            key={i}
                            x="58"
                            y="4"
                            width="4"
                            height="20"
                            fill="#FFE066"
                            transform={`rotate(${i * 30} 60 60)`}
                            opacity="0.85"
                            rx="2"
                        />
                    ))}
                </svg>
            </motion.div>
            <div
                className="absolute rounded-full"
                style={{
                    top: "13%",
                    right: "15%",
                    width: 80,
                    height: 80,
                    background: "radial-gradient(circle at 35% 35%, #FFF7B0 0%, #FFD23F 70%, #F5A623 100%)",
                    boxShadow: "0 0 60px rgba(255, 210, 63, 0.6)",
                }}
            />

            {/* Drifting clouds */}
            {[
                { top: "16%", size: 90, delay: 0, dur: 50 },
                { top: "8%", size: 60, delay: 8, dur: 45 },
                { top: "24%", size: 110, delay: 18, dur: 60 },
                { top: "5%", size: 70, delay: 28, dur: 52 },
            ].map((c, i) => (
                <motion.div
                    key={i}
                    className="absolute"
                    style={{ top: c.top, left: -150, width: c.size * 2, height: c.size }}
                    animate={{ x: [0, window.innerWidth + 300] }}
                    transition={{ repeat: Infinity, duration: c.dur, delay: c.delay, ease: "linear" }}
                >
                    <svg viewBox="0 0 200 100" width="100%" height="100%">
                        <ellipse cx="50" cy="60" rx="38" ry="28" fill="#FFFFFF" opacity="0.95" />
                        <ellipse cx="90" cy="50" rx="48" ry="34" fill="#FFFFFF" opacity="0.95" />
                        <ellipse cx="135" cy="58" rx="40" ry="28" fill="#FFFFFF" opacity="0.95" />
                        <ellipse cx="170" cy="65" rx="28" ry="22" fill="#FFFFFF" opacity="0.95" />
                    </svg>
                </motion.div>
            ))}

            {/* Distant rolling hills */}
            <svg
                className="absolute"
                viewBox="0 0 800 200"
                preserveAspectRatio="none"
                style={{ left: 0, right: 0, bottom: "32%", width: "100%", height: "22%" }}
            >
                <path d="M0 130 Q 100 60 200 100 T 400 80 T 600 110 T 800 70 L 800 200 L 0 200 Z" fill="#9DD680" opacity="0.85" />
                <path d="M0 160 Q 150 100 300 140 T 600 130 T 800 110 L 800 200 L 0 200 Z" fill="#7AC367" opacity="0.95" />
            </svg>

            {/* Foreground grass / hill */}
            <svg
                className="absolute"
                viewBox="0 0 800 250"
                preserveAspectRatio="none"
                style={{ left: 0, right: 0, bottom: 0, width: "100%", height: "42%" }}
            >
                <defs>
                    <linearGradient id="gscene-grass" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="#6FCF6A" />
                        <stop offset="100%" stopColor="#3F9E47" />
                    </linearGradient>
                </defs>
                <path
                    d="M0 60 Q 200 -10 400 40 T 800 30 L 800 250 L 0 250 Z"
                    fill="url(#gscene-grass)"
                />
                {/* Grass tufts */}
                {[...Array(28)].map((_, i) => {
                    const x = 30 + i * 28 + (i % 3) * 5;
                    const y = 70 + (i % 5) * 12;
                    return (
                        <g key={i}>
                            <path d={`M${x} ${y + 14} L${x + 4} ${y} L${x + 8} ${y + 14} Z`} fill="#2F8A3F" opacity="0.85" />
                            <path d={`M${x + 3} ${y + 18} L${x + 8} ${y + 4} L${x + 13} ${y + 18} Z`} fill="#4FAE56" />
                        </g>
                    );
                })}
            </svg>

            {/* Pokestop-style pillar in the distance */}
            <motion.div
                className="absolute"
                style={{ left: "20%", bottom: "44%", width: 32, height: 60 }}
                animate={{ y: [0, -2, 0] }}
                transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
            >
                <svg viewBox="0 0 32 60" width="100%" height="100%">
                    <rect x="13" y="18" width="6" height="38" fill="#94A3B8" />
                    <circle cx="16" cy="14" r="13" fill="#3B82F6" stroke="#1E40AF" strokeWidth="2" />
                    <circle cx="16" cy="14" r="6" fill="#FFFFFF" opacity="0.9" />
                    <ellipse cx="13" cy="11" rx="3" ry="2" fill="#FFFFFF" />
                </svg>
            </motion.div>

            {/* Tiny gym tower on the right */}
            <motion.div
                className="absolute"
                style={{ right: "18%", bottom: "46%", width: 40, height: 70 }}
                animate={{ y: [0, -3, 0] }}
                transition={{ repeat: Infinity, duration: 3.5, ease: "easeInOut", delay: 0.6 }}
            >
                <svg viewBox="0 0 40 70" width="100%" height="100%">
                    <rect x="14" y="25" width="12" height="40" fill="#64748B" />
                    <polygon points="20,4 6,28 34,28" fill="#F472B6" stroke="#9D174D" strokeWidth="2" />
                    <circle cx="20" cy="22" r="4" fill="#FFFFFF" />
                </svg>
            </motion.div>

            {/* Soft vignette to focus attention center */}
            <div
                className="absolute inset-0 pointer-events-none"
                style={{
                    background:
                        "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.25) 100%)",
                }}
            />
        </div>
    );
}
