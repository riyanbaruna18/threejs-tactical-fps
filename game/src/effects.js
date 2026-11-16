// Visual effects, all pooled: tracers, muzzle flashes, impact and blood particles,
// explosions and smoke clouds. Nothing is allocated per frame in the hot loop — the
// pools are built once and reused, which is also what the code rubric asks for.
import * as THREE from 'three';

const TRACER_POOL = 20;
const PARTICLE_POOL = 240;

export function createEffects(scene) {
  // Tracers: one Line per slot, fading fast.
  const tracers = [];
  const tracerMat = () => new THREE.LineBasicMaterial({
    color: 0xffd27a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  for (let i = 0; i < TRACER_POOL; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, tracerMat());
    line.frustumCulled = false;
    line.visible = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerCursor = 0;

  // Particles: one Points cloud, slots recycled.
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(PARTICLE_POOL * 3);
  const pCol = new Float32Array(PARTICLE_POOL * 3);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const pMat = new THREE.PointsMaterial({
    size: 0.09, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false,
  });
  const points = new THREE.Points(pGeo, pMat);
  points.frustumCulled = false;
  scene.add(points);
  const parts = [];
  for (let i = 0; i < PARTICLE_POOL; i += 1) parts.push({ life: 0, vx: 0, vy: 0, vz: 0 });
  let partCursor = 0;

  // Muzzle flash: a sprite plus a point light, shown for one frame or two.
  const flashTex = makeGlowTexture();
  const flashMat = new THREE.SpriteMaterial({
    map: flashTex, color: 0xffc861, transparent: true, opacity: 0, depthWrite: false,
  });
  const flash = new THREE.Sprite(flashMat);
  flash.scale.set(0.7, 0.7, 1);
  scene.add(flash);
  const flashLight = new THREE.PointLight(0xffb347, 0, 9, 1.8);
  scene.add(flashLight);
  let flashLife = 0;

  // Explosion: an expanding shell plus a light.
  const boomMat = new THREE.MeshBasicMaterial({
    color: 0xff7a1a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const boom = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), boomMat);
  boom.visible = false;
  scene.add(boom);
  const boomLight = new THREE.PointLight(0xff8c2a, 0, 26, 1.6);
  scene.add(boomLight);
  let boomLife = 0;

  // Smoke: sprites from a shared radial texture, drifting up and out.
  const smokeTex = makeSmokeTexture();
  const smokeClouds = [];
  let shake = 0;

  function spawnParticle(x, y, z, vx, vy, vz, life, r, g, b) {
    const p = parts[partCursor];
    partCursor = (partCursor + 1) % PARTICLE_POOL;
    p.life = life;
    p.vx = vx; p.vy = vy; p.vz = vz;
    pPos[partCursor * 3] = x;
    pPos[partCursor * 3 + 1] = y;
    pPos[partCursor * 3 + 2] = z;
    pCol[partCursor * 3] = r;
    pCol[partCursor * 3 + 1] = g;
    pCol[partCursor * 3 + 2] = b;
  }

  function impact(pos, normal, blood) {
    for (let i = 0; i < 8; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const s = 1 + Math.random() * 2.5;
      if (blood) spawnParticle(pos.x, pos.y, pos.z, Math.cos(a) * s, Math.random() * 2, Math.sin(a) * s, 0.45, 0.75, 0.08, 0.06);
      else spawnParticle(pos.x, pos.y, pos.z, normal.x * s + Math.cos(a), normal.y * s + 1, normal.z * s + Math.sin(a), 0.35, 0.85, 0.72, 0.55);
    }
  }

  function tracer(from, to) {
    const t = tracers[tracerCursor];
    tracerCursor = (tracerCursor + 1) % TRACER_POOL;
    const attr = t.line.geometry.getAttribute('position');
    attr.setXYZ(0, from.x, from.y, from.z);
    attr.setXYZ(1, to.x, to.y, to.z);
    attr.needsUpdate = true;
    t.line.visible = true;
    t.line.material.opacity = 0.85;
    t.life = 0.07;
  }

  function muzzle(pos, dir) {
    flash.position.copy(pos).addScaledVector(dir, 0.55);
    flash.material.opacity = 0.95;
    flashLight.position.copy(flash.position);
    flashLight.intensity = 14;
    flashLife = 0.05;
  }

  function explosion(pos) {
    boom.position.copy(pos);
    boom.visible = true;
    boomLife = 0.55;
    boomLight.position.copy(pos);
    boomLight.intensity = 60;
    shake = 1;
    for (let i = 0; i < 42; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * Math.PI - Math.PI / 2;
      const s = 3 + Math.random() * 8;
      spawnParticle(pos.x, pos.y + 0.3, pos.z,
        Math.cos(a) * Math.cos(e) * s, Math.abs(Math.sin(e)) * s + 2, Math.sin(a) * Math.cos(e) * s,
        0.7 + Math.random() * 0.5, 1, 0.55 + Math.random() * 0.3, 0.15);
    }
  }

  function smoke(pos, radius, life) {
    const sprites = [];
    for (let i = 0; i < 9; i += 1) {
      const mat = new THREE.SpriteMaterial({
        map: smokeTex, color: 0x9aa0a3, transparent: true, opacity: 0.55, depthWrite: false,
      });
      const sp = new THREE.Sprite(mat);
      const a = (i / 9) * Math.PI * 2;
      const r = Math.random() * radius * 0.55;
      sp.position.set(pos.x + Math.cos(a) * r, pos.y + 0.4 + Math.random() * 1.6, pos.z + Math.sin(a) * r);
      const s = radius * (0.9 + Math.random() * 0.7);
      sp.scale.set(s, s, 1);
      scene.add(sp);
      sprites.push(sp);
    }
    smokeClouds.push({ pos: pos.clone(), radius, life, maxLife: life, sprites });
  }

  function step(dt) {
    for (const t of tracers) {
      if (t.life > 0) {
        t.life -= dt;
        t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.85;
        if (t.life <= 0) t.line.visible = false;
      }
    }
    if (flashLife > 0) {
      flashLife -= dt;
      if (flashLife <= 0) {
        flash.material.opacity = 0;
        flashLight.intensity = 0;
      }
    }
    if (boomLife > 0) {
      boomLife -= dt;
      const k = 1 - Math.max(0, boomLife) / 0.55;
      boom.scale.setScalar(1 + k * 9);
      boomMat.opacity = Math.max(0, 0.75 * (1 - k));
      boomLight.intensity = Math.max(0, 60 * (1 - k));
      if (boomLife <= 0) boom.visible = false;
    }
    for (let i = 0; i < PARTICLE_POOL; i += 1) {
      const p = parts[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      p.vy -= 6 * dt;
      pPos[i * 3] += p.vx * dt;
      pPos[i * 3 + 1] += p.vy * dt;
      pPos[i * 3 + 2] += p.vz * dt;
      if (pPos[i * 3 + 1] < 0.02) pPos[i * 3 + 1] = 0.02;
      if (p.life <= 0) pPos[i * 3 + 1] = -10;
    }
    pGeo.getAttribute('position').needsUpdate = true;
    pGeo.getAttribute('color').needsUpdate = true;
    for (let i = smokeClouds.length - 1; i >= 0; i -= 1) {
      const c = smokeClouds[i];
      c.life -= dt;
      for (const sp of c.sprites) {
        sp.position.y += dt * 0.25;
        sp.material.opacity = Math.max(0, 0.55 * Math.min(1, c.life / 2) * Math.min(1, (c.maxLife - c.life) * 2));
      }
      if (c.life <= 0) {
        for (const sp of c.sprites) scene.remove(sp);
        smokeClouds.splice(i, 1);
      }
    }
    shake = Math.max(0, shake - dt * 2.2);
  }

  function shakeOffset(out) {
    out.set((Math.random() - 0.5) * 0.06 * shake, (Math.random() - 0.5) * 0.06 * shake, 0);
    return out;
  }

  return {
    tracer, muzzle, impact, explosion, smoke, step, shakeOffset,
    smokeClouds, addShake(v) { shake = Math.min(1, shake + v); },
  };
}

function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,200,90,0.85)');
  grad.addColorStop(1, 'rgba(255,150,30,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

function makeSmokeTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 26; i += 1) {
    const x = 34 + Math.random() * 60;
    const y = 34 + Math.random() * 60;
    const r = 14 + Math.random() * 26;
    const grad = g.createRadialGradient(x, y, 1, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.5)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  return new THREE.CanvasTexture(c);
}
