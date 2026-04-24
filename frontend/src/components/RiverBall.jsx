import React from "react";
import { motion } from "framer-motion";

/**
 * Rolling River Ball — pure SVG so it has a truly transparent background.
 * Camp colors: river-blue top, cream bottom, cream center button with emerald ring.
 * Replaces the old PNG asset that had a white box around it.
 */
export const RiverBall = React.forwardRef(function RiverBall(
    { size = 96, animate = true, className = "", ...rest },
    ref
) {
    return (
        <motion.div
            ref={ref}
            className={`relative inline-block ${className}`}
            style={{ width: size, height: size }}
            animate={animate ? { y: [0, -6, 0] } : {}}
            transition={{ repeat: Infinity, duration: 1.8, ease: "easeInOut" }}
            {...rest}
        >
            <svg
                viewBox="0 0 100 100"
                width={size}
                height={size}
                style={{ display: "block", filter: "drop-shadow(0 6px 10px rgba(0,0,0,0.45))" }}
            >
                <defs>
                    <radialGradient id="rb-top" cx="35%" cy="30%" r="70%">
                        <stop offset="0%" stopColor="#60A5FA" />
                        <stop offset="55%" stopColor="#2563EB" />
                        <stop offset="100%" stopColor="#1D4ED8" />
                    </radialGradient>
                    <radialGradient id="rb-bot" cx="35%" cy="30%" r="70%">
                        <stop offset="0%" stopColor="#FFFAE8" />
                        <stop offset="70%" stopColor="#FDF6D1" />
                        <stop offset="100%" stopColor="#F5E9A8" />
                    </radialGradient>
                    <radialGradient id="rb-btn" cx="50%" cy="45%" r="55%">
                        <stop offset="0%" stopColor="#FFFFFF" />
                        <stop offset="100%" stopColor="#F5E9A8" />
                    </radialGradient>
                    <clipPath id="rb-clip">
                        <circle cx="50" cy="50" r="46" />
                    </clipPath>
                </defs>

                {/* Ball body */}
                <g clipPath="url(#rb-clip)">
                    <rect x="0" y="0" width="100" height="50" fill="url(#rb-top)" />
                    <rect x="0" y="50" width="100" height="50" fill="url(#rb-bot)" />
                </g>

                {/* Outer ring */}
                <circle cx="50" cy="50" r="46" fill="none" stroke="#0F172A" strokeWidth="3.5" />

                {/* Center band */}
                <rect x="4" y="46.5" width="92" height="7" fill="#0F172A" />

                {/* Center button — emerald ring (Rolling River green) */}
                <circle cx="50" cy="50" r="11" fill="#0F172A" />
                <circle cx="50" cy="50" r="9" fill="#10B981" />
                <circle cx="50" cy="50" r="6.2" fill="url(#rb-btn)" />
                <circle cx="47.5" cy="47.5" r="1.8" fill="#FFFFFF" opacity="0.95" />

                {/* Subtle top highlight */}
                <ellipse cx="37" cy="28" rx="16" ry="7" fill="#FFFFFF" opacity="0.3" />
            </svg>
        </motion.div>
    );
});

export default RiverBall;
