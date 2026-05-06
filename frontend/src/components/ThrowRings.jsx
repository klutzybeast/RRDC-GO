import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { motion } from "framer-motion";

/**
 * Pokemon-GO style throw rings. Two concentric rings sit ON the Pokemon and
 * pulse rhythmically. Their RADIUS at the moment the camper releases the ball
 * determines the throw quality:
 *   - inner ring tight  → EXCELLENT (1.5x)
 *   - middle ring tight → GREAT     (1.3x)
 *   - outer ring tight  → NICE      (1.1x)
 *   - none tight        → no bonus
 *
 * The component drives a single shrink/grow cycle and exposes a `sample()`
 * method via ref. ARPage calls `sample()` at the moment of throw — guarantees
 * frame-accurate quality regardless of animation library timing.
 */
const RingTrio = forwardRef(function RingTrio({ active = true, size = 220 }, ref) {
    // t goes 0..1 over a 1.4s cycle: 0 = full size, 0.5 = tight, 1 = full size
    const tRef = useRef(0);
    const startRef = useRef(performance.now());

    useEffect(() => {
        if (!active) return;
        let raf;
        const tick = (now) => {
            const dt = ((now - startRef.current) / 1400) % 1;
            tRef.current = dt;
            setNow(now);
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [active]);
    const [, setNow] = useState(0);

    // sin curve so ring "breathes": 0=full, 0.5=tight, 1=full again.
    const phase = (Math.sin(tRef.current * Math.PI * 2 - Math.PI / 2) + 1) / 2; // 0..1..0
    const tight = 1 - phase; // 0=full, 1=tight

    useImperativeHandle(ref, () => ({
        // Returns: 'excellent' | 'great' | 'nice' | null
        sample() {
            // Tightness thresholds: deeper = harder.
            if (tight >= 0.85) return "excellent";
            if (tight >= 0.65) return "great";
            if (tight >= 0.40) return "nice";
            return null;
        },
        currentTight() { return tight; },
    }));

    if (!active) return null;
    // Three rings nested. Each shrinks at the same phase but at different
    // base radii. Inner ring requires near-perfect timing.
    const ringScale = 0.55 + (1 - tight) * 0.45; // 0.55..1.0
    return (
        <div className="absolute inset-0 z-[15] flex items-center justify-center pointer-events-none" data-testid="throw-rings">
            <motion.div
                className="relative"
                style={{ width: size, height: size }}
                animate={{ scale: ringScale }}
                transition={{ type: "tween", duration: 0.05 }}
            >
                {/* Outer ring — NICE zone */}
                <div
                    className="absolute inset-0 rounded-full pointer-events-none"
                    style={{
                        border: "4px solid rgba(255,255,255,0.85)",
                        boxShadow: "0 0 14px rgba(255,255,255,0.7)",
                    }}
                />
                {/* Middle ring — GREAT zone */}
                <div
                    className="absolute rounded-full pointer-events-none"
                    style={{
                        inset: "16%",
                        border: "4px solid rgba(96,165,250,0.95)",
                        boxShadow: "0 0 12px rgba(96,165,250,0.8)",
                    }}
                />
                {/* Inner ring — EXCELLENT zone */}
                <div
                    className="absolute rounded-full pointer-events-none"
                    style={{
                        inset: "34%",
                        border: "4px solid rgba(253,224,71,1)",
                        boxShadow: "0 0 14px rgba(253,224,71,0.95)",
                    }}
                />
            </motion.div>
        </div>
    );
});

export default RingTrio;
