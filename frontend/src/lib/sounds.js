// Pure WebAudio sound effects — no external assets needed.
// Each function returns a Promise that resolves when the sound finishes (so callers can chain).

let _ctx = null;
function ctx() {
    if (!_ctx) {
        try {
            _ctx = new (window.AudioContext || window.webkitAudioContext)();
        } catch {
            return null;
        }
    }
    if (_ctx.state === "suspended") _ctx.resume().catch(() => {});
    return _ctx;
}

function playEnvelope({ frequencies, type = "sine", duration = 0.3, gain = 0.2, slide = false }) {
    const c = ctx();
    if (!c) return Promise.resolve();
    return new Promise((resolve) => {
        const t0 = c.currentTime;
        const g = c.createGain();
        g.connect(c.destination);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

        const o = c.createOscillator();
        o.type = type;
        o.connect(g);
        if (slide && frequencies.length >= 2) {
            // Glide between successive freqs
            o.frequency.setValueAtTime(frequencies[0], t0);
            const step = duration / (frequencies.length - 1);
            for (let i = 1; i < frequencies.length; i++) {
                o.frequency.exponentialRampToValueAtTime(frequencies[i], t0 + i * step);
            }
        } else {
            // Sequential discrete notes
            const step = duration / frequencies.length;
            frequencies.forEach((f, i) => {
                o.frequency.setValueAtTime(f, t0 + i * step);
            });
        }
        o.start(t0);
        o.stop(t0 + duration + 0.05);
        setTimeout(resolve, (duration + 0.05) * 1000);
    });
}

export function playCatch() {
    return playEnvelope({
        frequencies: [523, 659, 784, 1047], // C5 E5 G5 C6 — happy arpeggio
        type: "triangle",
        duration: 0.5,
        gain: 0.18,
    });
}

export function playMiss() {
    return playEnvelope({
        frequencies: [380, 250],
        type: "sawtooth",
        duration: 0.25,
        gain: 0.12,
        slide: true,
    });
}

export function playSpawn() {
    return playEnvelope({
        frequencies: [880, 1320],
        type: "sine",
        duration: 0.35,
        gain: 0.14,
        slide: true,
    });
}

export function playLegendary() {
    // Three rising fanfare blasts
    return playEnvelope({
        frequencies: [330, 440, 523, 660, 880, 1047, 1319],
        type: "square",
        duration: 1.4,
        gain: 0.22,
    });
}

export function playClick() {
    return playEnvelope({
        frequencies: [880],
        type: "triangle",
        duration: 0.05,
        gain: 0.08,
    });
}

const SOUNDS_DISABLED_KEY = "rrdc_sounds_off";
export function isSoundEnabled() {
    return localStorage.getItem(SOUNDS_DISABLED_KEY) !== "1";
}
export function setSoundEnabled(enabled) {
    if (enabled) localStorage.removeItem(SOUNDS_DISABLED_KEY);
    else localStorage.setItem(SOUNDS_DISABLED_KEY, "1");
}

// Wrappers that check the user toggle
export function tryPlayCatch() { if (isSoundEnabled()) playCatch().catch(() => {}); }
export function tryPlayMiss() { if (isSoundEnabled()) playMiss().catch(() => {}); }
export function tryPlaySpawn() { if (isSoundEnabled()) playSpawn().catch(() => {}); }
export function tryPlayLegendary() { if (isSoundEnabled()) playLegendary().catch(() => {}); }
export function tryPlayClick() { if (isSoundEnabled()) playClick().catch(() => {}); }
