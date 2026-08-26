import { GAME } from './gameconfig.js';
import type { UpgradeKind, UpgradePrices, WeaponUpgrades } from './protocol.js';

export const UPGRADE_KINDS: UpgradeKind[] = ['damage', 'ammo', 'recoil', 'stamina'];

export function emptyUpgrades(): WeaponUpgrades {
  return { damage: 0, ammo: 0, recoil: 0, stamina: 0 };
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

/** Dispersão máxima (graus) do tiro em torno da mira. */
export function spreadDegrees(u: WeaponUpgrades): number {
  const c = GAME.upgrades.recoil;
  return Math.max(0, c.BASE_SPREAD - c.STEP * u.recoil);
}

/** Precisão exibida (0-100): 100% quando a dispersão é zero. */
export function accuracyPercent(u: WeaponUpgrades): number {
  return Math.round(100 - spreadDegrees(u) * 4);
}
