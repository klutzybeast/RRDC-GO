import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Star, Sparkles, Calendar, CalendarDays } from "lucide-react";
import { userApi } from "../lib/api";

const STYLE = {
    legendary_hour: { Icon: Star, label: "Legendary Hour", bg: "from-amber-400 to-yellow-300", text: "text-amber-900" },
    double_balls:   { Icon: Sparkles, label: "Double Balls", bg: "from-fuchsia-400 to-rose-300", text: "text-fuchsia-900" },
    spotlight:      { Icon: CalendarDays, label: "Spotlight", bg: "from-sky-400 to-cyan-300", text: "text-sky-900" },
    community_day:  { Icon: Calendar, label: "Community Day", bg: "from-emerald-400 to-lime-300", text: "text-emerald-900" },
};

function fmtRemaining(ms) {
    if (ms <= 0) return "ending…";
    const m = Math.floor(ms / 60000);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}h ${m % 60}m left`;
    if (m > 0) return `${m}m left`;
    const s = Math.floor(ms / 1000);
    return `${s}s left`;
}

export default function ActiveEventBanner() {
    const [events, setEvents] = useState([]);
    const [tick, setTick] = useState(0);
    useEffect(() => {
        const fetch = () => userApi.get("/events/active").then((r) => setEvents(r.data || [])).catch(() => {});
        fetch();
        const t = setInterval(fetch, 60_000);
        const t2 = setInterval(() => setTick((n) => (n + 1) % 1000), 1000);
        return () => { clearInterval(t); clearInterval(t2); };
    }, []);
    const live = events.filter((e) => e.active);
    if (live.length === 0) return null;
    return (
        <div className="space-y-2" data-testid="active-event-banners">
            <AnimatePresence initial={false}>
                {live.map((ev) => {
                    const meta = STYLE[ev.event_type] || STYLE.legendary_hour;
                    const Icon = meta.Icon;
                    const remaining = new Date(ev.end_at).getTime() - Date.now();
                    return (
                        <motion.div
                            key={ev.id}
                            initial={{ opacity: 0, y: -8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -8 }}
                            className={`relative bg-gradient-to-r ${meta.bg} rounded-2xl shadow-lg px-3 py-2 flex items-center gap-3 ${meta.text} ring-1 ring-white/40`}
                            data-testid={`event-banner-${ev.event_type}`}
                        >
                            <motion.div
                                animate={{ rotate: [0, 8, -6, 0] }}
                                transition={{ repeat: Infinity, duration: 2.4 }}
                                className="rounded-full bg-white/40 p-2"
                            >
                                <Icon className="w-5 h-5" />
                            </motion.div>
                            <div className="flex-1 min-w-0">
                                <div className="text-xs uppercase tracking-widest font-black opacity-80">Live now</div>
                                <div className="font-heading text-base sm:text-lg font-black leading-tight truncate">
                                    {meta.label}
                                    {ev.target_pokemon_name ? `: ${ev.target_pokemon_name}` : ""}
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="text-[10px] uppercase tracking-widest font-bold opacity-80">{fmtRemaining(remaining)}</div>
                            </div>
                            {/* tick is read here so the timer re-renders */}
                            <span className="hidden">{tick}</span>
                        </motion.div>
                    );
                })}
            </AnimatePresence>
        </div>
    );
}
