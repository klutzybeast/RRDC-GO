import { useEffect, useState, useCallback } from "react";

// Captures the beforeinstallprompt event (Chrome/Edge) so we can trigger the
// install prompt on demand. iOS Safari doesn't fire this event — we detect
// that separately and show manual instructions.
export function useInstallPrompt() {
    const [deferredPrompt, setDeferredPrompt] = useState(null);
    const [isInstalled, setIsInstalled] = useState(false);

    useEffect(() => {
        const onBeforeInstall = (e) => {
            e.preventDefault();
            setDeferredPrompt(e);
        };
        const onInstalled = () => {
            setIsInstalled(true);
            setDeferredPrompt(null);
        };
        const standalone =
            window.matchMedia?.("(display-mode: standalone)").matches ||
            window.navigator.standalone === true;
        if (standalone) setIsInstalled(true);
        window.addEventListener("beforeinstallprompt", onBeforeInstall);
        window.addEventListener("appinstalled", onInstalled);
        return () => {
            window.removeEventListener("beforeinstallprompt", onBeforeInstall);
            window.removeEventListener("appinstalled", onInstalled);
        };
    }, []);

    const promptInstall = useCallback(async () => {
        if (!deferredPrompt) return "unavailable";
        deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        setDeferredPrompt(null);
        return choice?.outcome || "dismissed";
    }, [deferredPrompt]);

    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const isIOS = /iPhone|iPad|iPod/i.test(ua) && !window.MSStream;
    const isAndroid = /Android/i.test(ua);

    return {
        canInstallNatively: !!deferredPrompt,
        promptInstall,
        isInstalled,
        isIOS,
        isAndroid,
    };
}
