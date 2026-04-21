import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GoogleMap, LoadScript, Marker, OverlayView } from "@react-google-maps/api";
import { motion } from "framer-motion";
import { userApi, formatApiError } from "../lib/api";
import { useUserAuth } from "../contexts/AuthContext";
import { LogOut, BackpackIcon, MapPin, Sparkles } from "lucide-react";
import RarityBadge from "../components/RarityBadge";
import { Button } from "../components/ui/button";
import { toast } from "sonner";

const GOOGLE_KEY = process.env.REACT_APP_GOOGLE_MAPS_KEY;
const RIVER_BALL = "https://static.prod-images.emergentagent.com/jobs/5b062d42-aa16-478f-9904-4c1a14748b37/images/0e5d9cd254c7af67a52924c927b4fb710091bea4bdb211921ad2c64510b4c327.png";

const rarityColor = {
    common: "#94A3B8",
    uncommon: "#22C55E",
    rare: "#3B82F6",
    legendary: "#FBBF24",
};

const mapStyles = [
    { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
    { featureType: "transit", elementType: "labels", stylers: [{ visibility: "off" }] },
];

function Countdown({ until }) {
    const [, setTick] = useState(0);
    useEffect(() => {
        const id = setInterval(() => setTick((x) => x + 1), 1000);
        return () => clearInterval(id);
    }, []);
    if (!until) return null;
    const ms = new Date(until).getTime() - Date.now();
    if (ms <= 0) return <span>now</span>;
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    return <span>{mins > 0 ? `${mins}m ` : ""}{secs}s</span>;
}

export default function MapPage() {
    const { user, logout } = useUserAuth();
    const nav = useNavigate();
    const [spawn, setSpawn] = useState(null);
    const [nextSpawnAt, setNextSpawnAt] = useState(null);
    const [enabled, setEnabled] = useState(true);
    const [pins, setPins] = useState([]);
    const [center, setCenter] = useState({ lat: 40.7128, lng: -74.0060 });
    const [zoom, setZoom] = useState(17);
    const [myLocation, setMyLocation] = useState(null);
    const [geoError, setGeoError] = useState("");
    const mapRef = useRef(null);
    const pollRef = useRef(null);
    const prevSpawnRef = useRef(null);

    // Poll spawn
    const poll = React.useCallback(async () => {
        try {
            const res = await userApi.get("/spawn/current");
            setEnabled(res.data.enabled);
            setNextSpawnAt(res.data.next_spawn_at);
            const s = res.data.spawn;
            const prevId = prevSpawnRef.current?.spawn_id;
            setSpawn(s);
            if (s && s.spawn_id !== prevId) {
                prevSpawnRef.current = s;
                toast.success(`A wild ${s.pokemon.name} appeared!`, { duration: 3500 });
                if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
            } else if (!s) {
                prevSpawnRef.current = null;
            }
        } catch (e) {
            // silent
        }
    }, []);

    useEffect(() => {
        poll();
        pollRef.current = setInterval(poll, 4000);
        return () => clearInterval(pollRef.current);
    }, [poll]);

    // Fetch pins + center the map
    useEffect(() => {
        userApi.get("/map-pins").then((r) => {
            setPins(r.data);
            if (r.data.length > 0) {
                const lat = r.data.reduce((s, p) => s + p.latitude, 0) / r.data.length;
                const lng = r.data.reduce((s, p) => s + p.longitude, 0) / r.data.length;
                setCenter({ lat, lng });
            }
        }).catch(() => {});
    }, []);

    // Watch geolocation
    useEffect(() => {
        if (!navigator.geolocation) {
            setGeoError("Your browser doesn't support location.");
            return;
        }
        const id = navigator.geolocation.watchPosition(
            (pos) => {
                setMyLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
                setGeoError("");
            },
            (err) => setGeoError(err?.message || "Location unavailable"),
            { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
        );
        return () => navigator.geolocation.clearWatch(id);
    }, []);

    // Recenter when spawn arrives
    useEffect(() => {
        if (spawn?.latitude && spawn?.longitude && mapRef.current) {
            mapRef.current.panTo({ lat: spawn.latitude, lng: spawn.longitude });
        }
    }, [spawn?.spawn_id, spawn?.latitude, spawn?.longitude]);

    const handleLogout = async () => {
        await logout();
        nav("/");
    };

    const openCatch = () => {
        if (!spawn) return;
        nav("/ar");
    };

    const campCenter = myLocation || center;

    return (
        <div className="relative w-full h-screen bg-slate-900" data-testid="map-page">
            {GOOGLE_KEY ? (
                <LoadScript googleMapsApiKey={GOOGLE_KEY} loadingElement={<div className="absolute inset-0 flex items-center justify-center text-white">Loading map…</div>}>
                    <GoogleMap
                        mapContainerStyle={{ width: "100%", height: "100%" }}
                        center={campCenter}
                        zoom={zoom}
                        options={{
                            styles: mapStyles,
                            disableDefaultUI: true,
                            zoomControl: true,
                            clickableIcons: false,
                            gestureHandling: "greedy",
                            mapTypeId: "hybrid",
                        }}
                        onLoad={(m) => (mapRef.current = m)}
                    >
                        {/* My location */}
                        {myLocation && (
                            <OverlayView position={myLocation} mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}>
                                <div className="relative" style={{ transform: "translate(-50%, -50%)" }}>
                                    <div className="w-5 h-5 rounded-full bg-river-500 border-2 border-white shadow-lg" />
                                    <div className="absolute inset-0 rounded-full bg-river-500/30 animate-ping" />
                                </div>
                            </OverlayView>
                        )}

                        {/* Pins */}
                        {pins.map((p) => (
                            <Marker
                                key={p.id}
                                position={{ lat: p.latitude, lng: p.longitude }}
                                title={p.name}
                                icon={{
                                    path: window.google?.maps?.SymbolPath?.CIRCLE,
                                    scale: 6,
                                    fillColor: "#22C55E",
                                    fillOpacity: 0.5,
                                    strokeWeight: 1,
                                    strokeColor: "#16A34A",
                                }}
                            />
                        ))}

                        {/* Active spawn marker */}
                        {spawn?.latitude != null && spawn?.longitude != null && (
                            <OverlayView
                                position={{ lat: spawn.latitude, lng: spawn.longitude }}
                                mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                            >
                                <div
                                    onClick={openCatch}
                                    className="relative cursor-pointer"
                                    style={{ transform: "translate(-50%, -100%)" }}
                                    data-testid="spawn-marker"
                                >
                                    <motion.div
                                        animate={{ y: [0, -8, 0] }}
                                        transition={{ repeat: Infinity, duration: 1.6 }}
                                        className="relative"
                                    >
                                        <div
                                            className="w-20 h-20 rounded-full flex items-center justify-center shadow-2xl border-4 border-white"
                                            style={{ background: rarityColor[spawn.pokemon.rarity] || "#94A3B8" }}
                                        >
                                            {spawn.pokemon.image_data_url ? (
                                                <img src={spawn.pokemon.image_data_url} alt="" className="w-[80%] h-[80%] object-contain" />
                                            ) : (
                                                <Sparkles className="w-8 h-8 text-white" />
                                            )}
                                        </div>
                                        <div className="absolute left-1/2 -translate-x-1/2 -bottom-2 w-0 h-0 border-l-8 border-r-8 border-t-8 border-transparent" style={{ borderTopColor: "white" }} />
                                    </motion.div>
                                </div>
                            </OverlayView>
                        )}
                    </GoogleMap>
                </LoadScript>
            ) : (
                <div className="absolute inset-0 flex items-center justify-center text-white">
                    Google Maps key missing. Ask director to configure.
                </div>
            )}

            {/* Top bar */}
            <div className="absolute top-3 left-3 right-3 flex items-center justify-between gap-2 z-10 pointer-events-none">
                <div className="glass-dark rounded-full px-4 py-2 text-sm font-bold flex items-center gap-2 pointer-events-auto" data-testid="camper-badge">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    {user?.first_name ? `${user.first_name} ${user.last_name}` : user?.username}
                    <span className="text-[10px] uppercase tracking-widest bg-white/20 rounded-full px-2 py-0.5 ml-1">{user?.group_name}</span>
                </div>
                <div className="flex gap-2 pointer-events-auto">
                    <button
                        onClick={() => nav("/collection")}
                        className="glass-dark rounded-full px-3 py-2 text-sm font-bold flex items-center gap-2"
                        data-testid="open-collection-btn"
                    >
                        <BackpackIcon className="w-4 h-4" /> My Pokedex
                    </button>
                    <button onClick={handleLogout} className="glass-dark rounded-full p-2" aria-label="Logout" data-testid="logout-btn">
                        <LogOut className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Bottom hud */}
            <div className="absolute bottom-4 left-3 right-3 flex items-end justify-between gap-2 z-10">
                <div className="glass-dark rounded-2xl px-4 py-3 max-w-[240px]" data-testid="hud-status">
                    {spawn ? (
                        <>
                            <div className="text-[10px] uppercase tracking-widest opacity-70">Active</div>
                            <div className="font-heading text-lg font-bold">{spawn.pokemon.name}</div>
                            <div className="mt-1 flex items-center gap-2">
                                <RarityBadge rarity={spawn.pokemon.rarity} className="text-[10px] px-2 py-0" />
                                {spawn.pin_name && <span className="text-[11px] opacity-80 flex items-center gap-1"><MapPin className="w-3 h-3" /> {spawn.pin_name}</span>}
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="text-[10px] uppercase tracking-widest opacity-70">Next spawn</div>
                            <div className="font-heading text-lg font-bold">
                                {enabled ? <Countdown until={nextSpawnAt} /> : "Paused"}
                            </div>
                            <div className="text-[11px] opacity-70 mt-0.5">Keep walking around camp!</div>
                        </>
                    )}
                </div>

                {spawn && (
                    <motion.button
                        onClick={openCatch}
                        whileTap={{ scale: 0.92 }}
                        className="relative"
                        data-testid="open-catch-btn"
                    >
                        <motion.img
                            src={RIVER_BALL}
                            alt="Catch"
                            className="w-24 h-24 drop-shadow-[0_8px_18px_rgba(0,0,0,0.6)]"
                            animate={{ y: [0, -6, 0] }}
                            transition={{ repeat: Infinity, duration: 1.6 }}
                        />
                        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-amber-300 text-slate-900 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full whitespace-nowrap">
                            Tap to catch
                        </div>
                    </motion.button>
                )}
            </div>

            {geoError && (
                <div className="absolute top-20 left-1/2 -translate-x-1/2 glass-dark rounded-full px-4 py-2 text-xs font-bold" data-testid="geo-error">
                    📍 {geoError}
                </div>
            )}
        </div>
    );
}
