import React, { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import { useUserAuth } from "../contexts/AuthContext";
import { toast } from "sonner";

const BG_URL = "https://static.prod-images.emergentagent.com/jobs/5b062d42-aa16-478f-9904-4c1a14748b37/images/fcc906834deba231ec5757f1369ff983bf23ef7f59bd4db5a29f5216ec21d7f7.png";

export default function LoginPage() {
    const { user, login } = useUserAuth();
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState("");
    const nav = useNavigate();

    useEffect(() => {
        if (user) nav("/ar");
    }, [user, nav]);

    const onSubmit = async (e) => {
        e.preventDefault();
        setErr("");
        setLoading(true);
        const ok = await login(username.trim(), password);
        setLoading(false);
        if (ok) {
            toast.success("Welcome to the camp!");
            nav("/ar");
        } else {
            setErr("Invalid username or password");
        }
    };

    return (
        <div
            className="min-h-screen w-full flex items-center justify-center relative bg-river-500"
            style={{ backgroundImage: `url(${BG_URL})`, backgroundSize: "cover", backgroundPosition: "center" }}
            data-testid="login-page"
        >
            <div className="absolute inset-0 bg-gradient-to-b from-river-900/30 via-transparent to-river-900/50" />
            <motion.div
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="relative z-10 w-full max-w-md mx-4"
            >
                <div className="glass rounded-[2rem] p-8 shadow-[0_20px_60px_rgba(0,0,0,0.25)]">
                    <div className="text-center mb-6">
                        <div className="text-xs tracking-[0.3em] uppercase font-bold text-river-700">Rolling River Day Camp</div>
                        <h1 className="font-heading text-5xl sm:text-6xl font-bold text-slate-900 mt-2" data-testid="app-title">
                            RRDC <span className="text-river-500">GO</span>
                        </h1>
                        <p className="text-slate-700 mt-2 font-medium">Catch 'em around camp!</p>
                    </div>

                    <form onSubmit={onSubmit} className="space-y-4">
                        <div>
                            <Label htmlFor="username" className="font-bold text-slate-700">Squad Username</Label>
                            <Input
                                id="username"
                                type="text"
                                autoCapitalize="off"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                placeholder="red-squirrels"
                                className="h-12 rounded-2xl text-base bg-white/90"
                                required
                                data-testid="login-username-input"
                            />
                        </div>
                        <div>
                            <Label htmlFor="password" className="font-bold text-slate-700">Password</Label>
                            <Input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                className="h-12 rounded-2xl text-base bg-white/90"
                                required
                                data-testid="login-password-input"
                            />
                        </div>
                        {err && <div className="text-red-600 text-sm font-semibold" data-testid="login-error">{err}</div>}
                        <Button
                            type="submit"
                            disabled={loading}
                            className="tactile-btn w-full h-14 rounded-2xl text-base bg-river-500 hover:bg-river-600 text-white font-heading font-bold"
                            data-testid="login-submit-btn"
                        >
                            {loading ? "Loading…" : "Start Hunting"}
                        </Button>
                    </form>

                    <div className="mt-6 text-center text-xs text-slate-600">
                        No self sign-up — ask your counselor.
                    </div>
                </div>
                <div className="text-center mt-5">
                    <Link to="/admin/login" className="text-white/90 hover:text-white text-sm font-semibold bg-black/30 backdrop-blur px-4 py-2 rounded-full" data-testid="admin-link">
                        Director Panel
                    </Link>
                </div>
            </motion.div>
        </div>
    );
}
