import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronUp, X } from "lucide-react";
import CampBall, { BALL_TYPES, BALL_BY_ID } from "./CampBall";

/**
 * Compact ball-switcher: shows a tiny chevron button next to the active ball.
 * Tap it → popover opens with all 4 balls + counts. Tap one → switches and
 * closes. Replaces the old always-visible 4-row strip.
 */
export default function BallSwitcher({ selected, onSelect, balances = {}, earnProgress = {} }) {
    const [open, setOpen] = useState(false);
    const cur = BALL_BY_ID[selected] || BALL_BY_ID.pokeball;

    const choose = (id) => {
        if (Number(balances[id] || 0) <= 0) return;
        onSelect && onSelect(id);
        setOpen(false);
    };

    return (
        <>
            <motion.button
                onClick={() => setOpen(true)}
                whileTap={{ scale: 0.92 }}
                className="flex items-center gap-1.5 bg-white/15 hover:bg-white/25 backdrop-blur-sm rounded-full pl-2 pr-3 py-1 ring-1 ring-white/30 shadow-lg"
                data-testid="ball-switcher-btn"
                aria-label={`Switch ball — currently ${cur.label}`}
            >
                <CampBall ballId={selected} size={28} animate={false} />
                <span className="text-white text-[11px] font-bold uppercase tracking-widest">
                    {cur.short}
                </span>
                <span className="text-white/70 text-[11px] font-bold tabular-nums">
                    × {Number(balances[selected] || 0)}
                </span>
                <ChevronUp className="w-3.5 h-3.5 text-white/80" />
            </motion.button>

            <AnimatePresence>
                {open && (
                    <motion.div
                        className="fixed inset-0 z-[300] flex items-end justify-center p-4 bg-black/55 backdrop-blur-sm"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setOpen(false)}
                        data-testid="ball-switcher-modal"
                    >
                        <motion.div
                            className="w-full max-w-md bg-white rounded-[2rem] p-5 shadow-2xl"
                            initial={{ y: 80, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={{ y: 80, opacity: 0 }}
                            transition={{ type: "spring", bounce: 0.4, duration: 0.4 }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex items-center justify-between mb-4">
                                <div>
                                    <div className="text-xs uppercase tracking-widest font-bold text-river-600">Pick your ball</div>
                                    <h3 className="font-heading text-xl font-bold text-slate-900">Switch Ball</h3>
                                </div>
                                <button onClick={() => setOpen(false)} className="p-2 -m-2 rounded-full hover:bg-slate-100" aria-label="Close">
                                    <X className="w-5 h-5 text-slate-500" />
                                </button>
                            </div>
                            <ul className="space-y-2">
                                {BALL_TYPES.map((b) => {
                                    const count = Number(balances[b.id] || 0);
                                    const owned = count > 0;
                                    const isSel = selected === b.id;
                                    const prog = earnProgress[b.id];
                                    const mult = { pokeball: "1.0×", rayball: "1.4×", myrtleball: "1.8×", lunchball: "2.5×" }[b.id];
                                    return (
                                        <li
                                            key={b.id}
                                            onClick={() => choose(b.id)}
                                            className={`flex items-center gap-3 p-3 rounded-2xl border-2 cursor-pointer transition-colors ${
                                                isSel
                                                    ? "border-river-500 bg-river-50"
                                                    : owned
                                                        ? "border-slate-200 hover:bg-slate-50"
                                                        : "border-slate-100 bg-slate-50 opacity-60 cursor-not-allowed"
                                            }`}
                                            data-testid={`ball-pick-${b.id}`}
                                        >
                                            <div style={{ filter: !owned ? "grayscale(0.85)" : undefined }}>
                                                <CampBall ballId={b.id} size={48} animate={false} />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="font-bold text-slate-900">{b.label}</div>
                                                <div className="text-xs text-slate-500">{b.description}</div>
                                                {!owned && prog && prog.need > 0 && (
                                                    <div className="text-[10px] uppercase tracking-widest text-slate-400 mt-0.5">
                                                        {prog.have}/{prog.need} {prog.rarity}s caught
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex-shrink-0 text-right">
                                                <div className="font-heading text-2xl font-black text-slate-900 tabular-nums" data-testid={`ball-count-${b.id}`}>
                                                    {count}
                                                </div>
                                                <div className="text-[10px] uppercase tracking-widest text-slate-400">
                                                    {mult}
                                                </div>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}
