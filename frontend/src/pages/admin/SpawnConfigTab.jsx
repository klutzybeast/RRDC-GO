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
                camp_latitude: Number(cfg.camp_latitude || 40.7128),
                camp_longitude: Number(cfg.camp_longitude || -74.0060),
                camp_default_zoom: Number(cfg.camp_default_zoom || 17),
                rarity_weights: Object.fromEntries(RARITIES.map((r) => [r, Number(cfg.rarity_weights?.[r] ?? 0)])),
            });
            toast.success("Spawn config saved");
        } catch (e) { toast.error(formatApiError(e)); }
        finally { setSaving(false); }
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

                <div className="pt-2">
                    <Button onClick={save} disabled={saving} className="tactile-btn rounded-2xl bg-river-500 hover:bg-river-600 text-white font-heading h-12 px-8" data-testid="spawn-config-save">
                        {saving ? "Saving…" : "Save Configuration"}
                    </Button>
                </div>
            </div>
        </div>
    );
}
