import React, { useEffect, useState } from "react";
import { adminApi } from "../../lib/api";
import { Button } from "../../components/ui/button";
import { toast } from "sonner";
import { Trash2, Calendar, Sparkles, Star, CalendarDays } from "lucide-react";

const EVENT_TYPES = [
    { id: "legendary_hour", label: "Legendary Hour", icon: Star, blurb: "Boost legendary spawn rate 6× for the window." },
    { id: "double_balls", label: "Double Balls", icon: Sparkles, blurb: "Catch rewards 2× pokeballs for every successful catch." },
    { id: "spotlight", label: "Spotlight", icon: CalendarDays, blurb: "Pick one Pokémon — 10× more likely to spawn." },
    { id: "community_day", label: "Community Day", icon: Calendar, blurb: "Pick one Pokémon — it ALWAYS spawns until the event ends." },
];

function pad(n) { return n.toString().padStart(2, "0"); }
function toLocalInput(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function EventsTab() {
    const [events, setEvents] = useState([]);
    const [pokemon, setPokemon] = useState([]);
    const [eventType, setEventType] = useState("legendary_hour");
    const now = new Date();
    const inAnHour = new Date(now.getTime() + 60 * 60 * 1000);
    const [startAt, setStartAt] = useState(toLocalInput(now));
    const [endAt, setEndAt] = useState(toLocalInput(inAnHour));
    const [targetId, setTargetId] = useState("");
    const [label, setLabel] = useState("");
    const [busy, setBusy] = useState(false);

    const refresh = async () => {
        try {
            const [e, p] = await Promise.all([
                adminApi.get("/admin/events"),
                adminApi.get("/admin/pokemon", { params: { active_only: "true" } }).catch(() => adminApi.get("/admin/pokemon")),
            ]);
            setEvents(e.data || []);
            setPokemon((p.data || []).filter((x) => x.active));
        } catch (err) {
            toast.error("Failed to load events");
        }
    };

    useEffect(() => { refresh(); }, []);

    const needsTarget = eventType === "spotlight" || eventType === "community_day";

    const create = async () => {
        if (needsTarget && !targetId) {
            toast.error("Pick a Pokémon for this event type");
            return;
        }
        setBusy(true);
        try {
            await adminApi.post("/admin/events", {
                event_type: eventType,
                start_at: new Date(startAt).toISOString(),
                end_at: new Date(endAt).toISOString(),
                target_pokemon_id: needsTarget ? targetId : null,
                label: label || null,
            });
            toast.success("Event scheduled");
            setLabel("");
            setTargetId("");
            await refresh();
        } catch (err) {
            const msg = err?.response?.data?.detail || "Could not schedule event";
            toast.error(msg);
        } finally {
            setBusy(false);
        }
    };

    const cancel = async (id) => {
        if (!window.confirm("Cancel this event?")) return;
        try {
            await adminApi.delete(`/admin/events/${id}`);
            toast.success("Event cancelled");
            await refresh();
        } catch {
            toast.error("Could not cancel event");
        }
    };

    return (
        <div className="space-y-6" data-testid="events-tab">
            {/* Create form */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <h2 className="font-heading text-xl font-bold text-slate-900 mb-1">Schedule a new event</h2>
                <p className="text-sm text-slate-500 mb-4">Events run automatically between start and end times. Times are in your local timezone.</p>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                    {EVENT_TYPES.map((t) => {
                        const Icon = t.icon;
                        const sel = eventType === t.id;
                        return (
                            <button
                                key={t.id}
                                onClick={() => setEventType(t.id)}
                                className={`p-3 rounded-xl border-2 text-left transition-colors ${sel ? "border-river-500 bg-river-50" : "border-slate-200 hover:bg-slate-50"}`}
                                data-testid={`event-type-${t.id}`}
                            >
                                <Icon className="w-5 h-5 text-river-600 mb-1" />
                                <div className="text-sm font-bold text-slate-900">{t.label}</div>
                                <div className="text-[11px] text-slate-500 leading-tight mt-0.5">{t.blurb}</div>
                            </button>
                        );
                    })}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="block text-sm">
                        <span className="font-bold text-slate-700">Starts at</span>
                        <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 px-2 py-2" data-testid="event-start" />
                    </label>
                    <label className="block text-sm">
                        <span className="font-bold text-slate-700">Ends at</span>
                        <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 px-2 py-2" data-testid="event-end" />
                    </label>
                    {needsTarget && (
                        <label className="block text-sm sm:col-span-2">
                            <span className="font-bold text-slate-700">Target Pokémon</span>
                            <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 px-2 py-2" data-testid="event-target">
                                <option value="">— Pick a Pokémon —</option>
                                {pokemon.map((p) => (
                                    <option key={p.id} value={p.id}>{p.name} ({p.rarity})</option>
                                ))}
                            </select>
                        </label>
                    )}
                    <label className="block text-sm sm:col-span-2">
                        <span className="font-bold text-slate-700">Label (optional)</span>
                        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Saturday legendary surge" className="mt-1 w-full rounded-lg border-slate-300 px-2 py-2" data-testid="event-label" />
                    </label>
                </div>

                <div className="mt-4 flex justify-end">
                    <Button onClick={create} disabled={busy} className="bg-river-500 hover:bg-river-600 text-white rounded-xl" data-testid="event-create-btn">
                        {busy ? "Scheduling…" : "Schedule event"}
                    </Button>
                </div>
            </div>

            {/* List */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <h2 className="font-heading text-xl font-bold text-slate-900 mb-3">All events</h2>
                {events.length === 0 ? (
                    <div className="text-sm text-slate-500 py-6 text-center">No events scheduled yet.</div>
                ) : (
                    <ul className="divide-y divide-slate-100">
                        {events.map((ev) => {
                            const start = new Date(ev.start_at);
                            const end = new Date(ev.end_at);
                            const meta = EVENT_TYPES.find((t) => t.id === ev.event_type);
                            return (
                                <li key={ev.id} className="py-3 flex items-start gap-3" data-testid={`event-row-${ev.id}`}>
                                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${ev.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                                        {meta && <meta.icon className="w-5 h-5" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-bold text-slate-900">
                                            {meta?.label || ev.event_type}
                                            {ev.target_pokemon_name && <span className="ml-2 text-slate-500 text-sm">→ {ev.target_pokemon_name}</span>}
                                        </div>
                                        <div className="text-xs text-slate-500">
                                            {start.toLocaleString()} → {end.toLocaleString()}
                                        </div>
                                        {ev.label && <div className="text-xs text-slate-600 italic">"{ev.label}"</div>}
                                    </div>
                                    {ev.active && <span className="text-[10px] uppercase tracking-widest font-bold text-emerald-700 bg-emerald-100 rounded-full px-2 py-0.5">live</span>}
                                    <button onClick={() => cancel(ev.id)} className="text-rose-500 hover:bg-rose-50 rounded-lg p-2" data-testid={`event-cancel-${ev.id}`}>
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
