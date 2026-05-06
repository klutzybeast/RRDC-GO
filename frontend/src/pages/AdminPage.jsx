import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAdminAuth } from "../contexts/AuthContext";
import { Button } from "../components/ui/button";
import { LogOut, Users, Sparkles, Clock, BarChart3, MapPin, HandCoins, Compass, Calendar } from "lucide-react";
import RosterTab from "./admin/RosterTab";
import PokemonTab from "./admin/PokemonTab";
import SpawnConfigTab from "./admin/SpawnConfigTab";
import AnalyticsTab from "./admin/AnalyticsTab";
import MapPinsTab from "./admin/MapPinsTab";
import WalletTab from "./admin/WalletTab";
import CamperMapTab from "./admin/CamperMapTab";
import EventsTab from "./admin/EventsTab";

const TABS = [
    { id: "analytics", label: "Analytics", icon: BarChart3 },
    { id: "roster", label: "Roster", icon: Users },
    { id: "wallet", label: "Balls", icon: HandCoins },
    { id: "pokemon", label: "Pokemon", icon: Sparkles },
    { id: "events", label: "Events", icon: Calendar },
    { id: "pins", label: "Map Pins", icon: MapPin },
    { id: "campers", label: "Live Map", icon: Compass },
    { id: "spawns", label: "Spawns", icon: Clock },
];

export default function AdminPage() {
    const { admin, logout } = useAdminAuth();
    const [tab, setTab] = useState("analytics");
    const nav = useNavigate();

    const doLogout = () => {
        logout();
        nav("/admin/login");
    };

    return (
        <div className="min-h-screen bg-slate-50" data-testid="admin-page">
            <div className="bg-white border-b border-slate-200">
                <div className="max-w-7xl mx-auto px-4 sm:px-8 py-4 flex items-center justify-between">
                    <div>
                        <div className="text-xs uppercase tracking-widest font-bold text-river-600">RRDC GO</div>
                        <h1 className="font-heading text-2xl font-bold text-slate-900">Director Panel</h1>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="text-sm text-slate-600 hidden sm:block">{admin?.username}</span>
                        <Button variant="outline" onClick={doLogout} className="rounded-full" data-testid="admin-logout-btn">
                            <LogOut className="w-4 h-4 mr-2" /> Sign out
                        </Button>
                    </div>
                </div>
                <div className="max-w-7xl mx-auto px-4 sm:px-8 flex gap-1 overflow-x-auto no-scrollbar">
                    {TABS.map((t) => {
                        const Icon = t.icon;
                        const active = tab === t.id;
                        return (
                            <button
                                key={t.id}
                                onClick={() => setTab(t.id)}
                                className={`px-4 py-3 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${
                                    active
                                        ? "border-river-500 text-river-600"
                                        : "border-transparent text-slate-500 hover:text-slate-700"
                                }`}
                                data-testid={`admin-tab-${t.id}`}
                            >
                                <Icon className="w-4 h-4" /> {t.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="max-w-7xl mx-auto p-4 sm:p-8">
                {tab === "analytics" && <AnalyticsTab />}
                {tab === "roster" && <RosterTab />}
                {tab === "wallet" && <WalletTab />}
                {tab === "pokemon" && <PokemonTab />}
                {tab === "events" && <EventsTab />}
                {tab === "pins" && <MapPinsTab />}
                {tab === "campers" && <CamperMapTab />}
                {tab === "spawns" && <SpawnConfigTab />}
            </div>
        </div>
    );
}
