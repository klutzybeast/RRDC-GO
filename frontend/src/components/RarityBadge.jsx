import React from "react";

const LABEL = {
    common: "Common",
    uncommon: "Uncommon",
    rare: "Rare",
    legendary: "Legendary",
};

const STYLE = {
    common: "bg-slate-200 text-slate-700 border border-slate-300",
    uncommon: "bg-emerald-100 text-emerald-800 border border-emerald-300",
    rare: "bg-sky-100 text-sky-800 border border-sky-300",
    legendary: "bg-amber-100 text-amber-900 border border-amber-300 animate-legendary-pulse",
};

export default function RarityBadge({ rarity = "common", className = "" }) {
    return (
        <span
            data-testid={`rarity-badge-${rarity}`}
            className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${STYLE[rarity] || STYLE.common} ${className}`}
        >
            {LABEL[rarity] || rarity}
        </span>
    );
}
