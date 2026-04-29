import React, { useMemo } from "react";
import { motion } from "framer-motion";

/**
 * Cartoony Pokemon-GO-inspired backdrop shown on the AR page when the user
 * turns off the camera. Themes by time-of-day and live weather:
 *   sunny | partly_cloudy | cloudy | rain | thunder | snow | fog | windy |
 *   cold_clear | clear_night
 *
 * Pure SVG + CSS — no external assets. Scales perfectly, animates gently
 * (clouds drift, rain falls, snow flutters, lightning flashes).
 */

const NIGHT_CONDITIONS = new Set([
    "clear_night",
]);

// Sky gradient for each scene. Top → mid → horizon glow.
const SKY = {
    sunny:        ["#6BCBFF", "#B6E6FF", "#DFF7FA"],
    partly_cloudy:["#7FCBEB", "#BCE0EE", "#E5F2F4"],
    cloudy:       ["#7E8FA1", "#A6B5C2", "#CBD3DB"],
    rain:         ["#3E4F61", "#5C6E80", "#7C8B97"],
    thunder:      ["#1F2533", "#3A3F4F", "#525766"],
    snow:         ["#9FB3C8", "#D6E2EC", "#F1F5F9"],
    fog:          ["#A7B2BB", "#C5CCD2", "#DFE3E6"],
    windy:        ["#5DB7E3", "#9CD3EE", "#D7EEF7"],
    cold_clear:   ["#74A4D6", "#B6CDE3", "#E0EAF3"],
    clear_night:  ["#0B1530", "#152347", "#22325E"],
};

// Foreground grass tone — switches between day & dusk green.
const GRASS = {
    day:   { top: "#6FCF6A", bottom: "#3F9E47", tuft1: "#2F8A3F", tuft2: "#4FAE56" },
    night: { top: "#1B3F2C", bottom: "#0E2419", tuft1: "#0B1F12", tuft2: "#244F35" },
    rain:  { top: "#4F8C5A", bottom: "#2D6A3A", tuft1: "#1F4D27", tuft2: "#3A7A48" },
    snow:  { top: "#E8F0F4", bottom: "#BFD0DA", tuft1: "#9CB1BD", tuft2: "#CFDEE5" },
};

const HILL_COLORS = {
    day:   { far: "#9DD680", near: "#7AC367" },
    night: { far: "#1F3A2A", near: "#13261B" },
    snow:  { far: "#C9D8E0", near: "#9FB6C2" },
};

function pickGrass(condition, isDay) {
    if (condition === "snow") return GRASS.snow;
    if (condition === "rain" || condition === "thunder") return GRASS.rain;
    return isDay ? GRASS.day : GRASS.night;
}

function pickHills(condition, isDay) {
    if (condition === "snow") return HILL_COLORS.snow;
    return isDay ? HILL_COLORS.day : HILL_COLORS.night;
}

export default function ARFallbackScene({ ambient }) {
    const condition = ambient?.condition || "sunny";
    const isDay = ambient?.is_day !== undefined ? !!ambient.is_day : !NIGHT_CONDITIONS.has(condition);
    const sky = SKY[condition] || SKY.sunny;
    const grass = pickGrass(condition, isDay);
    const hills = pickHills(condition, isDay);

    const showSun = isDay && (condition === "sunny" || condition === "partly_cloudy" || condition === "windy" || condition === "cold_clear");
    const showMoon = !isDay;
    const showStars = !isDay && (condition === "clear_night" || condition === "cold_clear");
    const showClouds = condition === "sunny" || condition === "partly_cloudy" || condition === "cloudy" || condition === "windy";
    const showHeavyClouds = condition === "rain" || condition === "thunder" || condition === "snow";
    const showRain = condition === "rain" || condition === "thunder";
    const showLightning = condition === "thunder";
    const showSnow = condition === "snow";
    const showFog = condition === "fog";
    const cloudSpeed = condition === "windy" ? 18 : condition === "cloudy" ? 60 : 45;
    const treeSwayDeg = condition === "windy" ? 4 : condition === "thunder" ? 2 : 1;

    const stars = useMemo(() => {
        if (!showStars) return [];
        // Deterministic-ish tiny stars
        return Array.from({ length: 60 }).map((_, i) => ({
            x: (i * 53 + 7) % 100,
            y: (i * 31 + 11) % 45,
            r: 0.6 + ((i * 7) % 5) * 0.2,
            o: 0.5 + ((i * 13) % 5) * 0.1,
        }));
    }, [showStars]);

    const raindrops = useMemo(() => {
        if (!showRain) return [];
        const heavy = condition === "thunder";
        const count = heavy ? 90 : 60;
        return Array.from({ length: count }).map((_, i) => ({
            x: (i * 37 + (i % 7) * 11) % 100,
            delay: ((i * 17) % 100) / 100,
            dur: 0.5 + ((i * 3) % 5) * 0.1,
            len: heavy ? 18 : 14,
            opacity: 0.55 + ((i * 5) % 4) * 0.1,
        }));
    }, [showRain, condition]);

    const snowflakes = useMemo(() => {
        if (!showSnow) return [];
        return Array.from({ length: 70 }).map((_, i) => ({
            x: (i * 41 + 5) % 100,
            delay: ((i * 13) % 100) / 100 * 6,
            dur: 6 + ((i * 5) % 6),
            size: 2 + ((i * 7) % 4),
            drift: ((i * 11) % 7) - 3,
        }));
    }, [showSnow]);

    return (
        <div className="absolute inset-0 z-[1] overflow-hidden" data-testid="ar-fallback-scene" data-condition={condition} data-is-day={isDay ? "1" : "0"}>
            {/* Sky gradient */}
            <div
                className="absolute inset-0"
                style={{
                    background: isDay
                        ? `linear-gradient(180deg, ${sky[0]} 0%, ${sky[1]} 35%, ${sky[2]} 55%, ${grass.top} 65%, ${grass.bottom} 100%)`
                        : `linear-gradient(180deg, ${sky[0]} 0%, ${sky[1]} 45%, ${sky[2]} 65%, ${grass.top} 75%, ${grass.bottom} 100%)`,
                }}
            />

            {/* Stars (night) */}
            {showStars && (
                <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none" viewBox="0 0 100 100">
                    {stars.map((s, i) => (
                        <circle key={i} cx={s.x} cy={s.y} r={s.r * 0.15} fill="#FFFFFF" opacity={s.o}>
                            <animate attributeName="opacity" values={`${s.o};${s.o * 0.4};${s.o}`} dur={`${2 + (i % 4)}s`} repeatCount="indefinite" />
                        </circle>
                    ))}
                </svg>
            )}

            {/* Sun */}
            {showSun && (
                <>
                    <motion.div
                        className="absolute"
                        style={{ top: "10%", right: "12%", width: 120, height: 120 }}
                        animate={{ rotate: 360 }}
                        transition={{ repeat: Infinity, duration: 60, ease: "linear" }}
                    >
                        <svg viewBox="0 0 120 120" width="120" height="120">
                            {[...Array(12)].map((_, i) => (
                                <rect key={i} x="58" y="4" width="4" height="20" fill="#FFE066" transform={`rotate(${i * 30} 60 60)`} opacity="0.85" rx="2" />
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
                </>
            )}

            {/* Moon */}
            {showMoon && (
                <div
                    className="absolute rounded-full"
                    style={{
                        top: "11%",
                        left: "12%",
                        width: 78,
                        height: 78,
                        background: "radial-gradient(circle at 35% 30%, #FFF8E0 0%, #E8E2C1 60%, #B8B597 100%)",
                        boxShadow: "0 0 70px rgba(255, 248, 224, 0.35)",
                    }}
                />
            )}

            {/* Drifting clouds */}
            {showClouds && (
                <>
                    {[
                        { top: "16%", size: 90, delay: 0, dur: cloudSpeed },
                        { top: "8%", size: 60, delay: 8, dur: cloudSpeed * 0.9 },
                        { top: "24%", size: 110, delay: 18, dur: cloudSpeed * 1.2 },
                        { top: "5%", size: 70, delay: 28, dur: cloudSpeed * 1.05 },
                    ].map((c, i) => (
                        <motion.div
                            key={i}
                            className="absolute"
                            style={{ top: c.top, left: -150, width: c.size * 2, height: c.size }}
                            animate={{ x: [0, (typeof window !== "undefined" ? window.innerWidth : 1024) + 300] }}
                            transition={{ repeat: Infinity, duration: c.dur, delay: c.delay, ease: "linear" }}
                        >
                            <svg viewBox="0 0 200 100" width="100%" height="100%">
                                <ellipse cx="50" cy="60" rx="38" ry="28" fill={isDay ? "#FFFFFF" : "#A8B4C8"} opacity={isDay ? 0.95 : 0.7} />
                                <ellipse cx="90" cy="50" rx="48" ry="34" fill={isDay ? "#FFFFFF" : "#A8B4C8"} opacity={isDay ? 0.95 : 0.7} />
                                <ellipse cx="135" cy="58" rx="40" ry="28" fill={isDay ? "#FFFFFF" : "#A8B4C8"} opacity={isDay ? 0.95 : 0.7} />
                                <ellipse cx="170" cy="65" rx="28" ry="22" fill={isDay ? "#FFFFFF" : "#A8B4C8"} opacity={isDay ? 0.95 : 0.7} />
                            </svg>
                        </motion.div>
                    ))}
                </>
            )}

            {/* Heavy storm/snow clouds */}
            {showHeavyClouds && (
                <svg className="absolute" viewBox="0 0 800 220" preserveAspectRatio="none" style={{ left: 0, right: 0, top: 0, width: "100%", height: "32%" }}>
                    <ellipse cx="120" cy="100" rx="160" ry="60" fill={condition === "snow" ? "#E5ECF2" : "#3E4955"} opacity="0.9" />
                    <ellipse cx="350" cy="80" rx="200" ry="70" fill={condition === "snow" ? "#DCE5EC" : "#454F5C"} opacity="0.9" />
                    <ellipse cx="600" cy="95" rx="180" ry="65" fill={condition === "snow" ? "#E5ECF2" : "#3E4955"} opacity="0.9" />
                    <ellipse cx="780" cy="80" rx="120" ry="55" fill={condition === "snow" ? "#DCE5EC" : "#454F5C"} opacity="0.9" />
                </svg>
            )}

            {/* Rain */}
            {showRain && (
                <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none" viewBox="0 0 100 100">
                    {raindrops.map((d, i) => (
                        <line
                            key={i}
                            x1={d.x}
                            x2={d.x - 1.5}
                            y1={-5}
                            y2={-5 + d.len / 4}
                            stroke="#BFE0FF"
                            strokeWidth="0.4"
                            opacity={d.opacity}
                        >
                            <animate attributeName="y1" values="-5;110" dur={`${d.dur}s`} begin={`${d.delay}s`} repeatCount="indefinite" />
                            <animate attributeName="y2" values={`${-5 + d.len / 4};${110 + d.len / 4}`} dur={`${d.dur}s`} begin={`${d.delay}s`} repeatCount="indefinite" />
                        </line>
                    ))}
                </svg>
            )}

            {/* Lightning flash overlay */}
            {showLightning && (
                <motion.div
                    className="absolute inset-0 bg-white pointer-events-none"
                    animate={{ opacity: [0, 0, 0.8, 0, 0, 0, 0.5, 0, 0] }}
                    transition={{ repeat: Infinity, duration: 7, times: [0, 0.45, 0.47, 0.5, 0.6, 0.85, 0.87, 0.9, 1], ease: "easeOut" }}
                />
            )}

            {/* Snow */}
            {showSnow && (
                <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none" viewBox="0 0 100 100">
                    {snowflakes.map((f, i) => (
                        <circle key={i} cx={f.x} cy={-2} r={f.size * 0.18} fill="#FFFFFF" opacity="0.9">
                            <animate attributeName="cy" values={`-2;110`} dur={`${f.dur}s`} begin={`${f.delay}s`} repeatCount="indefinite" />
                            <animate attributeName="cx" values={`${f.x};${f.x + f.drift};${f.x}`} dur={`${f.dur}s`} begin={`${f.delay}s`} repeatCount="indefinite" />
                        </circle>
                    ))}
                </svg>
            )}

            {/* Fog overlay */}
            {showFog && (
                <>
                    <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(180deg, rgba(220,225,230,0.0) 0%, rgba(220,225,230,0.5) 35%, rgba(220,225,230,0.75) 70%, rgba(220,225,230,0.85) 100%)" }} />
                    <motion.div
                        className="absolute pointer-events-none"
                        style={{ left: 0, right: 0, top: "50%", height: "30%", background: "radial-gradient(ellipse at center, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 70%)" }}
                        animate={{ x: [-40, 40, -40] }}
                        transition={{ repeat: Infinity, duration: 12, ease: "easeInOut" }}
                    />
                </>
            )}

            {/* Distant tree-line silhouette (Pokemon GO style) */}
            <svg
                className="absolute"
                viewBox="0 0 800 200"
                preserveAspectRatio="none"
                style={{ left: 0, right: 0, bottom: "32%", width: "100%", height: "26%" }}
            >
                <motion.g
                    animate={{ rotate: [-treeSwayDeg, treeSwayDeg, -treeSwayDeg] }}
                    transition={{ repeat: Infinity, duration: condition === "windy" ? 2 : 5, ease: "easeInOut" }}
                    style={{ transformOrigin: "400px 200px" }}
                >
                    {/* Tree silhouette band — multiple bumpy tops to read as a forest */}
                    <path d="M0 130 Q 30 80 60 110 Q 90 50 120 100 Q 160 30 200 90 Q 240 60 280 110 Q 320 40 360 100 Q 400 70 440 110 Q 480 30 520 100 Q 560 60 600 110 Q 640 40 680 100 Q 720 70 760 110 Q 790 80 800 100 L 800 200 L 0 200 Z" fill={hills.far} opacity="0.95" />
                    <path d="M0 160 Q 80 110 160 150 Q 240 100 320 140 Q 400 110 480 150 Q 560 100 640 140 Q 720 120 800 150 L 800 200 L 0 200 Z" fill={hills.near} />
                    {/* Pointy individual trees */}
                    {[60, 140, 220, 300, 380, 460, 540, 620, 700, 770].map((x, i) => (
                        <g key={i}>
                            <path d={`M${x - 16} 150 L${x} 80 L${x + 16} 150 Z`} fill={hills.far} />
                            <path d={`M${x - 12} 165 L${x} 100 L${x + 12} 165 Z`} fill={hills.near} />
                        </g>
                    ))}
                </motion.g>
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
                        <stop offset="0%" stopColor={grass.top} />
                        <stop offset="100%" stopColor={grass.bottom} />
                    </linearGradient>
                </defs>
                <path d="M0 60 Q 200 -10 400 40 T 800 30 L 800 250 L 0 250 Z" fill="url(#gscene-grass)" />
                {/* Grass tufts */}
                {[...Array(28)].map((_, i) => {
                    const x = 30 + i * 28 + (i % 3) * 5;
                    const y = 70 + (i % 5) * 12;
                    return (
                        <g key={i}>
                            <path d={`M${x} ${y + 14} L${x + 4} ${y} L${x + 8} ${y + 14} Z`} fill={grass.tuft1} opacity="0.85" />
                            <path d={`M${x + 3} ${y + 18} L${x + 8} ${y + 4} L${x + 13} ${y + 18} Z`} fill={grass.tuft2} />
                        </g>
                    );
                })}
                {/* Snow on the ground */}
                {showSnow && (
                    <path d="M0 70 Q 200 30 400 55 T 800 50 L 800 90 Q 600 75 400 80 T 0 95 Z" fill="#FFFFFF" opacity="0.9" />
                )}
            </svg>

            {/* Soft vignette to focus attention center */}
            <div
                className="absolute inset-0 pointer-events-none"
                style={{
                    background: "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.25) 100%)",
                }}
            />
        </div>
    );
}
