/**
 * Lightweight synthesized background music loop for the camp map.
 *
 * Why synth and not an MP3? Hosting/licensing-free, zero asset weight,
 * loops perfectly, and we can fade out on a catch / fade in on resume
 * without juggling <audio> elements that iOS Safari hates.
 *
 * The tune is a cheerful 8-bar major-key loop in C major at ~96 BPM —
 * "summer camp adventure" vibe. Two synth voices:
 *   - Square-wave lead playing the melody (one octave above middle C)
 *   - Triangle-wave bass playing root + 5th
 * A single shared GainNode lets us fade in/out and obey the user's
 * mute preference (shared with the SFX module via localStorage).
 *
 * Public API:
 *   musicStart()   — begin (or resume) the loop. Idempotent.
 *   musicStop()    — fade out and pause.
 *   musicSetMuted(b) — soft-link to mute toggle. Persists in localStorage.
 *   musicIsMuted() — current mute state.
 */

let _ctx = null;
let _master = null;
let _scheduler = null;
let _running = false;
let _muted = false;
try { _muted = localStorage.getItem("rrdc:musicMuted") === "1"; } catch { /* SSR */ }

// --- Music data ----------------------------------------------------------
// Notes encoded as midi numbers. 60 = middle C.
// Each entry = [midi, beats]. -1 = rest.
const MELODY = [
    [72, 1], [76, 1], [79, 1], [76, 1],
    [74, 1], [77, 1], [81, 2],
    [79, 1], [76, 1], [72, 1], [74, 1],
    [76, 4],
    [77, 1], [79, 1], [81, 1], [83, 1],
    [84, 2], [81, 2],
    [79, 1], [77, 1], [76, 1], [74, 1],
    [72, 4],
];
const BASS = [
    [48, 2], [52, 2],   // C - E
    [50, 2], [55, 2],   // D - G
    [48, 2], [52, 2],
    [55, 2], [60, 2],
    [53, 2], [57, 2],   // F - A
    [50, 2], [54, 2],   // D - F#
    [48, 2], [52, 2],
    [48, 4],
];
const BPM = 96;
const BEAT_SEC = 60 / BPM;

function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

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

function ensureMaster() {
    const c = ctx();
    if (!c) return null;
    if (!_master) {
        _master = c.createGain();
        _master.gain.value = 0;
        _master.connect(c.destination);
    }
    return _master;
}

function playNote(when, midi, dur, type, vol, attack = 0.02, release = 0.06) {
    if (midi < 0) return;
    const c = _ctx; const master = _master;
    if (!c || !master) return;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.value = midiToFreq(midi);
    osc.connect(g);
    g.connect(master);
    const t0 = when;
    const t1 = when + Math.max(0.05, dur - release);
    const t2 = when + dur;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.setValueAtTime(vol, t1);
    g.gain.linearRampToValueAtTime(0, t2);
    osc.start(t0);
    osc.stop(t2 + 0.02);
}

function scheduleLoop(startAt) {
    let t = startAt;
    // Lead
    for (const [n, b] of MELODY) {
        const dur = b * BEAT_SEC;
        if (n >= 0) playNote(t, n, dur, "square", 0.06);
        t += dur;
    }
    // Bass plays in parallel — restart from the same startAt
    let tb = startAt;
    for (const [n, b] of BASS) {
        const dur = b * BEAT_SEC;
        if (n >= 0) playNote(tb, n, dur, "triangle", 0.08);
        tb += dur;
    }
    return t; // end-time of this loop iteration
}

function startScheduler() {
    if (_scheduler) return;
    const c = ctx();
    const master = ensureMaster();
    if (!c || !master) return;
    let nextStart = c.currentTime + 0.05;
    nextStart = scheduleLoop(nextStart);
    _scheduler = setInterval(() => {
        // Schedule the next loop iteration ~1s before the current one ends
        // so there's no audible gap.
        if (nextStart - c.currentTime < 1.5) {
            nextStart = scheduleLoop(nextStart);
        }
    }, 500);
}

function stopScheduler() {
    if (_scheduler) { clearInterval(_scheduler); _scheduler = null; }
}

export function musicStart() {
    if (_muted) return;
    const c = ctx();
    const master = ensureMaster();
    if (!c || !master) return;
    if (_running) return;
    _running = true;
    startScheduler();
    // Fade in from silence over 1.2s
    master.gain.cancelScheduledValues(c.currentTime);
    master.gain.setValueAtTime(master.gain.value, c.currentTime);
    master.gain.linearRampToValueAtTime(0.55, c.currentTime + 1.2);
}

export function musicStop({ fade = 0.6 } = {}) {
    if (!_running) return;
    _running = false;
    const c = ctx();
    const master = ensureMaster();
    if (!c || !master) { stopScheduler(); return; }
    master.gain.cancelScheduledValues(c.currentTime);
    master.gain.setValueAtTime(master.gain.value, c.currentTime);
    master.gain.linearRampToValueAtTime(0, c.currentTime + fade);
    setTimeout(stopScheduler, (fade + 0.05) * 1000);
}

export function musicSetMuted(v) {
    _muted = !!v;
    try { localStorage.setItem("rrdc:musicMuted", _muted ? "1" : "0"); } catch { /* noop */ }
    if (_muted) musicStop({ fade: 0.4 });
    else musicStart();
}

export function musicIsMuted() { return _muted; }

// Auto-pause when the tab is hidden (saves battery, avoids music playing
// silently in the background drum) and auto-resume on visibility return.
if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) musicStop({ fade: 0.2 });
        else if (!_muted) musicStart();
    });
}
