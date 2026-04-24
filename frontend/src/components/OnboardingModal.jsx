import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "./ui/button";
import { MapPin, Camera, Home, Check, ChevronRight, Share2 } from "lucide-react";
import { useInstallPrompt } from "../hooks/useInstallPrompt";

const RIVER_BALL = "https://static.prod-images.emergentagent.com/jobs/5b062d42-aa16-478f-9904-4c1a14748b37/images/0e5d9cd254c7af67a52924c927b4fb710091bea4bdb211921ad2c64510b4c327.png";

export default function OnboardingModal({ open, camperName, onFinish }) {
    const [step, setStep] = useState(0);
    const [locOk, setLocOk] = useState(false);
    const [camOk, setCamOk] = useState(false);
    const { canInstallNatively, promptInstall, isInstalled, isIOS, isAndroid } = useInstallPrompt();

    if (!open) return null;

    const requestLocation = () => {
        if (!navigator.geolocation) { setLocOk(false); return; }
        navigator.geolocation.getCurrentPosition(
            () => setLocOk(true),
            () => setLocOk(false),
            { enableHighAccuracy: true, timeout: 15000 }
        );
    };

    const requestCamera = async () => {
        if (!navigator.mediaDevices?.getUserMedia) { setCamOk(false); return; }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
            stream.getTracks().forEach((t) => t.stop());
            setCamOk(true);
        } catch { setCamOk(false); }
    };

    const handleInstall = async () => {
        if (canInstallNatively) {
            await promptInstall();
        }
    };

    const next = () => setStep((s) => s + 1);
    const finish = () => onFinish();

    const steps = [
        {
            key: "location",
            title: "Allow location",
            subtitle: "So spawns appear near you on the camp map.",
            icon: <MapPin className="w-10 h-10" />,
            iconBg: "bg-river-500",
            body: (
                <ol className="text-left text-sm text-slate-700 space-y-1.5 bg-slate-50 rounded-2xl p-4">
                    <li>1. Tap <span className="font-bold text-river-600">Enable location</span> below.</li>
                    <li>2. When your browser asks, choose <span className="font-bold">Allow</span>.</li>
                    <li>3. You'll see a blue dot where you're standing.</li>
                </ol>
            ),
            primary: (
                locOk ? (
                    <Button disabled className="tactile-btn w-full h-12 rounded-2xl bg-emerald-500 text-white font-heading font-bold">
                        <Check className="w-4 h-4 mr-2" /> Location on
                    </Button>
                ) : (
                    <Button onClick={requestLocation} className="tactile-btn w-full h-12 rounded-2xl bg-river-500 hover:bg-river-600 text-white font-heading font-bold" data-testid="onboard-location-btn">
                        <MapPin className="w-4 h-4 mr-2" /> Enable location
                    </Button>
                )
            ),
        },
        {
            key: "camera",
            title: "Allow camera",
            subtitle: "To see Pokemon in the real world when you get close.",
            icon: <Camera className="w-10 h-10" />,
            iconBg: "bg-forest-500",
            body: (
                <ol className="text-left text-sm text-slate-700 space-y-1.5 bg-slate-50 rounded-2xl p-4">
                    <li>1. Tap <span className="font-bold text-forest-600">Enable camera</span> below.</li>
                    <li>2. Choose <span className="font-bold">Allow</span> when your browser asks.</li>
                    <li>3. You can always change your mind later in settings.</li>
                </ol>
            ),
            primary: (
                camOk ? (
                    <Button disabled className="tactile-btn w-full h-12 rounded-2xl bg-emerald-500 text-white font-heading font-bold">
                        <Check className="w-4 h-4 mr-2" /> Camera on
                    </Button>
                ) : (
                    <Button onClick={requestCamera} className="tactile-btn w-full h-12 rounded-2xl bg-forest-500 hover:bg-forest-600 text-white font-heading font-bold" data-testid="onboard-camera-btn">
                        <Camera className="w-4 h-4 mr-2" /> Enable camera
                    </Button>
                )
            ),
        },
        {
            key: "install",
            title: "Add to home screen",
            subtitle: "Play anytime — no browser bar, no searching.",
            icon: <Home className="w-10 h-10" />,
            iconBg: "bg-amber-500",
            body: isInstalled ? (
                <div className="text-center text-sm text-emerald-700 font-bold bg-emerald-50 rounded-2xl p-4">
                    <Check className="w-5 h-5 inline mr-1" /> You're already installed!
                </div>
            ) : isIOS ? (
                <ol className="text-left text-sm text-slate-700 space-y-2 bg-slate-50 rounded-2xl p-4">
                    <li className="flex items-start gap-2">
                        <span className="font-bold shrink-0">1.</span>
                        <span>Tap the <Share2 className="w-4 h-4 inline mx-1" /> <span className="font-bold">Share</span> button at the bottom of Safari.</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <span className="font-bold shrink-0">2.</span>
                        <span>Scroll and tap <span className="font-bold">"Add to Home Screen"</span>.</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <span className="font-bold shrink-0">3.</span>
                        <span>Tap <span className="font-bold">Add</span>. Done!</span>
                    </li>
                </ol>
            ) : canInstallNatively ? (
                <div className="text-sm text-slate-700 bg-slate-50 rounded-2xl p-4 text-center">
                    Tap the button below and confirm to install.
                </div>
            ) : isAndroid ? (
                <ol className="text-left text-sm text-slate-700 space-y-2 bg-slate-50 rounded-2xl p-4">
                    <li>1. Tap the browser's <span className="font-bold">⋮</span> menu (top right).</li>
                    <li>2. Tap <span className="font-bold">"Install app"</span> or <span className="font-bold">"Add to Home screen"</span>.</li>
                    <li>3. Confirm.</li>
                </ol>
            ) : (
                <div className="text-sm text-slate-700 bg-slate-50 rounded-2xl p-4">
                    <div>On desktop: look for the install icon <Home className="w-4 h-4 inline" /> in the address bar (Chrome/Edge). Or bookmark this page.</div>
                </div>
            ),
            primary: (
                canInstallNatively && !isInstalled ? (
                    <Button onClick={handleInstall} className="tactile-btn w-full h-12 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-heading font-bold" data-testid="onboard-install-btn">
                        <Home className="w-4 h-4 mr-2" /> Install RRDC GO
                    </Button>
                ) : (
                    <Button onClick={finish} className="tactile-btn w-full h-12 rounded-2xl bg-river-500 hover:bg-river-600 text-white font-heading font-bold" data-testid="onboard-done-btn">
                        Start hunting!
                    </Button>
                )
            ),
        },
    ];

    const current = steps[step];
    const isLast = step === steps.length - 1;

    return (
        <AnimatePresence>
            <motion.div
                className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                data-testid="onboarding-modal"
            >
                <motion.div
                    initial={{ scale: 0.9, y: 20, opacity: 0 }}
                    animate={{ scale: 1, y: 0, opacity: 1 }}
                    transition={{ type: "spring", bounce: 0.4 }}
                    className="relative w-full max-w-md bg-white rounded-[2rem] p-5 sm:p-7 shadow-2xl"
                >
                    <div className="text-center">
                        <div className="flex items-center justify-center gap-2 mb-3">
                            {steps.map((_, i) => (
                                <div
                                    key={i}
                                    className={`h-1.5 rounded-full transition-all ${i === step ? "w-8 bg-river-500" : i < step ? "w-6 bg-emerald-400" : "w-6 bg-slate-200"}`}
                                />
                            ))}
                        </div>
                        <div className="flex items-center justify-center gap-3">
                            <img src={RIVER_BALL} alt="" className="w-7 h-7" />
                            <span className="text-[11px] font-bold uppercase tracking-widest text-river-600">Welcome{camperName ? `, ${camperName.split(" ")[0]}` : ""}!</span>
                        </div>
                    </div>

                    <div className="mt-4 text-center">
                        <div className={`mx-auto w-16 h-16 rounded-2xl ${current.iconBg} text-white flex items-center justify-center shadow-lg`}>
                            {current.icon}
                        </div>
                        <h2 className="font-heading text-2xl sm:text-3xl font-bold text-slate-900 mt-4">{current.title}</h2>
                        <p className="text-sm text-slate-600 mt-1">{current.subtitle}</p>
                    </div>

                    <div className="mt-5">
                        {current.body}
                    </div>

                    <div className="mt-5 space-y-2">
                        {current.primary}
                        {!isLast ? (
                            <Button
                                variant="ghost"
                                onClick={next}
                                className="w-full h-10 rounded-2xl text-slate-500 hover:text-slate-800 text-xs font-bold"
                                data-testid="onboard-next-btn"
                            >
                                Next <ChevronRight className="w-4 h-4 ml-1" />
                            </Button>
                        ) : (
                            !canInstallNatively && (
                                <Button variant="ghost" onClick={finish} className="w-full h-10 rounded-2xl text-slate-500 hover:text-slate-800 text-xs font-bold" data-testid="onboard-skip-btn">
                                    Skip for now
                                </Button>
                            )
                        )}
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}
