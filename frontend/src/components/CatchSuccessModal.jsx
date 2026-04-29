import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import RarityBadge from "./RarityBadge";
import TypeBadge from "./TypeBadge";
import CampBall, { BALL_BY_ID } from "./CampBall";
import { Button } from "./ui/button";

export default function CatchSuccessModal({ open, result, onClose, onGoToCollection }) {
    if (!open || !result || !result.success) return null;
    const p = result.pokemon || {};
    const rewards = result.ball_rewards || {};
    const rewardEntries = Object.entries(rewards).filter(([, n]) => Number(n) > 0);
    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    className="fixed inset-0 z-[1000] flex items-center justify-center p-3 bg-black/60 backdrop-blur-sm overflow-y-auto"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    data-testid="catch-success-modal"
                >
                    <motion.div
                        className="relative w-full max-w-md bg-white rounded-[2rem] shadow-2xl flex flex-col my-2"
                        style={{
                            maxHeight: "calc(100dvh - 1.5rem)",
                            WebkitOverflowScrolling: "touch",
                        }}
                        initial={{ scale: 0.7, y: 40, opacity: 0 }}
                        animate={{ scale: 1, y: 0, opacity: 1 }}
                        exit={{ scale: 0.8, opacity: 0 }}
                        transition={{ type: "spring", bounce: 0.5, duration: 0.6 }}
                    >
                        <div
                            className="overflow-y-auto px-6 sm:px-8 pt-6 sm:pt-8 pb-4 flex-1 min-h-0"
                            style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y", overscrollBehavior: "contain" }}
                        >
                        <div className="text-center">
                            <div className="text-sm uppercase tracking-widest font-bold text-river-600">Gotcha!</div>
                            <h2 className="font-heading text-3xl sm:text-4xl font-bold text-slate-900 mt-1" data-testid="catch-pokemon-name">
                                {p.name}
                            </h2>
                        </div>

                        <div className={`mt-4 relative rounded-[1.5rem] overflow-hidden p-4 rarity-${p.rarity || "common"}`}>
                            <div className="aspect-square w-full max-h-56 mx-auto flex items-center justify-center">
                                {p.image_data_url ? (
                                    <img src={p.image_data_url} alt={p.name} className="max-h-full max-w-full drop-shadow-2xl object-contain" />
                                ) : (
                                    <div className="w-32 h-32 rounded-full bg-white/40" />
                                )}
                            </div>
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-3">
                            <div className="rounded-2xl bg-slate-50 p-3 text-center">
                                <div className="text-[10px] font-bold uppercase text-slate-500 tracking-widest">Power</div>
                                <div className="font-heading text-2xl font-bold text-slate-900 mt-0.5" data-testid="catch-power-level">
                                    {result.power_rolled}
                                </div>
                            </div>
                            <div className="rounded-2xl bg-slate-50 p-3 text-center flex flex-col items-center justify-center gap-1">
                                <div className="text-[10px] font-bold uppercase text-slate-500 tracking-widest">Rarity / Type</div>
                                <div className="flex flex-wrap items-center justify-center gap-1">
                                    <RarityBadge rarity={p.rarity} />
                                    {p.type && p.type !== "normal" && <TypeBadge type={p.type} size="sm" />}
                                </div>
                            </div>
                        </div>

                        {p.description && (
                            <p className="mt-3 text-sm text-slate-600 text-center leading-relaxed" data-testid="catch-description">
                                {p.description}
                            </p>
                        )}

                        {rewardEntries.length > 0 && (
                            <div className="mt-3 rounded-2xl bg-gradient-to-br from-amber-50 to-amber-100 border-2 border-amber-300 p-3" data-testid="catch-ball-rewards">
                                <div className="text-[10px] font-bold uppercase tracking-widest text-amber-800 text-center">Ball unlocked!</div>
                                <div className="mt-1.5 flex items-center justify-center gap-3 flex-wrap">
                                    {rewardEntries.map(([ball, n]) => (
                                        <div key={ball} className="flex items-center gap-2">
                                            <CampBall ballId={ball} size={32} animate={false} />
                                            <div>
                                                <div className="text-sm font-bold text-slate-900">+{n} {BALL_BY_ID[ball]?.label || ball}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="mt-3 text-center text-xs text-slate-500">
                            Caught by <span className="font-bold text-slate-900">{result.caught_by}</span>
                            <div className="text-[10px] text-slate-400 mt-0.5">
                                {result.caught_at ? new Date(result.caught_at).toLocaleString() : ""}
                            </div>
                        </div>
                        </div>

                        {/* Sticky footer button — always visible */}
                        <div className="px-6 sm:px-8 pb-5 pt-2 flex-shrink-0 border-t border-slate-100 bg-white rounded-b-[2rem]">
                            <Button
                                className="w-full tactile-btn bg-river-500 hover:bg-river-600 text-white font-bold rounded-2xl h-12 text-base"
                                onClick={onClose}
                                data-testid="continue-hunting-btn"
                            >
                                Continue Hunting
                            </Button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
