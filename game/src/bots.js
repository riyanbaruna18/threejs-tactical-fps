// Bot brains: routes, holds, engagements and reactions to sound. A bot is a state
// machine over the waypoint graph — route, hold, engage, investigate, fetch, plant,
// defuse, retake — with a small BFS pathfinder so any bot can walk to any node. Aim is
// honest: the bot turns its head at a point near the target (error grows with distance,
// target speed and burst heat) and fires the same hitscan the player fires, so cover,
// smoke and distance protect you the same way they protect a bot.
import * as THREE from 'three';
import { WAYPOINTS, ROUTES } from './map.js';
import { stepActor, groundSpeed } from './actors.js';
import { currentSpread, tryFire, startReload, stepWeapon } from './weapons.js';
import { botBuyPlan, applyBuyPlan } from './economy.js';

// Waypoint graph: edges are consecutive pairs in any named route, both directions.
const EDGES = {};
for (const route of Object.values(ROUTES)) {
  for (let i = 0; i < route.length - 1; i += 1) {
    (EDGES[route[i]] ??= []).push(route[i + 1]);
    (EDGES[route[i + 1]] ??= []).push(route[i]);
  }
}

export function nearestNode(x, z) {
  let best = null;
  let bestD = Infinity;
  for (const [id, n] of Object.entries(WAYPOINTS)) {
    const d = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

export function findPath(from, to) {
  if (from === to) return [to];
  const prev = { [from]: null };
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    for (const next of EDGES[cur] || []) {
      if (!(next in prev)) {
        prev[next] = cur;
        if (next === to) {
          const path = [to];
          let n = cur;
          while (n) {
            path.unshift(n);
            n = prev[n];
          }
          return path;
        }
        queue.push(next);
      }
    }
  }
  return [to];
}

const _dir = new THREE.Vector3();
const _toTarget = new THREE.Vector3();
const _eye = new THREE.Vector3();

export function createBot(actor, skill) {
  return {
    actor, skill,
    mode: 'route',
    route: [], routeIdx: 0,
    goalPos: null, // final position after the waypoint chain (a bomb, a site...)
    target: null,
    lastSeen: new THREE.Vector3(),
    lastSeenT: -99,
    hearPos: null, hearT: -99,
    reactT: 0,
    burstLeft: 0, burstPause: 0,
    thinkT: Math.random() * 0.12,
    holdT: 0,
    scanDir: 1,
    aimErr: 0,
    strafeDir: 1, strafeT: 0,
    stuckT: 0, lastPos: new THREE.Vector3(),
    throwT: 0,
    blindT: 0, // seconds of flash blindness left
  };
}

export function botBuy(bot, rng) {
  const plan = botBuyPlan(bot.actor, rng);
  applyBuyPlan(bot.actor, plan);
}

function eyePos(actor, out) {
  out.set(actor.pos.x, actor.pos.y + actor.eye, actor.pos.z);
  return out;
}

function aimAt(bot, point) {
  const a = bot.actor;
  _toTarget.subVectors(point, eyePos(a, _eye));
  const len = Math.hypot(_toTarget.x, _toTarget.y, _toTarget.z) || 1;
  const wantYaw = Math.atan2(-_toTarget.x, -_toTarget.z);
  const wantPitch = Math.asin(Math.max(-1, Math.min(1, _toTarget.y / len)));
  // Turn speed limit: a bot cannot snap 180 degrees in one tick.
  let dy = wantYaw - a.yaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  const maxTurn = 7 * (1 / 60);
  a.yaw += Math.max(-maxTurn, Math.min(maxTurn, dy));
  a.pitch += Math.max(-maxTurn, Math.min(maxTurn, wantPitch - a.pitch));
}

// Visible enemies: line of sight, in front, inside 60 m. Returns the nearest.
function acquire(bot, world) {
  const a = bot.actor;
  let best = null;
  let bestD = Infinity;
  eyePos(a, _eye);
  for (const other of world.actors) {
    if (!other.alive || other.team === a.team) continue;
    const dx = other.pos.x - a.pos.x;
    const dz = other.pos.z - a.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 60 || d < 0.5) continue;
    // Roughly 110 degrees of vision, unless the enemy is very close.
    const forward = Math.atan2(-Math.sin(a.yaw), -Math.cos(a.yaw));
    const toEnemy = Math.atan2(dx, dz);
    let diff = Math.abs(toEnemy - forward);
    while (diff > Math.PI) diff = Math.PI * 2 - diff;
    if (d > 6 && diff > 1.05) continue;
    const chest = new THREE.Vector3(other.pos.x, other.pos.y + 1.2, other.pos.z);
    if (!world.hasLOS(_eye, chest)) continue;
    if (d < bestD) {
      bestD = d;
      best = other;
    }
  }
  return best;
}

function hear(bot, world) {
  let best = null;
  let bestScore = Infinity;
  for (const s of world.sounds) {
    if (world.time - s.t > 4) continue;
    const d = Math.hypot(s.pos.x - bot.actor.pos.x, s.pos.z - bot.actor.pos.z);
    if (d > s.radius) continue;
    const score = d - (s.type === 'plant' ? 20 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

function setRoute(bot, route, goalPos = null) {
  bot.route = route.slice();
  bot.routeIdx = 0;
  bot.goalPos = goalPos;
  bot.mode = 'route';
}

function routeTo(bot, nodeId, goalPos = null) {
  const from = nearestNode(bot.actor.pos.x, bot.actor.pos.z);
  setRoute(bot, findPath(from, nodeId), goalPos);
}

export function botThink(bot, world, dt) {
  const a = bot.actor;
  if (!a.alive) return;
  const bomb = world.bomb.state;
  // A bot mid-plant or mid-defuse commits: it does not look away or walk off.
  const committed = (bomb.mode === 'planting' && bomb.carrier === a)
    || (bomb.mode === 'defusing' && bomb.defuser === a);
  const perceived = committed ? null : acquire(bot, world);
  if (perceived) {
    if (bot.target !== perceived) {
      // First sighting: a reaction delay before the first shot.
      bot.reactT = (0.28 + world.rng.range(0, 0.35)) / bot.skill;
      bot.burstLeft = 0;
    }
    bot.target = perceived;
    bot.lastSeen.set(perceived.pos.x, perceived.pos.y + 1.2, perceived.pos.z);
    bot.lastSeenT = world.time;
    bot.mode = 'engage';
  } else if (bot.target && world.time - bot.lastSeenT < 1.2) {
    // Keep aiming at the last seen spot briefly, then give up.
    bot.mode = 'engage';
  } else {
    if (bot.target) {
      bot.target = null;
      if (bot.mode === 'engage') bot.mode = bot.route.length ? 'route' : 'hold';
    }
    const sound = hear(bot, world);
    if (sound && bot.mode !== 'plant' && bot.mode !== 'defuse' && bot.mode !== 'fetch') {
      bot.hearPos = sound.pos;
      bot.hearT = world.time;
      if (bot.mode !== 'investigate' || world.time - bot.hearT < 0.5) {
        bot.mode = 'investigate';
        routeTo(bot, nearestNode(sound.pos.x, sound.pos.z), sound.pos);
      }
    }
  }

  // Objective logic, checked on every think tick.
  if (a.team === 'PHANTOM' && world.phase === 'live') {
    if (bomb.mode === 'carried' && bomb.carrier === a) {
      if (bot.mode !== 'plant') {
        const site = world.nearestSite(a.pos.x, a.pos.z);
        const node = site === 'A' ? 'pA3' : 'pB3';
        routeTo(bot, node, new THREE.Vector3(site === 'A' ? 24 : -24, 0, -9));
        bot.mode = 'carry';
      }
    } else if (bomb.mode === 'dropped' && bot.mode !== 'fetch' && bot.mode !== 'engage') {
      // The closest living PHANTOM goes and picks the charge up.
      let closest = null;
      let closestD = Infinity;
      for (const other of world.actors) {
        if (!other.alive || other.team !== 'PHANTOM' || other.isPlayer) continue;
        const d = Math.hypot(other.pos.x - bomb.dropPos.x, other.pos.z - bomb.dropPos.z);
        if (d < closestD) {
          closestD = d;
          closest = other;
        }
      }
      if (closest === a) {
        routeTo(bot, nearestNode(bomb.dropPos.x, bomb.dropPos.z), bomb.dropPos);
        bot.mode = 'fetch';
      }
    } else if (bomb.mode === 'planted' && bot.mode !== 'engage') {
      // Fall back and guard the planted charge.
      if (bot.mode !== 'guard') {
        const node = bomb.site === 'A' ? 'pA3' : 'pB3';
        routeTo(bot, node, new THREE.Vector3(bomb.plantPos.x, 0, bomb.plantPos.z));
        bot.mode = 'guard';
      }
    }
  }
  if (a.team === 'VANGUARD' && world.phase === 'live') {
    if (bomb.mode === 'planted' && bot.mode !== 'defuse' && bot.mode !== 'engage') {
      let rank = 0;
      for (const other of world.actors) {
        if (!other.alive || other.team !== 'VANGUARD') continue;
        const d = Math.hypot(other.pos.x - bomb.plantPos.x, other.pos.z - bomb.plantPos.z);
        const myD = Math.hypot(a.pos.x - bomb.plantPos.x, a.pos.z - bomb.plantPos.z);
        if (d < myD) rank += 1;
      }
      if (rank < 2) {
        const node = bomb.site === 'A' ? 'pA3' : 'pB3';
        routeTo(bot, node, new THREE.Vector3(bomb.plantPos.x, 0, bomb.plantPos.z));
        bot.mode = 'retake';
      }
    }
  }

  // Plant / defuse channels.
  if (bot.mode === 'carry' && bomb.mode === 'carried' && bomb.carrier === a) {
    const site = world.bomb.siteAt(a.pos.x, a.pos.z);
    if (site && a.onGround) {
      world.bomb.tryPlant(a);
      bot.mode = 'plant';
    }
  }
  if (bot.mode === 'retake' && bomb.mode === 'planted') {
    const d = Math.hypot(a.pos.x - bomb.plantPos.x, a.pos.z - bomb.plantPos.z);
    if (d < 2.2 && !bot.target) {
      world.bomb.tryDefuse(a);
      bot.mode = 'defuse';
    }
  }
}

function moveToward(bot, world, dt, tx, tz, speedScale = 1) {
  const a = bot.actor;
  const dx = tx - a.pos.x;
  const dz = tz - a.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.05) return true;
  const wantYaw = Math.atan2(-dx, -dz);
  let dy = wantYaw - a.yaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  const maxTurn = 6 * dt;
  a.yaw += Math.max(-maxTurn, Math.min(maxTurn, dy));
  const aligned = Math.abs(dy) < 0.6;
  const move = {
    forward: aligned ? 1 * speedScale : 0.25,
    strafe: 0,
    jump: false,
    crouch: false,
    walk: false,
  };
  stepActor(a, dt, move, world.colliders);
  return dist < 0.9;
}

export function botStep(bot, world, dt) {
  const a = bot.actor;
  if (!a.alive) return;
  stepWeapon(a.weapon, dt);
  bot.blindT = Math.max(0, bot.blindT - dt);
  // Perception and orders run at ~8 Hz; movement and aiming run every tick.
  bot.thinkT -= dt;
  if (bot.thinkT <= 0) {
    botThink(bot, world, dt);
    bot.thinkT = 0.12 + world.rng.next() * 0.06;
  }
  bot.reactT -= dt;

  // --- Aiming and firing ---
  let firing = false;
  if (bot.target) {
    const t = bot.target;
    const dist = Math.hypot(t.pos.x - a.pos.x, t.pos.z - a.pos.z);
    const visible = bot.target && world.time - bot.lastSeenT < 1.2;
    // Aim error: skill, distance, target speed, burst heat.
    const targetSpeed = Math.hypot(t.vel.x, t.vel.z);
    const heat = bot.burstLeft > 0 ? (4 - bot.burstLeft) * 0.012 : 0;
    const errAngle = (0.016 + dist * 0.0011 + targetSpeed * 0.006 + heat) / bot.skill;
    const aim = _toTarget.set(
      t.pos.x + world.rng.normal() * Math.tan(errAngle) * dist,
      t.pos.y + 1.25 + world.rng.normal() * Math.tan(errAngle) * dist * 0.5,
      t.pos.z + world.rng.normal() * Math.tan(errAngle) * dist,
    );
    aimAt(bot, aim);
    if (bot.blindT > 0) {
      // Flashed: the bot cannot fire and its aim wanders.
      a.yaw += world.rng.normal() * 0.06;
      a.pitch += world.rng.normal() * 0.03;
    } else if (visible && bot.reactT <= 0) {
      if (bot.burstLeft <= 0) {
        if (bot.burstPause <= 0) {
          bot.burstLeft = 3 + Math.floor(world.rng.next() * 3);
          bot.burstPause = 0;
        } else {
          bot.burstPause -= dt;
        }
      }
      if (bot.burstLeft > 0 && a.weapon.mag > 0 && a.weapon.reloading <= 0) {
        firing = true;
        bot.burstLeft -= 1;
        if (bot.burstLeft <= 0) bot.burstPause = 0.45 + world.rng.next() * 0.5;
      }
    }
  } else if (bot.mode === 'hold') {
    // Scan the lane: slow yaw sweep while holding.
    bot.holdT += dt;
    a.yaw += bot.scanDir * 0.35 * dt;
    if (bot.holdT > 2.4) {
      bot.holdT = 0;
      bot.scanDir *= -1;
    }
  }

  if (firing) {
    const spread = currentSpread(a.weapon, groundSpeed(a), !a.onGround, a.crouching, false);
    world.fireHitscan(a, spread);
  }
  if (a.weapon.mag === 0 && a.weapon.reloading <= 0) startReload(a.weapon);
  else if (a.weapon.mag < a.weapon.def.mag * 0.3 && !bot.target && a.weapon.reloading <= 0) {
    startReload(a.weapon);
  }

  // --- Movement ---
  if (bot.mode === 'engage' && bot.target) {
    // Strafe while fighting, keep the target in view.
    bot.strafeT -= dt;
    if (bot.strafeT <= 0) {
      bot.strafeDir = world.rng.chance(0.5) ? -1 : 1;
      bot.strafeT = 0.5 + world.rng.next() * 0.7;
    }
    const move = {
      forward: 0, strafe: bot.strafeDir * 0.55, jump: false, crouch: false, walk: true,
    };
    stepActor(a, dt, move, world.colliders);
    return;
  }
  if (bot.mode === 'hold' || bot.mode === 'plant' || bot.mode === 'defuse') {
    stepActor(a, dt, { forward: 0, strafe: 0, jump: false, crouch: false, walk: false }, world.colliders);
    return;
  }

  // Route following: walk the node chain, then the final goal position.
  let goal = null;
  if (bot.routeIdx < bot.route.length) {
    const node = WAYPOINTS[bot.route[bot.routeIdx]];
    goal = { x: node.x, z: node.z };
  } else if (bot.goalPos) {
    goal = { x: bot.goalPos.x, z: bot.goalPos.z };
  }
  if (!goal) {
    if (bot.mode === 'route' || bot.mode === 'carry' || bot.mode === 'guard' || bot.mode === 'retake') bot.mode = 'hold';
    stepActor(a, dt, { forward: 0, strafe: 0, jump: false, crouch: false, walk: false }, world.colliders);
    return;
  }
  const arrived = moveToward(bot, world, dt, goal.x, goal.z);
  if (arrived) {
    if (bot.routeIdx < bot.route.length) bot.routeIdx += 1;
    else {
      // Reached the final goal.
      if (bot.mode === 'fetch') {
        world.bomb.pickup(a);
        bot.mode = 'carry';
        const site = world.nearestSite(a.pos.x, a.pos.z);
        const node = site === 'A' ? 'pA3' : 'pB3';
        routeTo(bot, node, new THREE.Vector3(site === 'A' ? 24 : -24, 0, -9));
        bot.mode = 'carry';
      } else if (bot.mode === 'investigate') {
        bot.mode = 'hold';
        bot.holdT = 0;
      } else if (bot.mode === 'carry' || bot.mode === 'guard' || bot.mode === 'retake') {
        bot.mode = 'hold';
      }
    }
  }

  // Stuck detection: no progress while trying to move -> sidestep.
  const moved = Math.hypot(a.pos.x - bot.lastPos.x, a.pos.z - bot.lastPos.z);
  if (moved < 0.05) {
    bot.stuckT += dt;
    if (bot.stuckT > 1.2) {
      bot.stuckT = 0;
      const side = world.rng.chance(0.5) ? 1 : -1;
      const move = { forward: 0, strafe: side, jump: false, crouch: false, walk: false };
      stepActor(a, dt, move, world.colliders);
    }
  } else {
    bot.stuckT = 0;
  }
  bot.lastPos.set(a.pos.x, 0, a.pos.z);

  // Opportunistic grenades: smoke the push, frag a heard enemy.
  bot.throwT -= dt;
  if (bot.throwT <= 0 && (a.grenades.smoke > 0 || a.grenades.frag > 0)) {
    if (bot.mode === 'route' && bot.routeIdx >= 1 && a.grenades.smoke > 0
      && ['pMidDoor', 'pA1', 'pB1'].includes(bot.route[bot.routeIdx - 1] || '')) {
      _dir.set(-Math.sin(a.yaw), 0.35, -Math.cos(a.yaw)).normalize();
      world.throwGrenade(a, 'smoke', _dir);
      bot.throwT = 8;
    } else if (bot.hearPos && world.time - bot.hearT < 2 && a.grenades.frag > 0 && !bot.target) {
      _dir.set(bot.hearPos.x - a.pos.x, 1.4, bot.hearPos.z - a.pos.z).normalize();
      world.throwGrenade(a, 'frag', _dir);
      bot.throwT = 10;
    }
  }
}
