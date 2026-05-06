import React, { useEffect, useState } from "react";
import { OverlayView } from "@react-google-maps/api";
import { motion } from "framer-motion";
import { userApi } from "../lib/api";

/**
 * Kid-safe peer overlay. Same-group campers only, first-name only, no chat.
 * Backend-gated by SpawnConfig.show_group_positions. Stale entries (>10min)
 * are filtered out server-side.
 */
export default function GroupCampersOverlay() {
    const [peers, setPeers] = useState([]);
    useEffect(() => {
        let cancelled = false;
        const fetch = () => {
            userApi.get("/map/group-positions").then((r) => {
                if (!cancelled) setPeers(r.data || []);
            }).catch(() => {});
        };
        fetch();
        const t = setInterval(fetch, 10000);
        return () => { cancelled = true; clearInterval(t); };
    }, []);
    return (
        <>
            {peers.map((p) => (
                <OverlayView
                    key={p.camper_id}
                    position={{ lat: p.latitude, lng: p.longitude }}
                    mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                >
                    <motion.div
                        className="relative"
                        style={{ transform: "translate(-50%, -100%)" }}
                        initial={{ opacity: 0, scale: 0.7 }}
                        animate={{ opacity: 1, scale: 1 }}
                        data-testid={`peer-camper-${p.camper_id}`}
                    >
                        <div className="flex flex-col items-center">
                            <div className="px-2 py-0.5 rounded-full bg-white/95 border-2 border-river-300 shadow-md text-[11px] font-bold text-slate-900 whitespace-nowrap max-w-[120px] truncate">
                                {p.first_name}
                            </div>
                            <motion.div
                                className="w-7 h-7 rounded-full bg-gradient-to-br from-sky-300 to-river-500 ring-2 ring-white shadow-lg mt-0.5"
                                animate={{ y: [0, -2, 0] }}
                                transition={{ repeat: Infinity, duration: 2.4, ease: "easeInOut" }}
                            />
                        </div>
                    </motion.div>
                </OverlayView>
            ))}
        </>
    );
}
