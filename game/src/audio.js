// Synthesised sound effects: no audio assets, everything is WebAudio oscillators and
// filtered noise, so the game stays offline and under the size cap. Created lazily on
// the first user gesture; every call is a no-op until then.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.42;
      master.connect(ctx.destination);
      const len = ctx.sampleRate;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    } catch {
      return false;
    }
    return true;
  }

  function noise(dur, filterFreq, type, gain, when = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type || 'lowpass';
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  function tone(freq, dur, type, gain, slideTo = 0, when = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  // Distance in metres; distant shots are quieter and duller.
  function attenuate(dist) {
    return Math.max(0, 1 - dist / 70);
  }

  return {
    ensure,
    shot(weaponKind, dist = 0) {
      if (!ensure()) return;
      const a = attenuate(dist);
      if (a <= 0.02) return;
      if (weaponKind === 'sniper') {
        noise(0.28, 900, 'lowpass', 0.9 * a);
        tone(160, 0.22, 'sawtooth', 0.5 * a, 40);
      } else if (weaponKind === 'shotgun') {
        noise(0.22, 1400, 'lowpass', 0.85 * a);
        tone(120, 0.18, 'square', 0.35 * a, 50);
      } else if (weaponKind === 'smg') {
        noise(0.09, 2400, 'bandpass', 0.5 * a);
        tone(220, 0.07, 'square', 0.22 * a, 90);
      } else {
        noise(0.13, 1800, 'bandpass', 0.62 * a);
        tone(190, 0.09, 'square', 0.28 * a, 70);
      }
    },
    dryFire() {
      if (!ensure()) return;
      tone(1400, 0.03, 'square', 0.12);
    },
    reload() {
      if (!ensure()) return;
      tone(900, 0.04, 'square', 0.14);
      tone(600, 0.04, 'square', 0.14, 0, 0.16);
      tone(1100, 0.05, 'square', 0.16, 0, 0.38);
    },
    hit() {
      if (!ensure()) return;
      tone(2100, 0.05, 'sine', 0.22);
    },
    kill() {
      if (!ensure()) return;
      tone(1560, 0.07, 'sine', 0.22);
      tone(2090, 0.1, 'sine', 0.2, 0, 0.07);
    },
    hurt() {
      if (!ensure()) return;
      tone(110, 0.16, 'sawtooth', 0.3, 60);
      noise(0.12, 500, 'lowpass', 0.25);
    },
    step(run) {
      if (!ensure()) return;
      noise(0.05, run ? 700 : 420, 'lowpass', run ? 0.1 : 0.06);
    },
    beep(final = false) {
      if (!ensure()) return;
      tone(final ? 1500 : 1050, 0.09, 'sine', 0.22);
    },
    explosion(dist = 0) {
      if (!ensure()) return;
      const a = attenuate(dist);
      if (a <= 0.02) return;
      noise(1.1, 320, 'lowpass', 1.0 * a);
      tone(70, 0.9, 'sine', 0.7 * a, 28);
    },
    grenadeBounce() {
      if (!ensure()) return;
      tone(320, 0.05, 'sine', 0.12, 180);
    },
    flash() {
      if (!ensure()) return;
      tone(2400, 0.5, 'sine', 0.16, 900);
    },
    buy() {
      if (!ensure()) return;
      tone(880, 0.05, 'sine', 0.16);
      tone(1320, 0.07, 'sine', 0.16, 0, 0.05);
    },
    denied() {
      if (!ensure()) return;
      tone(220, 0.12, 'square', 0.16, 160);
    },
    plant() {
      if (!ensure()) return;
      tone(700, 0.08, 'sine', 0.2);
      tone(700, 0.08, 'sine', 0.2, 0, 0.14);
    },
    roundWin() {
      if (!ensure()) return;
      [523, 659, 784].forEach((f, i) => tone(f, 0.16, 'triangle', 0.2, 0, i * 0.11));
    },
    roundLose() {
      if (!ensure()) return;
      [392, 330, 262].forEach((f, i) => tone(f, 0.18, 'triangle', 0.18, 0, i * 0.12));
    },
    click() {
      if (!ensure()) return;
      tone(1200, 0.03, 'square', 0.1);
    },
  };
}
