import type { GameState } from './GameState';
import type { GameStartMessage } from '@shared/protocol';

/** Aplica o `game_start` (início, entrada tardia ou reinício após derrota) no estado local. */
export function applyGameStart(state: GameState, msg: GameStartMessage): void {
  state.seed = msg.seed;
  state.roomPlayers = msg.players;
  const me = msg.players.find((p) => p.id === state.playerId);
  state.playerPosition = { x: me?.x ?? 0, y: 0, z: me?.z ?? 0 };
  state.hp = me?.hp ?? state.hp;
  state.collectedObjectIds = new Set(msg.removedObjects);
  state.money = msg.money;
  state.inventory = msg.hotbar.map((s) => (s ? { ...s } : null));
  state.equippedSlot = msg.equipped;
  state.wave = msg.wave;
  state.upgrades = { ...msg.upgrades };
  state.magSize = msg.magSize;
  state.ammo = msg.ammo;
  state.upgradePrices = { ...msg.upgradePrices };
  state.batteryPrice = msg.batteryPrice;
  state.spectateZombieId = null;
  state.boarded = msg.evac?.boarded.includes(state.playerId ?? '') ?? false;
  state.evac = msg.evac;
  state.tower = { ...msg.tower };
  state.towerHp = msg.towerHp;
  state.towerMaxHp = msg.towerMaxHp;
  state.towerLevel = msg.towerLevel;
  state.structures = msg.structures.map((s) => ({ ...s }));
  state.drops = msg.drops.map((d) => ({ ...d }));
  state.features = { ...msg.features };
}
