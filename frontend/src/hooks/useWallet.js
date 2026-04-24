import { useCallback, useEffect, useRef, useState } from "react";
import { userApi, formatApiError } from "../lib/api";

export function useWallet(enabled = true) {
    const [wallet, setWallet] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const refresh = useCallback(async () => {
        if (!enabled) return;
        setLoading(true);
        try {
            const r = await userApi.get("/wallet");
            setWallet(r.data);
            setError("");
        } catch (e) { setError(formatApiError(e)); }
        finally { setLoading(false); }
    }, [enabled]);

    const claimDaily = useCallback(async () => {
        try {
            const r = await userApi.post("/wallet/claim-daily");
            await refresh();
            return { ok: true, granted: r.data.granted, balance: r.data.balance };
        } catch (e) {
            return { ok: false, error: formatApiError(e) };
        }
    }, [refresh]);

    const claimPin = useCallback(async (pinId) => {
        try {
            const r = await userApi.post(`/wallet/claim-pin/${pinId}`);
            await refresh();
            return { ok: true, ...r.data };
        } catch (e) {
            return { ok: false, error: formatApiError(e) };
        }
    }, [refresh]);

    useEffect(() => { refresh(); }, [refresh]);

    return { wallet, loading, error, refresh, claimDaily, claimPin };
}
