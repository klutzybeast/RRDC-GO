import React, { useEffect, useState } from "react";
import { adminApi } from "../../lib/api";
import RarityBadge from "../../components/RarityBadge";
import { Users, Sparkles, Target, Download, Trophy, Star } from "lucide-react";
import { Button } from "../../components/ui/button";
import { toast } from "sonner";

export default function AnalyticsTab() {
    const [data, setData] = useState(null);
    const [wof, setWof] = useState(null);
    const [exporting, setExporting] = useState(false);

    useEffect(() => {
        adminApi.get("/admin/analytics").then((r) => setData(r.data));
        adminApi.get("/admin/analytics/wall-of-fame").then((r) => setWof(r.data));
    }, []);

    const exportCsv = async () => {
        try {
            setExporting(true);
            const res = await adminApi.get("/admin/analytics/export", { responseType: "blob" });
            const url = window.URL.createObjectURL(new Blob([res.data], { type: "text/csv" }));
            const a = document.createElement("a");
            a.href = url;
            const ts = new Date().toISOString().slice(0, 10);
            a.download = `rrdc_catches_${ts}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
            toast.success("Catches CSV downloaded");
        } catch (e) {
            toast.error("Export failed");
        } finally {
            setExporting(false);
        }
    };

    if (!data) return <div className="text-center text-slate-400 py-16">Loading…</div>;

    const wofLoading = wof === null;

    const stats = [
        { label: "Total Catches", value: data.total_catches, icon: Target, color: "bg-river-500" },
        { label: "Campers", value: data.users_count, icon: Users, color: "bg-forest-500" },
        { label: "Active Pokemon", value: data.active_pokemon, icon: Sparkles, color: "bg-amber-500" },
    ];

    return (
        <div>
            <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
                <h2 className="font-heading text-2xl font-bold text-slate-900">Camp Overview</h2>
                <Button
                    onClick={exportCsv}
                    disabled={exporting}
                    className="tactile-btn rounded-2xl bg-river-500 hover:bg-river-600 text-white font-heading"
                    data-testid="export-csv-btn"
                >
                    <Download className="w-4 h-4 mr-1.5" />
                    {exporting ? "Exporting…" : "Export Catches CSV"}
                </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
                {stats.map((s) => {
                    const Icon = s.icon;
                    return (
                        <div key={s.label} className="bg-white rounded-3xl p-6 border border-slate-200" data-testid={`stat-${s.label.replace(/ /g, "-").toLowerCase()}`}>
                            <div className={`w-10 h-10 rounded-2xl ${s.color} text-white flex items-center justify-center mb-4`}>
                                <Icon className="w-5 h-5" />
                            </div>
                            <div className="font-heading text-4xl font-bold text-slate-900">{s.value}</div>
                            <div className="text-sm text-slate-500 mt-1">{s.label}</div>
                        </div>
                    );
                })}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white rounded-3xl p-6 border border-slate-200">
                    <h3 className="font-heading text-lg font-bold text-slate-900 mb-4">Top Squads</h3>
                    {data.by_group.length === 0 ? <div className="text-sm text-slate-400">No catches yet</div> : (
                        <div className="space-y-3">
                            {data.by_group.slice(0, 10).map((g, i) => (
                                <div key={g.group_name} className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <span className="w-7 h-7 rounded-full bg-slate-100 text-slate-600 font-bold flex items-center justify-center text-sm">{i + 1}</span>
                                        <span className="font-bold text-slate-900">{g.group_name}</span>
                                    </div>
                                    <span className="font-heading font-bold text-river-600">{g.count}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="bg-white rounded-3xl p-6 border border-slate-200">
                    <h3 className="font-heading text-lg font-bold text-slate-900 mb-4">Rarity Distribution</h3>
                    {data.by_rarity.length === 0 ? <div className="text-sm text-slate-400">No catches yet</div> : (
                        <div className="space-y-3">
                            {data.by_rarity.map((r) => (
                                <div key={r.rarity} className="flex items-center justify-between">
                                    <RarityBadge rarity={r.rarity} />
                                    <span className="font-heading font-bold text-slate-900">{r.count}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="bg-white rounded-3xl p-6 border border-slate-200 lg:col-span-2">
                    <h3 className="font-heading text-lg font-bold text-slate-900 mb-4">Most Caught Pokemon</h3>
                    {data.most_caught.length === 0 ? <div className="text-sm text-slate-400">No catches yet</div> : (
                        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
                            {data.most_caught.map((p) => (
                                <div key={p.pokemon_id} className="bg-slate-50 rounded-2xl p-3 text-center">
                                    <div className={`aspect-square rounded-xl mb-2 flex items-center justify-center rarity-${p.rarity}`}>
                                        {p.image ? <img src={p.image} alt={p.name} className="max-w-[70%] max-h-[70%]" /> : null}
                                    </div>
                                    <div className="font-bold text-xs truncate text-slate-900">{p.name}</div>
                                    <div className="text-xs text-slate-500">caught ×{p.count}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="bg-white rounded-3xl p-6 border border-slate-200 lg:col-span-2">
                    <h3 className="font-heading text-lg font-bold text-slate-900 mb-4">Recent Catches</h3>
                    {data.recent.length === 0 ? <div className="text-sm text-slate-400">No catches yet</div> : (
                        <div className="max-h-96 overflow-y-auto">
                            <table className="w-full text-sm" data-testid="recent-catches-table">
                                <thead className="text-xs uppercase text-slate-500 tracking-widest sticky top-0 bg-white">
                                    <tr>
                                        <th className="text-left py-2 font-bold">Pokemon</th>
                                        <th className="text-left py-2 font-bold">Camper</th>
                                        <th className="text-left py-2 font-bold">Squad</th>
                                        <th className="text-right py-2 font-bold">Power</th>
                                        <th className="text-right py-2 font-bold">When</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.recent.map((c) => (
                                        <tr key={c.id} className="border-t border-slate-100">
                                            <td className="py-2">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-bold text-slate-900">{c.pokemon_name}</span>
                                                    <RarityBadge rarity={c.rarity} className="text-[10px] px-1.5 py-0" />
                                                </div>
                                            </td>
                                            <td className="py-2 text-slate-700">{c.caught_by}</td>
                                            <td className="py-2 text-slate-600">{c.group_name}</td>
                                            <td className="py-2 text-right font-bold">{c.power_rolled}</td>
                                            <td className="py-2 text-right text-xs text-slate-500">{new Date(c.caught_at).toLocaleString()}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>

            {/* Wall of Fame — featured supervisor pokemon */}
            <div className="mt-8 bg-white rounded-3xl p-6 border border-amber-200" data-testid="wall-of-fame">
                <h3 className="font-heading text-xl font-bold text-slate-900 mb-1 flex items-center gap-2">
                    <Trophy className="w-5 h-5 text-amber-500" /> Supervisor Wall of Fame
                </h3>
                <p className="text-xs text-slate-500 mb-4">Catch stats for every featured (supervisor) Pokemon.</p>
                {!wof || wofLoading ? (
                    <div className="text-sm text-slate-400 py-8 text-center">Loading…</div>
                ) : wof.pokemon.length === 0 ? (
                    <div className="text-sm text-slate-400 py-8 text-center">
                        No featured Pokemon yet. Mark some on the Pokemon tab with the ⭐ button.
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {wof.pokemon.map((p, i) => (
                            <div
                                key={p.pokemon_id}
                                className={`rounded-2xl p-4 border ${i === 0 ? "bg-gradient-to-br from-amber-100 to-yellow-50 border-amber-400" : "bg-slate-50 border-slate-200"}`}
                                data-testid={`wof-card-${p.pokemon_id}`}
                            >
                                <div className="flex items-center gap-3">
                                    <div className="relative shrink-0">
                                        {p.image_data_url ? (
                                            <img src={p.image_data_url} alt={p.name} className="w-16 h-16 rounded-xl object-cover bg-white" draggable={false} />
                                        ) : (
                                            <div className="w-16 h-16 rounded-xl bg-slate-200" />
                                        )}
                                        <Star className="absolute -top-1 -right-1 w-5 h-5 text-amber-500 fill-amber-400" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-heading font-bold text-slate-900 truncate">{p.name}</div>
                                        <RarityBadge rarity={p.rarity} className="text-[10px] px-1.5 py-0" />
                                        {!p.active && <span className="ml-1 text-[10px] uppercase tracking-widest text-red-500 font-bold">inactive</span>}
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-2 mt-3">
                                    <div className="rounded-xl bg-white px-2 py-1.5">
                                        <div className="font-heading text-xl font-black text-slate-900 leading-none">{p.total_catches}</div>
                                        <div className="text-[9px] uppercase tracking-widest text-slate-500 font-bold">Caught</div>
                                    </div>
                                    <div className="rounded-xl bg-white px-2 py-1.5">
                                        <div className="font-heading text-xl font-black text-slate-900 leading-none">{p.unique_catchers}</div>
                                        <div className="text-[9px] uppercase tracking-widest text-slate-500 font-bold">Campers</div>
                                    </div>
                                </div>
                                {p.last_caught_at && (
                                    <div className="text-[10px] text-slate-500 mt-2">
                                        Last caught {new Date(p.last_caught_at).toLocaleDateString()}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
