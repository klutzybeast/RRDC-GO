import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Heart } from "lucide-react";
import { userApi } from "../lib/api";

/**
 * Compact buddy chip — sits in the top action row when the camper has chosen
 * a buddy. Shows the buddy's image + walked distance + candy count. Tapping
 * navigates to the Collection page (where buddy can be swapped/evolved).
 *
 * Reward thresholds (kept in sync with backend constants):
 *  - +1 pokeball per 100 m walked with buddy
 *  - +1 candy per 1000 m walked with buddy
 */
export default function BuddyStrip({ onTap }) {
    const [buddy, setBuddy] = useState(null);
    useEffect(() => {
        let cancelled = false;
        const load = () => userApi.get("/buddy").then((r) => !cancelled && setBuddy(r.data)).catch(() => {});
        load();
        const t = setInterval(load, 30_000);
        return () => { cancelled = true; clearInterval(t); };
    }, []);
    if (!buddy || !buddy.pokemon_id) return null;
    const meters = Math.round(buddy.distance_with_buddy_m || 0);
    const km = (meters / 1000).toFixed(2);
    return (
        <button
            onClick={onTap}
            className="bg-white/95 backdrop-blur-sm rounded-full pl-1 pr-3 py-1 shadow-lg flex items-center gap-2 hover:bg-white transition-colors"
            data-testid="buddy-strip"
            title={`Walking with ${buddy.pokemon_name}`}
        >
            <motion.div
                animate={{ rotate: [-3, 3, -3], y: [0, -2, 0] }}
                transition={{ repeat: Infinity, duration: 2.5 }}
                className="w-9 h-9 rounded-full overflow-hidden bg-gradient-to-br from-sky-100 to-emerald-100 flex items-center justify-center ring-2 ring-white"
            >
                {buddy.pokemon_image_data_url
                    ? <img src={buddy.pokemon_image_data_url} alt={buddy.pokemon_name} className="w-full h-full object-contain" />
                    : <Heart className="w-4 h-4 text-rose-500" />}
            </motion.div>
            <div className="flex flex-col items-start leading-none">
                <div className="text-[10px] uppercase tracking-widest font-bold text-river-600">Buddy</div>
                <div className="text-xs font-black text-slate-900 truncate max-w-[80px]">{buddy.pokemon_name}</div>
            </div>
            <div className="flex flex-col items-end leading-none">
                <div className="text-[11px] font-black text-slate-900 tabular-nums">{km} km</div>
                <div className="text-[10px] uppercase tracking-widest font-bold text-amber-700">🍬 {buddy.candies}</div>
            </div>
        </button>
    );
}
