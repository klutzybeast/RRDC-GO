import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ScrollText, X, Check, Gift } from "lucide-react";
import { userApi, formatApiError } from "../lib/api";
import { Button } from "./ui/button";
import { toast } from "sonner";

const TIER_STYLE = {
    easy:   { ring: "border-emerald-300", chip: "bg-emerald-500", label: "Easy",   bar: "bg-emerald-500" },
    medium: { ring: "border-river-300",   chip: "bg-river-500",   label: "Medium", bar: "bg-river-500" },
    hard:   { ring: "border-amber-300",   chip: "bg-amber-500",   label: "Hard",   bar: "bg-amber-500" },
};

export default function ChallengesCard({ onRewardClaimed }) {
    const [items, setItems] = useState([]);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [claiming, setClaiming] = useState(null);

    const refresh = async () => {
        setLoading(true);
        try {
            const r = await userApi.get("/challenges/today");
            setItems(r.data?.challenges || []);
        } catch (e) {
            // Silently fail — challenges are non-critical
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        refresh();
        const id = setInterval(refresh, 30000);
        return () => clearInterval(id);
    }, []);

    const claim = async (ch) => {
        if (claiming) return;
        setClaiming(ch.id);
        try {
            const r = await userApi.post(`/challenges/${ch.id}/claim`);
            toast.success(`+${r.data.reward} balls — ${ch.label}!`, { duration: 4000 });
            onRewardClaimed && onRewardClaimed(r.data);
            refresh();
        } catch (e) {
            toast.error(formatApiError(e));
        } finally {
            setClaiming(null);
        }
    };

    const completedReady = items.filter((c) => c.completed && !c.claimed).length;
    const totalReward = items.reduce((s, c) => s + (c.claimed ? 0 : c.reward), 0);

    return (
        <>
            {/* Compact pill on the map */}
            <button
                onClick={() => setOpen(true)}
                className="relative bg-white/95 backdrop-blur-sm rounded-full px-4 py-2 shadow-lg flex items-center gap-2 hover:bg-white transition-colors"
                data-testid="challenges-pill"
            >
                <ScrollText className="w-4 h-4 text-river-600" />
                <span className="text-sm font-bold text-slate-900">Daily Challenges</span>
                {completedReady > 0 && (
                    <span className="bg-amber-400 text-slate-900 text-xs font-bold rounded-full px-2 py-0.5 ml-1 animate-pulse" data-testid="challenges-ready-badge">
                        {completedReady} ready
                    </span>
                )}
                {!completedReady && totalReward > 0 && (
                    <span className="text-xs text-slate-500 font-bold">up to +{totalReward}</span>
                )}
            </button>

            <AnimatePresence>
                {open && (
                    <motion.div
                        className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-3 bg-black/55 backdrop-blur-sm"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setOpen(false)}
                        data-testid="challenges-modal"
                    >
                        <motion.div
                            className="w-full max-w-md bg-white rounded-[2rem] p-5 shadow-2xl max-h-[88vh] overflow-y-auto"
                            initial={{ y: 80, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={{ y: 80, opacity: 0 }}
                            transition={{ type: "spring", bounce: 0.4, duration: 0.5 }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex items-center justify-between mb-4">
                                <div>
                                    <div className="text-xs uppercase tracking-widest font-bold text-river-600">Today's</div>
                                    <h2 className="font-heading text-2xl font-bold text-slate-900">Daily Challenges</h2>
                                </div>
                                <button onClick={() => setOpen(false)} className="p-2 -m-2 rounded-full hover:bg-slate-100" data-testid="close-challenges">
                                    <X className="w-5 h-5 text-slate-500" />
                                </button>
                            </div>

                            <p className="text-sm text-slate-500 mb-3">
                                Complete any of these to earn extra Rolling River Balls. Resets at midnight.
                            </p>

                            {loading && items.length === 0 ? (
                                <div className="text-center text-slate-400 text-sm py-8">Loading…</div>
                            ) : items.length === 0 ? (
                                <div className="text-center text-slate-400 text-sm py-8">No challenges available</div>
                            ) : (
                                <ul className="space-y-3">
                                    {items.map((ch) => {
                                        const style = TIER_STYLE[ch.tier] || TIER_STYLE.medium;
                                        const pct = Math.round(Math.min(100, (ch.progress / Math.max(1, ch.target)) * 100));
                                        const done = ch.progress >= ch.target;
                                        return (
                                            <li
                                                key={ch.id}
                                                className={`rounded-2xl border-2 ${style.ring} bg-slate-50 p-3.5 ${ch.claimed ? "opacity-60" : ""}`}
                                                data-testid={`challenge-${ch.id}`}
                                            >
                                                <div className="flex items-start gap-3">
                                                    <span className={`flex-shrink-0 ${style.chip} text-white text-[10px] font-bold uppercase tracking-widest rounded-full px-2 py-0.5 mt-0.5`}>
                                                        {style.label}
                                                    </span>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="font-bold text-slate-900 leading-tight">{ch.label}</div>
                                                        <div className="text-xs text-slate-500 mt-0.5 tabular-nums" data-testid={`challenge-progress-${ch.id}`}>
                                                            {ch.progress} / {ch.target}
                                                        </div>
                                                    </div>
                                                    <div className="flex-shrink-0 flex flex-col items-end">
                                                        <span className="text-xs font-bold text-amber-600 flex items-center gap-1">
                                                            <Gift className="w-3.5 h-3.5" />+{ch.reward}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="mt-2.5 h-2 bg-slate-200 rounded-full overflow-hidden">
                                                    <div className={`h-full ${style.bar} transition-all`} style={{ width: `${pct}%` }} />
                                                </div>
                                                <div className="mt-2.5 flex justify-end">
                                                    {ch.claimed ? (
                                                        <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600">
                                                            <Check className="w-3.5 h-3.5" /> Claimed
                                                        </span>
                                                    ) : done ? (
                                                        <Button
                                                            onClick={() => claim(ch)}
                                                            disabled={claiming === ch.id}
                                                            className="rounded-2xl h-9 bg-amber-500 hover:bg-amber-600 text-white font-bold tactile-btn"
                                                            data-testid={`claim-${ch.id}`}
                                                        >
                                                            {claiming === ch.id ? "Claiming…" : `Claim +${ch.reward} balls`}
                                                        </Button>
                                                    ) : (
                                                        <span className="text-xs text-slate-400 italic">Keep going!</span>
                                                    )}
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}
