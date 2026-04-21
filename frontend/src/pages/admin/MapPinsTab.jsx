import React, { useEffect, useRef, useState } from "react";
import { GoogleMap, Marker } from "@react-google-maps/api";
import { adminApi, formatApiError } from "../../lib/api";
import { useGoogleMaps } from "../../contexts/GoogleMapsContext";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Switch } from "../../components/ui/switch";
import { toast } from "sonner";
import { Trash2, Plus, MapPin } from "lucide-react";

export default function MapPinsTab() {
    const { isLoaded, loadError } = useGoogleMaps();
    const [pins, setPins] = useState([]);
    const [center, setCenter] = useState({ lat: 40.6396, lng: -73.6665 });
    const [draft, setDraft] = useState(null);
    const [draftName, setDraftName] = useState("");
    const [loading, setLoading] = useState(true);
    const mapRef = useRef(null);

    const load = async () => {
        setLoading(true);
        const r = await adminApi.get("/admin/map-pins");
        setPins(r.data);
        if (r.data.length > 0) {
            const lat = r.data.reduce((s, p) => s + p.latitude, 0) / r.data.length;
            const lng = r.data.reduce((s, p) => s + p.longitude, 0) / r.data.length;
            setCenter({ lat, lng });
        } else {
            try {
                const c = await adminApi.get("/admin/spawn-config");
                if (c.data?.camp_latitude) setCenter({ lat: c.data.camp_latitude, lng: c.data.camp_longitude });
            } catch {}
        }
        setLoading(false);
    };

    useEffect(() => { load(); }, []);

    const onMapClick = (e) => {
        setDraft({ lat: e.latLng.lat(), lng: e.latLng.lng() });
        setDraftName("");
    };

    const saveDraft = async () => {
        if (!draft) return;
        try {
            await adminApi.post("/admin/map-pins", {
                name: draftName.trim() || "Camp pin",
                latitude: draft.lat,
                longitude: draft.lng,
                active: true,
            });
            toast.success("Pin added");
            setDraft(null);
            setDraftName("");
            load();
        } catch (e) { toast.error(formatApiError(e)); }
    };

    const togglePin = async (p) => {
        try {
            await adminApi.patch(`/admin/map-pins/${p.id}`, { active: !p.active });
            load();
        } catch (e) { toast.error(formatApiError(e)); }
    };

    const deletePin = async (p) => {
        if (!window.confirm(`Delete pin "${p.name}"?`)) return;
        try {
            await adminApi.delete(`/admin/map-pins/${p.id}`);
            toast.success("Pin deleted");
            load();
        } catch (e) { toast.error(formatApiError(e)); }
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
                <div>
                    <h2 className="font-heading text-2xl font-bold text-slate-900">Camp Map Pins</h2>
                    <p className="text-slate-500 text-sm">Click the map to drop a pin. Pokemon will spawn at random active pins.</p>
                </div>
                <div className="text-xs font-bold uppercase tracking-widest text-slate-500 bg-white rounded-full px-3 py-1 border border-slate-200" data-testid="pins-count">
                    {pins.length} pins · {pins.filter((p) => p.active).length} active
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 bg-white rounded-3xl overflow-hidden border border-slate-200" style={{ minHeight: "500px" }}>
                    {loadError ? (
                        <div className="p-10 text-center text-red-600">Google Maps failed to load.</div>
                    ) : !isLoaded ? (
                        <div className="p-10 text-center text-slate-500">Loading map…</div>
                    ) : (
                        <GoogleMap
                            mapContainerStyle={{ width: "100%", height: "500px" }}
                            center={center}
                            zoom={17}
                            onClick={onMapClick}
                            onLoad={(m) => (mapRef.current = m)}
                            options={{ mapTypeId: "hybrid", disableDefaultUI: false, clickableIcons: false }}
                        >
                            {pins.map((p) => (
                                <Marker
                                    key={p.id}
                                    position={{ lat: p.latitude, lng: p.longitude }}
                                    title={p.name}
                                    opacity={p.active ? 1 : 0.4}
                                />
                            ))}
                            {draft && (
                                <Marker
                                    position={{ lat: draft.lat, lng: draft.lng }}
                                    icon={{ path: window.google?.maps?.SymbolPath?.CIRCLE, scale: 10, fillColor: "#0EA5E9", fillOpacity: 0.8, strokeColor: "#fff", strokeWeight: 2 }}
                                />
                            )}
                        </GoogleMap>
                    )}
                </div>

                <div className="space-y-4">
                    {draft ? (
                        <div className="bg-white rounded-3xl p-4 border-2 border-river-500">
                            <div className="font-heading font-bold text-slate-900 mb-2">New pin</div>
                            <div className="text-xs font-mono text-slate-500 mb-3">
                                {draft.lat.toFixed(6)}, {draft.lng.toFixed(6)}
                            </div>
                            <Label className="text-xs">Name</Label>
                            <Input
                                value={draftName}
                                onChange={(e) => setDraftName(e.target.value)}
                                placeholder="e.g. Pool deck"
                                className="rounded-2xl h-10 mt-1 mb-3"
                                data-testid="draft-pin-name"
                            />
                            <div className="flex gap-2">
                                <Button onClick={() => setDraft(null)} variant="outline" className="rounded-2xl flex-1">Cancel</Button>
                                <Button onClick={saveDraft} className="tactile-btn rounded-2xl flex-1 bg-river-500 hover:bg-river-600 text-white font-heading" data-testid="save-draft-pin-btn">
                                    <Plus className="w-4 h-4 mr-1" /> Save Pin
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="bg-river-50 rounded-3xl p-5 border border-river-100">
                            <MapPin className="w-6 h-6 text-river-500 mb-2" />
                            <div className="font-heading font-bold text-slate-900">Drop a pin</div>
                            <div className="text-xs text-slate-600 mt-1">Click anywhere on the map to add a spawn location.</div>
                        </div>
                    )}

                    <div className="bg-white rounded-3xl border border-slate-200 p-1 max-h-[420px] overflow-y-auto">
                        {loading ? (
                            <div className="p-6 text-center text-slate-400 text-sm">Loading…</div>
                        ) : pins.length === 0 ? (
                            <div className="p-6 text-center text-slate-400 text-sm">No pins yet</div>
                        ) : pins.map((p) => (
                            <div key={p.id} className="flex items-center gap-2 p-3 border-b border-slate-100 last:border-none" data-testid={`pin-row-${p.id}`}>
                                <div className="flex-1 min-w-0">
                                    <div className="font-bold text-sm text-slate-900 truncate">{p.name}</div>
                                    <div className="text-xs text-slate-500 font-mono truncate">{p.latitude.toFixed(4)}, {p.longitude.toFixed(4)}</div>
                                </div>
                                <Switch checked={p.active} onCheckedChange={() => togglePin(p)} data-testid={`pin-active-${p.id}`} />
                                <Button size="sm" variant="ghost" onClick={() => deletePin(p)} data-testid={`pin-delete-${p.id}`}>
                                    <Trash2 className="w-4 h-4 text-red-500" />
                                </Button>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
