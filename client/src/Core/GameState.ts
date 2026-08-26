import { CONFIG } from '@/config';
import type { ItemStack } from '@/Items/Item';

/** Fonte única de verdade dos dados de jogo. Serializável para save/load futuro. */
export class GameState {
  seed: number = CONFIG.world.SEED;

  /** Identidade no servidor (preenchida pelo `welcome` do WebSocket). */
  playerId: string | null = null;
  playerName = '';

  hp: number = CONFIG.player.MAX_HP;
  stamina: number = CONFIG.player.MAX_STAMINA;

  /** Inventário por slots; null = vazio. Os primeiros HOTBAR_SLOTS aparecem na hotbar. */
  inventory: (ItemStack | null)[] = Array.from({ length: CONFIG.inventory.SLOTS }, () => null);

  playerPosition = { x: 0, y: 0, z: 0 };

  /** Índice do slot da hotbar (0..HOTBAR_SLOTS-1) equipado na mão. */
  equippedSlot = 0;

  /** ids de WorldObjects já coletados, para não respawnar ao recarregar o chunk */
  collectedObjectIds = new Set<number>();

  /** Zumbis abatidos na sessão. */
  kills = 0;

  toJSON() {
    return {
      seed: this.seed,
      playerId: this.playerId,
      playerName: this.playerName,
      hp: this.hp,
      stamina: this.stamina,
      inventory: this.inventory,
      playerPosition: this.playerPosition,
      equippedSlot: this.equippedSlot,
      collectedObjectIds: [...this.collectedObjectIds],
      kills: this.kills,
    };
  }
}
