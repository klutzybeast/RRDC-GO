import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import CampBall from "./CampBall";

/**
 * Pokemon-GO style 1-2-3 wobble sequence.
 *
 * Shows a ball that lands, wobbles up to 3 times, and then either seals
 * (success) or bursts open (the Pokemon escaped at stage N).
 *
 * Props:
 *  - ballId: which CampBall variant to render
 *  - stages: [bool, bool, bool] from backend. true = wobble held, false = broke out
 *  - success: overall result. If false and any stage is true, the ball wobbles
 *      that many times then bursts open. If success is true, all stages should be true.
 *  - onDone: called once after the full sequence finishes (success or fail)
 *  - onFail: called when the ball bursts open (so AR can flash "Dodged!")
 */
export default function BallWobbleSequence({ ballId = "pokeball", stages, success, onDone, onFail }) {
    const safe = Array.isArray(stages) && stages.length === 3 ? stages : [true, true, true];
    // How many wobble ticks to play before resolving.
    const heldCount = safe.findIndex((s) => s === false);
    const totalWobbles = heldCount === -1 ? 3 : heldCount + 1; // +1 = the failed wobble shown before burst
    const [phase, setPhase] = useState("drop"); // drop -> wobbleN -> sealed | burst
    const [tick, setTick] = useState(0);

    useEffect(() => {
        // Drop animation duration ~0.55s
        const t1 = setTimeout(() => setPhase("wobble"), 550);
        return () => clearTimeout(t1);
    }, []);

    useEffect(() => {
        if (phase !== "wobble") return;
        if (tick >= totalWobbles) {
            // Finished all scheduled wobbles
            if (success) {
                setPhase("sealed");
                setTimeout(() => onDone && onDone(true), 700);
            } else {
                setPhase("burst");
                onFail && onFail();
                setTimeout(() => onDone && onDone(false), 650);
            }
            return;
        }
        // Each wobble: 0.55s of motion + 0.25s rest
        const t = setTimeout(() => setTick((n) => n + 1), 800);
        return () => clearTimeout(t);
    }, [phase, tick, totalWobbles, success, onDone, onFail]);

    // Per-tick haptic
    useEffect(() => {
        if (phase !== "wobble" || tick === 0) return;
        if (navigator.vibrate) navigator.vibrate(30);
    }, [phase, tick]);

    return (
        <div className="absolute inset-0 z-[60] flex items-center justify-center pointer-events-none">
            <AnimatePresence>
                {phase === "drop" && (
                    <motion.div
                        key="drop"
                        initial={{ y: -200, scale: 0.4, opacity: 0 }}
                        animate={{ y: 0, scale: 1, opacity: 1 }}
                        transition={{ type: "spring", stiffness: 220, damping: 16, duration: 0.55 }}
                    >
                        <CampBall ballId={ballId} size={120} animate={false} />
                    </motion.div>
                )}
                {phase === "wobble" && (
                    <motion.div
                        key={`wobble-${tick}`}
                        initial={{ rotate: 0 }}
                        animate={{ rotate: [0, -22, 22, -16, 16, 0] }}
                        transition={{ duration: 0.55, ease: "easeInOut" }}
                        data-testid={`ball-wobble-${tick + 1}`}
                    >
                        <CampBall ballId={ballId} size={120} animate={false} />
                    </motion.div>
                )}
                {phase === "sealed" && (
                    <motion.div
                        key="sealed"
                        initial={{ scale: 1 }}
                        animate={{ scale: [1, 1.25, 1] }}
                        transition={{ duration: 0.55 }}
                        className="relative"
                        data-testid="ball-sealed"
                    >
                        {/* radiant burst */}
                        <motion.div
                            className="absolute inset-0 -m-12 rounded-full"
                            initial={{ opacity: 0.8, scale: 0.5 }}
                            animate={{ opacity: 0, scale: 2.2 }}
                            transition={{ duration: 0.6 }}
                            style={{ background: "radial-gradient(circle, rgba(253,224,71,0.95) 0%, rgba(253,224,71,0) 70%)" }}
                        />
                        <CampBall ballId={ballId} size={120} animate={false} />
                    </motion.div>
                )}
                {phase === "burst" && (
                    <motion.div
                        key="burst"
                        className="relative"
                        animate={{ scale: [1, 1.1, 0.9, 1.05, 1] }}
                        transition={{ duration: 0.5 }}
                        data-testid="ball-burst"
                    >
                        <motion.div
                            className="absolute inset-0 -m-8 rounded-full"
                            initial={{ opacity: 0.7, scale: 0.4 }}
                            animate={{ opacity: 0, scale: 1.6 }}
                            transition={{ duration: 0.5 }}
                            style={{ background: "radial-gradient(circle, rgba(248,113,113,0.85) 0%, rgba(248,113,113,0) 70%)" }}
                        />
                        <CampBall ballId={ballId} size={120} animate={false} />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
