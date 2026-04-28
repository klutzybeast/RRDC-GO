import React, { useEffect, useState } from "react";
import { adminApi, formatApiError } from "../../lib/api";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Switch } from "../../components/ui/switch";
import { toast } from "sonner";

const RARITIES = ["common", "uncommon", "rare", "legendary"];

export default function SpawnConfigTab() {
    const [cfg, setCfg] = useState(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        adminApi.get("/admin/spawn-config").then((r) => setCfg(r.data));
    }, []);

    const save = async () => {
        setSaving(true);
        try {
            await adminApi.put("/admin/spawn-config", {
                ...cfg,
                min_interval_min: Number(cfg.min_interval_min),
                max_interval_min: Number(cfg.max_interval_min),
                active_hours_start: Number(cfg.active_hours_start),
                active_hours_end: Number(cfg.active_hours_end),
                spawn_ttl_seconds: Number(cfg.spawn_ttl_seconds),
                catch_radius_meters: Number(cfg.catch_radius_meters ?? 40),
                featured_weight_multiplier: Number(cfg.featured_weight_multiplier ?? 10),
                camp_latitude: Number(cfg.camp_latitude || 40.7128),
                camp_longitude: Number(cfg.camp_longitude || -74.0060),
                camp_default_zoom: Number(cfg.camp_default_zoom || 17),
                rarity_weights: Object.fromEntries(RARITIES.map((r) => [r, Number(cfg.rarity_weights?.[r] ?? 0)])),
                catch_rates: Object.fromEntries(RARITIES.map((r) => [r, Math.max(0, Math.min(1, Number(cfg.catch_rates?.[r] ?? 0)))])),
                scheduled_windows: (cfg.scheduled_windows || [])
                    .filter((w) => w.start && w.end)
                    .map((w) => ({
                        label: w.label || "",
                        start: new Date(w.start).toISOString(),
                        end: new Date(w.end).toISOString(),
                    })),
            });
            toast.success("Spawn config saved");
        } catch (e) { toast.error(formatApiError(e)); }
        finally { setSaving(false); }
    };

    // datetime-local needs "YYYY-MM-DDTHH:MM" (no seconds, no zone)
    const toLocalInput = (iso) => {
        if (!iso) return "";
        try {
            const d = new Date(iso);
            const pad = (n) => String(n).padStart(2, "0");
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        } catch { return ""; }
    };

    const updateWindow = (idx, patch) => {
        const list = [...(cfg.scheduled_windows || [])];
        list[idx] = { ...list[idx], ...patch };
        setCfg({ ...cfg, scheduled_windows: list });
    };

    const addWindow = () => {
        const now = new Date();
        const start = new Date(now);
        start.setHours(9, 0, 0, 0);
        const end = new Date(now);
        end.setHours(15, 0, 0, 0);
        setCfg({
            ...cfg,
            scheduled_windows: [
                ...(cfg.scheduled_windows || []),
                { label: "Camp Day", start: start.toISOString(), end: end.toISOString() },
            ],
        });
    };

    const removeWindow = (idx) => {
        const list = [...(cfg.scheduled_windows || [])];
        list.splice(idx, 1);
        setCfg({ ...cfg, scheduled_windows: list });
    };

    if (!cfg) return <div className="text-center text-slate-400 py-16">Loading…</div>;

    return (
        <div className="max-w-3xl">
            <div className="mb-6">
                <h2 className="font-heading text-2xl font-bold text-slate-900">Spawn Configuration</h2>
                <p className="text-slate-500 text-sm">Control when and how often Pokemon appear</p>
            </div>

            <div className="bg-white rounded-3xl p-6 border border-slate-200 space-y-6">
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl">
                    <div>
                        <Label className="text-slate-900 font-bold text-base">Global spawns enabled</Label>
                        <p className="text-xs text-slate-500">Turn off on non-camp days</p>
                    </div>
                    <Switch checked={cfg.enabled} onCheckedChange={(v) => setCfg({ ...cfg, enabled: v })} data-testid="spawn-enabled-toggle" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <Label>Min interval (minutes)</Label>
                        <Input type="number" min="0.1" step="0.1" value={cfg.min_interval_min} onChange={(e) => setCfg({ ...cfg, min_interval_min: e.target.value })} className="rounded-2xl h-11" data-testid="min-interval-input" />
                    </div>
                    <div>
                        <Label>Max interval (minutes)</Label>
                        <Input type="number" min="0.1" step="0.1" value={cfg.max_interval_min} onChange={(e) => setCfg({ ...cfg, max_interval_min: e.target.value })} className="rounded-2xl h-11" data-testid="max-interval-input" />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <Label>Active hour start (0-24)</Label>
                        <Input type="number" min="0" max="24" value={cfg.active_hours_start} onChange={(e) => setCfg({ ...cfg, active_hours_start: e.target.value })} className="rounded-2xl h-11" data-testid="hours-start-input" />
                    </div>
                    <div>
                        <Label>Active hour end (0-24)</Label>
                        <Input type="number" min="0" max="24" value={cfg.active_hours_end} onChange={(e) => setCfg({ ...cfg, active_hours_end: e.target.value })} className="rounded-2xl h-11" data-testid="hours-end-input" />
                    </div>
                </div>

                <div>
                    <Label>Spawn duration (seconds) — how long a Pokemon stays before fleeing</Label>
                    <Input type="number" min="15" max="600" value={cfg.spawn_ttl_seconds} onChange={(e) => setCfg({ ...cfg, spawn_ttl_seconds: e.target.value })} className="rounded-2xl h-11" data-testid="spawn-ttl-input" />
                </div>

                <div className="rounded-2xl bg-slate-50 p-4 space-y-3">
                    <div>
                        <Label className="text-base">Camp map center</Label>
                        <p className="text-xs text-slate-500">Where the camper's map opens by default (before they grant location).</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <Label className="text-xs">Latitude</Label>
                            <Input type="number" step="0.000001" value={cfg.camp_latitude ?? ""} onChange={(e) => setCfg({ ...cfg, camp_latitude: e.target.value })} className="rounded-2xl h-11" data-testid="camp-latitude-input" />
                        </div>
                        <div>
                            <Label className="text-xs">Longitude</Label>
                            <Input type="number" step="0.000001" value={cfg.camp_longitude ?? ""} onChange={(e) => setCfg({ ...cfg, camp_longitude: e.target.value })} className="rounded-2xl h-11" data-testid="camp-longitude-input" />
                        </div>
                    </div>
                    <div>
                        <Label className="text-xs">Default zoom (14-20)</Label>
                        <Input type="number" min="10" max="21" value={cfg.camp_default_zoom ?? 17} onChange={(e) => setCfg({ ...cfg, camp_default_zoom: e.target.value })} className="rounded-2xl h-11" data-testid="camp-zoom-input" />
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                            if (!navigator.geolocation) { toast.error("Geolocation not supported"); return; }
                            navigator.geolocation.getCurrentPosition(
                                (pos) => {
                                    setCfg({ ...cfg, camp_latitude: pos.coords.latitude.toFixed(6), camp_longitude: pos.coords.longitude.toFixed(6) });
                                    toast.success("Filled with your current location");
                                },
                                (err) => toast.error(err.message || "Location unavailable"),
                                { enableHighAccuracy: true }
                            );
                        }}
                        className="rounded-2xl"
                        data-testid="use-my-location-btn"
                    >
                        Use my current location
                    </Button>
                </div>

                <div>
                    <Label className="text-base">Rarity weights</Label>
                    <p className="text-xs text-slate-500 mb-3">Higher = appears more often. Proportional, not percentages.</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {RARITIES.map((r) => (
                            <div key={r}>
                                <Label className="text-xs capitalize">{r}</Label>
                                <Input
                                    type="number"
                                    min="0"
                                    value={cfg.rarity_weights?.[r] ?? 0}
                                    onChange={(e) => setCfg({ ...cfg, rarity_weights: { ...cfg.rarity_weights, [r]: e.target.value } })}
                                    className="rounded-2xl h-11"
                                    data-testid={`rarity-weight-${r}`}
                                />
                            </div>
                        ))}
                    </div>
                </div>

                <div className="rounded-2xl bg-gradient-to-br from-emerald-50 to-white p-4 border border-emerald-200">
                    <Label className="text-base text-slate-900 font-bold">⭐ Featured Pokemon spawn boost</Label>
                    <p className="text-xs text-slate-500 mb-3">
                        How much more often "supervisor" (featured) Pokemon spawn vs regular ones. 1× = same as others. 10× = star Pokemon dominate.
                    </p>
                    <div className="flex items-center gap-3">
                        <input
                            type="range"
                            min="1"
                            max="25"
                            step="1"
                            value={Number(cfg.featured_weight_multiplier ?? 10)}
                            onChange={(e) => setCfg({ ...cfg, featured_weight_multiplier: e.target.value })}
                            className="flex-1 h-2 rounded-full accent-emerald-500"
                            data-testid="featured-boost-slider"
                        />
                        <div className="w-16 text-right font-heading text-xl font-bold text-slate-900 tabular-nums" data-testid="featured-boost-value">
                            {cfg.featured_weight_multiplier ?? 10}×
                        </div>
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-500 mt-1 px-0.5 uppercase tracking-widest">
                        <span>1× — Equal</span>
                        <span>10×</span>
                        <span>25× — Dominant</span>
                    </div>
                </div>

                <div className="rounded-2xl bg-gradient-to-br from-amber-50 to-white p-4 border border-amber-200">
                    <Label className="text-base text-slate-900 font-bold">Catch radius (meters)</Label>
                    <p className="text-xs text-slate-500 mb-3">
                        How close a camper must be to a spawn to catch it. Lower = more walking / harder. Higher = easier for younger campers.
                    </p>
                    <div className="flex items-center gap-3">
                        <input
                            type="range"
                            min="10"
                            max="80"
                            step="5"
                            value={Number(cfg.catch_radius_meters ?? 40)}
                            onChange={(e) => setCfg({ ...cfg, catch_radius_meters: e.target.value })}
                            className="flex-1 h-2 rounded-full accent-amber-500"
                            data-testid="catch-radius-slider"
                        />
                        <div className="w-16 text-right font-heading text-xl font-bold text-slate-900 tabular-nums" data-testid="catch-radius-value">
                            {cfg.catch_radius_meters ?? 40} m
                        </div>
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-500 mt-1 px-0.5 uppercase tracking-widest">
                        <span>10 m — Hard</span>
                        <span>40 m</span>
                        <span>80 m — Easy</span>
                    </div>
                </div>

                <div>
                    <Label className="text-base">Catch success rates</Label>
                    <p className="text-xs text-slate-500 mb-3">
                        Probability a single ball throw catches the Pokemon (0.00 = never, 1.00 = always). Tune to make the game easier or harder.
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {RARITIES.map((r) => (
                            <div key={r}>
                                <Label className="text-xs capitalize">{r}</Label>
                                <Input
                                    type="number"
                                    min="0"
                                    max="1"
                                    step="0.05"
                                    value={cfg.catch_rates?.[r] ?? 0}
                                    onChange={(e) => setCfg({ ...cfg, catch_rates: { ...cfg.catch_rates, [r]: e.target.value } })}
                                    className="rounded-2xl h-11"
                                    data-testid={`catch-rate-${r}`}
                                />
                            </div>
                        ))}
                    </div>
                </div>

                <div className="rounded-2xl bg-gradient-to-br from-river-50 to-white p-4 border border-river-200">
                    <div className="flex items-start justify-between gap-3 mb-2">
                        <div>
                            <Label className="text-base text-slate-900 font-bold">Scheduled activation windows</Label>
                            <p className="text-xs text-slate-500">
                                Add specific date/time ranges when the game is "on". When at least one window is set, the game ignores the daily hours above and follows your windows. Leave empty to use daily hours only.
                            </p>
                        </div>
                        <Button type="button" onClick={addWindow} variant="outline" className="rounded-2xl shrink-0" data-testid="add-window-btn">
                            + Add window
                        </Button>
                    </div>
                    {(cfg.scheduled_windows || []).length === 0 ? (
                        <div className="text-xs text-slate-400 py-3 text-center italic">No scheduled windows — using daily hours.</div>
                    ) : (
                        <div className="space-y-2 mt-3">
                            {(cfg.scheduled_windows || []).map((w, i) => (
                                <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end bg-white rounded-xl p-3 border border-slate-200" data-testid={`window-row-${i}`}>
                                    <div>
                                        <Label className="text-xs">Label</Label>
                                        <Input
                                            value={w.label || ""}
                                            onChange={(e) => updateWindow(i, { label: e.target.value })}
                                            placeholder="e.g. Tuesday Camp Day"
                                            className="rounded-xl h-10"
                                            data-testid={`window-label-${i}`}
                                        />
                                    </div>
                                    <div>
                                        <Label className="text-xs">Start</Label>
                                        <Input
                                            type="datetime-local"
                                            value={toLocalInput(w.start)}
                                            onChange={(e) => updateWindow(i, { start: e.target.value ? new Date(e.target.value).toISOString() : "" })}
                                            className="rounded-xl h-10"
                                            data-testid={`window-start-${i}`}
                                        />
                                    </div>
                                    <div>
                                        <Label className="text-xs">End</Label>
                                        <Input
                                            type="datetime-local"
                                            value={toLocalInput(w.end)}
                                            onChange={(e) => updateWindow(i, { end: e.target.value ? new Date(e.target.value).toISOString() : "" })}
                                            className="rounded-xl h-10"
                                            data-testid={`window-end-${i}`}
                                        />
                                    </div>
                                    <Button type="button" variant="outline" onClick={() => removeWindow(i)} className="rounded-xl h-10 text-red-600 border-red-200 hover:bg-red-50" data-testid={`window-remove-${i}`}>
                                        Remove
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="pt-2">
                    <Button onClick={save} disabled={saving} className="tactile-btn rounded-2xl bg-river-500 hover:bg-river-600 text-white font-heading h-12 px-8" data-testid="spawn-config-save">
                        {saving ? "Saving…" : "Save Configuration"}
                    </Button>
                </div>
            </div>
        </div>
    );
}
