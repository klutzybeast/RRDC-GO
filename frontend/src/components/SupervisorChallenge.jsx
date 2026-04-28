import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Star, Trophy } from "lucide-react";
import { userApi } from "../lib/api";

/**
 * Compact "Catch all supervisors!" weekly challenge banner.
 * Shows progress (caught / total) and a row of supervisor avatars,
 * dimmed when not yet caught this week, vibrant when caught.
 *
 * Lives at the top of MapPage and CollectionPage.
 */
export default function SupervisorChallenge({ compact = false }) {
    const [data, setData] = useState(null);
    const [err, setErr] = useState(false);

    useEffect(() => {
        let cancelled = false;
        userApi.get("/supervisor-challenge")
            .then((r) => { if (!cancelled) setData(r.data); })
            .catch(() => { if (!cancelled) setErr(true); });
        return () => { cancelled = true; };
    }, []);

    if (err || !data || data.total === 0) return null;

    const pct = data.total > 0 ? Math.round((data.caught / data.total) * 100) : 0;

    return (
        <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className={`rounded-2xl ${data.complete ? "bg-gradient-to-r from-amber-300 to-yellow-200" : "bg-gradient-to-r from-emerald-50 to-river-50"} border ${data.complete ? "border-amber-400" : "border-emerald-200"} ${compact ? "p-2" : "p-3"} shadow-md`}
            data-testid="supervisor-challenge-banner"
        >
            <div className="flex items-center gap-2">
                {data.complete ? <Trophy className="w-4 h-4 text-amber-700" /> : <Star className="w-4 h-4 text-emerald-700 fill-emerald-300" />}
                <div className="flex-1 min-w-0">
                    <div className="text-[9px] uppercase tracking-widest font-black text-slate-700">
                        {data.complete ? "ALL CAUGHT! GO YOU!" : "Catch the Supervisors"}
                    </div>
                    <div className="font-heading text-sm font-black text-slate-900">
                        {data.caught} / {data.total} this week
                    </div>
                </div>
                <div className="text-right shrink-0">
                    <div className="font-heading text-2xl font-black text-slate-900 leading-none">{pct}%</div>
                </div>
            </div>
            {/* Progress bar */}
            <div className={`relative mt-2 h-1.5 rounded-full ${data.complete ? "bg-amber-600/30" : "bg-slate-200"} overflow-hidden`}>
                <motion.div
                    className={`absolute inset-y-0 left-0 rounded-full ${data.complete ? "bg-amber-600" : "bg-emerald-500"}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ type: "spring", damping: 18 }}
                />
            </div>
            {/* Avatars row */}
            <div className="flex gap-1.5 mt-2 overflow-x-auto pb-0.5">
                {data.supervisors.map((s) => (
                    <div
                        key={s.pokemon_id}
                        className={`relative shrink-0 rounded-full p-0.5 ${s.caught_this_week ? "bg-emerald-200 ring-2 ring-emerald-500" : "bg-slate-100 ring-1 ring-slate-300"}`}
                        title={`${s.name}${s.caught_this_week ? " — caught" : " — not yet"}`}
                        data-testid={`supervisor-${s.caught_this_week ? "caught" : "missing"}`}
                    >
                        {s.image_data_url ? (
                            <img
                                src={s.image_data_url}
                                alt={s.name}
                                className={`w-9 h-9 rounded-full object-cover ${s.caught_this_week ? "" : "grayscale opacity-60"}`}
                                draggable={false}
                            />
                        ) : (
                            <div className="w-9 h-9 rounded-full bg-slate-200" />
                        )}
                        {s.caught_this_week && (
                            <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-white text-white text-[8px] font-black flex items-center justify-center">✓</span>
                        )}
                    </div>
                ))}
            </div>
        </motion.div>
    );
}
