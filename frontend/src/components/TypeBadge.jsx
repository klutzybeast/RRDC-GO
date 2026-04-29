import React from "react";
import { typeMeta } from "../lib/pokemonTypes";

export default function TypeBadge({ type, size = "sm", className = "" }) {
    const meta = typeMeta(type);
    const sizeCls = size === "lg"
        ? "text-sm px-3 py-1.5"
        : size === "md"
            ? "text-xs px-2.5 py-1"
            : "text-[10px] px-2 py-0.5";
    return (
        <span
            className={`inline-flex items-center gap-1 font-bold rounded-full uppercase tracking-wider ${sizeCls} ${className}`}
            style={{ backgroundColor: meta.bg, color: meta.text }}
            data-testid={`type-badge-${type || "normal"}`}
        >
            <span aria-hidden>{meta.icon}</span> {meta.label}
        </span>
    );
}
