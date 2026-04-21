import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

const USER_TOKEN_KEY = "rrdc_user_token";
const ADMIN_TOKEN_KEY = "rrdc_admin_token";

export const tokenStore = {
    getUser: () => localStorage.getItem(USER_TOKEN_KEY),
    setUser: (t) => localStorage.setItem(USER_TOKEN_KEY, t),
    clearUser: () => localStorage.removeItem(USER_TOKEN_KEY),
    getAdmin: () => localStorage.getItem(ADMIN_TOKEN_KEY),
    setAdmin: (t) => localStorage.setItem(ADMIN_TOKEN_KEY, t),
    clearAdmin: () => localStorage.removeItem(ADMIN_TOKEN_KEY),
};

export const userApi = axios.create({ baseURL: API });
userApi.interceptors.request.use((cfg) => {
    const t = tokenStore.getUser();
    if (t) cfg.headers.Authorization = `Bearer ${t}`;
    return cfg;
});

export const adminApi = axios.create({ baseURL: API });
adminApi.interceptors.request.use((cfg) => {
    const t = tokenStore.getAdmin();
    if (t) cfg.headers.Authorization = `Bearer ${t}`;
    return cfg;
});

export function formatApiError(err) {
    const d = err?.response?.data?.detail;
    if (!d) return err?.message || "Something went wrong";
    if (typeof d === "string") return d;
    if (Array.isArray(d)) return d.map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e))).join(" ");
    if (d && typeof d.msg === "string") return d.msg;
    return String(d);
}
