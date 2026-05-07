/**
 * RRDC GO sound effects — Web Audio API only, no asset payload.
 *
 * All sounds are synthesized at runtime so we don't ship MP3s and don't pay
 * the iPad cellular cost on Day 1. iOS Safari requires a user gesture to
 * unlock the AudioContext, so playback is best-effort: the first call after a
 * tap will succeed; calls before the gesture silently no-op.
 *
 * Mute state is persisted in localStorage under `rrdc:muted`.
 */

let _ctx = null;
let _muted = false;
try { _muted = localStorage.getItem("rrdc:muted") === "1"; } catch { /* SSR / private mode */ }

const subscribers = new Set();

function ctx() {
    if (typeof window === "undefined") return null;
    if (!_ctx) {
        const C = window.AudioContext || window.webkitAudioContext;
        if (!C) return null;
        _ctx = new C();
    }
    if (_ctx.state === "suspended") _ctx.resume().catch(() => {});
    return _ctx;
}

// iOS Safari requires the AudioContext to be created/resumed from a user
// gesture before any audio (Web Audio AND <audio>) will play. Install a
// one-time global listener that unlocks audio on the first interaction.
// Without this, Pokémon cries fired from polling timers never play because
// they're outside the gesture-context window.
if (typeof window !== "undefined") {
    let _unlocked = false;
    const unlock = () => {
        if (_unlocked) return;
        _unlocked = true;
        // Resume the WebAudio context.
        const c = ctx();
        if (c && c.state === "suspended") c.resume().catch(() => {});
        // Prime the <audio> element pipeline with a silent wav so iOS
        // permanently allows .play() from non-gesture contexts later.
        try {
            const silent = new Audio("data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA");
            silent.volume = 0;
            silent.play().catch(() => {});
        } catch { /* noop */ }
        window.removeEventListener("pointerdown", unlock);
        window.removeEventListener("touchstart", unlock);
        window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("touchstart", unlock, { passive: true });
    window.addEventListener("keydown", unlock);
}

export function isMuted() { return _muted; }
export function setMuted(v) {
    _muted = !!v;
    try { localStorage.setItem("rrdc:muted", _muted ? "1" : "0"); } catch { /* private mode */ }
    subscribers.forEach((cb) => { try { cb(_muted); } catch { /* ignore */ } });
}
export function toggleMuted() { setMuted(!_muted); return _muted; }
export function onMuteChange(cb) { subscribers.add(cb); return () => subscribers.delete(cb); }

/** Play a single oscillator beep with an envelope. */
function tone({ freq = 440, dur = 0.18, type = "sine", vol = 0.18, attack = 0.01, decay = 0.05, sweepTo = null, delay = 0 }) {
    if (_muted) return;
    const c = ctx();
    if (!c) return;
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (sweepTo != null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t0 + dur);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + decay);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + decay + 0.05);
}

/** Short noise burst (used for woosh / hit). */
function noise({ dur = 0.25, vol = 0.18, hp = 600, lp = 4000, decay = 0.05, delay = 0 }) {
    if (_muted) return;
    const c = ctx();
    if (!c) return;
    const t0 = c.currentTime + delay;
    const len = Math.floor(c.sampleRate * (dur + decay));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const hpFilter = c.createBiquadFilter();
    hpFilter.type = "highpass";
    hpFilter.frequency.value = hp;
    const lpFilter = c.createBiquadFilter();
    lpFilter.type = "lowpass";
    lpFilter.frequency.value = lp;
    const gain = c.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + decay);
    src.connect(hpFilter).connect(lpFilter).connect(gain).connect(c.destination);
    src.start(t0);
    src.stop(t0 + dur + decay + 0.05);
}

// ────────────────────────────────────────────────────────────────────
// Public sound library
// ────────────────────────────────────────────────────────────────────

export const sfx = {
    uiTap()        { tone({ freq: 1100, dur: 0.04, type: "triangle", vol: 0.10, decay: 0.03 }); },
    spawnAppear()  { tone({ freq: 660, dur: 0.10, type: "sine", vol: 0.16, sweepTo: 1320, decay: 0.10 }); tone({ freq: 990, dur: 0.10, type: "sine", vol: 0.10, sweepTo: 1980, delay: 0.05, decay: 0.10 }); },
    spawnNearby()  { tone({ freq: 880, dur: 0.08, type: "sine", vol: 0.10, sweepTo: 1100 }); },
    ballThrow()    { noise({ dur: 0.18, hp: 400, lp: 2000, vol: 0.18 }); },
    ballHit()      { tone({ freq: 220, dur: 0.06, type: "square", vol: 0.16, sweepTo: 110, decay: 0.04 }); noise({ dur: 0.06, hp: 200, lp: 1200, vol: 0.10 }); },
    ballWobble(stage = 1) {
        const freqs = [520, 480, 440];
        tone({ freq: freqs[(stage - 1) % 3], dur: 0.06, type: "triangle", vol: 0.16, decay: 0.04 });
    },
    catchSuccess() {
        // 3-note fanfare: C5 - E5 - G5
        tone({ freq: 523, dur: 0.10, type: "triangle", vol: 0.20, decay: 0.06 });
        tone({ freq: 659, dur: 0.10, type: "triangle", vol: 0.20, delay: 0.08, decay: 0.06 });
        tone({ freq: 784, dur: 0.30, type: "triangle", vol: 0.22, delay: 0.16, decay: 0.20, sweepTo: 1046 });
    },
    catchFail() {
        tone({ freq: 380, dur: 0.10, type: "sawtooth", vol: 0.18, sweepTo: 180, decay: 0.10 });
    },
    legendaryCatch() {
        // Dramatic 4-note hit
        const notes = [392, 523, 659, 1046];
        notes.forEach((f, i) => tone({ freq: f, dur: 0.28, type: "triangle", vol: 0.22, delay: i * 0.10, decay: 0.18 }));
        tone({ freq: 130, dur: 0.40, type: "sawtooth", vol: 0.10, delay: 0.10, decay: 0.40 });
    },
    streakClaimed() {
        // Cheerful 2-note chime
        tone({ freq: 880, dur: 0.10, type: "sine", vol: 0.18, decay: 0.06 });
        tone({ freq: 1318, dur: 0.18, type: "sine", vol: 0.20, delay: 0.08, decay: 0.18 });
    },
    pokestopSpin() {
        // Rising sweep then chime
        tone({ freq: 220, dur: 0.30, type: "sine", vol: 0.10, sweepTo: 1320, decay: 0.05 });
        tone({ freq: 1318, dur: 0.10, type: "triangle", vol: 0.20, delay: 0.30, decay: 0.10 });
    },
    raidEngage() {
        // Ominous low rumble
        tone({ freq: 110, dur: 0.40, type: "sawtooth", vol: 0.16, sweepTo: 220, decay: 0.20 });
    },
    raidDefeated() {
        // Triumphant ascending arpeggio
        const notes = [392, 494, 587, 784, 988];
        notes.forEach((f, i) => tone({ freq: f, dur: 0.16, type: "triangle", vol: 0.20, delay: i * 0.08, decay: 0.10 }));
        tone({ freq: 1046, dur: 0.50, type: "sine", vol: 0.22, delay: 0.40, decay: 0.40 });
    },
};

/** Optional Pokémon cry — backed by a recorded clip. Falls back to a
 *  synthesized "warble" if no URL is provided. */
export function playCry(cryUrl, fallbackSeed = 0) {
    if (_muted) return;
    if (cryUrl) {
        try {
            const a = new Audio(cryUrl);
            a.volume = 0.6;
            a.play().catch(() => {});
            return;
        } catch { /* fall through */ }
    }
    // Procedural fallback: 2-3 randomized warbly tones based on a deterministic seed
    const c = ctx();
    if (!c) return;
    const rng = mulberry32(fallbackSeed || 1);
    const baseHz = 200 + Math.floor(rng() * 600);
    const n = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i++) {
        const f = baseHz + Math.floor(rng() * 300) - 150;
        tone({
            freq: Math.max(120, f),
            dur: 0.18 + rng() * 0.20,
            type: "triangle",
            vol: 0.18,
            sweepTo: Math.max(80, f * (0.7 + rng() * 0.6)),
            delay: i * (0.16 + rng() * 0.10),
            decay: 0.08,
        });
    }
}
function mulberry32(a) {
    return function () {
        let t = (a += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
