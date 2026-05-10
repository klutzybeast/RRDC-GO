import React, { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import { useAdminAuth } from "../contexts/AuthContext";
import { motion } from "framer-motion";
import { Shield, Eye, EyeOff } from "lucide-react";

export default function AdminLoginPage() {
    const { admin, login } = useAdminAuth();
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState("");
    const nav = useNavigate();

    useEffect(() => {
        if (admin) nav("/admin");
    }, [admin, nav]);

    const onSubmit = async (e) => {
        e.preventDefault();
        setErr("");
        setLoading(true);
        const ok = await login(username.trim(), password);
        setLoading(false);
        if (ok) nav("/admin");
        else setErr("Invalid admin credentials");
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-900 p-4" data-testid="admin-login-page">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-md"
            >
                <div className="bg-slate-800 rounded-[2rem] p-8 border border-slate-700">
                    <div className="text-center mb-6">
                        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-river-500/20 text-river-400 mb-3">
                            <Shield className="w-7 h-7" />
                        </div>
                        <h1 className="font-heading text-3xl font-bold text-white">Director Panel</h1>
                        <p className="text-slate-400 text-sm mt-1">Staff only</p>
                    </div>
                    <form onSubmit={onSubmit} className="space-y-4">
                        <div>
                            <Label className="text-slate-300">Username</Label>
                            <Input
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                className="h-12 rounded-2xl bg-slate-900 border-slate-700 text-white"
                                required
                                autoCapitalize="off"
                                autoCorrect="off"
                                autoComplete="username"
                                spellCheck={false}
                                data-testid="admin-username-input"
                            />
                        </div>
                        <div>
                            <Label className="text-slate-300">Password</Label>
                            <div className="relative">
                                <Input
                                    type={showPassword ? "text" : "password"}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="h-12 rounded-2xl bg-slate-900 border-slate-700 text-white pr-12"
                                    required
                                    autoCapitalize="off"
                                    autoCorrect="off"
                                    autoComplete="current-password"
                                    spellCheck={false}
                                    data-testid="admin-password-input"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword((v) => !v)}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full text-slate-400 hover:text-white active:scale-95 transition"
                                    aria-label={showPassword ? "Hide password" : "Show password"}
                                    data-testid="admin-password-toggle"
                                    tabIndex={-1}
                                >
                                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                </button>
                            </div>
                        </div>
                        {err && <div className="text-red-400 text-sm" data-testid="admin-login-error">{err}</div>}
                        <Button type="submit" disabled={loading} className="tactile-btn w-full h-12 rounded-2xl bg-river-500 hover:bg-river-600 text-white font-heading font-bold" data-testid="admin-login-submit">
                            {loading ? "Signing in…" : "Sign In"}
                        </Button>
                    </form>
                    <div className="mt-6 text-center">
                        <Link to="/" className="text-slate-400 hover:text-white text-sm">← Back to camper login</Link>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}
