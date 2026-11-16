# DUSTLINE — Tactical Strike

A complete round-based tactical FPS that runs offline in a desktop browser,
single-player against bots. Built for make.fun's best-game-01.

- **Teams:** PHANTOM (attackers, you) vs VANGUARD (defenders) — 5v5 with 9 bots.
- **Map:** Dustline Compound, 64×44 m, 3 lanes, 2 bomb sites (Foundry, Cistern).
- **Rounds:** buy 12 s → live 100 s → first to 5, max 9 rounds.
- **Objective:** plant the charge (3.2 s, 35 s timer) or defuse it (5 s); the
  charge drops when its carrier dies and a friendly bot picks it up.
- **Buy menu (B):** 4 weapons, 3 grenades (frag, smoke, flash), Kevlar, full economy.
- **Bots:** waypoint pathfinding, line-of-sight perception, burst fire, hearing,
  smoke and flash effects.
- **HUD:** health/armour, money, ammo, timer, round score, killfeed, minimap,
  plant/defuse progress, scoreboard, spectate on death.

## Play

```sh
node serve.ts
# open http://localhost:8080
```

No build step, no network request: `game/` is plain static files (three.js 0.187.0
vendored under `game/vendor/`). `main.ts` (Node 22) hands the game in: it copies
`game/` and `screenshots/` to `/output` and writes `/output/dossier.json`.

## Controls

WASD move, mouse aim, click fire, R reload, Shift walk, Ctrl/C crouch, Space jump,
B buy menu, 1–8 buy / switch weapon, G grenade, E plant/defuse, P pause.
