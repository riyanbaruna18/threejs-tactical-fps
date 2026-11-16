// The charge: carried by a PHANTOM, planted in a site, defended or defused. One state
// machine, no per-frame allocation: planting and defusing are channels that cancel when
// the actor moves away or dies. The timer after planting is 35 seconds.
import * as THREE from 'three';
import { SITES } from './map.js';

export const PLANT_TIME = 3.2;
export const DEFUSE_TIME = 5;
export const BOMB_TIMER = 35;

export function createBomb(scene) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.2, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.5, metalness: 0.5 }),
  );
  const lamp = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.06, 0.08),
    new THREE.MeshStandardMaterial({ color: 0xf5a623, emissive: 0xf5a623, emissiveIntensity: 2 }),
  );
  lamp.position.set(0.14, 0.12, 0);
  group.add(body, lamp);
  group.visible = false;
  scene.add(group);

  const state = {
    mode: 'carried', // carried | dropped | planting | planted | defusing | exploded | defused
    carrier: null,
    dropPos: new THREE.Vector3(),
    plantPos: new THREE.Vector3(),
    site: null,
    progress: 0,
    timer: 0,
    beepT: 0,
  };

  function siteAt(x, z) {
    for (const [key, s] of Object.entries(SITES)) {
      if (x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ) return key;
    }
    return null;
  }

  function dropAt(actor) {
    state.mode = 'dropped';
    state.carrier = null;
    state.dropPos.set(actor.pos.x, 0.12, actor.pos.z);
    group.position.copy(state.dropPos);
    group.visible = true;
  }

  function pickup(actor) {
    state.mode = 'carried';
    state.carrier = actor;
    group.visible = false;
  }

  function step(dt, hooks) {
    if (state.mode === 'planting') {
      const by = state.carrier;
      if (!by || !by.alive || !siteAt(by.pos.x, by.pos.z)) {
        state.mode = 'carried';
        state.progress = 0;
        return;
      }
      state.progress += dt;
      if (state.progress >= PLANT_TIME) {
        state.mode = 'planted';
        state.site = siteAt(by.pos.x, by.pos.z);
        state.plantPos.set(by.pos.x, 0.12, by.pos.z);
        state.timer = BOMB_TIMER;
        state.beepT = 0;
        group.position.copy(state.plantPos);
        group.visible = true;
        hooks.onPlanted(state.site, state.plantPos);
      }
    } else if (state.mode === 'planted') {
      state.timer -= dt;
      state.beepT -= dt;
      if (state.beepT <= 0) {
        hooks.onBeep(state.timer);
        state.beepT = Math.max(0.35, state.timer / BOMB_TIMER);
      }
      if (state.timer <= 0) {
        state.mode = 'exploded';
        hooks.onExploded(state.plantPos, state.site);
      }
    } else if (state.mode === 'defusing') {
      const by = state.defuser;
      const d = Math.hypot(by.pos.x - state.plantPos.x, by.pos.z - state.plantPos.z);
      if (!by || !by.alive || d > 2.2) {
        state.mode = 'planted';
        state.progress = 0;
        return;
      }
      state.progress += dt;
      if (state.progress >= DEFUSE_TIME) {
        state.mode = 'defused';
        group.visible = false;
        hooks.onDefused(by);
      }
    }
    // Blink the lamp while the charge is live.
    if (state.mode === 'planted' || state.mode === 'defusing') {
      lamp.material.emissiveIntensity = (Math.sin(performance.now() * 0.02) > 0) ? 2.5 : 0.2;
    }
  }

  function tryPlant(actor) {
    if (actor.team !== 'PHANTOM') return false; // only the attackers plant
    if (state.mode !== 'carried' || state.carrier !== actor) return false;
    if (!siteAt(actor.pos.x, actor.pos.z)) return false;
    state.mode = 'planting';
    state.progress = 0;
    return true;
  }

  function tryDefuse(actor) {
    if (actor.team !== 'VANGUARD') return false; // only the defenders defuse
    if (state.mode !== 'planted') return false;
    const d = Math.hypot(actor.pos.x - state.plantPos.x, actor.pos.z - state.plantPos.z);
    if (d > 2.2) return false;
    state.mode = 'defusing';
    state.defuser = actor;
    state.progress = 0;
    return true;
  }

  function reset(carrier) {
    state.mode = 'carried';
    state.carrier = carrier;
    state.site = null;
    state.progress = 0;
    state.timer = 0;
    group.visible = false;
  }

  return { state, siteAt, dropAt, pickup, step, tryPlant, tryDefuse, reset, group };
}
