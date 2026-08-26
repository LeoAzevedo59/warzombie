import { GAME } from './gameconfig.js';
import type { UpgradeKind, WeaponUpgrades } from './protocol.js';

export function emptyUpgrades(): WeaponUpgrades {
  return { damage: 0, ammo: 0, recoil: 0 };
}

/** Preço do próximo nível, ou null se já está no máximo. */
export function upgradePrice(kind: UpgradeKind, current: number): number | null {
  const c = GAME.upgrades[kind];
  return current >= c.MAX_LEVEL ? null : c.PRICES[current];
}

export function damageMultiplier(u: WeaponUpgrades): number {
  return 1 + GAME.upgrades.damage.STEP * u.damage;
}

export function magSize(u: WeaponUpgrades): number {
  return GAME.weapon.glock.MAG + GAME.upgrades.ammo.STEP * u.ammo;
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
