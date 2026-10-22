let ctx;

/** Two-tone chime for a new incident. Silently does nothing if audio isn't allowed yet. */
export function chime() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = ctx || new AC();
    const t = ctx.currentTime;
    [784, 988].forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const start = t + i * 0.2;
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
      o.connect(g).connect(ctx.destination);
      o.start(start);
      o.stop(start + 0.2);
    });
  } catch { /* autoplay blocked or unsupported */ }
}
