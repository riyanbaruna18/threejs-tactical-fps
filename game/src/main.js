// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's
// rate. The camera follows the player's eyes (or a teammate when spectating), the
// viewmodel gun bobs and kicks, and ?shot=start|play|buy|end&seed=N stages a
// deterministic frame for a capture, renders it twice, then freezes and sets
// window.__shotReady.
import * as THREE from 'three';
import { createGame } from './sim.js';
import { createWeaponState } from './weapons.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '7', 10) || 7;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x232c3d);
scene.fog = new THREE.Fog(0x232c3d, 30, 95);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 220);
scene.add(camera);

const game = createGame(scene, camera, renderer.domElement, seed);
const player = game.player;
const input = game.input;

// Viewmodel: a low-poly rifle held in front of the camera. It bobs with the stride,
// kicks on every shot and dips while reloading.
const viewmodel = new THREE.Group();
{
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.55, metalness: 0.5, emissive: 0x0c0d0f });
  const accent = new THREE.MeshStandardMaterial({ color: 0xf5a623, roughness: 0.5, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.5), dark);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.34), dark);
  barrel.position.set(0, 0.03, -0.4);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.06), accent);
  sight.position.set(0, 0.085, -0.1);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.14, 0.08), dark);
  grip.position.set(0, -0.11, 0.12);
  grip.rotation.x = 0.35;
  viewmodel.add(body, barrel, sight, grip);
  viewmodel.position.set(0.26, -0.24, -0.5);
  camera.add(viewmodel);
}

let lastMag = player.weapon.mag;
let kick = 0;
let bobPhase = 0;
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();
const _shake = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();

function syncCamera(dt) {
  const aiming = input.state.aiming && player.weapon.def.zoom > 1;
  const targetFov = aiming ? 74 / player.weapon.def.zoom : 74;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 14);
  camera.updateProjectionMatrix();

  if (game.phase === 'menu' || game.phase === 'matchEnd') {
    // Slow pan over the compound for the menu backdrop.
    viewmodel.visible = false;
    const t = game.time * 0.05;
    camera.position.set(Math.sin(t) * 3, 3.4, 20.5);
    camera.rotation.set(-0.06, Math.sin(t * 0.7) * 0.12, 0, 'YXZ');
    return;
  }
  if (player.alive) {
    const speed = Math.hypot(player.vel.x, player.vel.z);
    if (player.onGround && speed > 0.5) bobPhase += dt * speed * 1.6;
    const bob = Math.sin(bobPhase * 2) * 0.022 * Math.min(1, speed / 5);
    game.effects.shakeOffset(_shake);
    camera.position.set(
      player.pos.x + _shake.x,
      player.pos.y + player.eye + bob + _shake.y,
      player.pos.z + _shake.z,
    );
    camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
    // Viewmodel life: kick, bob and reload dip.
    if (player.weapon.mag < lastMag) kick = 1;
    lastMag = player.weapon.mag;
    kick = Math.max(0, kick - dt * 7);
    const reloading = player.weapon.reloading > 0;
    viewmodel.visible = !(aiming && player.weapon.def.id === 'sniper');
    viewmodel.position.set(
      0.26 + Math.sin(bobPhase) * 0.006,
      -0.24 + Math.abs(Math.cos(bobPhase)) * 0.008 - (reloading ? 0.12 : 0) - (aiming ? 0.05 : 0),
      -0.5 + kick * 0.07 + (aiming ? 0.12 : 0),
    );
    viewmodel.rotation.x = kick * 0.09;
    game.hud.setScope(aiming && player.weapon.def.id === 'sniper');
  } else {
    viewmodel.visible = false;
    game.hud.setScope(false);
    const target = game.spectateTarget();
    if (target) {
      const back = 2.6;
      const bx = target.pos.x + Math.sin(target.yaw) * back;
      const bz = target.pos.z + Math.cos(target.yaw) * back;
      camera.position.set(bx, target.pos.y + 2.1, bz);
      _lookTarget.set(
        target.pos.x - Math.sin(target.yaw) * 4,
        target.pos.y + 1.3 + Math.sin(target.pitch) * 4,
        target.pos.z - Math.cos(target.yaw) * 4,
      );
      camera.lookAt(_lookTarget);
    }
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    if (player.alive && input.state.locked) {
      player.yaw -= look.x * 0.0022;
      player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - look.y * 0.0022));
    }
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      game.step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera(dt);
    game.effects.step(dt);
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) game.step(FIXED_STEP);
}

function aimPlayerAt(x, y, z) {
  const dx = x - player.pos.x;
  const dy = y - (player.pos.y + player.eye);
  const dz = z - player.pos.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  player.yaw = Math.atan2(-dx, -dz);
  player.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera(1 / 60);
    game.effects.step(1 / 60);
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  game.preview();
  if (name === 'start') {
    player.pos.set(0, 0, 20.2);
    player.yaw = 0;
    player.pitch = -0.02;
    game.hud.showOverlay('menu');
    settle(30);
  } else if (name === 'buy') {
    game.startMatch();
    settle(40);
    // Face north into the map; stage two teammates ahead so the buy phase reads
    // as a team getting ready, not an empty room.
    player.pos.set(0, 0, 19);
    player.yaw = 0;
    player.pitch = 0;
    const mates = game.actors.filter((a) => a.team === 'PHANTOM' && !a.isPlayer).slice(0, 2);
    if (mates[0]) { mates[0].pos.set(-4, 0, 13); mates[0].yaw = 0; }
    if (mates[1]) { mates[1].pos.set(4, 0, 13.5); mates[1].yaw = 0; }
    settle(2);
  } else if (name === 'play') {
    game.startMatch();
    game.phase = 'live';
    game.timer = 85;
    game.buyOpen = false;
    game.lockGraceT = 9999; // scripted shot: no pointer lock, never show the pause menu
    game.hud.hideOverlays();
    game.hud.setHint('Plant the charge at A or B — or eliminate VANGUARD');
    player.pos.set(0, 0, 8);
    player.yaw = 0;
    player.pitch = 0;
    player.armor = 50;
    player.primary = 'rifle';
    player.arsenal.rifle = createWeaponState('rifle');
    player.weapon = player.arsenal.rifle;
    settle(90); // bots walk their routes for 1.5 s
    // Put one clean shot into the first enemy actually visible from here.
    const eye = new THREE.Vector3(player.pos.x, player.pos.y + player.eye, player.pos.z);
    const chest = new THREE.Vector3();
    const visible = game.actors.filter((a) => {
      if (!a.alive || a.team !== 'VANGUARD' || a === player) return false;
      chest.set(a.pos.x, a.pos.y + 1.2, a.pos.z);
      return game.hasLOS(eye, chest);
    });
    const enemy = visible[0] || game.actors.find((a) => a.alive && a.team === 'VANGUARD');
    if (enemy) {
      aimPlayerAt(enemy.pos.x, enemy.pos.y + 1.2, enemy.pos.z);
      game.fireHitscan(player, 0.001);
      settle(6);
    }
  } else if (name === 'end') {
    game.startMatch();
    game.score.PHANTOM = 2;
    game.score.VANGUARD = 1;
    game.round = 3;
    game.phase = 'live';
    game.timer = 60;
    game.buyOpen = false;
    game.hud.hideOverlays();
    game.debugKillAll('VANGUARD');
    // The kills above end the round through onKill; settle so the banner lands.
    settle(30);
    player.pos.set(14, 0, 4);
    player.yaw = -0.5;
    player.pitch = -0.04;
  }
  game.refreshHud();
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

game.preview();
// Debug/testing handle: lets a headless run drive the game (startMatch, step, state)
// without pointer lock. Harmless in normal play.
window.__game = game;
if (shot) runShot(shot);
else requestAnimationFrame(frame);
