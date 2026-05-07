import React, { useEffect, useMemo, useRef, useState } from "react";
import { GoogleMap, Marker, OverlayView } from "@react-google-maps/api";
import { adminApi, formatApiError } from "../../lib/api";
import { useGoogleMaps } from "../../contexts/GoogleMapsContext";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { RefreshCw, MapPin, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import pokemonGoMapStyle from "../../lib/pokemonGoMapStyle";

const POLL_MS = 5000;
const STATIONARY_THRESHOLD_MIN = 15;

const groupColor = (code) => {
    if (!code) return "#64748b";
    const palette = [
        "#ef4444", "#f97316", "#f59e0b", "#84cc16", "#22c55e",
        "#10b981", "#06b6d4", "#3b82f6", "#6366f1", "#a855f7",
        "#ec4899", "#f43f5e",
    ];
    let h = 0;
    for (const c of code) h = (h * 31 + c.charCodeAt(0)) % palette.length;
    return palette[h];
};

const fmtAge = (iso) => {
    try {
        const t = new Date(iso).getTime();
        const s = Math.max(0, Math.round((Date.now() - t) / 1000));
        if (s < 60) return `${s}s ago`;
        if (s < 3600) return `${Math.round(s / 60)}m ago`;
        return `${Math.round(s / 3600)}h ago`;
    } catch {
        return "?";
    }
};

export default function CamperMapTab() {
    const { isLoaded, loadError } = useGoogleMaps();
    const [positions, setPositions] = useState([]);
    const [maxAge, setMaxAge] = useState(30);
    const [loading, setLoading] = useState(false);
    const [campCenter, setCampCenter] = useState({ lat: 40.6396, lng: -73.6665 });
    const [campZoom, setCampZoom] = useState(17);
    const [groupFilter, setGroupFilter] = useState("");
    const [selected, setSelected] = useState(null);
    const mapRef = useRef(null);

    const fetchPositions = async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const r = await adminApi.get(`/admin/camper-positions?max_age_min=${Number(maxAge) || 30}`);
            setPositions(r.data?.positions || []);
        } catch (e) {
            if (!silent) toast.error(formatApiError(e));
        } finally {
            if (!silent) setLoading(false);
        }
    };

    useEffect(() => {
        adminApi.get("/admin/spawn-config").then((r) => {
            if (r.data?.camp_latitude && r.data?.camp_longitude) {
                setCampCenter({ lat: Number(r.data.camp_latitude), lng: Number(r.data.camp_longitude) });
            }
            if (r.data?.camp_default_zoom) setCampZoom(Number(r.data.camp_default_zoom));
        }).catch(() => {});
        fetchPositions();
        const id = setInterval(() => fetchPositions(true), POLL_MS);
        return () => clearInterval(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        fetchPositions(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [maxAge]);

    const groups = useMemo(() => {
        const s = new Set(positions.map((p) => p.group_code).filter(Boolean));
        return Array.from(s).sort();
    }, [positions]);

    const visible = useMemo(() => {
        return groupFilter ? positions.filter((p) => p.group_code === groupFilter) : positions;
    }, [positions, groupFilter]);

    const stationaryCount = useMemo(
        () => visible.filter((p) => Number(p.stationary_minutes || 0) >= STATIONARY_THRESHOLD_MIN).length,
        [visible],
    );

    const fitToCampers = () => {
        if (!mapRef.current || !window.google || visible.length === 0) {
            toast.info("No campers to fit");
            return;
        }
        const bounds = new window.google.maps.LatLngBounds();
        visible.forEach((p) => bounds.extend({ lat: p.latitude, lng: p.longitude }));
        mapRef.current.fitBounds(bounds, 80);
    };

    return (
        <div className="space-y-4" data-testid="camper-map-tab">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h2 className="font-heading text-2xl font-bold text-slate-900">Where are my campers?</h2>
                    <p className="text-slate-500 text-sm">Live positions from active campers (auto-refresh every 5s).</p>
                    {stationaryCount > 0 && (
                        <div
                            className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-rose-50 border border-rose-200 px-3 py-1 text-rose-700 text-xs font-bold"
                            data-testid="stationary-alert-pill"
                        >
                            <AlertTriangle className="w-3.5 h-3.5" />
                            {stationaryCount} {stationaryCount === 1 ? "camper hasn't" : "campers haven't"} moved in {STATIONARY_THRESHOLD_MIN}+ min
                        </div>
                    )}
                </div>
                <div className="flex items-end gap-2 flex-wrap">
                    <div className="w-32">
                        <Label className="text-xs">Show last (min)</Label>
                        <Input
                            type="number"
                            min="1"
                            max="240"
                            value={maxAge}
                            onChange={(e) => setMaxAge(e.target.value)}
                            className="rounded-2xl h-10"
                            data-testid="camper-map-max-age"
                        />
                    </div>
                    <div className="w-40">
                        <Label className="text-xs">Filter group</Label>
                        <select
                            value={groupFilter}
                            onChange={(e) => setGroupFilter(e.target.value)}
                            className="w-full h-10 rounded-2xl border border-slate-300 bg-white px-3 text-sm"
                            data-testid="camper-map-group-filter"
                        >
                            <option value="">All groups</option>
                            {groups.map((g) => (
                                <option key={g} value={g}>{g}</option>
                            ))}
                        </select>
                    </div>
                    <Button onClick={() => fetchPositions()} variant="outline" className="rounded-2xl h-10" data-testid="camper-map-refresh">
                        <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
                    </Button>
                    <Button onClick={fitToCampers} variant="outline" className="rounded-2xl h-10" data-testid="camper-map-fit">
                        <MapPin className="w-4 h-4 mr-2" /> Fit to campers
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
                <div className="rounded-3xl overflow-hidden border border-slate-200 bg-emerald-100" style={{ height: 560 }}>
                    {loadError ? (
                        <div className="h-full flex items-center justify-center text-slate-600 text-sm">
                            Map failed to load — check Google Maps API key.
                        </div>
                    ) : !isLoaded ? (
                        <div className="h-full flex items-center justify-center text-slate-500 text-sm">Loading map…</div>
                    ) : (
                        <GoogleMap
                            mapContainerStyle={{ width: "100%", height: "100%" }}
                            center={campCenter}
                            zoom={campZoom}
                            options={{
                                styles: pokemonGoMapStyle,
                                disableDefaultUI: true,
                                zoomControl: true,
                                clickableIcons: false,
                                gestureHandling: "greedy",
                                mapTypeId: "roadmap",
                                minZoom: 14,
                                maxZoom: 20,
                                tilt: 0,
                            }}
                            onLoad={(m) => (mapRef.current = m)}
                        >
                            <Marker
                                position={campCenter}
                                title="Camp center"
                                icon={{
                                    path: window.google?.maps?.SymbolPath?.CIRCLE,
                                    scale: 8,
                                    fillColor: "#0ea5e9",
                                    fillOpacity: 0.8,
                                    strokeColor: "#0c4a6e",
                                    strokeWeight: 2,
                                }}
                            />
                            {visible.map((p) => {
                                const color = groupColor(p.group_code);
                                const initials = `${(p.first_name?.[0] || "?")}${(p.last_name?.[0] || "")}`.toUpperCase();
                                const isStationary = Number(p.stationary_minutes || 0) >= STATIONARY_THRESHOLD_MIN;
                                return (
                                    <OverlayView
                                        key={p.camper_id}
                                        position={{ lat: p.latitude, lng: p.longitude }}
                                        mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                                    >
                                        <button
                                            onClick={() => setSelected(p)}
                                            className="relative -translate-x-1/2 -translate-y-1/2 group"
                                            data-testid={`camper-pin-${p.camper_id}`}
                                        >
                                            <div
                                                className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold border-2 shadow-lg transition-transform group-hover:scale-110 ${isStationary ? "border-rose-500 ring-2 ring-rose-300 animate-pulse" : "border-white"}`}
                                                style={{ backgroundColor: color }}
                                            >
                                                {initials}
                                            </div>
                                            {isStationary && (
                                                <div
                                                    className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 border-2 border-white flex items-center justify-center"
                                                    title={`Stationary ${p.stationary_minutes} min`}
                                                    data-testid={`stationary-badge-${p.camper_id}`}
                                                >
                                                    <AlertTriangle className="w-2 h-2 text-white" />
                                                </div>
                                            )}
                                            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-white border" style={{ borderColor: color }} />
                                        </button>
                                    </OverlayView>
                                );
                            })}
                        </GoogleMap>
                    )}
                </div>

                <div className="rounded-3xl border border-slate-200 bg-white p-4 max-h-[560px] overflow-y-auto">
                    <div className="flex items-baseline justify-between mb-3">
                        <div className="font-heading font-bold text-slate-900">
                            {visible.length} {visible.length === 1 ? "camper" : "campers"} live
                        </div>
                        {groupFilter && (
                            <button onClick={() => setGroupFilter("")} className="text-xs text-river-600 hover:underline">Clear filter</button>
                        )}
                    </div>
                    {visible.length === 0 ? (
                        <div className="text-sm text-slate-400 py-8 text-center">
                            No active campers in the last {maxAge} min.
                        </div>
                    ) : (
                        <ul className="space-y-2">
                            {visible.map((p) => {
                                const color = groupColor(p.group_code);
                                const isSel = selected?.camper_id === p.camper_id;
                                const isStationary = Number(p.stationary_minutes || 0) >= STATIONARY_THRESHOLD_MIN;
                                return (
                                    <li
                                        key={p.camper_id}
                                        className={`flex items-center gap-3 p-2 rounded-2xl cursor-pointer transition-colors ${isSel ? "bg-river-50 ring-1 ring-river-300" : isStationary ? "bg-rose-50 hover:bg-rose-100" : "hover:bg-slate-50"}`}
                                        onClick={() => {
                                            setSelected(p);
                                            mapRef.current?.panTo({ lat: p.latitude, lng: p.longitude });
                                        }}
                                        data-testid={`camper-row-${p.camper_id}`}
                                    >
                                        <div
                                            className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-bold border-2 shadow ${isStationary ? "border-rose-400 ring-2 ring-rose-200" : "border-white"}`}
                                            style={{ backgroundColor: color }}
                                        >
                                            {(p.first_name?.[0] || "?")}{p.last_name?.[0] || ""}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="text-sm font-bold text-slate-900 truncate flex items-center gap-1.5">
                                                {p.first_name} {p.last_name}
                                                {isStationary && (
                                                    <span
                                                        className="inline-flex items-center gap-0.5 rounded-full bg-rose-500 text-white text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5"
                                                        data-testid={`stationary-row-badge-${p.camper_id}`}
                                                    >
                                                        <AlertTriangle className="w-2.5 h-2.5" />
                                                        {p.stationary_minutes}m
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-xs text-slate-500 truncate">
                                                Group {p.group_code} · {fmtAge(p.updated_at)}
                                            </div>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
}
