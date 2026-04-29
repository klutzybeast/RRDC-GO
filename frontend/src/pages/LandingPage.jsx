import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Link, useNavigate } from "react-router-dom";
import {
    MapPin, Sparkles, ScrollText, Camera, Compass, Users, Trophy,
    Heart, Gift, Swords, Shield, Star, ChevronDown, ArrowRight, Mail,
} from "lucide-react";
import CampBall from "../components/CampBall";
import { useUserAuth } from "../contexts/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";

const BG_URL = "https://customer-assets.emergentagent.com/job_river-catch-1/artifacts/ryl7u54o_image12.jpg";

const FEATURES = [
    { Icon: MapPin,      title: "Live camp map",           desc: "See exactly where you are and what Pokémon are spawning right around you.", color: "from-river-400 to-river-600" },
    { Icon: Camera,      title: "AR catch screen",         desc: "Point your iPad and throw 4 different ball types with a real spiral animation.", color: "from-emerald-400 to-emerald-600" },
    { Icon: Sparkles,    title: "11 Pokémon types",        desc: "Fire, water, grass, electric, psychic, dark and more. Each one looks different.", color: "from-fuchsia-400 to-rose-500" },
    { Icon: ScrollText,  title: "Daily challenges",        desc: "Daily, weekly, monthly, and expert challenges. Earn balls. Stay engaged.", color: "from-amber-400 to-orange-500" },
    { Icon: Compass,     title: "Director live map",       desc: "Counselors see every camper in real time. Safety + fun in one screen.", color: "from-sky-400 to-blue-600" },
    { Icon: Trophy,      title: "Group leaderboards",      desc: "Groups compete for catch counts, supervisor catches, and rare finds.", color: "from-yellow-400 to-amber-600" },
];

const PHASES = [
    {
        id: 1, label: "Phase 1", title: "Buddy Pokémon",
        Icon: Heart,
        eta: "Next sprint",
        bullets: [
            "Pick a buddy from your Pokedex.",
            "Buddy walks beside you on the map.",
            "Earn candy every 100m to level them up.",
        ],
        accent: "from-rose-400 to-pink-600",
    },
    {
        id: 2, label: "Phase 2", title: "PokéStops & Gyms",
        Icon: Shield,
        eta: "Soon",
        bullets: [
            "Camp pins split into Stops (free balls) and Gyms.",
            "Groups claim Gyms with their best supervisor.",
            "Rival groups battle to take them back.",
        ],
        accent: "from-amber-400 to-orange-600",
    },
    {
        id: 3, label: "Phase 3", title: "Friends & Gifts",
        Icon: Gift,
        eta: "Soon",
        bullets: [
            "Add friends across or within groups.",
            "Send a daily gift — postcard + balls.",
            "7-day streak → bonus rare ball.",
        ],
        accent: "from-fuchsia-400 to-rose-600",
    },
    {
        id: 4, label: "Phase 4", title: "Raids",
        Icon: Swords,
        eta: "Coming soon",
        bullets: [
            "Daily raid bosses spawn at gyms.",
            "Team up — 2+ kids physically nearby join.",
            "Defeat the boss, everyone catches it.",
        ],
        accent: "from-violet-500 to-indigo-700",
    },
    {
        id: 5, label: "Phase 5", title: "Trading",
        Icon: Users,
        eta: "Coming soon",
        bullets: [
            "Two friends in the same spot → trade.",
            "Director can require approval for younger camps.",
            "1 trade per pair per day.",
        ],
        accent: "from-cyan-400 to-blue-600",
    },
    {
        id: 6, label: "Phase 6", title: "Party Play",
        Icon: Star,
        eta: "Coming soon",
        bullets: [
            "4 kids form a Party by tapping nearby.",
            "+20% catch rate while together.",
            "Shared daily party goal.",
        ],
        accent: "from-emerald-400 to-teal-600",
    },
];

function FloatingBall({ ballId, top, left, delay, size }) {
    return (
        <motion.div
            className="absolute pointer-events-none"
            style={{ top, left }}
            initial={{ y: 0, rotate: 0 }}
            animate={{ y: [0, -22, 0], rotate: [0, 360] }}
            transition={{ y: { repeat: Infinity, duration: 5 + delay, ease: "easeInOut", delay }, rotate: { repeat: Infinity, duration: 12 + delay, ease: "linear", delay } }}
        >
            <CampBall ballId={ballId} size={size} animate={false} />
        </motion.div>
    );
}

export default function LandingPage() {
    const nav = useNavigate();
    const { user } = useUserAuth();
    const [email, setEmail] = useState("");

    // Already-logged-in campers should hop straight into the game so this
    // page is purely a marketing entry for first-time visitors / parents.
    useEffect(() => {
        if (user) nav("/map", { replace: true });
    }, [user, nav]);

    const onJoinList = (e) => {
        e?.preventDefault?.();
        if (!email || !email.includes("@")) {
            toast.error("Enter a valid email so we can ping you when the next phase ships.");
            return;
        }
        // Stash locally — counselor team can collect later.
        try {
            const list = JSON.parse(localStorage.getItem("rrdc_waitlist") || "[]");
            list.push({ email, at: new Date().toISOString() });
            localStorage.setItem("rrdc_waitlist", JSON.stringify(list));
        } catch {}
        toast.success("You're on the list! We'll email you when raids land.");
        setEmail("");
    };

    return (
        <div className="min-h-screen bg-slate-900 text-white overflow-x-hidden" data-testid="landing-page">
            {/* Top nav */}
            <header className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 sm:px-8 py-4">
                <div className="flex items-baseline gap-2">
                    <span className="text-[10px] sm:text-xs uppercase tracking-[0.25em] text-white/70 font-semibold">Rolling River Day Camp</span>
                </div>
                <Link
                    to="/admin/login"
                    className="text-xs uppercase tracking-widest font-semibold text-white/70 hover:text-white transition-colors"
                    data-testid="director-link"
                >
                    Director
                </Link>
            </header>

            {/* HERO */}
            <section className="relative min-h-[100svh] flex items-center justify-center px-4 py-20 overflow-hidden">
                {/* Camp background */}
                <div
                    className="absolute inset-0"
                    style={{
                        backgroundImage: `url(${BG_URL})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                    }}
                />
                <div className="absolute inset-0 bg-gradient-to-b from-slate-900/55 via-slate-900/65 to-slate-900" />

                {/* Floating decorative balls */}
                <FloatingBall ballId="pokeball"   top="14%" left="8%"  delay={0} size={64} />
                <FloatingBall ballId="rayball"    top="22%" left="86%" delay={1.4} size={52} />
                <FloatingBall ballId="myrtleball" top="68%" left="6%"  delay={0.8} size={70} />
                <FloatingBall ballId="lunchball"  top="74%" left="84%" delay={2.2} size={56} />

                <motion.div
                    className="relative z-10 max-w-3xl text-center"
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.7 }}
                >
                    <motion.img
                        src="/rrdc-logo.png"
                        alt="RRDC GO"
                        className="mx-auto w-44 h-44 sm:w-56 sm:h-56 lg:w-64 lg:h-64 mb-3 drop-shadow-2xl"
                        initial={{ scale: 0.6, rotate: -8, opacity: 0 }}
                        animate={{ scale: 1, rotate: 0, opacity: 1 }}
                        transition={{ type: "spring", bounce: 0.5, duration: 1 }}
                        data-testid="landing-logo"
                    />
                    <p className="text-lg sm:text-2xl text-white mb-2 font-semibold drop-shadow-[0_2px_12px_rgba(0,0,0,0.9)]" style={{ textShadow: "0 2px 16px rgba(0,0,0,0.85), 0 1px 4px rgba(0,0,0,0.95)" }}>
                        Catch Pokémon all over Rolling River.
                    </p>
                    <p className="text-base sm:text-lg text-white mb-10 max-w-xl mx-auto leading-relaxed drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]" style={{ textShadow: "0 2px 12px rgba(0,0,0,0.85), 0 1px 3px rgba(0,0,0,0.95)" }}>
                        An augmented-reality treasure hunt designed for camp days. Walk, find,
                        throw, collect. Daily challenges, supervisor Pokémon, and 4 kinds of balls
                        to earn.
                    </p>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                        <motion.button
                            onClick={() => nav("/login")}
                            whileHover={{ scale: 1.04 }}
                            whileTap={{ scale: 0.96 }}
                            className="group relative inline-flex items-center gap-3 px-8 py-4 rounded-full bg-gradient-to-r from-amber-400 to-amber-600 text-slate-900 font-heading text-xl font-black shadow-2xl tactile-btn"
                            data-testid="hero-play-now"
                        >
                            <CampBall ballId="pokeball" size={32} animate={false} />
                            <span>Play Now</span>
                            <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
                        </motion.button>

                        <a
                            href="#what-you-get"
                            className="text-white/80 hover:text-white text-sm font-semibold uppercase tracking-widest underline underline-offset-4 decoration-white/30 hover:decoration-white"
                            data-testid="hero-learn-more"
                        >
                            What's in the game ↓
                        </a>
                    </div>

                    <div className="mt-20 flex justify-center">
                        <motion.div
                            animate={{ y: [0, 10, 0] }}
                            transition={{ repeat: Infinity, duration: 1.6, ease: "easeInOut" }}
                            className="text-white/60"
                        >
                            <ChevronDown className="w-8 h-8" />
                        </motion.div>
                    </div>
                </motion.div>
            </section>

            {/* WHAT'S IN THE GAME */}
            <section id="what-you-get" className="relative py-24 px-4 sm:px-8 bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
                <div className="max-w-6xl mx-auto">
                    <div className="text-center mb-14">
                        <div className="text-xs uppercase tracking-[0.3em] text-amber-400 font-bold mb-3">Already in your camp</div>
                        <h2 className="font-heading text-4xl sm:text-5xl lg:text-6xl font-black">What you get on Day 1</h2>
                        <p className="text-white/60 mt-3 max-w-2xl mx-auto">
                            Everything below is shipping today. Tap the ball, walk around, catch supervisors.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                        {FEATURES.map((f, i) => (
                            <motion.div
                                key={f.title}
                                initial={{ opacity: 0, y: 30 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true, margin: "-50px" }}
                                transition={{ duration: 0.5, delay: i * 0.06 }}
                                whileHover={{ y: -6 }}
                                className="group relative rounded-3xl bg-white/5 border border-white/10 p-6 hover:bg-white/10 hover:border-white/20 transition-all backdrop-blur-sm"
                                data-testid={`feature-${i}`}
                            >
                                <div className={`inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br ${f.color} mb-4 shadow-lg group-hover:scale-110 transition-transform`}>
                                    <f.Icon className="w-7 h-7 text-white" />
                                </div>
                                <h3 className="font-heading text-xl font-bold mb-2">{f.title}</h3>
                                <p className="text-sm text-white/70 leading-relaxed">{f.desc}</p>
                            </motion.div>
                        ))}
                    </div>

                    <div className="mt-12 text-center">
                        <motion.button
                            onClick={() => nav("/login")}
                            whileHover={{ scale: 1.04 }}
                            whileTap={{ scale: 0.96 }}
                            className="inline-flex items-center gap-3 px-7 py-3.5 rounded-full bg-river-500 hover:bg-river-600 text-white font-heading font-bold shadow-xl tactile-btn"
                            data-testid="features-play-now"
                        >
                            <CampBall ballId="pokeball" size={28} animate={false} />
                            <span>Jump in — Play Now</span>
                        </motion.button>
                    </div>
                </div>
            </section>

            {/* ROADMAP */}
            <section id="roadmap" className="relative py-24 px-4 sm:px-8 bg-gradient-to-b from-slate-900 to-slate-950">
                <div className="absolute inset-0 opacity-30 pointer-events-none" style={{ background: "radial-gradient(circle at 30% 20%, rgba(56,189,248,0.15) 0%, transparent 50%), radial-gradient(circle at 70% 80%, rgba(236,72,153,0.15) 0%, transparent 50%)" }} />
                <div className="relative max-w-5xl mx-auto">
                    <div className="text-center mb-16">
                        <div className="text-xs uppercase tracking-[0.3em] text-fuchsia-400 font-bold mb-3">What's coming</div>
                        <h2 className="font-heading text-4xl sm:text-5xl lg:text-6xl font-black">The Roadmap</h2>
                        <p className="text-white/60 mt-3 max-w-2xl mx-auto">
                            Six phases of new ways to play, shipping every couple of weeks.
                        </p>
                    </div>

                    {/* Vertical timeline */}
                    <ol className="relative space-y-6 sm:space-y-8 before:absolute before:left-6 sm:before:left-1/2 before:top-0 before:bottom-0 before:w-0.5 before:bg-gradient-to-b before:from-amber-400/0 before:via-amber-400/50 before:to-amber-400/0">
                        {PHASES.map((p, i) => {
                            const left = i % 2 === 0;
                            return (
                                <motion.li
                                    key={p.id}
                                    initial={{ opacity: 0, y: 30 }}
                                    whileInView={{ opacity: 1, y: 0 }}
                                    viewport={{ once: true, margin: "-50px" }}
                                    transition={{ duration: 0.5, delay: i * 0.05 }}
                                    className="relative pl-16 sm:pl-0 sm:grid sm:grid-cols-2 sm:gap-8"
                                    data-testid={`phase-${p.id}`}
                                >
                                    {/* Node dot */}
                                    <div className="absolute left-3 sm:left-1/2 top-2 sm:-translate-x-1/2 w-7 h-7 rounded-full bg-gradient-to-br from-amber-300 to-amber-600 ring-4 ring-slate-950 flex items-center justify-center shadow-lg z-10">
                                        <span className="text-[10px] font-black text-slate-900">{p.id}</span>
                                    </div>

                                    {/* Card — alternates sides on sm+ */}
                                    <div className={`rounded-3xl p-6 bg-gradient-to-br ${p.accent} shadow-2xl border border-white/15 ${left ? "sm:col-start-1 sm:text-right sm:pr-10" : "sm:col-start-2 sm:text-left sm:pl-10"}`}>
                                        <div className={`flex items-center gap-3 mb-3 ${left ? "sm:justify-end" : "sm:justify-start"}`}>
                                            <span className="text-[10px] uppercase tracking-[0.25em] font-black bg-black/30 rounded-full px-2.5 py-1">
                                                {p.eta}
                                            </span>
                                            <p.Icon className="w-7 h-7 drop-shadow" />
                                        </div>
                                        <div className="text-[11px] uppercase tracking-widest font-bold opacity-80">{p.label}</div>
                                        <h3 className="font-heading text-2xl sm:text-3xl font-black mt-1 mb-3">{p.title}</h3>
                                        <ul className="space-y-1.5 text-sm/6 text-white/95">
                                            {p.bullets.map((b, k) => (
                                                <li key={k} className={`flex items-start gap-2 ${left ? "sm:flex-row-reverse" : ""}`}>
                                                    <span className="mt-2 w-1.5 h-1.5 rounded-full bg-white shrink-0" />
                                                    <span className="flex-1">{b}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                </motion.li>
                            );
                        })}
                    </ol>

                    {/* Coming Soon CTA */}
                    <motion.form
                        onSubmit={onJoinList}
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.5 }}
                        className="mt-16 max-w-xl mx-auto rounded-3xl bg-white/8 border border-white/15 backdrop-blur-md p-6 sm:p-8 text-center"
                        data-testid="coming-soon-card"
                    >
                        <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-amber-300 font-bold mb-2">
                            <Mail className="w-4 h-4" /> Coming soon
                        </div>
                        <h3 className="font-heading text-2xl sm:text-3xl font-black mb-2">Get notified when raids drop</h3>
                        <p className="text-white/70 text-sm mb-5">
                            Drop your email and we'll ping you the moment the next phase ships.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-2">
                            <Input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="parent@email.com"
                                className="rounded-2xl h-12 bg-white text-slate-900 border-0 placeholder:text-slate-400"
                                data-testid="coming-soon-email"
                            />
                            <Button
                                type="submit"
                                className="rounded-2xl h-12 px-6 bg-amber-400 hover:bg-amber-500 text-slate-900 font-heading font-black tactile-btn"
                                data-testid="coming-soon-submit"
                            >
                                Notify me
                            </Button>
                        </div>
                    </motion.form>
                </div>
            </section>

            {/* FINAL CTA */}
            <section className="relative py-24 px-4 sm:px-8 bg-gradient-to-br from-river-500 via-river-600 to-river-700 overflow-hidden">
                <FloatingBall ballId="lunchball" top="20%" left="12%" delay={0.5} size={50} />
                <FloatingBall ballId="myrtleball" top="55%" left="85%" delay={1.2} size={60} />
                <FloatingBall ballId="rayball" top="78%" left="20%" delay={2.0} size={44} />

                <div className="relative max-w-3xl mx-auto text-center">
                    <h2 className="font-heading text-5xl sm:text-6xl lg:text-7xl font-black mb-4" style={{ textShadow: "0 4px 30px rgba(0,0,0,0.3)" }}>
                        Ready to play?
                    </h2>
                    <p className="text-white/90 text-lg mb-10 max-w-xl mx-auto">
                        Pick your group, find your name, and start catching. No password, no app store, no setup.
                    </p>
                    <motion.button
                        onClick={() => nav("/login")}
                        whileHover={{ scale: 1.04 }}
                        whileTap={{ scale: 0.96 }}
                        className="inline-flex items-center gap-3 px-10 py-5 rounded-full bg-white text-river-700 font-heading text-2xl font-black shadow-2xl tactile-btn"
                        data-testid="final-play-now"
                    >
                        <CampBall ballId="pokeball" size={36} animate={false} />
                        <span>Play Now</span>
                        <ArrowRight className="w-6 h-6" />
                    </motion.button>
                </div>
            </section>

            {/* Footer */}
            <footer className="bg-slate-950 px-4 py-10 text-center text-xs text-white/40">
                <div className="font-heading text-base text-white/70 font-bold mb-2">RRDC GO</div>
                <div>Built for Rolling River Day Camp · {new Date().getFullYear()}</div>
            </footer>
        </div>
    );
}
