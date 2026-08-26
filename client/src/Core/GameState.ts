import { CONFIG } from '@/config';
import { GAME } from '@shared/gameconfig';
import type { ItemStack } from '@/Items/Item';
import type { PlayerSnapshot, WaveState } from '@shared/protocol';

/** Espelho local do estado de jogo. O servidor é a fonte da verdade para hotbar, HP, dinheiro e munição. */
export class GameState {
  seed: number = CONFIG.world.SEED;

  /** Identidade no servidor (preenchida pelo `welcome` do WebSocket). */
  playerId: string | null = null;
  playerName = '';
  /** servidor aceita cheats (painel ⚙) */
  devCheats = false;

  /** Sala atual (definida pelo lobby) e quem já estava no mundo quando a partida começou. */
  roomId: string | null = null;
  isOwner = false;
  roomPlayers: PlayerSnapshot[] = [];

  hp: number = CONFIG.player.MAX_HP;
  stamina: number = CONFIG.player.MAX_STAMINA;

  /** Hotbar (5 slots); null = vazio. Vem do servidor. */
  inventory: (ItemStack | null)[] = Array.from({ length: CONFIG.inventory.SLOTS }, () => null);

  playerPosition = { x: 0, y: 0, z: 0 };

  /** Índice do slot da hotbar (0..HOTBAR_SLOTS-1) equipado na mão. */
  equippedSlot = 0;

  /** ids de WorldObjects já coletados/quebrados na sala (não instanciar ao carregar o chunk) */
  collectedObjectIds = new Set<number>();

  /** Dinheiro compartilhado da sala. */
  money = 0;
  ammo: number = GAME.weapon.glock.MAG;
  reloading = false;

  /** Zumbis abatidos na sessão. */
  kills = 0;

  /** Estado das waves da sala (vem do servidor). */
  wave: WaveState = { phase: 'idle', wave: 0, total: 5, alive: 0, nextIn: null };

  toJSON() {
    return {
      seed: this.seed,
      playerId: this.playerId,
      playerName: this.playerName,
      roomId: this.roomId,
      hp: this.hp,
      stamina: this.stamina,
      inventory: this.inventory,
      playerPosition: this.playerPosition,
      equippedSlot: this.equippedSlot,
      collectedObjectIds: [...this.collectedObjectIds],
      money: this.money,
      ammo: this.ammo,
      kills: this.kills,
    };
  }
}
