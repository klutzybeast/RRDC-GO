import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Gift, Users, ArrowLeftRight, Inbox, Trophy } from "lucide-react";
import { userApi } from "../lib/api";
import { Button } from "../components/ui/button";
import { useUserAuth } from "../contexts/AuthContext";
import { toast } from "sonner";

const TABS = [
    { id: "friends", label: "Friends", Icon: Users },
    { id: "gifts", label: "Gifts", Icon: Gift },
    { id: "trades", label: "Trades", Icon: ArrowLeftRight },
];

function fmtAgo(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    const m = Math.floor((Date.now() - d.getTime()) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

export default function FriendsPage() {
    const nav = useNavigate();
    const { user, refresh: refreshWallet } = useUserAuth();
    const [tab, setTab] = useState("friends");

    return (
        <div className="min-h-screen bg-gradient-to-b from-river-50 via-emerald-50 to-white pb-12">
            <div className="sticky top-0 z-20 bg-white/95 backdrop-blur-sm border-b border-slate-200">
                <div className="max-w-md mx-auto px-3 py-3 flex items-center gap-2">
                    <button onClick={() => nav("/map")} className="p-2.5 -ml-1 rounded-full hover:bg-slate-100" data-testid="friends-back">
                        <ArrowLeft className="w-5 h-5 text-slate-700" />
                    </button>
                    <div className="flex-1">
                        <div className="text-[10px] uppercase tracking-widest text-river-600 font-bold">Group {user?.group_name || ""}</div>
                        <h1 className="font-heading text-lg font-black text-slate-900 leading-none">Friends &amp; Trades</h1>
                    </div>
                </div>
                <div className="max-w-md mx-auto px-2 pb-2 flex gap-1">
                    {TABS.map(({ id, label, Icon }) => (
                        <button
                            key={id}
                            onClick={() => setTab(id)}
                            className={`flex-1 px-3 h-10 rounded-xl flex items-center justify-center gap-1 text-xs font-bold transition ${tab === id ? "bg-river-500 text-white shadow-md" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                            data-testid={`friends-tab-${id}`}
                        >
                            <Icon className="w-4 h-4" /> {label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="max-w-md mx-auto px-3 py-4">
                {tab === "friends" && <FriendsList onRefresh={refreshWallet} />}
                {tab === "gifts" && <GiftInbox onClaimed={refreshWallet} />}
                {tab === "trades" && <TradesList />}
            </div>
        </div>
    );
}

function FriendsList({ onRefresh }) {
    const [friends, setFriends] = useState(null);
    const [busy, setBusy] = useState(null);
    const load = () => userApi.get("/friends").then((r) => setFriends(r.data || [])).catch(() => setFriends([]));
    useEffect(() => { load(); }, []);
    const sendGift = async (f) => {
        setBusy(f.camper_id);
        try {
            const r = await userApi.post("/gifts/send", { to_camper_id: f.camper_id });
            toast.success(`🎁 Sent ${r.data.to_first_name} +${r.data.pokeballs} balls!`);
            load();
        } catch (e) {
            toast.error(e?.response?.data?.detail || "Could not send gift");
        } finally { setBusy(null); }
    };
    if (!friends) return <div className="py-10 text-center text-slate-500">Loading…</div>;
    if (friends.length === 0) return <div className="py-10 text-center text-slate-500">No friends in your group yet.</div>;
    return (
        <ul className="space-y-2" data-testid="friends-list">
            {friends.map((f) => (
                <li key={f.camper_id} className="bg-white rounded-2xl border border-slate-200 p-3 flex items-center gap-3" data-testid={`friend-row-${f.camper_id}`}>
                    <div className="w-11 h-11 rounded-full bg-gradient-to-br from-sky-300 to-river-500 ring-2 ring-white shadow-md flex items-center justify-center text-white font-black text-lg">
                        {(f.first_name || "C")[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="font-heading text-base font-bold text-slate-900 truncate">{f.first_name}</div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-2">
                            <span className="flex items-center gap-0.5"><Trophy className="w-3 h-3" /> {f.catches_count}</span>
                            <span>· {fmtAgo(f.last_seen_at)}</span>
                        </div>
                    </div>
                    <Button
                        onClick={() => sendGift(f)}
                        disabled={!f.can_send_gift || busy === f.camper_id}
                        className="bg-amber-400 hover:bg-amber-500 text-amber-950 rounded-full text-xs font-black px-3 h-10 disabled:opacity-50"
                        data-testid={`gift-btn-${f.camper_id}`}
                    >
                        <Gift className="w-3.5 h-3.5 mr-1" /> {f.can_send_gift ? "Gift" : "Sent"}
                    </Button>
                </li>
            ))}
        </ul>
    );
}

function GiftInbox({ onClaimed }) {
    const [gifts, setGifts] = useState(null);
    const load = () => userApi.get("/gifts/inbox").then((r) => setGifts(r.data || [])).catch(() => setGifts([]));
    useEffect(() => { load(); }, []);
    const open = async (g) => {
        try {
            const r = await userApi.post(`/gifts/${g.id}/open`);
            if (r.data.already_opened) {
                toast.info(`Already opened — +${r.data.pokeballs} balls.`);
            } else {
                toast.success(`🎁 +${r.data.pokeballs} pokeballs from ${r.data.from_first_name}!`);
                if (onClaimed) onClaimed();
            }
            load();
        } catch (e) {
            toast.error(e?.response?.data?.detail || "Could not open gift");
        }
    };
    if (!gifts) return <div className="py-10 text-center text-slate-500">Loading…</div>;
    if (gifts.length === 0) return (
        <div className="py-10 text-center text-slate-500" data-testid="gifts-empty">
            <Inbox className="w-10 h-10 mx-auto mb-2 text-slate-300" />
            No gifts yet. Send some to your friends — they might send one back!
        </div>
    );
    return (
        <ul className="space-y-2" data-testid="gifts-list">
            {gifts.map((g) => (
                <li key={g.id} className={`rounded-2xl p-3 flex items-center gap-3 border ${g.opened ? "bg-slate-50 border-slate-200" : "bg-amber-50 border-amber-300"}`} data-testid={`gift-row-${g.id}`}>
                    <motion.div animate={!g.opened ? { rotate: [0, -6, 6, -3, 3, 0] } : {}} transition={{ repeat: Infinity, duration: 2.4 }} className="w-11 h-11 rounded-2xl bg-amber-300 flex items-center justify-center text-amber-950 shadow-md">
                        <Gift className="w-6 h-6" />
                    </motion.div>
                    <div className="flex-1 min-w-0">
                        <div className="font-bold text-slate-900 truncate">From {g.from_first_name}</div>
                        <div className="text-[11px] text-slate-500">{fmtAgo(g.sent_at)} · {g.opened ? `+${g.pokeballs} balls (opened)` : "Tap to open"}</div>
                    </div>
                    {!g.opened && (
                        <Button onClick={() => open(g)} className="bg-amber-500 hover:bg-amber-600 text-white rounded-full text-xs font-black px-3 py-2" data-testid={`gift-open-${g.id}`}>
                            Open
                        </Button>
                    )}
                </li>
            ))}
        </ul>
    );
}

function TradesList() {
    const { user } = useUserAuth();
    const [trades, setTrades] = useState(null);
    const load = () => userApi.get("/trades").then((r) => setTrades(r.data || [])).catch(() => setTrades([]));
    useEffect(() => { load(); }, []);
    const accept = async (t) => {
        try { await userApi.post(`/trades/${t.id}/accept`); toast.success("Trade complete!"); load(); }
        catch (e) { toast.error(e?.response?.data?.detail || "Could not accept"); }
    };
    const reject = async (t) => {
        try { await userApi.post(`/trades/${t.id}/reject`); toast.success("Trade declined"); load(); }
        catch (e) { toast.error(e?.response?.data?.detail || "Could not reject"); }
    };
    const revert = async (t) => {
        if (!window.confirm("Revert this trade? Both Pokémon will go back to where they were.")) return;
        try { await userApi.post(`/trades/${t.id}/revert`); toast.success("Trade reverted"); load(); }
        catch (e) { toast.error(e?.response?.data?.detail || "Could not revert"); }
    };
    if (!trades) return <div className="py-10 text-center text-slate-500">Loading…</div>;
    if (trades.length === 0) return (
        <div className="py-10 text-center text-slate-500" data-testid="trades-empty">
            <ArrowLeftRight className="w-10 h-10 mx-auto mb-2 text-slate-300" />
            No trades yet. Tap a friend's catch in your Collection to propose one.
        </div>
    );
    return (
        <ul className="space-y-3" data-testid="trades-list">
            {trades.map((t) => {
                const isProposer = t.proposer_id === user?.id;
                const otherName = isProposer ? t.receiver_first_name : t.proposer_first_name;
                const youOffer = isProposer ? t.offer_pokemon_image_data_url : t.request_pokemon_image_data_url;
                const youOfferName = isProposer ? t.offer_pokemon_name : t.request_pokemon_name;
                const youGet = isProposer ? t.request_pokemon_image_data_url : t.offer_pokemon_image_data_url;
                const youGetName = isProposer ? t.request_pokemon_name : t.offer_pokemon_name;
                const canAccept = !isProposer && t.status === "proposed";
                const canRevert = t.status === "accepted" && t.revert_until && new Date(t.revert_until) > new Date();
                return (
                    <li key={t.id} className="bg-white rounded-2xl border border-slate-200 p-3" data-testid={`trade-row-${t.id}`}>
                        <div className="flex items-center justify-between text-[10px] uppercase tracking-widest font-bold mb-2">
                            <span className="text-slate-500">{isProposer ? "You → " : ""}{otherName}{!isProposer ? " → You" : ""}</span>
                            <span className={`px-2 py-0.5 rounded-full ${
                                t.status === "proposed" ? "bg-amber-100 text-amber-700" :
                                t.status === "accepted" ? "bg-emerald-100 text-emerald-700" :
                                t.status === "reverted" ? "bg-slate-100 text-slate-500" :
                                "bg-rose-100 text-rose-700"
                            }`}>{t.status}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 items-center">
                            <div className="text-center">
                                <div className="text-[10px] uppercase tracking-widest font-bold text-slate-500 mb-1">You give</div>
                                {youOffer ? <img src={youOffer} alt={youOfferName} className="w-14 h-14 mx-auto object-contain" /> : <div className="w-14 h-14 mx-auto bg-slate-100 rounded-xl" />}
                                <div className="text-[11px] font-bold text-slate-900 truncate">{youOfferName}</div>
                            </div>
                            <ArrowLeftRight className="w-6 h-6 mx-auto text-river-500" />
                            <div className="text-center">
                                <div className="text-[10px] uppercase tracking-widest font-bold text-slate-500 mb-1">You get</div>
                                {youGet ? <img src={youGet} alt={youGetName} className="w-14 h-14 mx-auto object-contain" /> : <div className="w-14 h-14 mx-auto bg-slate-100 rounded-xl" />}
                                <div className="text-[11px] font-bold text-slate-900 truncate">{youGetName}</div>
                            </div>
                        </div>
                        <div className="mt-3 flex gap-2">
                            {canAccept && (
                                <>
                                    <Button onClick={() => accept(t)} className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-bold" data-testid={`trade-accept-${t.id}`}>Accept</Button>
                                    <Button onClick={() => reject(t)} variant="outline" className="flex-1 rounded-xl font-bold" data-testid={`trade-reject-${t.id}`}>Decline</Button>
                                </>
                            )}
                            {canRevert && (
                                <Button onClick={() => revert(t)} variant="outline" className="flex-1 rounded-xl font-bold" data-testid={`trade-revert-${t.id}`}>
                                    Revert (until {new Date(t.revert_until).toLocaleTimeString()})
                                </Button>
                            )}
                            {t.status === "proposed" && isProposer && (
                                <Button onClick={() => reject(t)} variant="outline" className="flex-1 rounded-xl font-bold" data-testid={`trade-cancel-${t.id}`}>Cancel</Button>
                            )}
                        </div>
                    </li>
                );
            })}
        </ul>
    );
}
