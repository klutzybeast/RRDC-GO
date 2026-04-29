import React from "react";
import { motion } from "framer-motion";

// Camp-themed ball variants. Each ball is a distinct color scheme so kids
// can tell them apart at a glance. SVG-only so backgrounds stay transparent
// and they scale crisply on iPad retina.
export const BALL_TYPES = [
    {
        id: "pokeball",
        label: "Pokeball",
        short: "Pokeball",
        topA: "#60A5FA", topB: "#2563EB", topC: "#1D4ED8",
        botA: "#FFFAE8", botB: "#FDF6D1", botC: "#F5E9A8",
        ring: "#10B981",
        accent: "#0F172A",
        description: "Standard ball. Comes free.",
    },
    {
        id: "rayball",
        label: "Rayball",
        short: "Rayball",
        topA: "#FDE68A", topB: "#F59E0B", topC: "#D97706",
        botA: "#FFF7ED", botB: "#FED7AA", botC: "#FB923C",
        ring: "#FACC15",
        accent: "#7C2D12",
        description: "Sun-bright ball. +40% catch rate. Earned every 5 uncommons.",
    },
    {
        id: "myrtleball",
        label: "Myrtleball",
        short: "Myrtleball",
        topA: "#86EFAC", topB: "#16A34A", topC: "#166534",
        botA: "#F0FDF4", botB: "#BBF7D0", botC: "#86EFAC",
        ring: "#22C55E",
        accent: "#14532D",
        description: "Forest-leaf ball. +80% catch rate. Earned every 3 rares.",
    },
    {
        id: "lunchball",
        label: "Lunchball",
        short: "Lunchball",
        topA: "#FCA5A5", topB: "#DC2626", topC: "#7F1D1D",
        botA: "#FFFFFF", botB: "#FECACA", botC: "#F87171",
        ring: "#FB7185",
        accent: "#7F1D1D",
        description: "Sandwich-stripe ball. +150% catch rate. Earned with every legendary.",
    },
];

export const BALL_BY_ID = Object.fromEntries(BALL_TYPES.map((b) => [b.id, b]));

const CampBall = React.forwardRef(function CampBall(
    { ballId = "pokeball", size = 96, animate = true, className = "", style, ...rest },
    ref
) {
    const cfg = BALL_BY_ID[ballId] || BALL_BY_ID.pokeball;
    // Unique gradient ids per render so multiple instances on screen don't bleed.
    const uid = React.useId().replace(/:/g, "");
    return (
        <motion.div
            ref={ref}
            className={`relative inline-block ${className}`}
            style={{ width: size, height: size, ...(style || {}) }}
            animate={animate ? { y: [0, -6, 0] } : {}}
            transition={{ repeat: Infinity, duration: 1.8, ease: "easeInOut" }}
            data-testid={`camp-ball-${ballId}`}
            {...rest}
        >
            <svg
                viewBox="0 0 100 100"
                width={size}
                height={size}
                style={{ display: "block", filter: "drop-shadow(0 6px 10px rgba(0,0,0,0.45))" }}
            >
                <defs>
                    <radialGradient id={`top-${uid}`} cx="35%" cy="30%" r="70%">
                        <stop offset="0%" stopColor={cfg.topA} />
                        <stop offset="55%" stopColor={cfg.topB} />
                        <stop offset="100%" stopColor={cfg.topC} />
                    </radialGradient>
                    <radialGradient id={`bot-${uid}`} cx="35%" cy="30%" r="70%">
                        <stop offset="0%" stopColor={cfg.botA} />
                        <stop offset="70%" stopColor={cfg.botB} />
                        <stop offset="100%" stopColor={cfg.botC} />
                    </radialGradient>
                    <radialGradient id={`btn-${uid}`} cx="50%" cy="45%" r="55%">
                        <stop offset="0%" stopColor="#FFFFFF" />
                        <stop offset="100%" stopColor={cfg.botC} />
                    </radialGradient>
                    <clipPath id={`clip-${uid}`}>
                        <circle cx="50" cy="50" r="46" />
                    </clipPath>
                </defs>

                {/* Ball body */}
                <g clipPath={`url(#clip-${uid})`}>
                    <rect x="0" y="0" width="100" height="50" fill={`url(#top-${uid})`} />
                    <rect x="0" y="50" width="100" height="50" fill={`url(#bot-${uid})`} />

                    {/* Decorative accents per ball — gives each one a recognizable face */}
                    {ballId === "rayball" && (
                        <g opacity="0.85">
                            {[...Array(8)].map((_, i) => (
                                <rect key={i} x="48" y="6" width="4" height="14" fill="#FBBF24" transform={`rotate(${i * 45} 50 50)`} rx="1.5" />
                            ))}
                        </g>
                    )}
                    {ballId === "myrtleball" && (
                        <g opacity="0.9">
                            <path d="M14 18 Q 25 8 36 22 Q 25 30 14 18 Z" fill="#16A34A" />
                            <path d="M70 14 Q 80 6 90 18 Q 82 26 70 14 Z" fill="#15803D" />
                            <path d="M80 32 L 76 24 L 84 24 Z" fill="#166534" opacity="0.7" />
                        </g>
                    )}
                    {ballId === "lunchball" && (
                        <g opacity="0.95">
                            <rect x="0" y="22" width="100" height="6" fill="#FFEEDD" />
                            <rect x="0" y="32" width="100" height="3" fill="#FCA5A5" />
                            <circle cx="22" cy="36" r="3" fill="#FBBF24" />
                            <circle cx="68" cy="34" r="2.5" fill="#FBBF24" />
                        </g>
                    )}
                </g>

                {/* Outer ring */}
                <circle cx="50" cy="50" r="46" fill="none" stroke={cfg.accent} strokeWidth="3.5" />

                {/* Center band */}
                <rect x="4" y="46.5" width="92" height="7" fill={cfg.accent} />

                {/* Center button */}
                <circle cx="50" cy="50" r="11" fill={cfg.accent} />
                <circle cx="50" cy="50" r="9" fill={cfg.ring} />
                <circle cx="50" cy="50" r="6.2" fill={`url(#btn-${uid})`} />
                <circle cx="47.5" cy="47.5" r="1.8" fill="#FFFFFF" opacity="0.95" />

                {/* Subtle top highlight */}
                <ellipse cx="37" cy="28" rx="16" ry="7" fill="#FFFFFF" opacity="0.3" />
            </svg>
        </motion.div>
    );
});

export default CampBall;
