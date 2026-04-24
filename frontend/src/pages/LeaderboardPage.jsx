import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { userApi } from "../lib/api";
import { useUserAuth } from "../contexts/AuthContext";
import { Trophy, Footprints, Sparkles, ArrowLeft, Flame } from "lucide-react";
import RarityBadge from "../components/RarityBadge";

const TABS = [
    { id: "catches", label: "Most Catches", icon: Trophy },
    { id: "pokemon", label: "Top Pokemon", icon: Sparkles },
    { id: "distance", label: "Most Distance", icon: Footprints },
];

function formatMeters(m) {
    if (m == null || isNaN(m)) return "0 m";
    if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
    return `${Math.round(m)} m`;
}

function MedalBadge({ rank }) {
    if (rank === 1) return <span className="text-2xl leading-none">🥇</span>;
    if (rank === 2) return <span className="text-2xl leading-none">🥈</span>;
    if (rank === 3) return <span className="text-2xl leading-none">🥉</span>;
    return (
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-slate-700 text-white text-[11px] font-bold">
            {rank}
        </span>
    );
}

function Row({ rank, avatarText, primary, secondary, valueLabel, isMe, rarity }) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(rank * 0.025, 0.25) }}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-2xl border ${
                isMe
                    ? "bg-amber-100 border-amber-300"
                    : rank === 1
                    ? "bg-gradient-to-r from-amber-50 to-white border-amber-200"
                    : "bg-white/80 border-slate-200"
            }`}
            data-testid={`lb-row-${rank}`}
        >
            <div className="w-8 flex justify-center shrink-0">
                <MedalBadge rank={rank} />
            </div>
            <div className="w-10 h-10 rounded-full bg-river-100 text-river-700 flex items-center justify-center font-heading font-bold text-sm shrink-0 overflow-hidden">
                {avatarText}
            </div>
            <div className="min-w-0 flex-1">
                <div className="font-heading font-bold text-slate-900 text-sm truncate flex items-center gap-1.5">
                    {primary}
                    {isMe && (
                        <span className="text-[9px] uppercase tracking-wider bg-amber-400 text-slate-900 px-1.5 py-0.5 rounded-full">
                            You
                        </span>
                    )}
                    {rarity && <RarityBadge rarity={rarity} className="text-[9px] px-1.5 py-0" />}
                </div>
                {secondary && (
                    <div className="text-[11px] text-slate-500 truncate">{secondary}</div>
                )}
            </div>
            <div className="text-right shrink-0">
                <div className="font-heading font-bold text-slate-900 text-base leading-none">
                    {valueLabel}
                </div>
            </div>
        </motion.div>
    );
}

export default function LeaderboardPage() {
    const { user } = useUserAuth();
    const nav = useNavigate();
    const [tab, setTab] = useState("catches");
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState("");

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        userApi
            .get("/leaderboard/weekly")
            .then((r) => {
                if (!cancelled) setData(r.data);
            })
            .catch((e) => {
                if (!cancelled) setErr(e?.response?.data?.detail || "Could not load leaderboard");
            })
            .finally(() => !cancelled && setLoading(false));
        return () => {
            cancelled = true;
        };
    }, []);

    const me = data?.me;
    const weekStart = data?.week_start ? new Date(data.week_start) : null;

    return (
        <div
            className="relative w-full min-h-screen"
            style={{
                background:
                    "linear-gradient(180deg, #0b2545 0%, #0e4e6b 55%, #0ea5a1 100%)",
            }}
            data-testid="leaderboard-page"
        >
            {/* Header */}
            <div className="sticky top-0 z-20 safe-top">
                <div className="flex items-center gap-3 px-4 py-3 bg-slate-900/80 backdrop-blur-md border-b border-white/10">
                    <button
                        onClick={() => nav("/map")}
                        className="glass-dark rounded-full p-2"
                        aria-label="Back"
                        data-testid="leaderboard-back-btn"
                    >
                        <ArrowLeft className="w-4 h-4 text-white" />
                    </button>
                    <div className="flex-1 min-w-0">
                        <div className="text-[10px] uppercase tracking-widest text-amber-300 font-bold flex items-center gap-1">
                            <Flame className="w-3 h-3" /> Weekly Standings
                        </div>
                        <div className="font-heading text-lg font-bold text-white leading-tight truncate">
                            This Week's Top Campers
                        </div>
                    </div>
                    {weekStart && (
                        <div className="hidden sm:block text-[10px] text-white/60 uppercase tracking-wider">
                            Since {weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        </div>
                    )}
                </div>

                {/* Tab bar */}
                <div className="flex gap-1 px-2 py-2 bg-slate-900/70 backdrop-blur-md border-b border-white/10 overflow-x-auto">
                    {TABS.map((t) => {
                        const Icon = t.icon;
                        const active = tab === t.id;
                        return (
                            <button
                                key={t.id}
                                onClick={() => setTab(t.id)}
                                className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
                                    active
                                        ? "bg-amber-400 text-slate-900"
                                        : "bg-white/10 text-white hover:bg-white/20"
                                }`}
                                data-testid={`lb-tab-${t.id}`}
                            >
                                <Icon className="w-3.5 h-3.5" />
                                {t.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* My rank card */}
            {me && (tab === "catches" ? me.catch_rank : tab === "distance" ? me.walk_rank : null) && (
                <div className="px-3 pt-3">
                    <div className="rounded-2xl bg-gradient-to-r from-amber-400 to-amber-300 text-slate-900 px-4 py-3 shadow-lg flex items-center gap-3" data-testid="lb-me-card">
                        <div className="text-xs uppercase tracking-widest font-bold opacity-80">
                            Your rank
                        </div>
                        <div className="font-heading text-3xl font-black">
                            #{tab === "catches" ? me.catch_rank : me.walk_rank}
                        </div>
                        <div className="ml-auto text-right">
                            <div className="font-heading text-xl font-bold leading-none">
                                {tab === "catches"
                                    ? `${me.catches} catch${me.catches === 1 ? "" : "es"}`
                                    : formatMeters(me.meters)}
                            </div>
                            <div className="text-[10px] uppercase tracking-wider opacity-70">
                                {tab === "catches"
                                    ? `of ${me.total_campers_with_catches} catching`
                                    : `of ${me.total_campers_walking} walking`}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Body */}
            <div className="p-3 pb-24 max-w-2xl mx-auto">
                {loading && (
                    <div className="text-center py-12 text-white/80" data-testid="lb-loading">
                        <div className="animate-spin w-8 h-8 border-2 border-white/30 border-t-white rounded-full mx-auto mb-3" />
                        Loading…
                    </div>
                )}

                {err && !loading && (
                    <div className="text-center py-10 text-red-200 text-sm" data-testid="lb-error">
                        {err}
                    </div>
                )}

                {!loading && !err && data && (
                    <div className="space-y-2">
                        {tab === "catches" && (
                            <>
                                {data.top_catchers.length === 0 && (
                                    <EmptyState message="No catches yet this week — be the first!" />
                                )}
                                {data.top_catchers.map((r) => (
                                    <Row
                                        key={r.camper_id}
                                        rank={r.rank}
                                        avatarText={(r.first_name?.[0] || "?") + (r.last_name?.[0] || "")}
                                        primary={`${r.first_name} ${r.last_name || ""}`.trim()}
                                        secondary={`${r.group_code}${r.legendaries ? ` • ${r.legendaries} legendary` : ""}${r.rares ? ` • ${r.rares} rare` : ""}`}
                                        valueLabel={`${r.catches}`}
                                        isMe={r.is_me}
                                    />
                                ))}
                            </>
                        )}

                        {tab === "pokemon" && (
                            <>
                                {data.top_pokemon.length === 0 && (
                                    <EmptyState message="No Pokemon have been caught yet this week." />
                                )}
                                {data.top_pokemon.map((p) => (
                                    <Row
                                        key={p.pokemon_id}
                                        rank={p.rank}
                                        avatarText={
                                            p.image_data_url ? (
                                                <img
                                                    src={p.image_data_url}
                                                    alt=""
                                                    className="w-10 h-10 object-contain"
                                                    draggable={false}
                                                />
                                            ) : (
                                                p.name?.[0] || "?"
                                            )
                                        }
                                        primary={p.name}
                                        secondary={`${p.unique_catchers} camper${p.unique_catchers === 1 ? "" : "s"} caught one`}
                                        valueLabel={`${p.count}×`}
                                        rarity={p.rarity}
                                    />
                                ))}
                            </>
                        )}

                        {tab === "distance" && (
                            <>
                                {data.top_walkers.length === 0 && (
                                    <EmptyState message="No steps tracked yet this week. Start walking!" />
                                )}
                                {data.top_walkers.map((r) => (
                                    <Row
                                        key={r.camper_id}
                                        rank={r.rank}
                                        avatarText={(r.first_name?.[0] || "?") + (r.last_name?.[0] || "")}
                                        primary={`${r.first_name} ${r.last_name || ""}`.trim()}
                                        secondary={r.group_code}
                                        valueLabel={formatMeters(r.meters)}
                                        isMe={r.is_me}
                                    />
                                ))}
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

function EmptyState({ message }) {
    return (
        <div className="text-center py-10 rounded-2xl bg-white/10 border border-white/20 text-white/80 text-sm px-4" data-testid="lb-empty">
            {message}
        </div>
    );
}
