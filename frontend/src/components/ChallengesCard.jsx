import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ScrollText, X, Check, Sparkles, Trophy, Calendar, CalendarDays, CalendarRange } from "lucide-react";
import { userApi, formatApiError } from "../lib/api";
import { Button } from "./ui/button";
import { toast } from "sonner";
import CampBall, { BALL_BY_ID } from "./CampBall";

const TIER_STYLE = {
    easy:   { ring: "border-emerald-300", chip: "bg-emerald-500", label: "Easy",   bar: "bg-emerald-500" },
    medium: { ring: "border-river-300",   chip: "bg-river-500",   label: "Medium", bar: "bg-river-500" },
    hard:   { ring: "border-amber-300",   chip: "bg-amber-500",   label: "Hard",   bar: "bg-amber-500" },
};

const TABS = [
    { id: "daily",   label: "Daily",   Icon: Calendar },
    { id: "weekly",  label: "Weekly",  Icon: CalendarDays },
    { id: "monthly", label: "Monthly", Icon: CalendarRange },
    { id: "expert",  label: "Expert",  Icon: Trophy },
];

export default function ChallengesCard({ onRewardClaimed }) {
    const [data, setData] = useState({ daily: { challenges: [] }, weekly: { challenges: [] }, monthly: { challenges: [] }, expert: { challenges: [] }, totals: { available: 0, ready_to_claim: 0 } });
    const [open, setOpen] = useState(false);
    const [activeTab, setActiveTab] = useState("daily");
    const [loading, setLoading] = useState(false);
    const [claiming, setClaiming] = useState(null);

    const refresh = async () => {
        setLoading(true);
        try {
            const r = await userApi.get("/challenges");
            setData(r.data);
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
            const ballId = r.data?.reward_ball || "pokeball";
            const ballLabel = BALL_BY_ID[ballId]?.label || "balls";
            toast.success(`+${r.data.reward} ${ballLabel}${r.data.reward === 1 ? "" : "s"} — ${ch.label}!`, { duration: 4000 });
            onRewardClaimed && onRewardClaimed(r.data);
            refresh();
        } catch (e) {
            toast.error(formatApiError(e));
        } finally {
            setClaiming(null);
        }
    };

    const tabCounts = useMemo(() => {
        return TABS.reduce((acc, t) => {
            const items = data?.[t.id]?.challenges || [];
            acc[t.id] = {
                total: items.length,
                ready: items.filter((c) => c.completed && !c.claimed).length,
            };
            return acc;
        }, {});
    }, [data]);

    const totalReady = data?.totals?.ready_to_claim ?? 0;
    const totalAvailable = data?.totals?.available ?? 0;
    const activeItems = data?.[activeTab]?.challenges || [];

    return (
        <>
            <button
                onClick={() => setOpen(true)}
                className="relative bg-white/95 backdrop-blur-sm rounded-full px-4 py-2 shadow-lg flex items-center gap-2 hover:bg-white transition-colors"
                data-testid="challenges-pill"
            >
                <ScrollText className="w-4 h-4 text-river-600" />
                <span className="text-sm font-bold text-slate-900">Challenges</span>
                {totalReady > 0 ? (
                    <span className="bg-amber-400 text-slate-900 text-xs font-bold rounded-full px-2 py-0.5 ml-1 animate-pulse" data-testid="challenges-ready-badge">
                        {totalReady} ready
                    </span>
                ) : (
                    <span className="text-xs text-slate-500 font-bold" data-testid="challenges-count">
                        {totalAvailable} available
                    </span>
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
                            className="w-full max-w-md bg-white rounded-[2rem] shadow-2xl flex flex-col"
                            style={{ maxHeight: "88vh" }}
                            initial={{ y: 80, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={{ y: 80, opacity: 0 }}
                            transition={{ type: "spring", bounce: 0.4, duration: 0.5 }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Header */}
                            <div className="px-5 pt-5 pb-3 flex-shrink-0 border-b border-slate-100">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="text-xs uppercase tracking-widest font-bold text-river-600">Earn balls</div>
                                        <h2 className="font-heading text-2xl font-bold text-slate-900">Challenges</h2>
                                    </div>
                                    <button onClick={() => setOpen(false)} className="p-2 -m-2 rounded-full hover:bg-slate-100" data-testid="close-challenges">
                                        <X className="w-5 h-5 text-slate-500" />
                                    </button>
                                </div>
                                {/* Tabs */}
                                <div className="mt-3 grid grid-cols-4 gap-1 bg-slate-100 rounded-2xl p-1">
                                    {TABS.map((t) => {
                                        const isActive = activeTab === t.id;
                                        const cnt = tabCounts[t.id]?.ready || 0;
                                        return (
                                            <button
                                                key={t.id}
                                                onClick={() => setActiveTab(t.id)}
                                                className={`relative rounded-xl py-1.5 px-1 text-[11px] font-bold uppercase tracking-wider transition-all flex flex-col items-center gap-0.5 ${
                                                    isActive ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                                                }`}
                                                data-testid={`tab-${t.id}`}
                                            >
                                                <t.Icon className="w-3.5 h-3.5" />
                                                <span>{t.label}</span>
                                                {cnt > 0 && (
                                                    <span className="absolute -top-1 -right-1 bg-amber-400 text-slate-900 text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                                                        {cnt}
                                                    </span>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Scrollable list */}
                            <div
                                className="flex-1 min-h-0 overflow-y-auto px-5 py-3"
                                style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y", overscrollBehavior: "contain" }}
                                data-testid="challenges-scroll"
                            >
                                {activeTab === "expert" && activeItems.length === 0 && !loading ? (
                                    <div className="text-center py-10">
                                        <Sparkles className="w-10 h-10 text-amber-400 mx-auto" />
                                        <div className="font-heading text-xl font-bold text-slate-900 mt-2">All expert challenges complete!</div>
                                        <div className="text-sm text-slate-500 mt-1">You're a Rolling River legend.</div>
                                    </div>
                                ) : loading && activeItems.length === 0 ? (
                                    <div className="text-center text-slate-400 text-sm py-10">Loading…</div>
                                ) : activeItems.length === 0 ? (
                                    <div className="text-center text-slate-400 text-sm py-10">No challenges available</div>
                                ) : (
                                    <ul className="space-y-3">
                                        {activeItems.map((ch) => {
                                            const style = TIER_STYLE[ch.tier] || TIER_STYLE.medium;
                                            const pct = Math.round(Math.min(100, (ch.progress / Math.max(1, ch.target)) * 100));
                                            const done = ch.progress >= ch.target;
                                            const formatProgress = (v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v;
                                            const rewardBall = ch.reward_ball || "pokeball";
                                            const rewardBallLabel = BALL_BY_ID[rewardBall]?.label || "Ball";
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
                                                                {formatProgress(ch.progress)} / {formatProgress(ch.target)}
                                                                {ch.kind === "walk_meters" && " m"}
                                                            </div>
                                                        </div>
                                                        <div className="flex-shrink-0 flex flex-col items-center gap-0.5" data-testid={`reward-${ch.id}`}>
                                                            <CampBall ballId={rewardBall} size={28} animate={false} />
                                                            <span className="text-[10px] font-bold text-slate-700 tabular-nums">+{ch.reward}</span>
                                                            <span className="text-[8px] uppercase tracking-wider text-slate-400 leading-none">
                                                                {rewardBallLabel}{ch.reward !== 1 ? "s" : ""}
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
                                                                className="rounded-2xl h-9 bg-amber-500 hover:bg-amber-600 text-white font-bold tactile-btn flex items-center gap-1.5"
                                                                data-testid={`claim-${ch.id}`}
                                                            >
                                                                {claiming === ch.id ? "Claiming…" : (
                                                                    <>
                                                                        <CampBall ballId={rewardBall} size={20} animate={false} />
                                                                        Claim +{ch.reward}
                                                                    </>
                                                                )}
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
                            </div>

                            {/* Footer note about reset */}
                            <div className="px-5 py-3 flex-shrink-0 border-t border-slate-100 text-[11px] text-slate-400 text-center">
                                {activeTab === "daily"   && "Daily challenges reset at midnight."}
                                {activeTab === "weekly"  && "Weekly challenges reset every Monday."}
                                {activeTab === "monthly" && "Monthly challenges reset on the 1st."}
                                {activeTab === "expert"  && "Expert unlocks the next challenge once you claim."}
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}
