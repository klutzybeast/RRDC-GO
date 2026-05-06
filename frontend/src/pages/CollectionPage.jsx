import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { userApi } from "../lib/api";
import { useUserAuth } from "../contexts/AuthContext";
import RarityBadge from "../components/RarityBadge";
import TypeBadge from "../components/TypeBadge";
import { Button } from "../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { ArrowLeft, ArrowUpDown } from "lucide-react";
import { motion } from "framer-motion";
import TrainerAvatar from "../components/TrainerAvatar";
import { loadAvatarColors } from "../components/TrainerCustomizer";
import SupervisorChallenge from "../components/SupervisorChallenge";

const RARITY_ORDER = { legendary: 4, rare: 3, uncommon: 2, common: 1 };

export default function CollectionPage() {
    const { user } = useUserAuth();
    const nav = useNavigate();
    const [bank, setBank] = useState(null);
    const [rarityFilter, setRarityFilter] = useState("all");
    const [sort, setSort] = useState("recent");
    const [selected, setSelected] = useState(null);
    const [buddy, setBuddy] = useState(null);
    const [candies, setCandies] = useState({});

    const refreshBuddyCandies = React.useCallback(() => {
        userApi.get("/buddy").then((r) => setBuddy(r.data)).catch(() => {});
        userApi.get("/candies").then((r) => setCandies(r.data || {})).catch(() => {});
    }, []);

    useEffect(() => {
        userApi.get("/bank").then((r) => setBank(r.data)).catch(() => setBank([]));
        refreshBuddyCandies();
    }, [refreshBuddyCandies]);

    const setBuddyTo = async (pokemon_id) => {
        try {
            const r = await userApi.post("/buddy/set", { pokemon_id });
            setBuddy(r.data);
            // brief toast via window.alert is not great; the parent has sonner. Use it.
            (await import("sonner")).toast.success("Buddy set! Walk with them to earn candies.");
        } catch (e) {
            (await import("sonner")).toast.error(e?.response?.data?.detail || "Could not set buddy");
        }
    };

    const evolveSelected = async () => {
        if (!selected) return;
        try {
            const r = await userApi.post("/evolve", { pokemon_id: selected.pokemon_id });
            const into = r.data?.evolved_into;
            (await import("sonner")).toast.success(`Evolved ${selected.name} → ${into?.name}!`);
            setSelected(null);
            // Refresh bank + candies
            const b = await userApi.get("/bank");
            setBank(b.data);
            refreshBuddyCandies();
        } catch (e) {
            (await import("sonner")).toast.error(e?.response?.data?.detail || "Could not evolve");
        }
    };

    const filtered = useMemo(() => {
        if (!bank) return [];
        let items = [...bank];
        if (rarityFilter !== "all") items = items.filter((b) => b.rarity === rarityFilter);
        items.sort((a, b) => {
            if (sort === "power") return (b.best_power || 0) - (a.best_power || 0);
            if (sort === "rarity") return (RARITY_ORDER[b.rarity] || 0) - (RARITY_ORDER[a.rarity] || 0);
            return new Date(b.last_caught_at) - new Date(a.last_caught_at);
        });
        return items;
    }, [bank, rarityFilter, sort]);

    const totalUnique = bank?.length || 0;
    const totalCatches = bank?.reduce((s, b) => s + b.count, 0) || 0;

    return (
        <div className="min-h-screen bg-river-50" data-testid="collection-page">
            <div className="max-w-6xl mx-auto p-4 sm:p-8">
                <div className="flex items-center justify-between mb-6">
                    <Button
                        variant="ghost"
                        onClick={() => nav("/map")}
                        className="rounded-full hover:bg-white"
                        data-testid="back-to-map-btn"
                    >
                        <ArrowLeft className="w-4 h-4 mr-2" /> Map
                    </Button>
                    <div className="text-right">
                        <div className="text-xs uppercase tracking-widest font-bold text-slate-500">Group {user?.group_name}</div>
                        <div className="font-heading text-sm font-bold text-slate-800">
                            {user?.first_name ? `${user.first_name} ${user.last_name}` : user?.username}
                        </div>
                    </div>
                </div>

                {/* Trainer card + supervisor challenge */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    <TrainerCard user={user} totalUnique={totalUnique} totalCatches={totalCatches} />
                    <SupervisorChallenge />
                </div>

                <div className="mb-8">
                    <h1 className="font-heading text-4xl sm:text-5xl font-bold text-slate-900">My Pokedex</h1>
                    <p className="text-slate-600 mt-2 font-medium">
                        <span data-testid="total-unique">{totalUnique}</span> unique · <span data-testid="total-catches">{totalCatches}</span> total catches
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-3 mb-6">
                    <Select value={rarityFilter} onValueChange={setRarityFilter}>
                        <SelectTrigger className="w-40 h-11 rounded-2xl bg-white" data-testid="rarity-filter-select">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All rarities</SelectItem>
                            <SelectItem value="common">Common</SelectItem>
                            <SelectItem value="uncommon">Uncommon</SelectItem>
                            <SelectItem value="rare">Rare</SelectItem>
                            <SelectItem value="legendary">Legendary</SelectItem>
                        </SelectContent>
                    </Select>

                    <Select value={sort} onValueChange={setSort}>
                        <SelectTrigger className="w-48 h-11 rounded-2xl bg-white" data-testid="sort-select">
                            <ArrowUpDown className="w-4 h-4 mr-2 text-slate-500" />
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="recent">Most Recent</SelectItem>
                            <SelectItem value="power">Highest Power</SelectItem>
                            <SelectItem value="rarity">Rarity Tier</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                {bank === null ? (
                    <div className="text-slate-500 text-center py-16">Loading…</div>
                ) : filtered.length === 0 ? (
                    <div className="bg-white rounded-3xl p-10 text-center border border-slate-200" data-testid="empty-collection">
                        <div className="font-heading text-2xl font-bold text-slate-700">No catches yet</div>
                        <p className="text-slate-500 mt-2">Head back to the map and catch your first Pokemon!</p>
                        <Button
                            onClick={() => nav("/map")}
                            className="tactile-btn mt-5 rounded-2xl bg-river-500 hover:bg-river-600 text-white font-heading"
                        >
                            Back to Map
                        </Button>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6" data-testid="bank-grid">
                        {filtered.map((p) => (
                            <motion.button
                                key={p.pokemon_id}
                                onClick={() => setSelected(p)}
                                whileHover={{ y: -4 }}
                                className="bg-white rounded-3xl overflow-hidden border border-slate-200 text-left shadow-sm hover:shadow-lg transition-shadow"
                                data-testid={`bank-card-${p.pokemon_id}`}
                            >
                                <div className={`aspect-square flex items-center justify-center rarity-${p.rarity}`}>
                                    {p.image_data_url ? (
                                        <img src={p.image_data_url} alt={p.name} className="max-w-[80%] max-h-[80%] drop-shadow-xl" />
                                    ) : (
                                        <div className="w-16 h-16 rounded-full bg-white/40" />
                                    )}
                                </div>
                                <div className="p-4">
                                    <div className="flex items-center justify-between gap-2">
                                        <h3 className="font-heading font-bold text-slate-900 truncate">{p.name}</h3>
                                        {p.count > 1 && (
                                            <span className="text-xs font-bold bg-river-100 text-river-700 px-2 py-0.5 rounded-full">×{p.count}</span>
                                        )}
                                    </div>
                                    <div className="mt-2 flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-1 flex-wrap">
                                            <RarityBadge rarity={p.rarity} />
                                            {p.type && p.type !== "normal" && <TypeBadge type={p.type} size="sm" />}
                                        </div>
                                        <span className="text-sm font-bold text-slate-700">PWR {p.best_power}</span>
                                    </div>
                                </div>
                            </motion.button>
                        ))}
                    </div>
                )}
            </div>

            {selected && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setSelected(null)} data-testid="bank-detail-modal">
                    <motion.div
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="bg-white rounded-[2rem] p-6 max-w-md w-full"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className={`rounded-2xl p-6 rarity-${selected.rarity} aspect-square flex items-center justify-center`}>
                            {selected.image_data_url && (
                                <img src={selected.image_data_url} alt={selected.name} className="max-w-[80%] max-h-[80%] drop-shadow-2xl" />
                            )}
                        </div>
                        <div className="mt-4 text-center">
                            <h2 className="font-heading text-3xl font-bold">{selected.name}</h2>
                            <div className="mt-2 flex items-center justify-center gap-2 flex-wrap">
                                <RarityBadge rarity={selected.rarity} />
                                {selected.type && selected.type !== "normal" && <TypeBadge type={selected.type} size="md" />}
                                <span className="text-xs text-slate-500">Caught ×{selected.count}</span>
                            </div>
                            <div className="mt-4 grid grid-cols-2 gap-3">
                                <div className="rounded-2xl bg-slate-50 p-3">
                                    <div className="text-xs uppercase tracking-widest font-bold text-slate-500">Best Power</div>
                                    <div className="font-heading text-2xl font-bold">{selected.best_power}</div>
                                </div>
                                <div className="rounded-2xl bg-slate-50 p-3">
                                    <div className="text-xs uppercase tracking-widest font-bold text-slate-500">Last</div>
                                    <div className="font-heading text-sm font-bold">{new Date(selected.last_caught_at).toLocaleDateString()}</div>
                                </div>
                            </div>
                            {selected.description && <p className="mt-4 text-sm text-slate-600 leading-relaxed">{selected.description}</p>}

                            {/* Buddy + Evolve actions */}
                            <div className="mt-4 grid grid-cols-1 gap-2">
                                <Button
                                    onClick={() => setBuddyTo(selected.pokemon_id)}
                                    disabled={buddy?.pokemon_id === selected.pokemon_id || (buddy?.can_swap_at && new Date(buddy.can_swap_at) > new Date())}
                                    variant="outline"
                                    className="rounded-2xl h-11 font-bold border-2 border-river-300"
                                    data-testid="set-buddy-btn"
                                >
                                    {buddy?.pokemon_id === selected.pokemon_id
                                        ? "💖 Walking with this buddy"
                                        : (buddy?.can_swap_at && new Date(buddy.can_swap_at) > new Date())
                                            ? `Swap available in ${Math.max(1, Math.ceil((new Date(buddy.can_swap_at) - new Date()) / 60000))}m`
                                            : "Set as Buddy"}
                                </Button>
                                {selected.evolution_target_id && (
                                    <div className="rounded-2xl bg-amber-50 border-2 border-amber-200 p-3" data-testid="evolution-card">
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-2 min-w-0">
                                                {selected.evolution_target_image && (
                                                    <img src={selected.evolution_target_image} alt={selected.evolution_target_name || "evolution"} className="w-10 h-10 object-contain" />
                                                )}
                                                <div className="min-w-0">
                                                    <div className="text-[10px] uppercase tracking-widest font-bold text-amber-700">Evolves into</div>
                                                    <div className="font-heading text-sm font-black text-slate-900 truncate">{selected.evolution_target_name}</div>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-[10px] uppercase tracking-widest font-bold text-slate-500">Candies</div>
                                                <div className="font-heading text-base font-black text-slate-900 tabular-nums">
                                                    {candies[selected.pokemon_id] || 0} / {selected.evolution_cost}
                                                </div>
                                            </div>
                                        </div>
                                        <Button
                                            onClick={evolveSelected}
                                            disabled={(candies[selected.pokemon_id] || 0) < selected.evolution_cost}
                                            className="mt-3 w-full tactile-btn bg-amber-500 hover:bg-amber-600 text-white rounded-2xl h-11 font-heading"
                                            data-testid="evolve-btn"
                                        >
                                            {(candies[selected.pokemon_id] || 0) < selected.evolution_cost
                                                ? `Need ${selected.evolution_cost - (candies[selected.pokemon_id] || 0)} more candies`
                                                : "Evolve!"}
                                        </Button>
                                    </div>
                                )}
                            </div>

                            <Button onClick={() => setSelected(null)} className="mt-3 w-full tactile-btn bg-river-500 hover:bg-river-600 text-white rounded-2xl h-12 font-heading">
                                Close
                            </Button>
                        </div>
                    </motion.div>
                </div>
            )}
        </div>
    );
}

function TrainerCard({ user, totalUnique, totalCatches }) {
    const colors = loadAvatarColors(user?.id);
    return (
        <div
            className="rounded-3xl p-4 shadow-md border border-emerald-200 flex items-center gap-4"
            style={{
                background: "linear-gradient(135deg, #ECFDF5 0%, #DBEAFE 100%)",
            }}
            data-testid="trainer-card"
        >
            <div className="relative shrink-0">
                <TrainerAvatar size={84} walking colors={colors} />
            </div>
            <div className="flex-1 min-w-0">
                <div className="text-[10px] uppercase tracking-widest font-black text-river-700">
                    Trainer Card
                </div>
                <div className="font-heading text-xl font-black text-slate-900 truncate" data-testid="trainer-card-name">
                    {user?.first_name ? `${user.first_name} ${user.last_name || ""}` : user?.username}
                </div>
                <div className="text-[11px] text-slate-600 font-bold uppercase tracking-widest">
                    Group {user?.group_name}
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2">
                    <div className="rounded-xl bg-white/70 px-2 py-1 text-center">
                        <div className="font-heading text-lg font-black text-slate-900 leading-none">{totalUnique}</div>
                        <div className="text-[9px] uppercase tracking-widest text-slate-500 font-bold">Unique</div>
                    </div>
                    <div className="rounded-xl bg-white/70 px-2 py-1 text-center">
                        <div className="font-heading text-lg font-black text-slate-900 leading-none">{totalCatches}</div>
                        <div className="text-[9px] uppercase tracking-widest text-slate-500 font-bold">Total</div>
                    </div>
                </div>
            </div>
        </div>
    );
}

