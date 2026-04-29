// Pokemon type catalog — colors loosely inspired by canon Pokemon types
// but tuned for the camp's blue/green/cream palette. All 11 types match the
// backend `valid_types` set in /admin/pokemon/bulk-upload.

export const POKEMON_TYPES = {
    normal:   { label: "Normal",   bg: "#A8A77A", text: "#FFFFFF", icon: "✦" },
    fire:     { label: "Fire",     bg: "#EE8130", text: "#FFFFFF", icon: "🔥" },
    water:    { label: "Water",    bg: "#6390F0", text: "#FFFFFF", icon: "💧" },
    grass:    { label: "Grass",    bg: "#7AC74C", text: "#FFFFFF", icon: "🌿" },
    electric: { label: "Electric", bg: "#F7D02C", text: "#1F2937", icon: "⚡" },
    rock:     { label: "Rock",     bg: "#B6A136", text: "#FFFFFF", icon: "🪨" },
    psychic:  { label: "Psychic",  bg: "#F95587", text: "#FFFFFF", icon: "🔮" },
    dark:     { label: "Dark",     bg: "#6B5848", text: "#FFFFFF", icon: "🌑" },
    ice:      { label: "Ice",      bg: "#96D9D6", text: "#1F2937", icon: "❄" },
    ghost:    { label: "Ghost",    bg: "#735797", text: "#FFFFFF", icon: "👻" },
    fighting: { label: "Fighting", bg: "#C22E28", text: "#FFFFFF", icon: "🥊" },
};

export const TYPE_LIST = Object.keys(POKEMON_TYPES);

export function typeMeta(t) {
    return POKEMON_TYPES[(t || "normal").toLowerCase()] || POKEMON_TYPES.normal;
}
