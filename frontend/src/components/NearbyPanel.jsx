import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Eye, X } from "lucide-react";
import { userApi } from "../lib/api";
import RarityBadge from "./RarityBadge";

// CSS to render an image as a black silhouette. The image gets sucked to
// 100% black, so a raw PNG with transparency becomes a clean "?" silhouette.
const SILHOUETTE_STYLE = {
    filter: "brightness(0) saturate(100%)",
};

export default function NearbyPanel({ spawns, myLocation, catchRadius = 40, onPick }) {
    const [open, setOpen] = useState(false);
    const [seenIds, setSeenIds] = useState(null); // null = loading, Set when ready

    // Fetch the camper's bank once when panel first opens (and refresh on open).
    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        userApi.get("/bank").then((r) => {
            if (cancelled) return;
            const ids = new Set((r.data || []).map((b) => b.pokemon_id));
            setSeenIds(ids);
        }).catch(() => !cancelled && setSeenIds(new Set()));
        return () => { cancelled = true; };
    }, [open]);

    const items = useMemo(() => {
        const arr = (spawns || []).map((s) => {
            let dist = Infinity;
            if (myLocation && s?.latitude && s?.longitude) {
                const R = 6371000;
                const toRad = (d) => (d * Math.PI) / 180;
                const dLat = toRad(s.latitude - myLocation.lat);
                const dLng = toRad(s.longitude - myLocation.lng);
                const a = Math.sin(dLat / 2) ** 2
                    + Math.cos(toRad(myLocation.lat))
                    * Math.cos(toRad(s.latitude))
                    * Math.sin(dLng / 2) ** 2;
                dist = 2 * R * Math.asin(Math.sqrt(a));
            }
            return { spawn: s, dist };
        });
        arr.sort((a, b) => a.dist - b.dist);
        return arr;
    }, [spawns, myLocation]);

    const newCount = useMemo(() => {
        if (!seenIds) return 0;
        return items.reduce((n, it) => n + (seenIds.has(it.spawn.pokemon?.id) ? 0 : 1), 0);
    }, [items, seenIds]);

    return (
        <>
            <button
                onClick={() => setOpen(true)}
                className="relative bg-white/95 backdrop-blur-sm rounded-full px-4 py-2 shadow-lg flex items-center gap-2 hover:bg-white transition-colors"
                data-testid="nearby-pill"
            >
                <Eye className="w-4 h-4 text-river-600" />
                <span className="text-sm font-bold text-slate-900">Nearby</span>
                <span className="text-xs font-bold text-slate-500">
                    {items.length}
                </span>
                {newCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-fuchsia-500 text-white text-[10px] font-bold rounded-full px-1.5 min-w-[18px] h-[18px] flex items-center justify-center" data-testid="nearby-new-badge">
                        {newCount} new
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
                        data-testid="nearby-modal"
                    >
                        <motion.div
                            className="w-full max-w-md bg-white rounded-[2rem] shadow-2xl flex flex-col"
                            style={{ maxHeight: "calc(100dvh - 1.5rem)" }}
                            initial={{ y: 80, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={{ y: 80, opacity: 0 }}
                            transition={{ type: "spring", bounce: 0.4, duration: 0.5 }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="px-5 pt-5 pb-3 flex-shrink-0 border-b border-slate-100">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="text-xs uppercase tracking-widest font-bold text-river-600">Around you</div>
                                        <h2 className="font-heading text-2xl font-bold text-slate-900">
                                            Nearby Pokémon
                                        </h2>
                                    </div>
                                    <button onClick={() => setOpen(false)} className="p-2 -m-2 rounded-full hover:bg-slate-100" data-testid="close-nearby">
                                        <X className="w-5 h-5 text-slate-500" />
                                    </button>
                                </div>
                                <p className="text-xs text-slate-500 mt-1.5">
                                    Tap one to chase it. Black silhouettes mean you haven't caught one yet.
                                </p>
                            </div>

                            <div
                                className="flex-1 min-h-0 overflow-y-auto px-5 py-4"
                                style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y", overscrollBehavior: "contain" }}
                                data-testid="nearby-scroll"
                            >
                                {items.length === 0 ? (
                                    <div className="text-center text-slate-400 text-sm py-10">
                                        No Pokémon spawning right around you yet. Walk a bit and check again!
                                    </div>
                                ) : (
                                    <ul className="grid grid-cols-2 gap-3">
                                        {items.map(({ spawn: s, dist }) => {
                                            const seen = seenIds && seenIds.has(s.pokemon?.id);
                                            const inRange = isFinite(dist) && dist <= catchRadius;
                                            return (
                                                <li
                                                    key={s.spawn_id}
                                                    className={`relative rounded-2xl bg-slate-50 border-2 ${inRange ? "border-emerald-400" : "border-slate-200"} p-3 flex flex-col items-center text-center cursor-pointer hover:bg-slate-100 transition-colors`}
                                                    onClick={() => { onPick && onPick(s); setOpen(false); }}
                                                    data-testid={`nearby-item-${s.spawn_id}`}
                                                >
                                                    <div className="aspect-square w-full bg-white rounded-xl flex items-center justify-center overflow-hidden">
                                                        {s.pokemon?.image_data_url ? (
                                                            <img
                                                                src={s.pokemon.image_data_url}
                                                                alt={seen ? s.pokemon.name : "Unknown Pokémon"}
                                                                className="w-full h-full object-contain"
                                                                style={seen ? undefined : SILHOUETTE_STYLE}
                                                                loading="lazy"
                                                            />
                                                        ) : (
                                                            <div className="text-3xl text-slate-300 font-black">?</div>
                                                        )}
                                                    </div>
                                                    <div className="mt-2 w-full">
                                                        <div className="font-bold text-slate-900 text-sm leading-tight truncate">
                                                            {seen ? s.pokemon.name : "???"}
                                                        </div>
                                                        <div className="mt-1 flex items-center justify-center gap-1.5 flex-wrap">
                                                            <RarityBadge rarity={s.pokemon?.rarity || "common"} className="text-[9px] px-1.5 py-0" />
                                                            <span className={`text-[10px] font-bold tabular-nums ${inRange ? "text-emerald-600" : "text-slate-500"}`}>
                                                                {isFinite(dist) ? `${Math.round(dist)} m` : "—"}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    {!seen && (
                                                        <span className="absolute top-1.5 right-1.5 bg-fuchsia-500 text-white text-[9px] font-bold rounded-full px-1.5 py-0.5 uppercase tracking-wider">
                                                            New
                                                        </span>
                                                    )}
                                                    {inRange && (
                                                        <span className="absolute top-1.5 left-1.5 bg-emerald-500 text-white text-[9px] font-bold rounded-full px-1.5 py-0.5 uppercase tracking-wider">
                                                            In range
                                                        </span>
                                                    )}
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}
