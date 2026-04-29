import React from "react";
import { motion } from "framer-motion";
import CampBall, { BALL_TYPES } from "./CampBall";

/**
 * Horizontal row of ball pickers shown above the throw area on the AR page.
 * Disabled (grayscale + lock icon) if the camper has 0 of that ball.
 */
export default function BallSelector({ selected, onSelect, balances = {}, earnProgress = {} }) {
    return (
        <div className="flex items-center justify-center gap-2 px-2" data-testid="ball-selector">
            {BALL_TYPES.map((b) => {
                const count = Number(balances[b.id] || 0);
                const isSel = selected === b.id;
                const owned = count > 0;
                const prog = earnProgress[b.id];
                return (
                    <motion.button
                        key={b.id}
                        type="button"
                        onClick={() => owned && onSelect && onSelect(b.id)}
                        disabled={!owned}
                        whileTap={owned ? { scale: 0.92 } : {}}
                        className={`relative flex flex-col items-center justify-center rounded-2xl px-2 py-2 transition-all ${
                            isSel
                                ? "bg-white/20 ring-2 ring-white shadow-lg"
                                : "bg-white/5 ring-1 ring-white/15 hover:bg-white/10"
                        } ${!owned ? "opacity-50" : ""}`}
                        style={{ minWidth: 64 }}
                        data-testid={`ball-pick-${b.id}`}
                        aria-label={`${b.label} — ${count} owned`}
                    >
                        <div style={{ filter: !owned ? "grayscale(0.85)" : undefined }}>
                            <CampBall ballId={b.id} size={isSel ? 52 : 44} animate={isSel} />
                        </div>
                        <div className="text-[10px] font-bold uppercase tracking-widest text-white mt-1 leading-none">
                            {b.short}
                        </div>
                        <div className="text-[11px] font-bold tabular-nums text-white/95" data-testid={`ball-count-${b.id}`}>
                            {count > 99 ? "99+" : count}
                        </div>
                        {!owned && prog && prog.need > 0 && (
                            <div className="text-[8px] uppercase tracking-widest text-white/70 mt-0.5">
                                {prog.have}/{prog.need} {prog.rarity}s
                            </div>
                        )}
                        {isSel && (
                            <motion.span
                                layoutId="ball-pick-indicator"
                                className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-river-500 ring-2 ring-white"
                            />
                        )}
                    </motion.button>
                );
            })}
        </div>
    );
}
