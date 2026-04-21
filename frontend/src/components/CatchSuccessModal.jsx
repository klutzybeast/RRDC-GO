import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import RarityBadge from "./RarityBadge";
import { Button } from "./ui/button";

export default function CatchSuccessModal({ open, result, onClose, onGoToCollection }) {
    if (!open || !result || !result.success) return null;
    const p = result.pokemon || {};
    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    data-testid="catch-success-modal"
                >
                    <motion.div
                        className="relative w-full max-w-md bg-white rounded-[2rem] p-6 sm:p-8 shadow-2xl"
                        initial={{ scale: 0.7, y: 40, opacity: 0 }}
                        animate={{ scale: 1, y: 0, opacity: 1 }}
                        exit={{ scale: 0.8, opacity: 0 }}
                        transition={{ type: "spring", bounce: 0.5, duration: 0.6 }}
                    >
                        <div className="text-center">
                            <div className="text-sm uppercase tracking-widest font-bold text-river-600">Gotcha!</div>
                            <h2 className="font-heading text-3xl sm:text-4xl font-bold text-slate-900 mt-1" data-testid="catch-pokemon-name">
                                {p.name}
                            </h2>
                        </div>

                        <div className={`mt-6 relative rounded-[1.5rem] overflow-hidden p-6 rarity-${p.rarity || "common"}`}>
                            <div className="aspect-square w-full flex items-center justify-center">
                                {p.image_data_url ? (
                                    <img src={p.image_data_url} alt={p.name} className="max-h-full max-w-full drop-shadow-2xl" />
                                ) : (
                                    <div className="w-40 h-40 rounded-full bg-white/40" />
                                )}
                            </div>
                        </div>

                        <div className="mt-6 grid grid-cols-2 gap-3">
                            <div className="rounded-2xl bg-slate-50 p-4 text-center">
                                <div className="text-xs font-bold uppercase text-slate-500 tracking-widest">Power</div>
                                <div className="font-heading text-3xl font-bold text-slate-900 mt-1" data-testid="catch-power-level">
                                    {result.power_rolled}
                                </div>
                            </div>
                            <div className="rounded-2xl bg-slate-50 p-4 text-center flex flex-col items-center justify-center">
                                <div className="text-xs font-bold uppercase text-slate-500 tracking-widest mb-2">Rarity</div>
                                <RarityBadge rarity={p.rarity} />
                            </div>
                        </div>

                        {p.description && (
                            <p className="mt-4 text-sm text-slate-600 text-center leading-relaxed" data-testid="catch-description">
                                {p.description}
                            </p>
                        )}

                        <div className="mt-5 text-center text-sm text-slate-500">
                            Caught by <span className="font-bold text-slate-900">{result.caught_by}</span>
                            <div className="text-xs text-slate-400 mt-1">
                                {result.caught_at ? new Date(result.caught_at).toLocaleString() : ""}
                            </div>
                        </div>

                        <div className="mt-6 flex flex-col gap-3">
                            <Button
                                className="tactile-btn bg-river-500 hover:bg-river-600 text-white font-bold rounded-2xl h-12 text-base"
                                onClick={onClose}
                                data-testid="continue-hunting-btn"
                            >
                                Continue Hunting
                            </Button>
                            <button
                                onClick={onGoToCollection}
                                className="text-river-600 hover:text-river-700 font-semibold text-sm"
                                data-testid="view-collection-link"
                            >
                                View My Collection →
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
