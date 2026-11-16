// Economy: money is earned per round and spent in the buy menu between rounds.
// Kill $300, plant $300, defuse $300, round win $3,250, round loss $1,900 plus $500
// per consecutive loss (capped at $3,400). A lost round still buys a rifle next round.
import { WEAPONS, GRENADES, ARMOR_PRICE, createWeaponState } from './weapons.js';

export const KILL_REWARD = 300;
export const PLANT_REWARD = 300;
export const DEFUSE_REWARD = 300;
export const WIN_REWARD = 3250;
export const LOSS_REWARD = 1900;
export const LOSS_STREAK_BONUS = 500;
export const LOSS_REWARD_CAP = 3400;
export const START_MONEY = 800;

export function roundPayout(won, lossStreak) {
  if (won) return WIN_REWARD;
  return Math.min(LOSS_REWARD_CAP, LOSS_REWARD + LOSS_STREAK_BONUS * Math.min(3, lossStreak));
}

// What a bot buys with its money: best rifle it can afford, armour if it fits, and a
// grenade when it can. Bots never buy the sniper; the player may.
export function botBuyPlan(bot, rng) {
  const money = bot.money;
  const plan = { primary: null, armor: false, grenades: [] };
  if (money >= WEAPONS.rifle.price) plan.primary = 'rifle';
  else if (money >= WEAPONS.shotgun.price && rng.chance(0.25)) plan.primary = 'shotgun';
  else if (money >= WEAPONS.smg.price) plan.primary = 'smg';
  let left = money - (plan.primary ? WEAPONS[plan.primary].price : 0);
  if (left >= ARMOR_PRICE && rng.chance(0.8)) {
    plan.armor = true;
    left -= ARMOR_PRICE;
  }
  if (left >= GRENADES.frag.price && rng.chance(0.5)) {
    plan.grenades.push('frag');
    left -= GRENADES.frag.price;
  } else if (left >= GRENADES.smoke.price && rng.chance(0.4)) {
    plan.grenades.push('smoke');
    left -= GRENADES.smoke.price;
  }
  return plan;
}

export function applyBuyPlan(actor, plan) {
  let cost = 0;
  if (plan.primary) {
    actor.primary = plan.primary;
    actor.arsenal[plan.primary] = createWeaponState(plan.primary);
    actor.weapon = actor.arsenal[plan.primary];
    cost += WEAPONS[plan.primary].price;
  }
  if (plan.armor) {
    actor.armor = 50;
    cost += ARMOR_PRICE;
  }
  for (const g of plan.grenades || []) {
    if (actor.grenades[g] < GRENADES[g].max) {
      actor.grenades[g] += 1;
      cost += GRENADES[g].price;
    }
  }
  actor.money = Math.max(0, actor.money - cost);
  return cost;
}
