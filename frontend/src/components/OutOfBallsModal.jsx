import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "./ui/button";
import { MapPin, Clock, HandCoins } from "lucide-react";

export default function OutOfBallsModal({ open, onClose, nextDailyAt, canClaimDaily, onClaimDaily, daily = 25, pinBonus = 5 }) {
    if (!open) return null;
    return (
        <AnimatePresence>
            <motion.div
                className="fixed inset-0 z-[1500] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                data-testid="out-of-balls-modal"
            >
                <motion.div
                    initial={{ scale: 0.9, y: 10, opacity: 0 }}
                    animate={{ scale: 1, y: 0, opacity: 1 }}
                    className="w-full max-w-md bg-white rounded-[2rem] p-6 sm:p-7 shadow-2xl"
                >
                    <div className="text-center">
                        <div className="text-[11px] font-bold uppercase tracking-widest text-rose-500">Out of balls</div>
                        <h2 className="font-heading text-2xl sm:text-3xl font-bold text-slate-900 mt-1">
                            Time to restock!
                        </h2>
                        <p className="text-sm text-slate-600 mt-2">
                            Earn more Rolling River Balls three ways:
                        </p>
                    </div>

                    <div className="mt-5 space-y-3">
                        <div className="flex items-start gap-3 bg-river-50 rounded-2xl p-4 border border-river-100">
                            <div className="w-9 h-9 rounded-xl bg-river-500 text-white flex items-center justify-center shrink-0">
                                <Clock className="w-5 h-5" />
                            </div>
                            <div className="flex-1">
                                <div className="font-bold text-slate-900">Daily bonus: +{daily}</div>
                                <div className="text-xs text-slate-600 mt-0.5">
                                    {canClaimDaily
                                        ? "Ready to claim now!"
                                        : nextDailyAt
                                        ? `Available ${new Date(nextDailyAt).toLocaleString()}`
                                        : "Come back tomorrow"}
                                </div>
                                {canClaimDaily && (
                                    <Button
                                        onClick={onClaimDaily}
                                        size="sm"
                                        className="tactile-btn mt-2 rounded-full h-9 bg-river-500 hover:bg-river-600 text-white font-heading font-bold"
                                        data-testid="claim-daily-in-modal-btn"
                                    >
                                        Claim +{daily}
                                    </Button>
                                )}
                            </div>
                        </div>

                        <div className="flex items-start gap-3 bg-emerald-50 rounded-2xl p-4 border border-emerald-100">
                            <div className="w-9 h-9 rounded-xl bg-emerald-500 text-white flex items-center justify-center shrink-0">
                                <MapPin className="w-5 h-5" />
                            </div>
                            <div className="flex-1">
                                <div className="font-bold text-slate-900">Explore camp: +{pinBonus} per new pin</div>
                                <div className="text-xs text-slate-600 mt-0.5">Walk within a few meters of a camp pin to earn.</div>
                            </div>
                        </div>

                        <div className="flex items-start gap-3 bg-amber-50 rounded-2xl p-4 border border-amber-100">
                            <div className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0">
                                <HandCoins className="w-5 h-5" />
                            </div>
                            <div className="flex-1">
                                <div className="font-bold text-slate-900">Counselor rewards</div>
                                <div className="text-xs text-slate-600 mt-0.5">Ask a counselor — they can grant bonus balls for camp activities.</div>
                            </div>
                        </div>
                    </div>

                    <Button onClick={onClose} className="tactile-btn mt-6 w-full h-12 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-heading font-bold" data-testid="close-out-of-balls-btn">
                        Got it
                    </Button>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}
