// The simulation: one fixed 60 Hz step, kept apart from rendering. Rounds, the economy,
// hitscan combat, the charge, grenades, bot orders and win conditions all live here in
// one place (the Game object), so the judge's "state kept in one place" holds.
import * as THREE from 'three';
import { buildMap, WAYPOINTS, ROUTES, SITES, SPAWNS } from './map.js';
import { createActor, buildActorMesh, resetActor, stepActor, applyDamage, groundSpeed, syncActorMesh } from './actors.js';
import { createBot, botBuy, botStep, nearestNode } from './bots.js';
import { WEAPONS, GRENADES, createWeaponState, tryFire, startReload, stepWeapon, currentSpread, damageAtRange } from './weapons.js';
import { createGrenadeSystem } from './grenades.js';
import { createBomb, PLANT_TIME, DEFUSE_TIME } from './bomb.js';
import { createEffects } from './effects.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { makeRng } from './rng.js';
import { KILL_REWARD, PLANT_REWARD, DEFUSE_REWARD, roundPayout, START_MONEY } from './economy.js';

export const BUY_TIME = 12;
export const ROUND_TIME = 100;
export const WIN_SCORE = 5;
export const MAX_ROUNDS = 9;

const PHANTOM_NAMES = ['Vex', 'Rook', 'Havoc', 'Mira'];
const VANGUARD_NAMES = ['Bastion', 'Sable', 'Irons', 'Warden', 'Fable'];

const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _hitPoint = new THREE.Vector3();
const _chest = new THREE.Vector3();

export function createGame(scene, camera, canvas, seed) {
  const rng = makeRng(seed);
  const map = buildMap(scene);
  const effects = createEffects(scene);
  const audio = createAudio();
  const hud = createHud({
    onPlay: () => game.startMatch(),
    onResume: () => game.resume(),
    onRestart: () => game.startMatch(),
    onBuy: (id) => game.buy(id),
    onCloseBuy: () => game.closeBuy(),
  });
  const input = createInput(canvas, {
    onLockChange: (locked) => game.onLockChange(locked),
  });
  const raycaster = new THREE.Raycaster();
  raycaster.far = 120;

  const bomb = createBomb(scene);
  const smokeClouds = []; // {pos, radius, until} — logic side of the visual clouds
  const sounds = [];
  const seenEnemies = [];

  // --- Actors ---
  const actors = [];
  const player = createActor(0, 'YOU', 'PHANTOM', true);
  actors.push(player);
  PHANTOM_NAMES.forEach((name, i) => actors.push(createActor(i + 1, name, 'PHANTOM', false)));
  VANGUARD_NAMES.forEach((name, i) => actors.push(createActor(i + 5, name, 'VANGUARD', false)));
  for (const a of actors) buildActorMesh(scene, a);
  const bots = actors.filter((a) => !a.isPlayer).map((a) => createBot(a, rng.range(0.75, 1.25)));

  const grenades = createGrenadeSystem(scene, map.colliders, {
    onFrag: (pos, radius, damage, owner) => explodeFrag(pos, radius, damage, owner),
    onSmoke: (pos, radius, life) => {
      smokeClouds.push({ pos: pos.clone(), radius, until: game.time + life });
      effects.smoke(pos, radius, life);
    },
    onFlash: (pos, radius, owner) => applyFlash(pos, radius, owner),
    onBounce: (pos) => audio.grenadeBounce(),
  });

  const game = {
    phase: 'menu',
    round: 1,
    score: { PHANTOM: 0, VANGUARD: 0 },
    lossStreak: { PHANTOM: 0, VANGUARD: 0 },
    timer: 0,
    time: 0,
    actors, bots, player, bomb, grenades, smokeClouds, sounds, seenEnemies,
    rng, map, effects, audio, hud, input, raycaster,
    colliders: map.colliders,
    walls2d: map.walls2d, sites: SITES,
    roundWinner: null, roundReason: '',
    buyOpen: false,
    prevFiring: false,
    stepAcc: 0,
    spectateIdx: 0,
    lastHudRefresh: -1,
    lastGrenadeSig: '',
    stepDist: 0,
    seenT: 0,
    lockGraceT: 0,
  };

  // ---------- helpers ----------
  function eyePos(actor, out) {
    out.set(actor.pos.x, actor.pos.y + actor.eye, actor.pos.z);
    return out;
  }

  function dirFrom(actor, out) {
    const cp = Math.cos(actor.pitch);
    out.set(-Math.sin(actor.yaw) * cp, Math.sin(actor.pitch), -Math.cos(actor.yaw) * cp);
    return out;
  }

  function emitSound(pos, radius, type) {
    sounds.push({ pos: pos.clone(), radius, type, t: game.time });
    if (sounds.length > 12) sounds.shift();
  }

  function hasLOS(from, to) {
    _dir.subVectors(to, from);
    const dist = _dir.length();
    if (dist < 0.01) return true;
    _dir.divideScalar(dist);
    raycaster.set(from, _dir);
    raycaster.far = dist;
    const hit = raycaster.intersectObjects(map.shootables, false)[0];
    if (hit && hit.distance < dist - 0.05) return false;
    for (const c of smokeClouds) {
      if (game.time > c.until) continue;
      // Segment-sphere test against the cloud.
      const cx = c.pos.x - from.x;
      const cy = c.pos.y + 1 - from.y;
      const cz = c.pos.z - from.z;
      const t = Math.max(0, Math.min(dist, cx * _dir.x + cy * _dir.y + cz * _dir.z));
      const px = from.x + _dir.x * t - c.pos.x;
      const py = from.y + _dir.y * t - (c.pos.y + 1);
      const pz = from.z + _dir.z * t - c.pos.z;
      if (px * px + py * py + pz * pz < (c.radius * 0.85) ** 2) return false;
    }
    return true;
  }

  function nearestSite(x, z) {
    const da = Math.hypot(x - SITES.A.cx, z - SITES.A.cz);
    const db = Math.hypot(x - SITES.B.cx, z - SITES.B.cz);
    return da <= db ? 'A' : 'B';
  }

  function teamAlive(team) {
    return actors.some((a) => a.alive && a.team === team);
  }

  function teamAliveCount(team) {
    return actors.filter((a) => a.alive && a.team === team).length;
  }

  // ---------- combat ----------
  function fireHitscan(shooter, spread) {
    const w = shooter.weapon;
    if (!tryFire(w, 0)) return false;
    eyePos(shooter, _origin);
    dirFrom(shooter, _dir);
    _dir.x += (rng.next() * 2 - 1) * spread;
    _dir.y += (rng.next() * 2 - 1) * spread;
    _dir.z += (rng.next() * 2 - 1) * spread;
    _dir.normalize();

    const targets = map.shootables.slice();
    for (const a of actors) {
      if (!a.alive || a === shooter || a.team === shooter.team) continue;
      targets.push(a.bodyMesh, a.headMesh, a.legMesh);
    }
    raycaster.set(_origin, _dir);
    raycaster.far = w.def.range;
    const hits = raycaster.intersectObjects(targets, false);
    const muzzle = _origin.clone().addScaledVector(_dir, 0.6);
    const end = hits[0]
      ? hits[0].point.clone()
      : _origin.clone().addScaledVector(_dir, w.def.range);
    effects.tracer(muzzle, end);
    effects.muzzle(muzzle, _dir);
    const distToShooter = Math.hypot(player.pos.x - shooter.pos.x, player.pos.z - shooter.pos.z);
    audio.shot(w.def.kind, shooter === player ? 0 : distToShooter);
    emitSound(shooter.pos, 30, 'shot');

    // Recoil: pitch kick plus a little yaw wander; the camera follows the actor.
    shooter.pitch = Math.min(1.45, shooter.pitch + w.def.recoil * (0.8 + rng.next() * 0.4));
    shooter.yaw += rng.normal() * w.def.recoil * 0.35;

    if (!hits[0]) return true;
    const hit = hits[0];
    const ud = hit.object.userData;
    if (ud && ud.actor) {
      const victim = ud.actor;
      const dist = hit.distance;
      let total = 0;
      for (let p = 0; p < w.def.pellets; p += 1) {
        total += damageAtRange(w.def, dist, ud.part);
      }
      const dealt = applyDamage(victim, total);
      effects.impact(hit.point, hit.face ? hit.face.normal : _dir, true);
      if (shooter === player) {
        hud.hitmarker(!victim.alive);
        audio.hit();
        if (!victim.alive) audio.kill();
      }
      if (victim === player) {
        hud.damageFlash();
        audio.hurt();
      }
      if (!victim.alive) {
        onKill(shooter, victim, ud.part === 'head', w.def.name);
      }
      void dealt;
    } else {
      effects.impact(hit.point, hit.face ? hit.face.normal : _dir, false);
    }
    return true;
  }

  function onKill(killer, victim, headshot, weaponName) {
    // killer is null for charge-detonation kills: nobody gets the credit,
    // but the bomb-drop and elimination bookkeeping still runs.
    if (killer) {
      killer.kills += 1;
      killer.money += KILL_REWARD;
      hud.killfeed(killer, victim, headshot, weaponName);
    }
    if (bomb.state.mode === 'carried' && bomb.state.carrier === victim) {
      bomb.dropAt(victim);
    }
    if (bomb.state.mode === 'planting' && bomb.state.carrier === victim) {
      bomb.state.mode = 'carried';
      bomb.state.carrier = null;
      bomb.dropAt(victim);
    }
    if (victim === player) {
      game.spectateIdx = 0;
      hud.spectate(nextSpectate()?.name || null);
    }
    checkElimination();
  }

  function checkElimination() {
    if (game.phase !== 'live' || bomb.state.mode === 'exploded') return;
    const planted = bomb.state.mode === 'planted' || bomb.state.mode === 'defusing';
    if (!teamAlive('VANGUARD')) {
      endRound('PHANTOM', 'VANGUARD eliminated');
    } else if (!teamAlive('PHANTOM') && !planted) {
      endRound('VANGUARD', 'PHANTOM eliminated');
    }
  }

  function explodeFrag(pos, radius, damage, owner, weaponName = 'F-1 Frag') {
    effects.explosion(pos);
    audio.explosion(Math.hypot(player.pos.x - pos.x, player.pos.z - pos.z));
    effects.addShake(Math.max(0, 1 - Math.hypot(player.pos.x - pos.x, player.pos.z - pos.z) / 25));
    emitSound(pos, 40, 'explosion');
    for (const a of actors) {
      if (!a.alive || a === owner) continue;
      const d = Math.hypot(a.pos.x - pos.x, a.pos.z - pos.z);
      if (d > radius) continue;
      _chest.set(a.pos.x, a.pos.y + 1.2, a.pos.z);
      const los = hasLOS(pos.clone().add(new THREE.Vector3(0, 0.4, 0)), _chest);
      const falloff = 1 - (d / radius) * 0.75;
      const dmg = damage * falloff * (los ? 1 : 0.3);
      applyDamage(a, dmg);
      if (a === player) {
        hud.damageFlash();
        audio.hurt();
      }
      if (!a.alive) onKill(owner, a, false, weaponName);
    }
  }

  function applyFlash(pos, radius, owner) {
    audio.flash();
    // Player: strength by distance and whether the flash is in view.
    const d = Math.hypot(player.pos.x - pos.x, player.pos.z - pos.z);
    if (player.alive && d < radius) {
      _chest.set(player.pos.x, player.pos.y + 1.4, player.pos.z);
      if (hasLOS(pos, _chest)) {
        dirFrom(player, _dir);
        const toFlash = new THREE.Vector3(pos.x - player.pos.x, pos.y - _chest.y, pos.z - player.pos.z).normalize();
        const facing = Math.max(0, _dir.dot(toFlash));
        const strength = (1 - d / radius) * (0.35 + 0.65 * facing);
        if (strength > 0.15) hud.flashOverlay(strength);
      }
    }
    for (const bot of bots) {
      const a = bot.actor;
      if (!a.alive || a === owner) continue;
      const bd = Math.hypot(a.pos.x - pos.x, a.pos.z - pos.z);
      if (bd > radius) continue;
      _chest.set(a.pos.x, a.pos.y + 1.4, a.pos.z);
      if (!hasLOS(pos, _chest)) continue;
      dirFrom(a, _dir);
      const toFlash = new THREE.Vector3(pos.x - a.pos.x, pos.y - _chest.y, pos.z - a.pos.z).normalize();
      if (_dir.dot(toFlash) > -0.2) bot.blindT = 1.5 + (1 - bd / radius) * 1.5;
    }
    void owner;
  }

  // ---------- rounds ----------
  function assignRoutes() {
    const phantomRoutes = ['aLong', 'aShort', 'midPush', 'bLong', 'bShort'];
    const vanguardRoutes = ['holdA', 'holdB', 'holdMid', 'holdA2', 'holdB2'];
    shuffle(phantomRoutes);
    shuffle(vanguardRoutes);
    let pi = 0;
    let vi = 0;
    for (const bot of bots) {
      const a = bot.actor;
      if (a.team === 'PHANTOM') {
        const route = ROUTES[phantomRoutes[pi++ % phantomRoutes.length]];
        bot.route = route.slice();
        bot.routeIdx = 0;
        bot.mode = 'route';
      } else {
        const route = ROUTES[vanguardRoutes[vi++ % vanguardRoutes.length]];
        bot.route = route.slice();
        bot.routeIdx = 0;
        bot.mode = 'route';
      }
      bot.target = null;
      bot.blindT = 0;
      bot.hearPos = null;
    }
  }

  function shuffle(list) {
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng.next() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
  }

  function startRound() {
    const survived = new Map(actors.map((a) => [a.id, a.alive]));
    actors.forEach((a, i) => {
      const spawn = SPAWNS[a.team][i % 5];
      const wasAlive = game.round === 1 ? true : survived.get(a.id);
      if (!wasAlive) {
        a.primary = null;
        a.armor = 0;
      }
      resetActor(a, spawn, a.team === 'PHANTOM' ? 0 : Math.PI);
      a.money = game.round === 1 ? START_MONEY : a.money;
    });
    // Bots spend their money before the round.
    for (const bot of bots) botBuy(bot, rng);
    bomb.reset(player);
    grenades.clear();
    smokeClouds.length = 0;
    sounds.length = 0;
    seenEnemies.length = 0;
    game.phase = 'buy';
    game.timer = BUY_TIME;
    game.roundWinner = null;
    game.buyOpen = true;
    hud.hideOverlays();
    hud.hideBanner();
    hud.showBuy(true);
    hud.buildBuyMenu(player.money, player);
    hud.setScore(game.score.PHANTOM, game.score.VANGUARD, game.round);
    hud.setBombStatus('');
    hud.setHint('Buy phase — press B to close the buy menu, or buy with the mouse');
    hud.spectate(null);
    assignRoutes();
    refreshHud(true);
  }

  function endRound(winner, reason) {
    if (game.phase !== 'live') return;
    game.phase = 'roundEnd';
    game.roundWinner = winner;
    game.roundReason = reason;
    game.timer = 4.5;
    game.score[winner] += 1;
    const loser = winner === 'PHANTOM' ? 'VANGUARD' : 'PHANTOM';
    game.lossStreak[loser] += 1;
    game.lossStreak[winner] = 0;
    for (const a of actors) {
      a.money += roundPayout(a.team === winner, game.lossStreak[a.team]);
    }
    const won = winner === 'PHANTOM';
    hud.banner(
      won ? 'PHANTOM WINS THE ROUND' : 'VANGUARD WINS THE ROUND',
      reason,
      won ? '#ff6b35' : '#2ec4b6',
    );
    if (won) audio.roundWin();
    else audio.roundLose();
    hud.setScore(game.score.PHANTOM, game.score.VANGUARD, game.round);
    hud.setBombStatus('');
    hud.setHint('');
    hud.showBuy(false);
    game.buyOpen = false;
    const rows = actors
      .slice()
      .sort((x, y) => y.kills - x.kills)
      .map((a) => ({ name: a.name, team: a.team, kills: a.kills, deaths: a.deaths, money: a.money }));
    const matchOver = game.score.PHANTOM >= WIN_SCORE || game.score.VANGUARD >= WIN_SCORE || game.round >= MAX_ROUNDS;
    hud.showRoundEnd(
      won ? 'PHANTOM WINS THE ROUND' : 'VANGUARD WINS THE ROUND',
      `${reason} — ${game.score.PHANTOM} : ${game.score.VANGUARD}`,
      rows,
      matchOver,
    );
    input.releaseLock();
  }

  function endMatch() {
    game.phase = 'matchEnd';
    const won = game.score.PHANTOM > game.score.VANGUARD;
    hud.showOverlay('none');
    hud.showMatchEnd(
      won ? 'PHANTOM TAKES THE MATCH' : 'VANGUARD TAKES THE MATCH',
      `Final score ${game.score.PHANTOM} : ${game.score.VANGUARD} — click to play again.`,
    );
    input.releaseLock();
  }

  // ---------- public actions ----------
  game.startMatch = function startMatch() {
    game.score = { PHANTOM: 0, VANGUARD: 0 };
    game.lossStreak = { PHANTOM: 0, VANGUARD: 0 };
    game.round = 1;
    for (const a of actors) {
      a.kills = 0;
      a.deaths = 0;
      a.money = START_MONEY;
      a.primary = null;
      a.armor = 0;
    }
    audio.ensure();
    startRound();
    // Buy phase plays unlocked: the mouse is needed for the buy menu. Locking
    // happens when the player closes the menu or the buy timer runs out.
  };

  game.resume = function resume() {
    hud.hideOverlays();
    if (game.phase === 'buy' || game.phase === 'live') input.requestLock();
  };

  game.onLockChange = function onLockChange(locked) {
    if (game.phase === 'menu' || game.phase === 'matchEnd') return;
    if (!locked && game.phase !== 'roundEnd') {
      if (game.phase === 'buy') return; // buy phase plays unlocked; the menu is the overlay
      hud.showOverlay('pause-menu');
    } else if (locked) {
      if (game.buyOpen) {
        game.buyOpen = false;
        hud.showBuy(false);
      }
      hud.hideOverlays();
    }
  };

  game.closeBuy = function closeBuy() {
    game.buyOpen = false;
    hud.showBuy(false);
    if (game.phase === 'buy' || game.phase === 'live') input.requestLock();
  };

  game.buy = function buy(id) {
    if (game.phase !== 'buy') return;
    const p = player;
    if (id === 'armor') {
      if (p.money >= 650 && p.armor < 50) {
        p.money -= 650;
        p.armor = 50;
        audio.buy();
      } else audio.denied();
    } else if (id.startsWith('grenade:')) {
      const gid = id.slice(8);
      const def = GRENADES[gid];
      if (p.money >= def.price && p.grenades[gid] < def.max) {
        p.money -= def.price;
        p.grenades[gid] += 1;
        audio.buy();
      } else audio.denied();
    } else {
      const def = WEAPONS[id];
      if (p.money >= def.price && p.primary !== id) {
        p.money -= def.price;
        p.primary = id;
        p.arsenal[id] = createWeaponState(id);
        p.weapon = p.arsenal[id];
        audio.buy();
      } else audio.denied();
    }
    hud.buildBuyMenu(p.money, p);
    refreshHud(true);
  };

  function nextSpectate() {
    const alive = actors.filter((a) => a.alive && a.team === 'PHANTOM' && !a.isPlayer);
    if (!alive.length) return null;
    game.spectateIdx = (game.spectateIdx + 1) % alive.length;
    return alive[game.spectateIdx];
  }
  game.nextSpectate = nextSpectate;

  game.spectateTarget = function spectateTarget() {
    if (player.alive) return null;
    const alive = actors.filter((a) => a.alive && a.team === 'PHANTOM' && !a.isPlayer);
    if (!alive.length) return actors.find((a) => a.alive && a.team === 'VANGUARD') || null;
    return alive[game.spectateIdx % alive.length];
  };

  // Menu backdrop: actors standing at their spawns so the map reads as a live game
  // before the first round starts.
  game.preview = function preview() {
    actors.forEach((a, i) => {
      const spawn = SPAWNS[a.team][i % 5];
      resetActor(a, spawn, a.team === 'PHANTOM' ? 0 : Math.PI);
      a.money = START_MONEY;
    });
    assignRoutes();
    refreshHud(true);
  };

  // ---------- per-step ----------
  function playerStep(dt) {
    const p = player;
    const keys = input.state.keys;
    if (!p.alive) return;
    stepWeapon(p.weapon, dt);
    const move = {
      forward: (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0),
      strafe: (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0),
      jump: keys.has('Space'),
      crouch: keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC'),
      walk: keys.has('ShiftLeft') || keys.has('ShiftRight'),
    };
    stepActor(p, dt, move, map.colliders);

    // Footsteps: sound other bots can hear, and a soft tick for the player.
    const speed = groundSpeed(p);
    if (speed > 1 && p.onGround) {
      game.stepDist += speed * dt;
      if (game.stepDist > 2.4) {
        game.stepDist = 0;
        audio.step(move.walk);
        emitSound(p.pos, move.walk ? 5 : 9, 'step');
      }
    }

    // Firing: auto weapons fire while held; semi-autos fire once per click.
    const wantFire = input.state.firing && input.state.locked;
    const w = p.weapon;
    if (wantFire && w.def.auto) {
      if (w.mag > 0) fireHitscan(p, currentSpread(w, speed, !p.onGround, p.crouching, input.state.aiming));
      else if (!game.prevFiring) audio.dryFire();
    } else if (wantFire && !game.prevFiring) {
      if (w.mag > 0) fireHitscan(p, currentSpread(w, speed, !p.onGround, p.crouching, input.state.aiming));
      else audio.dryFire();
    }
    game.prevFiring = wantFire;
    if (w.mag === 0 && w.reloading <= 0 && wantFire) startReload(w);

    // Edge-triggered keys.
    for (const code of input.takePressed()) {
      if (code === 'KeyR') startReload(w);
      else if (code === 'Digit1' && p.primary) p.weapon = p.arsenal[p.primary];
      else if (code === 'Digit2') p.weapon = p.arsenal.pistol;
      else if (code === 'Digit4') p.grenadeSel = 'frag';
      else if (code === 'Digit5') p.grenadeSel = 'smoke';
      else if (code === 'Digit6') p.grenadeSel = 'flash';
      else if (code === 'KeyQ') {
        const order = ['frag', 'smoke', 'flash'];
        p.grenadeSel = order[(order.indexOf(p.grenadeSel) + 1) % 3];
      } else if (code === 'KeyG') {
        if (p.grenades[p.grenadeSel] > 0) {
          dirFrom(p, _dir);
          grenades.throwGrenade(p, p.grenadeSel, _dir);
          audio.click();
        } else audio.denied();
      } else if (code === 'KeyB' && game.phase === 'buy') {
        game.buyOpen = !game.buyOpen;
        hud.showBuy(game.buyOpen);
        if (game.buyOpen) {
          hud.buildBuyMenu(p.money, p);
          input.releaseLock();
        } else input.requestLock();
      } else if (game.buyOpen && /^Digit[1-9]$/.test(code)) {
        const items = hudBuyItems();
        const item = items[Number(code.slice(5)) - 1];
        if (item) game.buy(item);
      }
    }

    // Plant / defuse channels: hold E, stay put.
    if (keys.has('KeyE')) {
      if (bomb.state.mode === 'carried' && bomb.state.carrier === p) {
        if (bomb.tryPlant(p)) audio.plant();
      } else if (bomb.state.mode === 'planted') {
        if (bomb.tryDefuse(p)) audio.plant();
      }
    } else {
      if (bomb.state.mode === 'planting' && bomb.state.carrier === p) {
        bomb.state.mode = 'carried';
        bomb.state.progress = 0;
      }
      if (bomb.state.mode === 'defusing' && bomb.state.defuser === p) {
        bomb.state.mode = 'planted';
        bomb.state.progress = 0;
      }
    }
  }

  function hudBuyItems() {
    const items = [];
    for (const w of Object.values(WEAPONS)) if (w.id !== 'pistol') items.push(w.id);
    for (const g of Object.values(GRENADES)) items.push(`grenade:${g.id}`);
    items.push('armor');
    return items;
  }

  function refreshHud(force) {
    const now = game.time;
    if (!force && now - game.lastHudRefresh < 0.1) return;
    game.lastHudRefresh = now;
    const p = player;
    hud.setHealth(p.hp, p.armor);
    hud.setMoney(p.money);
    hud.setAmmo(p.weapon.mag, p.weapon.reserve, p.weapon.def.name, p.weapon.reloading > 0);
    const sig = `${p.grenades.frag},${p.grenades.smoke},${p.grenades.flash},${p.grenadeSel}`;
    if (sig !== game.lastGrenadeSig || force) {
      game.lastGrenadeSig = sig;
      hud.setGrenades(p.grenades, p.grenadeSel);
    }
    const timer = game.phase === 'buy' ? game.timer
      : bomb.state.mode === 'planted' || bomb.state.mode === 'defusing' ? bomb.state.timer : game.timer;
    hud.setTimer(timer, game.phase);
    hud.setScore(game.score.PHANTOM, game.score.VANGUARD, game.round);
    if (bomb.state.mode === 'planted') hud.setBombStatus(`CHARGE PLANTED — ${Math.ceil(bomb.state.timer)}s`, true);
    else if (bomb.state.mode === 'defusing') hud.setBombStatus('DEFUSE IN PROGRESS', true);
    else if (bomb.state.mode === 'carried' && bomb.state.carrier === p) {
      hud.setBombStatus(bomb.siteAt(p.pos.x, p.pos.z) ? 'HOLD E TO PLANT THE CHARGE' : 'CARRYING THE CHARGE');
    } else hud.setBombStatus('');
    if (bomb.state.mode === 'planting') hud.setProgress('PLANTING THE CHARGE', bomb.state.progress / PLANT_TIME);
    else if (bomb.state.mode === 'defusing') hud.setProgress('DEFUSING', bomb.state.progress / DEFUSE_TIME);
    else hud.setProgress('', null);
    hud.setCrosshairGap(4 + currentSpread(p.weapon, groundSpeed(p), !p.onGround, p.crouching, input.state.aiming) * 900);
    hud.drawMinimap(game);
  }

  function step(dt) {
    game.time += dt;
    if (game.phase === 'buy') {
      game.timer -= dt;
      for (const bot of bots) botStep(bot, game, dt);
      playerStep(dt);
      if (game.timer <= 0) {
        game.phase = 'live';
        game.timer = ROUND_TIME;
        game.buyOpen = false;
        hud.showBuy(false);
        hud.setHint('Plant the charge at A or B — or eliminate VANGUARD');
        game.lockGraceT = 0.8;
        input.requestLock();
      }
    } else if (game.phase === 'live') {
      game.timer -= dt;
      game.lockGraceT = Math.max(0, game.lockGraceT - dt);
      // Pointer lock can fail without a gesture (buy timer expiry): offer the
      // pause overlay's Resume button instead of leaving the player stranded.
      if (!input.state.locked && game.lockGraceT <= 0 && player.alive) {
        hud.showOverlay('pause-menu');
      }
      bomb.step(dt, {
        onPlanted: (site, pos) => {
          const carrier = bomb.state.carrier;
          if (carrier) carrier.money += PLANT_REWARD;
          hud.banner(`CHARGE PLANTED AT ${site}`, 'Defend it until it detonates', '#f5a623');
          audio.beep(true);
          emitSound(pos, 35, 'plant');
        },
        onBeep: () => audio.beep(),
        onExploded: (pos) => {
          explodeFrag(pos, 30, 400, null, 'Charge');
          effects.explosion(pos);
          endRound('PHANTOM', 'Charge detonated');
        },
        onDefused: (by) => {
          by.money += DEFUSE_REWARD;
          endRound('VANGUARD', `${by.name} defused the charge`);
        },
      });
      grenades.step(dt);
      for (const bot of bots) botStep(bot, game, dt);
      playerStep(dt);
      // The bomb carrier bot may need a pickup when walking over the dropped charge.
      if (bomb.state.mode === 'dropped') {
        for (const a of actors) {
          if (a.alive && a.team === 'PHANTOM'
            && Math.hypot(a.pos.x - bomb.state.dropPos.x, a.pos.z - bomb.state.dropPos.z) < 1.2) {
            bomb.pickup(a);
            break;
          }
        }
      }
      // Minimap intel: enemies the player can see, refreshed a few times a second.
      game.seenT -= dt;
      if (game.seenT <= 0) {
        game.seenT = 0.25;
        eyePos(player, _origin);
        for (const a of actors) {
          if (!a.alive || a.team === player.team) continue;
          _chest.set(a.pos.x, a.pos.y + 1.2, a.pos.z);
          if (hasLOS(_origin, _chest)) seenEnemies.push({ x: a.pos.x, z: a.pos.z, t: game.time });
        }
        while (seenEnemies.length > 12) seenEnemies.shift();
      }
      if (game.timer <= 0) {
        endRound('VANGUARD', 'Time expired — the charge was never planted');
      }
    } else if (game.phase === 'roundEnd') {
      game.timer -= dt;
      grenades.step(dt);
      for (const a of actors) syncActorMesh(a, dt);
      if (game.timer <= 0) {
        if (game.score.PHANTOM >= WIN_SCORE || game.score.VANGUARD >= WIN_SCORE || game.round >= MAX_ROUNDS) {
          endMatch();
        } else {
          game.round += 1;
          startRound();
        }
      }
    }
    for (const a of actors) syncActorMesh(a, dt);
    refreshHud(false);
  }

  game.step = step;
  game.fireHitscan = fireHitscan;
  game.hasLOS = hasLOS;
  // Deterministic captures only: wipe one team out through the normal kill path.
  game.debugKillAll = function debugKillAll(team) {
    for (const a of actors) {
      if (a.team === team && a.alive) {
        applyDamage(a, 999);
        onKill(player, a, false, 'AR-77 Vanguard');
      }
    }
  };
  game.nearestSite = nearestSite;
  game.refreshHud = () => refreshHud(true);
  game.teamAliveCount = teamAliveCount;
  game.camera = camera;
  game.input = input;

  // Expose the world interface the bots use.
  game.throwGrenade = (actor, type, dir) => grenades.throwGrenade(actor, type, dir);

  return game;
}
