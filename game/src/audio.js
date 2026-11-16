// audio.js — every sound is synthesized with WebAudio: filtered noise for
// gunfire, square blips for beeps and clicks, a swept sine for the blast.
// No audio files, so the game makes no network requests and ships no assets.
// Volumes are passed in by callers that know the distance to the listener.

export function createAudio() {
  let ctx = null, master = null, noiseBuf = null;

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.45;
      master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return true;
    } catch { return false; }
  }

  function noise(dur, filterType, freq, vol, freqEnd) {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filterType; f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  function tone(freq, dur, vol, type = 'square', freqEnd = 0, delay = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  return {
    unlock: () => ensure(),
    // vol scales with distance at the call site; kind changes the crack.
    shot(kind, vol) {
      if (vol <= 0.01) return;
      if (kind === 'paleeye') { noise(0.34, 'lowpass', 2600, 0.85 * vol, 300); tone(120, 0.22, 0.4 * vol, 'sawtooth', 40); }
      else if (kind === 'p9') { noise(0.11, 'bandpass', 2100, 0.5 * vol, 700); }
      else if (kind === 'raptor') { noise(0.09, 'bandpass', 1700, 0.5 * vol, 600); }
      else { noise(0.16, 'bandpass', 1300, 0.65 * vol, 420); }
    },
    dryFire() { tone(2400, 0.03, 0.12, 'square'); },
    reload() { tone(900, 0.04, 0.15, 'square'); tone(620, 0.04, 0.15, 'square', 0, 0.16); tone(1100, 0.04, 0.18, 'square', 0, 0.34); },
    hit() { tone(1900, 0.05, 0.2, 'sine'); },
    kill() { tone(1320, 0.07, 0.22, 'sine'); tone(1760, 0.1, 0.22, 'sine', 0, 0.07); },
    hurt() { noise(0.12, 'lowpass', 500, 0.5); },
    throwWhoosh() { noise(0.18, 'bandpass', 600, 0.2, 1600); },
    explosion() { noise(0.7, 'lowpass', 900, 1.0, 60); tone(90, 0.6, 0.7, 'sine', 30); },
    beep(final) { tone(final ? 1320 : 880, final ? 0.3 : 0.07, 0.25, 'square'); },
    uiClick() { tone(1500, 0.03, 0.12, 'square'); },
    buyOk() { tone(1040, 0.06, 0.18, 'sine'); tone(1560, 0.08, 0.18, 'sine', 0, 0.06); },
    buyDenied() { tone(220, 0.12, 0.2, 'square'); },
    roundWin() { tone(660, 0.12, 0.2, 'triangle'); tone(880, 0.12, 0.2, 'triangle', 0, 0.11); tone(1100, 0.2, 0.22, 'triangle', 0, 0.22); },
    roundLose() { tone(520, 0.14, 0.2, 'triangle'); tone(390, 0.14, 0.2, 'triangle', 0, 0.12); tone(300, 0.24, 0.2, 'triangle', 0, 0.24); },
  };
}
