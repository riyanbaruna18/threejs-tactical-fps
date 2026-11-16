// Actors: one body for the player and for every bot. Movement is the same box-against-
// colliders step for all of them (acceleration, friction, gravity, jump, crouch), so a
// bot and the player collide with the map identically. Health, armour and hitboxes
// (head / body / leg) live here too; shooting lives in sim.js.
import * as THREE from 'three';
import { TEAM } from './palette.js';
import { createWeaponState } from './weapons.js';

const RADIUS = 0.34;
const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.4;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP_SPEED = 6.2;

const _probe = new THREE.Box3();
const _wish = new THREE.Vector3();

function overlaps(colliders, x, y, z, height, lift) {
  _probe.min.set(x - RADIUS, y + lift, z - RADIUS);
  _probe.max.set(x + RADIUS, y + height - lift, z + RADIUS);
  for (const c of colliders) if (_probe.intersectsBox(c)) return c;
  return null;
}

export function createActor(id, name, team, isPlayer) {
  return {
    id, name, team, isPlayer,
    pos: new THREE.Vector3(0, 0, 0),
    vel: new THREE.Vector3(),
    yaw: 0, pitch: 0,
    eye: STAND_EYE, height: STAND_HEIGHT,
    onGround: true, crouching: false,
    hp: 100, armor: 0, alive: true,
    weapon: createWeaponState('pistol'),
    arsenal: { pistol: null }, // one state per owned weapon; switching never refills
    primary: null, // weapon id or null
    grenades: { frag: 0, smoke: 0, flash: 0 },
    grenadeSel: 'frag',
    money: 800, kills: 0, deaths: 0,
    deathT: 0, // seconds since death, for the fall-over pose
    mesh: null, bodyMesh: null, headMesh: null, legMesh: null, gunMesh: null,
  };
}

// move: {forward:-1..1, strafe:-1..1, jump, crouch, walk} — walk halves speed.
export function stepActor(actor, dt, move, colliders) {
  if (!actor.alive) return;
  const wantCrouch = !!move.crouch;
  if (wantCrouch && !actor.crouching) {
    actor.crouching = true;
    actor.height = CROUCH_HEIGHT;
  } else if (!wantCrouch && actor.crouching
    && !overlaps(colliders, actor.pos.x, actor.pos.y, actor.pos.z, STAND_HEIGHT, 0.02)) {
    actor.crouching = false;
    actor.height = STAND_HEIGHT;
  }
  const eyeTarget = actor.crouching ? CROUCH_EYE : STAND_EYE;
  actor.eye += (eyeTarget - actor.eye) * Math.min(1, dt * 12);

  const sin = Math.sin(actor.yaw);
  const cos = Math.cos(actor.yaw);
  _wish.set(-sin * move.forward + cos * move.strafe, 0, -cos * move.forward - sin * move.strafe);
  if (_wish.lengthSq() > 1) _wish.normalize();
  const speed = (actor.crouching ? CROUCH_SPEED : WALK_SPEED) * (move.walk ? 0.5 : 1);
  const blend = Math.min(1, (actor.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt / speed);
  actor.vel.x += (_wish.x * speed - actor.vel.x) * blend;
  actor.vel.z += (_wish.z * speed - actor.vel.z) * blend;
  if (actor.onGround && !_wish.lengthSq()) {
    const damp = Math.max(0, 1 - FRICTION * dt);
    actor.vel.x *= damp;
    actor.vel.z *= damp;
  }
  if (move.jump && actor.onGround) {
    actor.vel.y = JUMP_SPEED;
    actor.onGround = false;
  }
  actor.vel.y -= GRAVITY * dt;

  const nextX = actor.pos.x + actor.vel.x * dt;
  if (!overlaps(colliders, nextX, actor.pos.y, actor.pos.z, actor.height, 0.04)) actor.pos.x = nextX;
  else actor.vel.x = 0;
  const nextZ = actor.pos.z + actor.vel.z * dt;
  if (!overlaps(colliders, actor.pos.x, actor.pos.y, nextZ, actor.height, 0.04)) actor.pos.z = nextZ;
  else actor.vel.z = 0;

  actor.pos.y += actor.vel.y * dt;
  actor.onGround = false;
  const hit = overlaps(colliders, actor.pos.x, actor.pos.y, actor.pos.z, actor.height, 0);
  if (hit && actor.vel.y <= 0) {
    actor.pos.y = hit.max.y;
    actor.vel.y = 0;
    actor.onGround = true;
  } else if (hit) {
    actor.pos.y = hit.min.y - actor.height;
    actor.vel.y = 0;
  }
  if (actor.pos.y < 0) {
    actor.pos.y = 0;
    actor.vel.y = 0;
    actor.onGround = true;
  }
  actor.vel.y = Math.max(-30, actor.vel.y);
}

export function groundSpeed(actor) {
  return Math.hypot(actor.vel.x, actor.vel.z);
}

// Armour soaks half the damage until it runs out; the rest goes to health.
export function applyDamage(actor, raw) {
  if (!actor.alive) return 0;
  let hpDmg = raw;
  if (actor.armor > 0) {
    const soaked = Math.min(actor.armor, raw * 0.5);
    actor.armor -= soaked;
    hpDmg = raw - soaked;
  }
  actor.hp -= hpDmg;
  if (actor.hp <= 0) {
    actor.hp = 0;
    actor.alive = false;
    actor.deathT = 0;
    actor.deaths += 1;
  }
  return hpDmg;
}

// A low-poly operative: torso, legs, head and a gun, in the team colour with a dark
// vest. The local player's mesh stays hidden (first person); bots are always visible.
export function buildActorMesh(scene, actor) {
  const team = TEAM[actor.team];
  const group = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: team.color, roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9a184, roughness: 0.8 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.62, 0.32), cloth);
  torso.position.y = 1.08;
  torso.userData = { actor, part: 'body' };
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.4, 0.36), dark);
  vest.position.y = 1.1;
  vest.userData = { actor, part: 'body' };
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.72, 0.3), dark);
  legs.position.y = 0.38;
  legs.userData = { actor, part: 'leg' };
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10), skin);
  head.position.y = 1.56;
  head.userData = { actor, part: 'head' };
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.23, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), cloth);
  helmet.position.y = 1.58;
  helmet.userData = { actor, part: 'head' };
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.72), dark);
  gun.position.set(0.22, 1.18, -0.3);
  gun.userData = { actor, part: 'body' };

  group.add(torso, vest, legs, head, helmet, gun);
  group.traverse((o) => { o.castShadow = true; });
  scene.add(group);
  actor.mesh = group;
  actor.bodyMesh = torso;
  actor.headMesh = head;
  actor.legMesh = legs;
  actor.gunMesh = gun;
  if (actor.isPlayer) group.visible = false;
  return group;
}

export function syncActorMesh(actor, dt) {
  if (!actor.mesh) return;
  actor.mesh.position.copy(actor.pos);
  if (!actor.alive) {
    actor.deathT += dt;
    const k = Math.min(1, actor.deathT * 4);
    actor.mesh.rotation.set(-Math.PI / 2 * 0.92 * k, actor.yaw, 0);
    actor.mesh.position.y = actor.pos.y + 0.25 * k;
  } else {
    actor.mesh.rotation.set(0, actor.yaw, 0);
    actor.gunMesh.rotation.x = actor.pitch * 0.6;
  }
}

export function resetActor(actor, spawn, yaw) {
  actor.pos.set(spawn.x, 0, spawn.z);
  actor.vel.set(0, 0, 0);
  actor.yaw = yaw;
  actor.pitch = 0;
  actor.hp = 100;
  actor.alive = true;
  actor.deathT = 0;
  actor.crouching = false;
  actor.height = STAND_HEIGHT;
  actor.eye = STAND_EYE;
  actor.arsenal = { pistol: createWeaponState('pistol') };
  if (actor.primary) actor.arsenal[actor.primary] = createWeaponState(actor.primary);
  actor.weapon = actor.arsenal[actor.primary || 'pistol'];
  actor.grenades = { frag: 0, smoke: 0, flash: 0 };
  actor.grenadeSel = 'frag';
  if (actor.mesh) {
    actor.mesh.visible = !actor.isPlayer;
    actor.mesh.rotation.set(0, yaw, 0);
  }
}
