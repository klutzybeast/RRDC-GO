import React, { useEffect, useState } from "react";
import { adminApi } from "../../lib/api";
import { Button } from "../../components/ui/button";
import { toast } from "sonner";
import { Trash2, Swords, Users, Square } from "lucide-react";

function pad(n) { return n.toString().padStart(2, "0"); }
function toLocalInput(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function RaidsTab() {
    const [raids, setRaids] = useState([]);
    const [pokemon, setPokemon] = useState([]);
    const [groups, setGroups] = useState([]);
    const [pinList, setPinList] = useState([]);
    const [pokemonId, setPokemonId] = useState("");
    const [groupCode, setGroupCode] = useState("");
    const [pinId, setPinId] = useState("");
    const now = new Date();
    const [startAt, setStartAt] = useState(toLocalInput(now));
    const [duration, setDuration] = useState(15);
    const [label, setLabel] = useState("");
    const [busy, setBusy] = useState(false);

    const refresh = async () => {
        try {
            const [r, p, g, pins] = await Promise.all([
                adminApi.get("/admin/raids"),
                adminApi.get("/admin/pokemon"),
                adminApi.get("/groups"),
                adminApi.get("/admin/map-pins"),
            ]);
            setRaids(r.data || []);
            setPokemon((p.data || []).filter((x) => x.active));
            setGroups((g.data || []).map((x) => x.group_code));
            setPinList((pins.data || []).filter((x) => x.active));
        } catch {
            toast.error("Failed to load raids");
        }
    };
    useEffect(() => { refresh(); }, []);

    const create = async () => {
        if (!pokemonId) { toast.error("Pick a Pokémon"); return; }
        const pin = pinList.find((p) => p.id === pinId);
        setBusy(true);
        try {
            await adminApi.post("/admin/raids", {
                pokemon_id: pokemonId,
                group_code: groupCode || null,
                start_at: new Date(startAt).toISOString(),
                duration_minutes: Number(duration) || 15,
                latitude: pin ? pin.latitude : null,
                longitude: pin ? pin.longitude : null,
                label: label || null,
            });
            toast.success("Raid scheduled");
            setLabel("");
            await refresh();
        } catch (e) {
            toast.error(e?.response?.data?.detail || "Could not schedule raid");
        } finally { setBusy(false); }
    };

    const forceEnd = async (id) => {
        if (!window.confirm("Force-end this raid?")) return;
        try { await adminApi.post(`/admin/raids/${id}/end`); toast.success("Raid ended"); await refresh(); }
        catch { toast.error("Could not end raid"); }
    };
    const remove = async (id) => {
        if (!window.confirm("Delete this raid?")) return;
        try { await adminApi.delete(`/admin/raids/${id}`); toast.success("Raid deleted"); await refresh(); }
        catch { toast.error("Could not delete raid"); }
    };

    return (
        <div className="space-y-6" data-testid="raids-tab">
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <h2 className="font-heading text-xl font-bold text-slate-900 mb-1">Schedule a raid</h2>
                <p className="text-sm text-slate-500 mb-4">Raids are co-op boss fights. Multiple campers tap and throw to fill a shared HP bar — when defeated, every participant gets the catch.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="block text-sm">
                        <span className="font-bold text-slate-700">Pokémon (boss)</span>
                        <select value={pokemonId} onChange={(e) => setPokemonId(e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 px-2 py-2" data-testid="raid-pokemon">
                            <option value="">— Pick a Pokémon —</option>
                            {pokemon.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.rarity})</option>)}
                        </select>
                    </label>
                    <label className="block text-sm">
                        <span className="font-bold text-slate-700">Group (or all)</span>
                        <select value={groupCode} onChange={(e) => setGroupCode(e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 px-2 py-2" data-testid="raid-group">
                            <option value="">All groups</option>
                            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
                        </select>
                    </label>
                    <label className="block text-sm">
                        <span className="font-bold text-slate-700">Map pin (location)</span>
                        <select value={pinId} onChange={(e) => setPinId(e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 px-2 py-2" data-testid="raid-pin">
                            <option value="">— No location (engageable from anywhere) —</option>
                            {pinList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                    </label>
                    <label className="block text-sm">
                        <span className="font-bold text-slate-700">Starts at</span>
                        <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 px-2 py-2" data-testid="raid-start" />
                    </label>
                    <label className="block text-sm">
                        <span className="font-bold text-slate-700">Duration (minutes)</span>
                        <input type="number" min="1" max="120" value={duration} onChange={(e) => setDuration(e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 px-2 py-2" data-testid="raid-duration" />
                    </label>
                    <label className="block text-sm sm:col-span-2">
                        <span className="font-bold text-slate-700">Label (optional)</span>
                        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Friday Color War boss" className="mt-1 w-full rounded-lg border-slate-300 px-2 py-2" data-testid="raid-label" />
                    </label>
                </div>
                <div className="mt-4 flex justify-end">
                    <Button onClick={create} disabled={busy} className="bg-rose-500 hover:bg-rose-600 text-white rounded-xl" data-testid="raid-create-btn">
                        {busy ? "Scheduling…" : "Schedule raid"}
                    </Button>
                </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <h2 className="font-heading text-xl font-bold text-slate-900 mb-3">All raids</h2>
                {raids.length === 0 ? (
                    <div className="text-sm text-slate-500 py-6 text-center">No raids scheduled.</div>
                ) : (
                    <ul className="divide-y divide-slate-100">
                        {raids.map((r) => {
                            const pct = Math.round((r.damage_dealt / Math.max(1, r.max_hp)) * 100);
                            return (
                                <li key={r.id} className="py-3 flex items-start gap-3" data-testid={`raid-row-${r.id}`}>
                                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${r.status === "active" ? "bg-rose-100 text-rose-700" : r.status === "defeated" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                                        <Swords className="w-5 h-5" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-bold text-slate-900 truncate">{r.pokemon_name}{r.group_code ? ` · ${r.group_code}` : " · all groups"}</div>
                                        <div className="text-xs text-slate-500">{new Date(r.start_at).toLocaleString()} → {new Date(r.end_at).toLocaleString()}</div>
                                        <div className="flex items-center gap-2 mt-1">
                                            <div className="flex-1 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                                                <div className="h-full bg-gradient-to-r from-rose-500 to-amber-300" style={{ width: `${pct}%` }} />
                                            </div>
                                            <span className="text-[11px] text-slate-500 tabular-nums whitespace-nowrap">{r.damage_dealt}/{r.max_hp}</span>
                                            <span className="text-[10px] flex items-center gap-1 text-slate-500"><Users className="w-3 h-3" /> {r.participants?.length || 0}</span>
                                        </div>
                                        {r.label && <div className="text-xs italic text-slate-600 mt-0.5">"{r.label}"</div>}
                                    </div>
                                    <span className={`text-[10px] uppercase tracking-widest font-bold rounded-full px-2 py-0.5 ${
                                        r.status === "active" ? "text-rose-700 bg-rose-100" :
                                        r.status === "defeated" ? "text-emerald-700 bg-emerald-100" :
                                        r.status === "expired" ? "text-slate-500 bg-slate-100" :
                                        "text-amber-700 bg-amber-100"
                                    }`}>{r.status}</span>
                                    {r.status === "active" && (
                                        <button onClick={() => forceEnd(r.id)} className="text-amber-600 hover:bg-amber-50 rounded-lg p-2" title="Force end" data-testid={`raid-end-${r.id}`}>
                                            <Square className="w-4 h-4" />
                                        </button>
                                    )}
                                    <button onClick={() => remove(r.id)} className="text-rose-500 hover:bg-rose-50 rounded-lg p-2" data-testid={`raid-delete-${r.id}`}>
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </div>
    );
}
