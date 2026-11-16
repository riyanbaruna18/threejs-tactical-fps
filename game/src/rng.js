// Seeded randomness: one stream per game, so a screenshot seed replays the same round.
// mulberry32 is small, fast and good enough for bot decisions, spread and loot-free rolls.
export function mulberry32(initial) {
  let a = initial >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed) {
  const next = mulberry32(seed);
  return {
    next,
    range(min, max) {
      return min + (max - min) * next();
    },
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    pick(list) {
      return list[Math.floor(next() * list.length)];
    },
    chance(p) {
      return next() < p;
    },
    // Box-Muller-ish normal in [-1, 1]-ish, cheap: average of two uniforms.
    normal() {
      return (next() + next() + next() - 1.5) / 1.5;
    },
  };
}
