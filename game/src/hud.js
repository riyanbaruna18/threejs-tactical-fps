// HUD: every DOM readout — health, armour, money, ammo, timer, score, killfeed, the
// buy menu, the minimap and all overlays. The sim writes state here; the HUD never
// writes game state back except through the callbacks (play, buy, resume, restart).
import { WEAPONS, GRENADES, ARMOR_PRICE } from './weapons.js';
import { TEAM } from './palette.js';

function el(id) {
  return document.getElementById(id);
}

export function createHud(callbacks) {
  const minimap = el('minimap');
  const mctx = minimap.getContext('2d');

  function setHealth(hp, armor) {
    el('hp-num').textContent = Math.ceil(hp);
    el('hp-fill').style.width = `${Math.max(0, hp)}%`;
    el('hp-fill').classList.toggle('low', hp <= 30);
    el('armor-fill').style.width = `${Math.max(0, armor)}%`;
    el('armor-row').style.visibility = armor > 0 ? 'visible' : 'hidden';
  }

  function setMoney(m) {
    el('money').textContent = `$${m}`;
    const buyMoney = el('buy-money');
    if (buyMoney) buyMoney.textContent = `$${m}`;
  }

  function setAmmo(mag, reserve, name, reloading) {
    el('ammo-mag').textContent = reloading ? '--' : mag;
    el('ammo-reserve').textContent = `/ ${reserve}`;
    el('weapon-name').textContent = name;
    el('ammo').classList.toggle('empty', mag === 0 && !reloading);
    el('ammo').classList.toggle('reloading', !!reloading);
  }

  function setGrenades(g, sel) {
    const wrap = el('grenade-slots');
    wrap.innerHTML = '';
    for (const [id, def] of Object.entries(GRENADES)) {
      const s = document.createElement('span');
      s.className = `grenade${sel === id ? ' sel' : ''}${g[id] === 0 ? ' none' : ''}`;
      s.textContent = `${def.name.split(' ')[0]} ${g[id]}`;
      wrap.appendChild(s);
    }
  }

  function setTimer(seconds, phase) {
    if (phase === 'menu') {
      el('timer').textContent = '--:--';
      el('timer').classList.remove('urgent');
      el('phase-label').textContent = '';
      return;
    }
    const t = Math.max(0, Math.ceil(seconds));
    el('timer').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    el('timer').classList.toggle('urgent', seconds <= 10 && phase === 'live');
    el('phase-label').textContent =
      phase === 'buy' ? 'BUY PHASE' : phase === 'live' ? 'ROUND LIVE' : phase === 'menu' ? '' : 'ROUND OVER';
  }

  function setScore(p, v, round) {
    el('score-p').textContent = p;
    el('score-v').textContent = v;
    el('round-label').textContent = `ROUND ${round} / 9`;
  }

  function setBombStatus(text, urgent) {
    const b = el('bomb-status');
    b.textContent = text;
    b.classList.toggle('urgent', !!urgent);
  }

  function killfeed(killer, victim, headshot, weaponName) {
    const feed = el('killfeed');
    const row = document.createElement('div');
    row.className = 'kf-row';
    const kc = TEAM[killer.team] ? TEAM[killer.team].css : '#fff';
    const vc = TEAM[victim.team] ? TEAM[victim.team].css : '#fff';
    row.innerHTML = `<b style="color:${kc}">${escapeHtml(killer.name)}</b> <span class="kf-w">${escapeHtml(weaponName)}${headshot ? ' ☠' : ''}</span> <b style="color:${vc}">${escapeHtml(victim.name)}</b>`;
    feed.prepend(row);
    while (feed.children.length > 5) feed.removeChild(feed.lastChild);
    setTimeout(() => row.remove(), 6000);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  let bannerTimer = 0;
  function banner(title, sub, color) {
    const b = el('banner');
    el('banner-title').textContent = title;
    el('banner-title').style.color = color || '#efe9dc';
    el('banner-sub').textContent = sub || '';
    b.hidden = false;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { b.hidden = true; }, 3200);
  }

  function hideBanner() {
    el('banner').hidden = true;
  }

  function setHint(text) {
    el('hint').textContent = text || '';
  }

  function setProgress(label, frac) {
    const p = el('progress');
    if (frac == null) {
      p.hidden = true;
      return;
    }
    p.hidden = false;
    el('progress-label').textContent = label;
    el('progress-fill').style.width = `${Math.round(frac * 100)}%`;
  }

  function hitmarker(kill) {
    const h = el('hitmarker');
    h.classList.add('on');
    h.classList.toggle('kill', !!kill);
    setTimeout(() => h.classList.remove('on', 'kill'), 110);
  }

  function damageFlash() {
    const v = el('dmg-vignette');
    v.classList.remove('on');
    void v.offsetWidth;
    v.classList.add('on');
  }

  function flashOverlay(strength) {
    const f = el('flash-overlay');
    f.style.opacity = String(Math.min(1, strength));
    setTimeout(() => { f.style.opacity = '0'; }, 60);
    f.style.transition = 'opacity 900ms ease-out';
    setTimeout(() => { f.style.transition = 'none'; }, 1000);
  }

  function setScope(on) {
    el('scope-overlay').hidden = !on;
    el('crosshair').style.visibility = on ? 'hidden' : 'visible';
  }

  function setCrosshairGap(px) {
    el('crosshair').style.setProperty('--gap', `${px}px`);
  }

  function spectate(name) {
    el('spectate-label').textContent = name ? `SPECTATING — ${name}` : '';
    el('spectate-label').hidden = !name;
  }

  // --- Overlays ---
  function showOverlay(which) {
    for (const id of ['menu', 'pause-menu', 'round-end', 'match-end']) el(id).hidden = id !== which;
    el('buy-menu').hidden = true;
  }
  function hideOverlays() {
    for (const id of ['menu', 'pause-menu', 'round-end', 'match-end', 'buy-menu']) el(id).hidden = true;
  }

  function showRoundEnd(title, sub, rows, matchOver) {
    el('round-end-title').textContent = title;
    el('round-end-sub').textContent = sub;
    const body = el('scoreboard-body');
    body.innerHTML = '';
    for (const r of rows) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td style="color:${TEAM[r.team].css}">${escapeHtml(r.name)}</td><td>${r.kills}</td><td>${r.deaths}</td><td>$${r.money}</td>`;
      body.appendChild(tr);
    }
    el('round-end').hidden = false;
    el('round-end-next').textContent = matchOver ? 'Match over — see the final score' : 'Next round starting…';
  }

  function showMatchEnd(title, sub) {
    el('match-end-title').textContent = title;
    el('match-end-sub').textContent = sub;
    el('match-end').hidden = false;
  }

  // --- Buy menu ---
  function buildBuyMenu(money, owned) {
    const grid = el('buy-grid');
    grid.innerHTML = '';
    const items = [];
    for (const w of Object.values(WEAPONS)) {
      if (w.id === 'pistol') continue;
      items.push({ id: w.id, name: w.name, price: w.price, desc: `${w.damage} dmg · ${w.mag} rnd mag`, owned: owned.primary === w.id });
    }
    for (const g of Object.values(GRENADES)) {
      items.push({ id: `grenade:${g.id}`, name: g.name, price: g.price, desc: `Grenade · max ${g.max}`, owned: (owned.grenades[g.id] || 0) >= g.max });
    }
    items.push({ id: 'armor', name: 'Kevlar Vest', price: ARMOR_PRICE, desc: '50 armour · soaks half the damage', owned: owned.armor >= 50 });
    items.forEach((item, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'buy-item';
      b.disabled = money < item.price || item.owned;
      b.innerHTML = `<b>${escapeHtml(item.name)}</b><span>${escapeHtml(item.desc)}</span><i>$${item.price}</i><kbd>${i + 1}</kbd>`;
      b.addEventListener('click', () => callbacks.onBuy(item.id));
      grid.appendChild(b);
    });
    setMoney(money);
  }

  function showBuy(show) {
    el('buy-menu').hidden = !show;
  }

  // --- Minimap: top-down, walls in sand, sites amber, teammates green/teal,
  // the player as a white wedge, the charge orange, seen enemies red (fading). ---
  function drawMinimap(world) {
    const W = minimap.width;
    const H = minimap.height;
    const sx = (x) => ((x + 33) / 66) * W;
    const sz = (z) => ((z + 23) / 46) * H;
    mctx.clearRect(0, 0, W, H);
    mctx.fillStyle = 'rgba(20,22,26,0.82)';
    mctx.fillRect(0, 0, W, H);
    mctx.fillStyle = '#6e675e';
    for (const r of world.walls2d) {
      mctx.fillRect(sx(r.x - r.w / 2), sz(r.z - r.d / 2), Math.max(1, (r.w / 66) * W), Math.max(1, (r.d / 46) * H));
    }
    mctx.font = 'bold 13px system-ui';
    mctx.textAlign = 'center';
    for (const [key, s] of Object.entries(world.sites)) {
      mctx.fillStyle = '#f5a623';
      mctx.fillRect(sx(s.minX), sz(s.minZ), sx(s.maxX) - sx(s.minX), sz(s.maxZ) - sz(s.minZ));
      mctx.fillStyle = '#14161a';
      mctx.fillText(key, sx(s.cx), sz(s.cz) + 4);
    }
    const bomb = world.bomb.state;
    if (bomb.mode === 'dropped' || bomb.mode === 'planted' || bomb.mode === 'planting') {
      const bp = bomb.mode === 'dropped' ? bomb.dropPos : bomb.plantPos;
      mctx.fillStyle = '#ff6b35';
      mctx.beginPath();
      mctx.arc(sx(bp.x), sz(bp.z), 4, 0, Math.PI * 2);
      mctx.fill();
    }
    for (const a of world.actors) {
      if (!a.alive) continue;
      const x = sx(a.pos.x);
      const y = sz(a.pos.z);
      if (a.isPlayer) {
        mctx.fillStyle = '#ffffff';
        mctx.beginPath();
        mctx.moveTo(x, y - 6);
        mctx.lineTo(x + 4.5, y + 4);
        mctx.lineTo(x - 4.5, y + 4);
        mctx.closePath();
        mctx.fill();
      } else {
        mctx.fillStyle = a.team === 'PHANTOM' ? '#ff6b35' : '#2ec4b6';
        mctx.beginPath();
        mctx.arc(x, y, 3.2, 0, Math.PI * 2);
        mctx.fill();
      }
    }
    for (const e of world.seenEnemies || []) {
      const age = (world.time - e.t) / 2.5;
      if (age > 1) continue;
      mctx.fillStyle = `rgba(255,60,50,${1 - age})`;
      mctx.beginPath();
      mctx.arc(sx(e.x), sz(e.z), 3.5, 0, Math.PI * 2);
      mctx.fill();
    }
    mctx.strokeStyle = 'rgba(239,233,220,0.5)';
    mctx.lineWidth = 1;
    mctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  el('play-btn').addEventListener('click', () => callbacks.onPlay());
  el('resume-btn').addEventListener('click', () => callbacks.onResume());
  el('restart-btn').addEventListener('click', () => callbacks.onRestart());
  el('match-restart-btn').addEventListener('click', () => callbacks.onRestart());
  el('buy-close').addEventListener('click', () => callbacks.onCloseBuy());

  return {
    setHealth, setMoney, setAmmo, setGrenades, setTimer, setScore, setBombStatus,
    killfeed, banner, hideBanner, setHint, setProgress, hitmarker, damageFlash,
    flashOverlay, setScope, setCrosshairGap, spectate, showOverlay, hideOverlays,
    showRoundEnd, showMatchEnd, buildBuyMenu, showBuy, drawMinimap,
  };
}
