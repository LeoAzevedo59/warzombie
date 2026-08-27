import { GAME } from './gameconfig.js';
import { ITEMS } from './items.js';
import type { UpgradeKind, UpgradePrices, WeaponUpgrades } from './protocol.js';

export const UPGRADE_KINDS: UpgradeKind[] = ['damage', 'ammo', 'recoil', 'stamina', 'laser', 'weight'];

export function emptyUpgrades(): WeaponUpgrades {
  return { damage: 0, ammo: 0, recoil: 0, stamina: 0, laser: 0, weight: 0 };
}

/** Preço da sala para o próximo nível dado quantas compras desse tipo já houve na sala. */
export function upgradePriceFor(kind: UpgradeKind, roomPurchases: number): number {
  return Math.round(GAME.upgrades[kind].BASE * Math.pow(GAME.upgrades.PRICE_GROWTH, roomPurchases));
}

export function pricesFor(roomPurchases: Record<UpgradeKind, number>): UpgradePrices {
  return {
    damage: upgradePriceFor('damage', roomPurchases.damage),
    ammo: upgradePriceFor('ammo', roomPurchases.ammo),
    recoil: upgradePriceFor('recoil', roomPurchases.recoil),
    stamina: upgradePriceFor('stamina', roomPurchases.stamina),
    laser: upgradePriceFor('laser', roomPurchases.laser),
    weight: upgradePriceFor('weight', roomPurchases.weight),
  };
}

export function isMaxed(kind: UpgradeKind, level: number): boolean {
  return level >= GAME.upgrades[kind].MAX_LEVEL;
}

export function damageMultiplier(u: WeaponUpgrades): number {
  return 1 + GAME.upgrades.damage.STEP * u.damage;
}

export function magSize(u: WeaponUpgrades): number {
  return GAME.weapon.glock.MAG + GAME.upgrades.ammo.STEP * u.ammo;
}

export function staminaMultiplier(u: WeaponUpgrades): number {
  return 1 + GAME.upgrades.stamina.STEP * u.stamina;
}

/** Preço da bateria na sala dado quantas já foram compradas (sobe a cada compra). */
export function batteryPrice(purchases: number): number {
  return Math.round((ITEMS.battery.buy ?? 0) * Math.pow(GAME.battery.GROWTH, purchases));
}

/** Preço do próximo reforço da torre (null no máximo). */
export function towerUpgradePrice(level: number): number | null {
  const c = GAME.towerUpgrade;
  return level >= c.MAX_LEVEL ? null : Math.round(c.BASE_PRICE * Math.pow(c.GROWTH, level));
}

/** Preço para reparar a torre dado quanto falta de vida. */
export function towerRepairPrice(missingHp: number): number {
  if (missingHp <= 0) return 0;
  return Math.max(GAME.towerRepair.MIN_PRICE, Math.ceil(missingHp * GAME.towerRepair.PRICE_PER_HP));
}

export function towerMaxHp(level: number): number {
  return GAME.hub.TOWER_HP + GAME.towerUpgrade.HP_STEP * level;
}

/** Capacidade de peso com o upgrade. */
export function maxWeight(u: WeaponUpgrades): number {
  return GAME.weight.BASE_CAPACITY + GAME.upgrades.weight.STEP * u.weight;
}

/** Multiplicador de velocidade pelo peso carregado (1 vazio, 1-SLOW_AT_FULL no limite). */
export function weightSpeedMult(carried: number, capacity: number): number {
  const ratio = capacity > 0 ? Math.min(1, carried / capacity) : 0;
  return 1 - GAME.weight.SLOW_AT_FULL * ratio;
}

/** Postura do atirador: parado atira melhor, andando pior, correndo só com o Recoil máximo. */
export type Stance = 'idle' | 'walk' | 'run';

/** Dispersão base (graus) do tiro em torno da mira, sem contar a postura. */
export function spreadDegrees(u: WeaponUpgrades): number {
  const c = GAME.upgrades.recoil;
  return Math.max(0, c.BASE_SPREAD - c.STEP * u.recoil);
}

export function stanceSpreadMult(stance: Stance): number {
  const a = GAME.accuracy;
  return stance === 'run' ? a.RUN_MULT : stance === 'walk' ? a.WALK_MULT : a.IDLE_MULT;
}

/** Dispersão efetiva (graus) do tiro na postura dada. */
export function spreadDegreesFor(u: WeaponUpgrades, stance: Stance): number {
  return spreadDegrees(u) * stanceSpreadMult(stance);
}

/** Atirar correndo exige o último nível do Recoil. */
export function canFireRunning(u: WeaponUpgrades): boolean {
  return isMaxed('recoil', u.recoil);
}

/** Precisão exibida (0-100) na postura dada: 100% quando a dispersão é zero. */
export function accuracyPercent(u: WeaponUpgrades, stance: Stance = 'idle'): number {
  return Math.max(0, Math.round(100 - spreadDegreesFor(u, stance) * 4));
}

/** Preço da próxima Medalha de Ressurreição na sala (sobe a cada compra). */
export function revivePrice(purchases: number): number {
  return Math.round(GAME.lives.REVIVE_BASE_PRICE * Math.pow(GAME.lives.REVIVE_GROWTH, purchases));
}
