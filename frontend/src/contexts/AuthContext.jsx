import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { userApi, adminApi, tokenStore, formatApiError } from "../lib/api";

const UserAuthCtx = createContext(null);
const AdminAuthCtx = createContext(null);

export function UserAuthProvider({ children }) {
    const [user, setUser] = useState(undefined); // undefined = checking, null = logged out
    const [error, setError] = useState("");

    const fetchMe = useCallback(async () => {
        if (!tokenStore.getUser()) {
            setUser(null);
            return;
        }
        try {
            const res = await userApi.get("/auth/me");
            setUser(res.data);
        } catch (e) {
            tokenStore.clearUser();
            setUser(null);
        }
    }, []);

    useEffect(() => {
        fetchMe();
    }, [fetchMe]);

    const loginCamper = async (camperId) => {
        setError("");
        try {
            const res = await userApi.post("/camper/login", { camper_id: camperId });
            tokenStore.setUser(res.data.access_token);
            await fetchMe();
            return true;
        } catch (e) {
            setError(formatApiError(e));
            return false;
        }
    };

    const logout = async () => {
        try { await userApi.post("/auth/logout"); } catch {}
        tokenStore.clearUser();
        setUser(null);
    };

    return (
        <UserAuthCtx.Provider value={{ user, error, loginCamper, logout, refresh: fetchMe }}>
            {children}
        </UserAuthCtx.Provider>
    );
}

export const useUserAuth = () => useContext(UserAuthCtx);

export function AdminAuthProvider({ children }) {
    const [admin, setAdmin] = useState(undefined);
    const [error, setError] = useState("");

    const fetchMe = useCallback(async () => {
        if (!tokenStore.getAdmin()) {
            setAdmin(null);
            return;
        }
        try {
            const res = await adminApi.get("/admin/auth/me");
            setAdmin(res.data);
        } catch (e) {
            tokenStore.clearAdmin();
            setAdmin(null);
        }
    }, []);

    useEffect(() => {
        fetchMe();
    }, [fetchMe]);

    const login = async (username, password) => {
        setError("");
        try {
            const res = await adminApi.post("/admin/auth/login", { username, password });
            tokenStore.setAdmin(res.data.access_token);
            await fetchMe();
            return true;
        } catch (e) {
            setError(formatApiError(e));
            return false;
        }
    };

    const logout = () => {
        tokenStore.clearAdmin();
        setAdmin(null);
    };

    return (
        <AdminAuthCtx.Provider value={{ admin, error, login, logout, refresh: fetchMe }}>
            {children}
        </AdminAuthCtx.Provider>
    );
}

export const useAdminAuth = () => useContext(AdminAuthCtx);
