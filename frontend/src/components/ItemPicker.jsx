import React, { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Apple, Egg, X } from "lucide-react";
import { userApi } from "../lib/api";
import { sfx } from "../lib/soundFx";

/**
 * Compact in-AR item picker. Reads `/inventory`, lets the camper consume one
 * razz berry (one-shot retention buff) or lucky egg (30-min ball-reward 2×).
 * Renders nothing when the camper has neither items nor active buffs.
 *
 * Props:
 *   - onConsume(item)  optional callback after a successful POST so the
 *                      parent can flash a banner / haptic.
 */
export default function ItemPicker({ onConsume }) {
    const [data, setData] = useState(null);
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(null);

    const refresh = useCallback(async () => {
        try {
            const r = await userApi.get("/inventory");
            setData(r.data);
        } catch { /* noop */ }
    }, []);

    useEffect(() => {
        refresh();
        const t = setInterval(refresh, 15000);
        return () => clearInterval(t);
    }, [refresh]);

    const items = data?.items || {};
    const buffs = data?.buffs || {};
    const totalItems = (Number(items.razz_berry || 0) + Number(items.lucky_egg || 0));
    const buffActive = buffs.razz_berry_pending || buffs.lucky_egg_active;
    if (totalItems === 0 && !buffActive) return null;

    const use = async (kind) => {
        setBusy(kind);
        try {
            await userApi.post("/inventory/use", { item: kind });
            sfx.uiTap();
            if (navigator.vibrate) navigator.vibrate(40);
            await refresh();
            if (onConsume) onConsume(kind);
            setOpen(false);
        } catch (e) {
            const { toast } = await import("sonner");
            toast.error(e?.response?.data?.detail || "Could not use item");
        } finally { setBusy(null); }
    };

    const luckyMin = Math.max(0, Math.ceil((buffs.lucky_egg_seconds_left || 0) / 60));

    return (
        <>
            <button
                onClick={() => setOpen(true)}
                className="relative bg-white/95 backdrop-blur-sm rounded-full p-2 shadow-lg ring-1 ring-slate-200 hover:bg-white transition-colors flex items-center gap-1"
                title="Use razz berry or lucky egg"
                data-testid="ar-item-picker-btn"
            >
                <span className="text-xs font-black text-slate-900 tabular-nums">{totalItems}</span>
                <Apple className="w-3.5 h-3.5 text-rose-500" />
                {buffs.razz_berry_pending && (
                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ring-white animate-pulse" data-testid="razz-pending-dot" />
                )}
                {buffs.lucky_egg_active && (
                    <span className="absolute -top-1 -left-1 w-2.5 h-2.5 rounded-full bg-amber-400 ring-2 ring-white animate-pulse" data-testid="lucky-active-dot" />
                )}
            </button>

            <AnimatePresence>
                {open && (
                    <motion.div
                        className="fixed inset-0 z-[2050] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-2 sm:p-4"
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        onClick={() => setOpen(false)}
                        data-testid="ar-item-picker-modal"
                    >
                        <motion.div
                            onClick={(e) => e.stopPropagation()}
                            initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
                            className="bg-white rounded-3xl w-full max-w-sm p-4 shadow-2xl"
                        >
                            <div className="flex items-start justify-between mb-3">
                                <div>
                                    <div className="text-[10px] uppercase tracking-widest font-black text-river-600">Use an item</div>
                                    <div className="font-heading text-lg font-black text-slate-900">Boost your next throws</div>
                                </div>
                                <button onClick={() => setOpen(false)} className="rounded-full p-2 hover:bg-slate-100" data-testid="ar-item-picker-close"><X className="w-5 h-5" /></button>
                            </div>

                            <div className="space-y-2">
                                <button
                                    onClick={() => use("razz_berry")}
                                    disabled={busy || (Number(items.razz_berry || 0) < 1) || buffs.razz_berry_pending}
                                    className="w-full flex items-center gap-3 p-3 rounded-2xl border-2 border-rose-200 bg-rose-50 hover:bg-rose-100 disabled:opacity-50 disabled:cursor-not-allowed text-left"
                                    data-testid="ar-use-razz"
                                >
                                    <div className="w-10 h-10 rounded-xl bg-rose-200 flex items-center justify-center"><Apple className="w-6 h-6 text-rose-700" /></div>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-bold text-rose-900">Razz Berry × {Number(items.razz_berry || 0)}</div>
                                        <div className="text-[11px] text-rose-700 leading-tight">+30% retention on your NEXT throw. Single-use.</div>
                                    </div>
                                    {buffs.razz_berry_pending && <span className="text-[10px] uppercase font-bold text-rose-600">primed</span>}
                                </button>
                                <button
                                    onClick={() => use("lucky_egg")}
                                    disabled={busy || (Number(items.lucky_egg || 0) < 1)}
                                    className="w-full flex items-center gap-3 p-3 rounded-2xl border-2 border-amber-200 bg-amber-50 hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed text-left"
                                    data-testid="ar-use-lucky"
                                >
                                    <div className="w-10 h-10 rounded-xl bg-amber-200 flex items-center justify-center"><Egg className="w-6 h-6 text-amber-700" /></div>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-bold text-amber-900">Lucky Egg × {Number(items.lucky_egg || 0)}</div>
                                        <div className="text-[11px] text-amber-800 leading-tight">2× pokeball rewards from catches for 30 minutes. Stacks if you use another while one is active.</div>
                                    </div>
                                    {buffs.lucky_egg_active && <span className="text-[10px] uppercase font-bold text-amber-700">{luckyMin}m left</span>}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}
