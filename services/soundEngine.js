/* services/soundEngine.js — Web Audio keyboard sounds (prompt architecture).
   OFF by default; the toggle persists in the existing settings key
   (hcm_settings_v1 → SETTINGS.sound). Sounds are synthesised — no audio
   files, no network. Stage 2's typing stage calls keyClick()/errorThock()
   from its keystroke handler; keep calls allocation-free and guarded so
   the zero-lag rule is never at risk. */

import { SETTINGS, persistSettings } from "../core/storage.js";

let ctx = null;
let master = null;

export function soundOn() { return SETTINGS.sound === true; }

export function setSound(on) {
  SETTINGS.sound = !!on;
  persistSettings();
  if (on) ensureCtx();
}

function ensureCtx() {
  if (ctx) { if (ctx.state === "suspended") ctx.resume(); return true; }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.12;
    master.connect(ctx.destination);
    return true;
  } catch (e) { return false; }
}

function blip(freq, dur, type, gain) {
  if (!soundOn() || !ensureCtx()) return;
  try {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(master);
    osc.start(t); osc.stop(t + dur);
  } catch (e) {}
}

/* Short mechanical click for a keystroke; lower thock for an error key. */
export function keyClick() { blip(1900 + Math.random() * 300, 0.03, "square", 0.25); }
export function errorThock() { blip(220, 0.06, "triangle", 0.5); }
export function finishChime() {
  if (!soundOn() || !ensureCtx()) return;
  blip(660, 0.12, "sine", 0.4);
  setTimeout(function () { blip(880, 0.16, "sine", 0.4); }, 110);
}
