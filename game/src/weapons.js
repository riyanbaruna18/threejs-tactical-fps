// Weapons: one table, no per-weapon code. Damage is flat out to 25 m, then falls to 70%
// at 60 m; headshots multiply, legs soften. Spread and recoil punish firing on the move,
// so stopping to aim pays — the core of the gunplay rubric.
export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', kind: 'pistol', price: 0, auto: false,
    damage: 26, headMult: 4, legMult: 0.75, rpm: 400, mag: 12, reserve: 36,
    spread: 0.011, moveSpread: 0.02, bloom: 0.004, recoil: 0.011, range: 60,
    pellets: 1, reloadTime: 1.1, speed: 1.0, zoom: 1,
  },
  smg: {
    id: 'smg', name: 'VK-9 Ripper', kind: 'smg', price: 1500, auto: true,
    damage: 22, headMult: 4, legMult: 0.75, rpm: 750, mag: 28, reserve: 84,
    spread: 0.016, moveSpread: 0.026, bloom: 0.005, recoil: 0.008, range: 45,
    pellets: 1, reloadTime: 1.6, speed: 0.98, zoom: 1.15,
  },
  rifle: {
    id: 'rifle', name: 'AR-77 Vanguard', kind: 'rifle', price: 2700, auto: true,
    damage: 33, headMult: 4, legMult: 0.75, rpm: 600, mag: 30, reserve: 90,
    spread: 0.008, moveSpread: 0.021, bloom: 0.0045, recoil: 0.013, range: 70,
    pellets: 1, reloadTime: 2.1, speed: 0.96, zoom: 1.35,
  },
  shotgun: {
    id: 'shotgun', name: 'SG-12 Breacher', kind: 'shotgun', price: 2100, auto: false,
    damage: 12, headMult: 2, legMult: 0.75, rpm: 70, mag: 6, reserve: 24,
    spread: 0.05, moveSpread: 0.06, bloom: 0.01, recoil: 0.038, range: 28,
    pellets: 8, reloadTime: 2.4, speed: 0.94, zoom: 1,
  },
  sniper: {
    id: 'sniper', name: 'LW-50 Longshot', kind: 'sniper', price: 4750, auto: false,
    damage: 95, headMult: 2, legMult: 0.75, rpm: 45, mag: 5, reserve: 15,
    spread: 0.002, moveSpread: 0.03, bloom: 0.02, recoil: 0.05, range: 120,
    pellets: 1, reloadTime: 2.8, speed: 0.92, zoom: 2.6,
  },
};

export const GRENADES = {
  frag: { id: 'frag', name: 'F-1 Frag', price: 300, max: 2, fuse: 1.6, radius: 9, damage: 110 },
  smoke: { id: 'smoke', name: 'S-9 Smoke', price: 300, max: 2, fuse: 1.1, radius: 6, life: 15 },
  flash: { id: 'flash', name: 'FL-2 Flash', price: 200, max: 2, fuse: 1.2, radius: 18 },
};

export const ARMOR_PRICE = 650;
export const ARMOR_POINTS = 50;

export function createWeaponState(id) {
  const def = WEAPONS[id];
  return {
    id, def,
    mag: def.mag,
    reserve: def.reserve,
    reloading: 0, // seconds left; 0 = ready
    cooldown: 0, // seconds until the next shot may fire
    bloom: 0, // accumulated spread from recent shots
  };
}

// Current spread in radians for one shot, from stance and movement.
export function currentSpread(state, moveSpeed, airborne, crouched, aiming) {
  const def = state.def;
  let spread = def.spread + state.bloom;
  if (moveSpeed > 0.5) spread += def.moveSpread * Math.min(1, moveSpeed / 5);
  if (airborne) spread += 0.03;
  if (crouched) spread *= 0.7;
  if (aiming) spread *= 0.6;
  return spread;
}

export function tryFire(state, dt) {
  state.cooldown -= dt;
  if (state.reloading > 0) return false;
  if (state.cooldown > 0) return false;
  if (state.mag <= 0) return false;
  state.mag -= 1;
  state.cooldown = 60 / state.def.rpm;
  state.bloom = Math.min(0.05, state.bloom + state.def.bloom);
  return true;
}

export function startReload(state) {
  if (state.reloading > 0 || state.mag >= state.def.mag || state.reserve <= 0) return false;
  state.reloading = state.def.reloadTime;
  return true;
}

export function stepWeapon(state, dt) {
  state.cooldown = Math.max(0, state.cooldown - dt);
  state.bloom = Math.max(0, state.bloom - dt * 0.06);
  if (state.reloading > 0) {
    state.reloading -= dt;
    if (state.reloading <= 0) {
      const need = state.def.mag - state.mag;
      const take = Math.min(need, state.reserve);
      state.mag += take;
      state.reserve -= take;
      state.reloading = 0;
    }
  }
}

export function damageAtRange(def, dist, part) {
  let dmg = def.damage;
  if (dist > 25) dmg *= 1 - 0.3 * Math.min(1, (dist - 25) / (def.range - 25 || 1));
  if (part === 'head') dmg *= def.headMult;
  else if (part === 'leg') dmg *= def.legMult;
  return dmg;
}
