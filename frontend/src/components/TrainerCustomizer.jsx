import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Shuffle, Check } from "lucide-react";
import TrainerAvatar, { DEFAULT_COLORS } from "./TrainerAvatar";

const PALETTES = {
    cap: ["#1D4ED8", "#DC2626", "#F59E0B", "#10B981", "#7C3AED", "#EC4899", "#0B1A4A", "#FFFFFF"],
    shirt: ["#10B981", "#3B82F6", "#EF4444", "#F59E0B", "#A855F7", "#14B8A6", "#F472B6", "#0F172A"],
    shorts: ["#0B1A4A", "#1F2937", "#7C2D12", "#15803D", "#581C87", "#0E7490", "#92400E", "#9CA3AF"],
    skin: ["#FFE3C2", "#F2BC8F", "#D49A6A", "#A36B43", "#6B4226", "#3E2912"],
    hair: ["#3B2A1A", "#0F0F0F", "#7C3F00", "#D4A256", "#F4D03F", "#E11D48", "#8B5CF6", "#1E40AF"],
    ring: ["#38BDF8", "#FBBF24", "#34D399", "#F472B6", "#A78BFA", "#FB7185"],
};

const LABELS = {
    cap: "Hat",
    shirt: "Shirt",
    shorts: "Shorts",
    skin: "Skin",
    hair: "Hair",
    ring: "Glow",
};

function storageKey(camperId) {
    return `rrdc_avatar_colors_${camperId || "default"}`;
}

export function loadAvatarColors(camperId) {
    try {
        const raw = localStorage.getItem(storageKey(camperId));
        if (!raw) return { ...DEFAULT_COLORS };
        const parsed = JSON.parse(raw);
        return { ...DEFAULT_COLORS, ...parsed };
    } catch {
        return { ...DEFAULT_COLORS };
    }
}

export function saveAvatarColors(camperId, colors) {
    try {
        localStorage.setItem(storageKey(camperId), JSON.stringify(colors));
    } catch {
        /* ignore quota errors */
    }
}

function randomPick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

export default function TrainerCustomizer({ open, onClose, camperId, onSave }) {
    const [colors, setColors] = useState(() => loadAvatarColors(camperId));

    // Re-load whenever modal OPENS (open transitions false→true). This avoids
    // clobbering in-progress edits if user.id arrives late from auth context.
    const wasOpenRef = React.useRef(false);
    useEffect(() => {
        if (open && !wasOpenRef.current) setColors(loadAvatarColors(camperId));
        wasOpenRef.current = open;
    }, [open, camperId]);

    const handleSet = (part, value) => setColors((c) => ({ ...c, [part]: value }));

    const randomize = () => {
        const r = {};
        for (const part of Object.keys(PALETTES)) {
            r[part] = randomPick(PALETTES[part]);
        }
        setColors(r);
    };

    const reset = () => setColors({ ...DEFAULT_COLORS });

    const save = () => {
        saveAvatarColors(camperId, colors);
        onSave?.(colors);
        onClose?.();
    };

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-6"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={onClose}
                    data-testid="trainer-customizer-modal"
                >
                    <motion.div
                        initial={{ y: 60, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 60, opacity: 0 }}
                        transition={{ type: "spring", damping: 24, stiffness: 240 }}
                        onClick={(e) => e.stopPropagation()}
                        className="relative w-full max-w-md bg-gradient-to-b from-slate-900 to-slate-950 text-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden border border-white/10 max-h-[92vh] flex flex-col"
                    >
                        {/* Header */}
                        <div className="px-5 py-4 flex items-center justify-between border-b border-white/10">
                            <div>
                                <div className="text-[10px] uppercase tracking-widest text-amber-300 font-bold">Trainer Style</div>
                                <div className="font-heading text-xl font-bold">Customize your camper</div>
                            </div>
                            <button
                                onClick={onClose}
                                className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center"
                                aria-label="Close"
                                data-testid="customizer-close"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Live preview */}
                        <div className="flex items-center justify-center py-5 bg-gradient-to-b from-emerald-700/30 to-sky-700/40">
                            <TrainerAvatar size={140} walking colors={colors} />
                        </div>

                        {/* Color picker rows */}
                        <div className="overflow-y-auto px-5 py-4 space-y-4 flex-1">
                            {Object.keys(PALETTES).map((part) => (
                                <div key={part}>
                                    <div className="flex items-center justify-between mb-1.5">
                                        <div className="text-[11px] uppercase tracking-widest text-white/70 font-bold">
                                            {LABELS[part]}
                                        </div>
                                        <div
                                            className="w-5 h-5 rounded-full border border-white/30"
                                            style={{ background: colors[part] }}
                                            aria-hidden
                                        />
                                    </div>
                                    <div className="flex gap-2 flex-wrap">
                                        {PALETTES[part].map((color) => {
                                            const isActive = colors[part]?.toUpperCase() === color.toUpperCase();
                                            return (
                                                <button
                                                    key={color}
                                                    onClick={() => handleSet(part, color)}
                                                    className={`relative w-9 h-9 rounded-full transition-transform ${
                                                        isActive
                                                            ? "ring-2 ring-amber-300 scale-110"
                                                            : "ring-1 ring-white/20 hover:scale-105"
                                                    }`}
                                                    style={{ background: color }}
                                                    aria-label={`${LABELS[part]} ${color}`}
                                                    data-testid={`color-${part}-${color.replace("#", "")}`}
                                                >
                                                    {isActive && (
                                                        <span className="absolute inset-0 flex items-center justify-center text-slate-900">
                                                            <Check className="w-4 h-4" strokeWidth={3} />
                                                        </span>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Footer actions */}
                        <div className="px-5 py-4 border-t border-white/10 flex items-center gap-2 bg-slate-950/80 safe-bottom">
                            <button
                                onClick={randomize}
                                className="flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-white/10 hover:bg-white/20 text-sm font-bold"
                                data-testid="customizer-randomize"
                            >
                                <Shuffle className="w-4 h-4" /> Random
                            </button>
                            <button
                                onClick={reset}
                                className="px-4 py-2.5 rounded-full bg-white/10 hover:bg-white/20 text-sm font-bold"
                                data-testid="customizer-reset"
                            >
                                Reset
                            </button>
                            <button
                                onClick={save}
                                className="ml-auto flex-1 px-4 py-2.5 rounded-full bg-gradient-to-r from-amber-400 to-amber-300 text-slate-900 font-heading font-bold tactile-btn"
                                data-testid="customizer-save"
                            >
                                Save Look
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
