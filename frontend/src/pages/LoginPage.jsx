import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { motion, AnimatePresence } from "framer-motion";
import { API } from "../lib/api";
import { useUserAuth } from "../contexts/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { ArrowLeft, Play, Shield, Search } from "lucide-react";

const BG_URL = "https://customer-assets.emergentagent.com/job_river-catch-1/artifacts/ryl7u54o_image12.jpg";

export default function LoginPage() {
    const { user, loginCamper } = useUserAuth();
    const nav = useNavigate();
    const [stage, setStage] = useState("groups"); // groups | campers
    const [groups, setGroups] = useState(null);
    const [selectedGroup, setSelectedGroup] = useState(null);
    const [campers, setCampers] = useState(null);
    const [filter, setFilter] = useState("");
    const [loadingId, setLoadingId] = useState(null);
    const [err, setErr] = useState("");

    useEffect(() => { if (user) nav("/map"); }, [user, nav]);

    useEffect(() => {
        axios.get(`${API}/groups`).then((r) => setGroups(r.data)).catch(() => setGroups([]));
    }, []);

    const openGroup = async (g) => {
        setSelectedGroup(g);
        setCampers(null);
        setFilter("");
        setStage("campers");
        try {
            const r = await axios.get(`${API}/groups/${encodeURIComponent(g.group_code)}/campers`);
            setCampers(r.data);
        } catch {
            setCampers([]);
        }
    };

    const play = async (c) => {
        setLoadingId(c.id);
        setErr("");
        const ok = await loginCamper(c.id);
        setLoadingId(null);
        if (ok) nav("/map");
        else setErr("Couldn't sign you in. Ask a counselor.");
    };

    const filteredCampers = useMemo(() => {
        if (!campers) return null;
        const f = filter.trim().toLowerCase();
        if (!f) return campers;
        return campers.filter((c) => `${c.first_name} ${c.last_name}`.toLowerCase().includes(f));
    }, [campers, filter]);

    return (
        <div className="min-h-screen w-full relative" data-testid="login-page">
            <div
                className="fixed inset-0"
                style={{
                    backgroundImage: `url(${BG_URL})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                }}
            />
            <div className="fixed inset-0 bg-gradient-to-b from-sky-950/50 via-sky-900/30 to-emerald-950/60" />

            <div className="relative z-10 min-h-screen flex flex-col">
                <header className="px-4 sm:px-8 pt-4 sm:pt-6 flex items-center justify-between safe-top">
                    <div>
                        <div className="text-[10px] sm:text-[11px] tracking-[0.28em] sm:tracking-[0.32em] uppercase font-bold text-white/80">Rolling River Day Camp</div>
                        <h1 className="font-heading text-3xl sm:text-4xl md:text-5xl font-bold text-white drop-shadow-lg">
                            RRDC <span className="text-amber-300">GO</span>
                        </h1>
                    </div>
                    <button
                        onClick={() => nav("/admin/login")}
                        className="glass-dark rounded-full px-3 sm:px-4 py-2 text-white text-[11px] sm:text-xs font-bold flex items-center gap-1.5 sm:gap-2"
                        data-testid="admin-link"
                    >
                        <Shield className="w-3.5 h-3.5" /> Director
                    </button>
                </header>

                <div className="flex-1 flex items-start justify-center p-4 sm:p-8">
                    <motion.div
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="glass rounded-[2rem] p-5 sm:p-8 shadow-[0_20px_60px_rgba(0,0,0,0.35)] w-full max-w-3xl"
                    >
                        <AnimatePresence mode="wait">
                            {stage === "groups" && (
                                <motion.div key="groups" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                    <div className="flex items-center justify-between mb-4">
                                        <div>
                                            <h2 className="font-heading text-2xl sm:text-3xl font-bold text-slate-900">Pick your group</h2>
                                            <p className="text-sm text-slate-700">Tap your bunk, then your name.</p>
                                        </div>
                                        <div className="text-xs font-bold uppercase tracking-widest text-slate-500 bg-white/60 rounded-full px-3 py-1" data-testid="group-count-badge">
                                            {groups ? `${groups.length} groups` : "…"}
                                        </div>
                                    </div>
                                    {groups === null ? (
                                        <div className="text-center text-slate-600 py-10">Loading groups…</div>
                                    ) : groups.length === 0 ? (
                                        <div className="text-center text-slate-700 py-10">
                                            No groups yet. The director needs to sync the roster.
                                        </div>
                                    ) : (
                                        <div
                                            className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 sm:gap-3 max-h-[60vh] overflow-y-auto pr-1"
                                            data-testid="groups-grid"
                                        >
                                            {groups.map((g) => (
                                                <motion.button
                                                    key={g.group_code}
                                                    whileHover={{ y: -3 }}
                                                    whileTap={{ scale: 0.95 }}
                                                    onClick={() => openGroup(g)}
                                                    className="tactile-btn bg-white rounded-2xl p-4 text-left border border-slate-200 hover:border-river-400 transition-colors"
                                                    data-testid={`group-card-${g.group_code}`}
                                                >
                                                    <div className="font-heading text-2xl font-bold text-river-600">{g.group_code}</div>
                                                    <div className="text-xs text-slate-500 mt-1 font-semibold">{g.camper_count} campers</div>
                                                </motion.button>
                                            ))}
                                        </div>
                                    )}
                                </motion.div>
                            )}

                            {stage === "campers" && (
                                <motion.div key="campers" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                                    <div className="flex items-center gap-3 mb-4">
                                        <Button
                                            variant="ghost"
                                            onClick={() => { setStage("groups"); setSelectedGroup(null); }}
                                            className="rounded-full"
                                            data-testid="back-to-groups-btn"
                                        >
                                            <ArrowLeft className="w-4 h-4 mr-1" /> Groups
                                        </Button>
                                        <div>
                                            <h2 className="font-heading text-2xl sm:text-3xl font-bold text-slate-900">
                                                Group {selectedGroup?.group_code}
                                            </h2>
                                            <p className="text-xs text-slate-600">Find your name and tap play.</p>
                                        </div>
                                    </div>
                                    <div className="relative mb-4">
                                        <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                                        <Input
                                            value={filter}
                                            onChange={(e) => setFilter(e.target.value)}
                                            placeholder="Search by name…"
                                            className="rounded-2xl h-11 pl-10 bg-white"
                                            data-testid="camper-search-input"
                                        />
                                    </div>
                                    {campers === null ? (
                                        <div className="text-center text-slate-600 py-10">Loading campers…</div>
                                    ) : filteredCampers.length === 0 ? (
                                        <div className="text-center text-slate-600 py-10">No matching names.</div>
                                    ) : (
                                        <div
                                            className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[55vh] overflow-y-auto pr-1"
                                            data-testid="campers-list"
                                        >
                                            {filteredCampers.map((c) => (
                                                <div
                                                    key={c.id}
                                                    className="flex items-center justify-between bg-white rounded-2xl border border-slate-200 p-3"
                                                    data-testid={`camper-row-${c.id}`}
                                                >
                                                    <div className="flex items-center gap-3 min-w-0">
                                                        <div className="w-10 h-10 rounded-full bg-river-100 text-river-700 flex items-center justify-center font-heading font-bold shrink-0">
                                                            {c.first_name?.[0]}{c.last_name?.[0]}
                                                        </div>
                                                        <div className="min-w-0">
                                                            <div className="font-bold text-slate-900 truncate">{c.first_name} {c.last_name}</div>
                                                            <div className="text-[11px] uppercase tracking-widest font-semibold text-slate-400">{c.group_code}</div>
                                                        </div>
                                                    </div>
                                                    <Button
                                                        onClick={() => play(c)}
                                                        disabled={loadingId === c.id}
                                                        className="tactile-btn rounded-full bg-emerald-500 hover:bg-emerald-600 text-white font-bold h-9 px-4"
                                                        data-testid={`play-camper-${c.id}`}
                                                    >
                                                        {loadingId === c.id ? "…" : (<><Play className="w-4 h-4 mr-1" /> Play</>)}
                                                    </Button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </motion.div>
                            )}
                        </AnimatePresence>
                        {err && <div className="mt-4 text-red-600 text-sm font-bold" data-testid="login-error">{err}</div>}
                    </motion.div>
                </div>
                <footer className="py-4 text-center text-xs text-white/70 safe-bottom">
                    No passwords — just pick your name from your group.<br className="sm:hidden"/>
                    <span className="text-[10px] opacity-80">Works on phone, tablet & desktop.</span>
                </footer>
            </div>
        </div>
    );
}
