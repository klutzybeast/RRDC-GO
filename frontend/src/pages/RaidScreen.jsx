import React, { useEffect, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Swords, Trophy, Users } from "lucide-react";
import { userApi } from "../lib/api";
import { Button } from "../components/ui/button";
import { useUserAuth } from "../contexts/AuthContext";
import RarityBadge from "../components/RarityBadge";
import { toast } from "sonner";

export default function RaidScreen() {
    const { raidId } = useParams();
    const nav = useNavigate();
    const { wallet, refresh: refreshWallet } = useUserAuth();
    const [raid, setRaid] = useState(null);
    const [throwing, setThrowing] = useState(false);
    const [defeated, setDefeated] = useState(false);
    const [errMsg, setErrMsg] = useState("");

    const refresh = useCallback(() => {
        userApi.get(`/raids/${raidId}`).then((r) => setRaid(r.data)).catch(() => setErrMsg("Could not load this raid"));
    }, [raidId]);

    useEffect(() => {
        refresh();
        const t = setInterval(refresh, 4000);
        return () => clearInterval(t);
    }, [refresh]);

    const onThrow = async () => {
        if (!raid || throwing || defeated) return;
        setThrowing(true);
        try {
            const ball = "pokeball"; // raids only consume pokeballs by default; future: choose ball type
            const r = await userApi.post(`/raids/${raidId}/throw`, null, { params: { ball_type: ball } });
            refreshWallet();
            if (r.data.defeated) {
                setDefeated(true);
                toast.success("🎉 Raid defeated! Pokémon added to your collection.");
                if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200]);
            } else {
                if (navigator.vibrate) navigator.vibrate(40);
            }
            setRaid((prev) => prev ? { ...prev, damage_dealt: r.data.damage_dealt, max_hp: r.data.max_hp } : prev);
        } catch (e) {
            const msg = e?.response?.data?.detail || "Throw failed";
            toast.error(msg);
        } finally {
            setThrowing(false);
        }
    };

    if (errMsg) {
        return (
            <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-6 text-center">
                <div>
                    <p className="text-lg font-bold mb-3">{errMsg}</p>
                    <Button onClick={() => nav("/map")} className="bg-river-500 hover:bg-river-600 text-white" data-testid="raid-back-btn">Back to map</Button>
                </div>
            </div>
        );
    }
    if (!raid) {
        return <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">Loading raid…</div>;
    }
    const hpPct = Math.max(0, 100 - Math.round((raid.damage_dealt / Math.max(1, raid.max_hp)) * 100));
    const balls = (wallet?.balances?.pokeball ?? 0);
    const canThrow = raid.status === "active" && raid.can_engage && balls > 0 && !defeated;

    return (
        <div className="min-h-screen bg-gradient-to-b from-rose-900 via-slate-900 to-slate-900 text-white relative overflow-hidden" data-testid="raid-screen">
            {/* Top bar */}
            <div className="absolute top-3 left-3 right-3 flex items-center justify-between z-20">
                <button onClick={() => nav("/map")} className="bg-white/15 hover:bg-white/25 rounded-full p-2 backdrop-blur-sm" data-testid="raid-exit-btn">
                    <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-rose-600/90 text-white text-xs font-black uppercase tracking-widest shadow-lg">
                    <Swords className="w-4 h-4" /> Raid
                </div>
                <div className="text-right">
                    <div className="text-[10px] uppercase tracking-widest opacity-70">Pokéballs</div>
                    <div className="font-heading text-xl font-black tabular-nums">{balls}</div>
                </div>
            </div>

            {/* Pokémon */}
            <div className="absolute inset-0 flex items-center justify-center px-6">
                <motion.div
                    className="relative"
                    animate={defeated ? { scale: 0.7, opacity: 0.4, rotate: [0, 8, -8, 0] } : { scale: [1, 1.04, 1] }}
                    transition={{ repeat: defeated ? 0 : Infinity, duration: 2.2 }}
                    style={{ width: "62vw", maxWidth: 380, aspectRatio: "1/1" }}
                >
                    <div className="absolute inset-0 rounded-full" style={{ background: "radial-gradient(circle, rgba(248,113,113,0.55) 0%, rgba(0,0,0,0) 65%)", filter: "blur(8px)" }} />
                    {raid.pokemon_image_data_url ? (
                        <img src={raid.pokemon_image_data_url} alt={raid.pokemon_name} className="relative w-full h-full object-contain drop-shadow-2xl" draggable={false} />
                    ) : (
                        <Swords className="relative w-24 h-24 text-rose-300 mx-auto mt-8" />
                    )}
                </motion.div>
            </div>

            {/* Bottom HUD */}
            <div className="absolute bottom-0 left-0 right-0 p-5 z-20 space-y-4">
                <div className="space-y-1">
                    <div className="flex items-end justify-between">
                        <div>
                            <div className="text-[10px] uppercase tracking-widest opacity-70">Boss</div>
                            <h1 className="font-heading text-2xl font-black flex items-center gap-2">
                                {raid.pokemon_name}
                                <RarityBadge rarity={raid.rarity} />
                            </h1>
                        </div>
                        <div className="flex items-center gap-1 text-xs opacity-80" title="Participants so far">
                            <Users className="w-4 h-4" /> {raid.participants?.length || 0}
                        </div>
                    </div>
                    {/* HP bar */}
                    <div className="w-full h-3 rounded-full bg-white/15 overflow-hidden ring-1 ring-white/20">
                        <motion.div className="h-full bg-gradient-to-r from-rose-500 via-rose-300 to-amber-300" animate={{ width: `${hpPct}%` }} transition={{ type: "spring", stiffness: 80, damping: 20 }} />
                    </div>
                    <div className="flex justify-between text-[11px] opacity-75 font-bold">
                        <span data-testid="raid-hp-text">HP {Math.max(0, raid.max_hp - raid.damage_dealt)} / {raid.max_hp}</span>
                        <span>{Math.round((raid.damage_dealt / Math.max(1, raid.max_hp)) * 100)}% damage dealt</span>
                    </div>
                </div>

                <AnimatePresence>
                    {defeated && (
                        <motion.div
                            initial={{ scale: 0.6, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="rounded-3xl bg-emerald-500/95 text-emerald-950 px-5 py-4 text-center font-heading font-black shadow-2xl"
                            data-testid="raid-defeated-banner"
                        >
                            <Trophy className="w-7 h-7 mx-auto" />
                            <div className="text-2xl mt-1">RAID DEFEATED!</div>
                            <div className="text-xs font-bold opacity-80 mt-0.5">All participants caught {raid.pokemon_name}.</div>
                            <Button onClick={() => nav("/collection")} className="mt-3 bg-white hover:bg-white/90 text-emerald-700 rounded-full" data-testid="raid-go-collection">See it in your Collection</Button>
                        </motion.div>
                    )}
                </AnimatePresence>

                {!defeated && (
                    <Button
                        onClick={onThrow}
                        disabled={!canThrow || throwing}
                        className="w-full h-14 rounded-3xl bg-rose-500 hover:bg-rose-600 disabled:bg-slate-600 text-white font-heading font-black text-lg tactile-btn shadow-xl"
                        data-testid="raid-throw-btn"
                    >
                        {throwing ? "Throwing…"
                            : !raid.can_engage ? "Walk closer to the raid pin"
                                : balls < 1 ? "Out of pokeballs"
                                    : `Attack! (-1 ball, deal damage)`}
                    </Button>
                )}
            </div>
        </div>
    );
}
