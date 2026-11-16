// Grenades: a thrown projectile with gravity and bounces, then a fuse. Frag hurts in a
// radius (line of sight checked by the caller), smoke lays a cloud that blocks sight,
// flash blinds whoever looks at it. One shared physics path for all three kinds.
import * as THREE from 'three';
import { GRENADES } from './weapons.js';

const GRAVITY = 16;
const R = 0.12;

export function createGrenadeSystem(scene, colliders, hooks) {
  const active = [];
  const geo = new THREE.SphereGeometry(R * 1.6, 8, 6);
  const mats = {
    frag: new THREE.MeshStandardMaterial({ color: 0x2f3338, roughness: 0.5, metalness: 0.6 }),
    smoke: new THREE.MeshStandardMaterial({ color: 0x7a7f72, roughness: 0.8 }),
    flash: new THREE.MeshStandardMaterial({ color: 0xd8d3c0, roughness: 0.4, metalness: 0.3 }),
  };

  function overlaps(x, y, z) {
    const min = new THREE.Vector3(x - R, y - R, z - R);
    const max = new THREE.Vector3(x + R, y + R, z + R);
    const probe = new THREE.Box3(min, max);
    for (const c of colliders) if (probe.intersectsBox(c)) return c;
    return null;
  }

  function throwGrenade(actor, type, dir) {
    const def = GRENADES[type];
    if (actor.grenades[type] <= 0) return false;
    actor.grenades[type] -= 1;
    const mesh = new THREE.Mesh(geo, mats[type]);
    const eye = new THREE.Vector3(
      actor.pos.x,
      actor.pos.y + actor.eye,
      actor.pos.z,
    );
    const vel = dir.clone().multiplyScalar(15);
    vel.y += 4.2;
    mesh.position.copy(eye).addScaledVector(dir, 0.5);
    scene.add(mesh);
    active.push({ type, def, mesh, vel, fuse: def.fuse, owner: actor, bounced: false });
    return true;
  }

  function detonate(g, index) {
    scene.remove(g.mesh);
    active.splice(index, 1);
    if (g.type === 'frag') hooks.onFrag(g.mesh.position, g.def.radius, g.def.damage, g.owner);
    else if (g.type === 'smoke') hooks.onSmoke(g.mesh.position, g.def.radius, g.def.life);
    else hooks.onFlash(g.mesh.position, g.def.radius, g.owner);
  }

  function step(dt) {
    for (let i = active.length - 1; i >= 0; i -= 1) {
      const g = active[i];
      g.fuse -= dt;
      const sub = 4;
      const sdt = dt / sub;
      for (let s = 0; s < sub; s += 1) {
        g.vel.y -= GRAVITY * sdt;
        const p = g.mesh.position;
        const nx = p.x + g.vel.x * sdt;
        if (!overlaps(nx, p.y, p.z)) p.x = nx;
        else { g.vel.x *= -0.45; if (Math.abs(g.vel.x) > 1.5) hooks.onBounce(p); }
        const nz = p.z + g.vel.z * sdt;
        if (!overlaps(p.x, p.y, nz)) p.z = nz;
        else { g.vel.z *= -0.45; if (Math.abs(g.vel.z) > 1.5) hooks.onBounce(p); }
        const ny = p.y + g.vel.y * sdt;
        if (!overlaps(p.x, ny, p.z)) p.y = ny;
        else {
          if (g.vel.y < -1.5) hooks.onBounce(p);
          g.vel.y = Math.abs(g.vel.y) > 1.2 ? -g.vel.y * 0.4 : 0;
          g.vel.x *= 0.72;
          g.vel.z *= 0.72;
          g.bounced = true;
        }
        if (p.y < R) { p.y = R; g.vel.y = Math.abs(g.vel.y) > 1.2 ? -g.vel.y * 0.4 : 0; }
      }
      if (g.fuse <= 0) detonate(g, i);
    }
  }

  function clear() {
    for (const g of active) scene.remove(g.mesh);
    active.length = 0;
  }

  return { throwGrenade, step, clear, active };
}
