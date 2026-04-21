/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: ["./src/**/*.{js,jsx,ts,tsx}", "./public/index.html"],
    theme: {
        extend: {
            fontFamily: {
                heading: ["Fredoka", "sans-serif"],
                body: ["Nunito", "sans-serif"],
                sans: ["Nunito", "ui-sans-serif", "system-ui", "sans-serif"],
            },
            borderRadius: {
                lg: "var(--radius)",
                md: "calc(var(--radius) - 2px)",
                sm: "calc(var(--radius) - 4px)",
            },
            colors: {
                background: "hsl(var(--background))",
                foreground: "hsl(var(--foreground))",
                card: {
                    DEFAULT: "hsl(var(--card))",
                    foreground: "hsl(var(--card-foreground))",
                },
                popover: {
                    DEFAULT: "hsl(var(--popover))",
                    foreground: "hsl(var(--popover-foreground))",
                },
                primary: {
                    DEFAULT: "hsl(var(--primary))",
                    foreground: "hsl(var(--primary-foreground))",
                },
                secondary: {
                    DEFAULT: "hsl(var(--secondary))",
                    foreground: "hsl(var(--secondary-foreground))",
                },
                muted: {
                    DEFAULT: "hsl(var(--muted))",
                    foreground: "hsl(var(--muted-foreground))",
                },
                accent: {
                    DEFAULT: "hsl(var(--accent))",
                    foreground: "hsl(var(--accent-foreground))",
                },
                destructive: {
                    DEFAULT: "hsl(var(--destructive))",
                    foreground: "hsl(var(--destructive-foreground))",
                },
                border: "hsl(var(--border))",
                input: "hsl(var(--input))",
                ring: "hsl(var(--ring))",
                river: {
                    50: "#F0F9FF",
                    100: "#E0F2FE",
                    500: "#0EA5E9",
                    600: "#0284C7",
                    700: "#0369A1",
                    900: "#0C4A6E",
                },
                forest: {
                    50: "#F0FDF4",
                    500: "#22C55E",
                    600: "#16A34A",
                    700: "#15803D",
                },
                rarity: {
                    common: "#94A3B8",
                    uncommon: "#22C55E",
                    rare: "#3B82F6",
                    legendary: "#FBBF24",
                },
            },
            keyframes: {
                "accordion-down": {
                    from: { height: "0" },
                    to: { height: "var(--radix-accordion-content-height)" },
                },
                "accordion-up": {
                    from: { height: "var(--radix-accordion-content-height)" },
                    to: { height: "0" },
                },
                "bob": {
                    "0%,100%": { transform: "translateY(0)" },
                    "50%": { transform: "translateY(-10px)" },
                },
                "legendary-pulse": {
                    "0%,100%": { boxShadow: "0 0 0 0 rgba(251,191,36,0.6)" },
                    "50%": { boxShadow: "0 0 20px 6px rgba(251,191,36,0.8)" },
                },
            },
            animation: {
                "accordion-down": "accordion-down 0.2s ease-out",
                "accordion-up": "accordion-up 0.2s ease-out",
                "bob": "bob 2.4s ease-in-out infinite",
                "legendary-pulse": "legendary-pulse 1.8s ease-in-out infinite",
            },
        },
    },
    plugins: [require("tailwindcss-animate")],
};
