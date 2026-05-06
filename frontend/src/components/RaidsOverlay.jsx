import React, { useEffect, useState } from "react";
import { OverlayView } from "@react-google-maps/api";
import { motion } from "framer-motion";
import { Swords } from "lucide-react";
import { userApi } from "../lib/api";

/**
 * Map overlay showing currently-active raids (large red marker + RAID badge +
 * shared HP bar). Tap → calls onPick(raid) so the parent can open a screen.
 */
export default function RaidsOverlay({ onPick }) {
    const [raids, setRaids] = useState([]);
    useEffect(() => {
        let cancelled = false;
        const fetch = () => userApi.get("/raids/active").then((r) => !cancelled && setRaids(r.data || [])).catch(() => {});
        fetch();
        const t = setInterval(fetch, 8000);
        return () => { cancelled = true; clearInterval(t); };
    }, []);
    return (
        <>
            {raids.filter((r) => r.latitude != null && r.longitude != null && r.status === "active").map((r) => {
                const hpPct = Math.max(0, 100 - Math.round((r.damage_dealt / Math.max(1, r.max_hp)) * 100));
                return (
                    <OverlayView
                        key={r.id}
                        position={{ lat: r.latitude, lng: r.longitude }}
                        mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                    >
                        <motion.div
                            onClick={() => onPick && onPick(r)}
                            className="relative cursor-pointer select-none"
                            style={{ transform: "translate(-50%, -100%)" }}
                            initial={{ scale: 0.6, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            data-testid={`raid-marker-${r.id}`}
                        >
                            <motion.div
                                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 rounded-full pointer-events-none"
                                animate={{ scale: [1, 1.2, 1], opacity: [0.4, 0.8, 0.4] }}
                                transition={{ repeat: Infinity, duration: 1.6 }}
                                style={{ background: "radial-gradient(circle, rgba(220,38,38,0.6) 0%, rgba(220,38,38,0) 70%)", filter: "blur(8px)" }}
                            />
                            <div className="relative w-24 h-28 flex flex-col items-center">
                                <div className="absolute -top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-black tracking-widest uppercase shadow-md flex items-center gap-1 z-10">
                                    <Swords className="w-3 h-3" /> Raid
                                </div>
                                <motion.div
                                    animate={{ y: [0, -4, 0] }}
                                    transition={{ repeat: Infinity, duration: 1.8 }}
                                    className="w-20 h-20 rounded-full bg-white ring-4 ring-rose-500 shadow-2xl flex items-center justify-center overflow-hidden mt-1"
                                >
                                    {r.pokemon_image_data_url
                                        ? <img src={r.pokemon_image_data_url} alt={r.pokemon_name} className="w-full h-full object-contain" />
                                        : <Swords className="w-8 h-8 text-rose-600" />}
                                </motion.div>
                                {/* HP bar */}
                                <div className="w-20 h-2 mt-1 rounded-full bg-slate-900/70 overflow-hidden">
                                    <motion.div
                                        className="h-full bg-gradient-to-r from-rose-500 to-rose-300"
                                        animate={{ width: `${hpPct}%` }}
                                    />
                                </div>
                            </div>
                        </motion.div>
                    </OverlayView>
                );
            })}
        </>
    );
}
