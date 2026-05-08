import React, { useEffect, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { isMuted, toggleMuted, onMuteChange, sfx } from "../lib/soundFx";
import { musicSetMuted } from "../lib/music";

/**
 * Tiny audio mute toggle. Persists to localStorage. Plays a tap when toggled
 * back on so the user gets immediate feedback that audio is back. Also
 * synchronously controls the camp background music (so kids don't need
 * two separate toggles).
 */
export default function MuteToggle({ className = "" }) {
    const [muted, setMuted] = useState(isMuted());
    useEffect(() => onMuteChange(setMuted), []);
    return (
        <button
            onClick={() => {
                const now = toggleMuted();
                musicSetMuted(now);
                if (!now) sfx.uiTap();
            }}
            className={`relative z-30 bg-white/95 backdrop-blur-sm rounded-full p-2.5 shadow-lg ring-1 ring-slate-200 hover:bg-white transition-colors ${className}`}
            title={muted ? "Unmute music + sound" : "Mute music + sound"}
            data-testid="mute-toggle"
        >
            {muted
                ? <VolumeX className="w-5 h-5 text-slate-500" />
                : <Volume2 className="w-5 h-5 text-river-600" />}
        </button>
    );
}
