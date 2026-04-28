import React from "react";
import { motion } from "framer-motion";

/**
 * Camp Trainer Avatar — customizable. Pure SVG, transparent background.
 *
 * Props:
 *   size: pixel size (default 88)
 *   walking: whether to animate legs/arms swinging
 *   colors: { cap, shirt, shorts, skin, hair, ring } — any subset
 */

export const DEFAULT_COLORS = {
    cap: "#1D4ED8",     // river blue
    shirt: "#10B981",   // emerald
    shorts: "#0B1A4A",  // navy
    skin: "#F2BC8F",    // medium peach
    hair: "#3B2A1A",    // dark brown
    ring: "#38BDF8",    // sky cyan footprint glow
};

// Helper: lighten a hex color for the radial-gradient inner stop
function lighten(hex, amount = 0.35) {
    const h = hex.replace("#", "");
    const num = parseInt(h, 16);
    const r = Math.min(255, Math.round(((num >> 16) & 255) + 255 * amount));
    const g = Math.min(255, Math.round(((num >> 8) & 255) + 255 * amount));
    const b = Math.min(255, Math.round((num & 255) + 255 * amount));
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

export default function TrainerAvatar({
    size = 88,
    walking = false,
    colors = {},
}) {
    const c = { ...DEFAULT_COLORS, ...colors };
    // unique gradient ids per render so multiple avatars don't share defs
    const gid = React.useId();

    return (
        <motion.div
            className="relative pointer-events-none select-none"
            style={{ width: size, height: size }}
            animate={{ y: [0, -3, 0] }}
            transition={{ repeat: Infinity, duration: 1.4, ease: "easeInOut" }}
            data-testid="trainer-avatar"
        >
            {/* Footprint glow ring */}
            <motion.div
                className="absolute inset-x-0 -bottom-2 mx-auto rounded-full"
                style={{
                    width: size * 0.85,
                    height: size * 0.28,
                    background: `radial-gradient(ellipse at center, ${c.ring}AA 0%, ${c.ring}00 65%)`,
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
                    <radialGradient id={`skin-${gid}`} cx="40%" cy="35%" r="65%">
                        <stop offset="0%" stopColor={lighten(c.skin, 0.18)} />
                        <stop offset="100%" stopColor={c.skin} />
                    </radialGradient>
                    <radialGradient id={`shirt-${gid}`} cx="40%" cy="30%" r="80%">
                        <stop offset="0%" stopColor={lighten(c.shirt, 0.25)} />
                        <stop offset="100%" stopColor={c.shirt} />
                    </radialGradient>
                    <radialGradient id={`cap-${gid}`} cx="40%" cy="30%" r="80%">
                        <stop offset="0%" stopColor={lighten(c.cap, 0.3)} />
                        <stop offset="100%" stopColor={c.cap} />
                    </radialGradient>
                    <radialGradient id={`shorts-${gid}`} cx="40%" cy="30%" r="80%">
                        <stop offset="0%" stopColor={lighten(c.shorts, 0.25)} />
                        <stop offset="100%" stopColor={c.shorts} />
                    </radialGradient>
                </defs>

                {/* Ground shadow */}
                <ellipse cx="50" cy="115" rx="22" ry="4" fill="rgba(0,0,0,0.25)" />

                {/* SHORTS (visible band of clothing) — drawn first so torso sits above */}
                <path
                    d="M30 82 Q30 78 50 78 Q70 78 70 82 L74 96 Q60 100 50 100 Q40 100 26 96 Z"
                    fill={`url(#shorts-${gid})`}
                    stroke="#0B1A4A"
                    strokeWidth="1.4"
                />

                {/* LEGS — bare skin between shorts and shoes */}
                <g>
                    <motion.rect
                        x="38" y="98" width="9" height="14" rx="2"
                        fill={`url(#skin-${gid})`} stroke="#8C5A2A" strokeWidth="1"
                        animate={walking ? { y: [98, 96, 98, 100, 98] } : {}}
                        transition={{ repeat: Infinity, duration: 0.6 }}
                    />
                    <motion.rect
                        x="53" y="98" width="9" height="14" rx="2"
                        fill={`url(#skin-${gid})`} stroke="#8C5A2A" strokeWidth="1"
                        animate={walking ? { y: [98, 100, 98, 96, 98] } : {}}
                        transition={{ repeat: Infinity, duration: 0.6 }}
                    />
                    {/* Sneakers */}
                    <ellipse cx="42.5" cy="113" rx="6.5" ry="3" fill="#FFFFFF" stroke="#0F172A" strokeWidth="1.2" />
                    <ellipse cx="57.5" cy="113" rx="6.5" ry="3" fill="#FFFFFF" stroke="#0F172A" strokeWidth="1.2" />
                </g>

                {/* TORSO (shorter, ends at the top of the shorts) */}
                <path
                    d="M30 60 Q30 52 50 52 Q70 52 70 60 L70 80 Q60 84 50 84 Q40 84 30 80 Z"
                    fill={`url(#shirt-${gid})`}
                    stroke="#0F4836"
                    strokeWidth="1.4"
                />
                {/* Belt */}
                <rect x="29" y="78" width="42" height="3" rx="1" fill="#0F4836" opacity="0.85" />
                <circle cx="50" cy="69" r="6.5" fill="#FFFFFF" stroke="#0F4836" strokeWidth="1.2" />
                <text x="50" y="72.5" textAnchor="middle" fontSize="7" fontWeight="900" fill="#0F4836" fontFamily="Arial Black, sans-serif">RR</text>

                {/* ARMS */}
                <motion.g
                    animate={walking ? { rotate: [0, -6, 0, 6, 0] } : {}}
                    transition={{ repeat: Infinity, duration: 0.6 }}
                    style={{ originX: "50px", originY: "60px" }}
                >
                    <ellipse cx="26" cy="68" rx="5.5" ry="11" fill={`url(#shirt-${gid})`} stroke="#0F4836" strokeWidth="1.4" />
                    <circle cx="24" cy="78" r="4" fill={`url(#skin-${gid})`} stroke="#8C5A2A" strokeWidth="1" />
                </motion.g>
                <motion.g
                    animate={walking ? { rotate: [0, 6, 0, -6, 0] } : {}}
                    transition={{ repeat: Infinity, duration: 0.6 }}
                    style={{ originX: "50px", originY: "60px" }}
                >
                    <ellipse cx="74" cy="68" rx="5.5" ry="11" fill={`url(#shirt-${gid})`} stroke="#0F4836" strokeWidth="1.4" />
                    <circle cx="76" cy="78" r="4" fill={`url(#skin-${gid})`} stroke="#8C5A2A" strokeWidth="1" />
                </motion.g>

                {/* NECK */}
                <rect x="46" y="48" width="8" height="6" fill={`url(#skin-${gid})`} />

                {/* HEAD */}
                <circle cx="50" cy="38" r="14" fill={`url(#skin-${gid})`} stroke="#8C5A2A" strokeWidth="1.2" />
                {/* Hair tuft */}
                <path d="M40 33 Q42 26 50 25 Q58 26 60 33 Q56 31 50 31 Q44 31 40 33 Z" fill={c.hair} />

                {/* CAP */}
                <path
                    d="M36 33 Q36 22 50 22 Q64 22 64 33 L64 36 L36 36 Z"
                    fill={`url(#cap-${gid})`}
                    stroke="#0B2545"
                    strokeWidth="1.4"
                />
                <path d="M34 36 Q35 38 50 38 Q65 38 66 36 L62 35 L38 35 Z" fill="#0B2545" />
                <circle cx="50" cy="29" r="3.4" fill="#FFFAE8" stroke="#0B2545" strokeWidth="1" />
                <circle cx="50" cy="29" r="1.6" fill="#10B981" />

                {/* Eyes */}
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
