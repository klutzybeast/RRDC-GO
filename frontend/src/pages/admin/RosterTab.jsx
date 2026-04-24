import React, { useEffect, useState } from "react";
import { adminApi, formatApiError } from "../../lib/api";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { RefreshCw, Search, Users, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export default function RosterTab() {
    const [status, setStatus] = useState(null);
    const [roster, setRoster] = useState([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [filter, setFilter] = useState("");

    const load = async () => {
        setLoading(true);
        try {
            const [s, r] = await Promise.all([
                adminApi.get("/admin/roster-status"),
                adminApi.get("/admin/roster"),
            ]);
            setStatus(s.data);
            setRoster(r.data);
        } finally { setLoading(false); }
    };

    useEffect(() => { load(); }, []);

    const sync = async () => {
        setSyncing(true);
        try {
            const res = await adminApi.post("/admin/roster-sync");
            if (res.data.error) toast.error(`Sync error: ${res.data.error}`);
            else toast.success(`Synced ${res.data.camper_count} campers · +${res.data.added} / ${res.data.updated}u / -${res.data.removed}`);
            await load();
        } catch (e) { toast.error(formatApiError(e)); }
        finally { setSyncing(false); }
    };

    const filteredRoster = filter.trim()
        ? roster.map((g) => ({ ...g, campers: g.campers.filter((c) => `${c.first_name} ${c.last_name} ${g.group_code}`.toLowerCase().includes(filter.toLowerCase())) })).filter((g) => g.campers.length > 0)
        : roster;

    const total = roster.reduce((s, g) => s + g.count, 0);

    return (
        <div>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                <div>
                    <h2 className="font-heading text-2xl font-bold text-slate-900">Roster</h2>
                    <p className="text-slate-500 text-sm">Synced from CamperSnap nightly at 00:00 ET</p>
                </div>
                <Button onClick={sync} disabled={syncing} className="tactile-btn rounded-2xl bg-river-500 hover:bg-river-600 text-white font-heading" data-testid="roster-sync-btn">
                    <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? "animate-spin" : ""}`} /> {syncing ? "Syncing…" : "Sync Now"}
                </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                <div className="bg-white rounded-3xl p-6 border border-slate-200" data-testid="roster-stat-campers">
                    <Users className="w-5 h-5 text-river-500 mb-3" />
                    <div className="font-heading text-3xl font-bold text-slate-900">{status?.camper_count ?? "…"}</div>
                    <div className="text-sm text-slate-500 mt-1">Campers</div>
                </div>
                <div className="bg-white rounded-3xl p-6 border border-slate-200" data-testid="roster-stat-groups">
                    <div className="w-5 h-5 rounded bg-forest-500 mb-3" />
                    <div className="font-heading text-3xl font-bold text-slate-900">{status?.group_count ?? "…"}</div>
                    <div className="text-sm text-slate-500 mt-1">Groups</div>
                </div>
                <div className="bg-white rounded-3xl p-6 border border-slate-200">
                    <div className="text-[11px] uppercase tracking-widest font-bold text-slate-400 mb-3">Last synced</div>
                    <div className="font-heading text-lg font-bold text-slate-900">
                        {status?.last_synced_at ? new Date(status.last_synced_at).toLocaleString() : "Never"}
                    </div>
                    {status?.next_sync_at && (
                        <div className="text-[11px] text-slate-500 mt-2">
                            Next auto-sync:{" "}
                            <span className="font-bold text-emerald-600" data-testid="roster-next-sync">
                                {new Date(status.next_sync_at).toLocaleString(undefined, {
                                    weekday: "short",
                                    month: "short",
                                    day: "numeric",
                                    hour: "numeric",
                                    minute: "2-digit",
                                    timeZoneName: "short",
                                })}
                            </span>
                        </div>
                    )}
                    {status?.last_error && (
                        <div className="mt-2 text-xs text-red-600 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> {status.last_error}
                        </div>
                    )}
                </div>
            </div>

            <div className="relative mb-4">
                <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Search name or group…"
                    className="rounded-2xl h-11 pl-10 bg-white"
                    data-testid="roster-filter-input"
                />
            </div>

            {loading ? (
                <div className="text-center text-slate-400 py-16">Loading…</div>
            ) : filteredRoster.length === 0 ? (
                <div className="bg-white rounded-3xl p-10 text-center border border-slate-200">
                    <Users className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                    <div className="font-heading text-lg font-bold text-slate-700">No campers synced yet</div>
                    <p className="text-slate-500 text-sm mt-1">Tap "Sync Now" to pull the roster.</p>
                </div>
            ) : (
                <div className="space-y-4" data-testid="roster-groups">
                    {filteredRoster.map((g) => (
                        <div key={g.group_code} className="bg-white rounded-3xl border border-slate-200 overflow-hidden">
                            <div className="flex items-center justify-between px-5 py-3 bg-slate-50 border-b border-slate-100">
                                <div className="font-heading text-lg font-bold text-slate-900">{g.group_code}</div>
                                <div className="text-xs font-bold uppercase tracking-widest text-slate-500">{g.campers.length} of {g.count}</div>
                            </div>
                            <div className="p-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                                {g.campers.map((c) => (
                                    <div key={`${g.group_code}-${c.id}`} className="flex items-center gap-2 text-sm p-2 rounded-xl bg-slate-50" data-testid={`roster-camper-${c.id}`}>
                                        <div className="w-7 h-7 rounded-full bg-river-100 text-river-700 flex items-center justify-center font-bold text-[11px]">
                                            {c.first_name?.[0]}{c.last_name?.[0]}
                                        </div>
                                        <span className="truncate">{c.first_name} {c.last_name}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
            <div className="mt-6 text-xs text-slate-400">Total in DB: {total}</div>
        </div>
    );
}
