import React, { useEffect, useMemo, useState } from "react";
import { adminApi, formatApiError } from "../../lib/api";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../../components/ui/dialog";
import { toast } from "sonner";
import { HandCoins, Search, Plus, Minus } from "lucide-react";

const RIVER_BALL = "https://static.prod-images.emergentagent.com/jobs/5b062d42-aa16-478f-9904-4c1a14748b37/images/0e5d9cd254c7af67a52924c927b4fb710091bea4bdb211921ad2c64510b4c327.png";

const REASON_LABELS = {
    starter: "Starter pack",
    daily_bonus: "Daily bonus",
    pin_bonus: "Explored pin",
    catch_reward: "Catch reward",
    throw: "Ball throw",
    counselor_award: "Counselor award",
};

export default function WalletTab() {
    const [balances, setBalances] = useState([]);
    const [ledger, setLedger] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState("");
    const [grantTarget, setGrantTarget] = useState(null); // camper
    const [grantAmount, setGrantAmount] = useState(10);
    const [grantReason, setGrantReason] = useState("Counselor award");
    const [saving, setSaving] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const [b, l] = await Promise.all([
                adminApi.get("/admin/wallet/balances"),
                adminApi.get("/admin/wallet/ledger?limit=50"),
            ]);
            setBalances(b.data);
            setLedger(l.data);
        } finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);

    const filtered = useMemo(() => {
        if (!filter.trim()) return balances;
        const f = filter.toLowerCase();
        return balances.filter((b) => `${b.first_name} ${b.last_name} ${b.group_code}`.toLowerCase().includes(f));
    }, [filter, balances]);

    const totalInCirculation = balances.reduce((s, b) => s + (b.balance || 0), 0);

    const openGrant = (camper, amount) => {
        setGrantTarget(camper);
        setGrantAmount(amount);
        setGrantReason("Counselor award");
    };

    const submitGrant = async () => {
        if (!grantTarget) return;
        setSaving(true);
        try {
            const r = await adminApi.post(`/admin/wallet/${grantTarget.camper_id}/grant`, {
                amount: Number(grantAmount),
                reason: grantReason?.toLowerCase().replace(/\s+/g, "_") || "counselor_award",
            });
            toast.success(`${grantTarget.first_name}: ${r.data.granted >= 0 ? "+" : ""}${r.data.granted} → ${r.data.balance}`);
            setGrantTarget(null);
            load();
        } catch (e) { toast.error(formatApiError(e)); }
        finally { setSaving(false); }
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
                <div>
                    <h2 className="font-heading text-2xl font-bold text-slate-900">Ball Economy</h2>
                    <p className="text-slate-500 text-sm">Grant bonus Rolling River Balls to campers as rewards.</p>
                </div>
                <div className="flex items-center gap-2 bg-white rounded-2xl px-4 py-2 border border-slate-200">
                    <img src={RIVER_BALL} alt="" className="w-6 h-6" />
                    <div>
                        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">In circulation</div>
                        <div className="font-heading text-xl font-bold text-slate-900" data-testid="balls-in-circulation">{totalInCirculation.toLocaleString()}</div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                    <div className="relative mb-3">
                        <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                        <Input
                            value={filter}
                            onChange={(e) => setFilter(e.target.value)}
                            placeholder="Search camper or group…"
                            className="rounded-2xl h-11 pl-10 bg-white"
                            data-testid="wallet-search-input"
                        />
                    </div>

                    <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden">
                        {loading ? (
                            <div className="p-10 text-center text-slate-400">Loading…</div>
                        ) : filtered.length === 0 ? (
                            <div className="p-10 text-center text-slate-400">No matches.</div>
                        ) : (
                            <div className="max-h-[60vh] overflow-y-auto">
                                <table className="w-full text-sm" data-testid="wallet-balances-table">
                                    <thead className="bg-slate-50 sticky top-0">
                                        <tr>
                                            <th className="text-left px-4 py-2 text-[11px] uppercase tracking-widest text-slate-500 font-bold">Camper</th>
                                            <th className="text-left px-4 py-2 text-[11px] uppercase tracking-widest text-slate-500 font-bold">Group</th>
                                            <th className="text-right px-4 py-2 text-[11px] uppercase tracking-widest text-slate-500 font-bold">Balance</th>
                                            <th className="text-right px-4 py-2 text-[11px] uppercase tracking-widest text-slate-500 font-bold">Grant</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filtered.map((b) => (
                                            <tr key={b.camper_id} className="border-t border-slate-100" data-testid={`wallet-row-${b.camper_id}`}>
                                                <td className="px-4 py-2 font-bold text-slate-900">{b.first_name} {b.last_name}</td>
                                                <td className="px-4 py-2 text-slate-600">{b.group_code}</td>
                                                <td className="px-4 py-2 text-right tabular-nums font-bold">{b.balance}</td>
                                                <td className="px-4 py-2 text-right">
                                                    <div className="inline-flex gap-1">
                                                        <Button size="sm" variant="outline" className="rounded-full h-7 text-xs px-2" onClick={() => openGrant(b, 10)} data-testid={`grant-10-${b.camper_id}`}>+10</Button>
                                                        <Button size="sm" variant="outline" className="rounded-full h-7 text-xs px-2" onClick={() => openGrant(b, 25)} data-testid={`grant-25-${b.camper_id}`}>+25</Button>
                                                        <Button size="sm" className="tactile-btn rounded-full h-7 text-xs px-2 bg-amber-500 hover:bg-amber-600 text-white" onClick={() => openGrant(b, 50)} data-testid={`grant-custom-${b.camper_id}`}>
                                                            <HandCoins className="w-3 h-3" />
                                                        </Button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>

                <div>
                    <h3 className="font-heading text-lg font-bold text-slate-900 mb-3">Recent activity</h3>
                    <div className="bg-white rounded-3xl border border-slate-200 max-h-[60vh] overflow-y-auto" data-testid="ledger-feed">
                        {ledger.length === 0 ? (
                            <div className="p-6 text-sm text-slate-400 text-center">No ledger entries yet.</div>
                        ) : ledger.map((e) => {
                            const camper = balances.find((b) => b.camper_id === e.camper_id);
                            const name = camper ? `${camper.first_name} ${camper.last_name}` : e.camper_id.slice(0, 6);
                            return (
                                <div key={e.id} className="px-4 py-2 border-b border-slate-100 last:border-none flex items-center justify-between gap-2 text-sm">
                                    <div className="min-w-0 flex-1">
                                        <div className="font-bold text-slate-900 truncate">{name}</div>
                                        <div className="text-[11px] text-slate-500">{REASON_LABELS[e.reason] || e.reason} · {new Date(e.created_at).toLocaleTimeString()}</div>
                                    </div>
                                    <div className={`font-heading font-bold tabular-nums text-sm ${e.delta >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                                        {e.delta >= 0 ? "+" : ""}{e.delta}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            <Dialog open={!!grantTarget} onOpenChange={(o) => !o && setGrantTarget(null)}>
                <DialogContent className="rounded-3xl">
                    <DialogHeader>
                        <DialogTitle className="font-heading text-2xl">
                            Grant balls to {grantTarget?.first_name} {grantTarget?.last_name}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div>
                            <div className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Amount</div>
                            <div className="flex items-center gap-2">
                                <Button variant="outline" size="sm" className="rounded-full h-10 w-10" onClick={() => setGrantAmount(Math.max(-500, Number(grantAmount) - 5))}>
                                    <Minus className="w-4 h-4" />
                                </Button>
                                <Input
                                    type="number"
                                    value={grantAmount}
                                    onChange={(e) => setGrantAmount(e.target.value)}
                                    className="rounded-2xl h-11 text-center font-heading font-bold text-xl"
                                    data-testid="grant-amount-input"
                                />
                                <Button variant="outline" size="sm" className="rounded-full h-10 w-10" onClick={() => setGrantAmount(Math.min(500, Number(grantAmount) + 5))}>
                                    <Plus className="w-4 h-4" />
                                </Button>
                            </div>
                            <div className="text-xs text-slate-500 mt-1">Negative numbers deduct (e.g. -10 to take away).</div>
                        </div>
                        <div>
                            <div className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Reason</div>
                            <Input
                                value={grantReason}
                                onChange={(e) => setGrantReason(e.target.value)}
                                placeholder="e.g. Cabin clean up winner"
                                className="rounded-2xl h-11"
                                data-testid="grant-reason-input"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setGrantTarget(null)} className="rounded-2xl">Cancel</Button>
                        <Button onClick={submitGrant} disabled={saving} className="tactile-btn rounded-2xl bg-river-500 hover:bg-river-600 text-white font-heading" data-testid="grant-submit-btn">
                            {saving ? "Saving…" : `Grant ${grantAmount > 0 ? "+" : ""}${grantAmount}`}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
