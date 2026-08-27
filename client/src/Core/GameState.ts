import { CONFIG } from '@/config';
import { GAME } from '@shared/gameconfig';
import type { ItemStack } from '@/Items/Item';
import type { CharacterId, DroppedItem, EvacState, PlayerSnapshot, RoomFeatures, StructureSnapshot, UpgradePrices, WaveState, WeaponUpgrades } from '@shared/protocol';
import { maxWeight, staminaMultiplier, weightSpeedMult } from '@shared/upgrades';
import { ITEMS, totalWeight } from '@shared/items';

/** Espelho local do estado de jogo. O servidor é a fonte da verdade para hotbar, HP, dinheiro e munição. */
export class GameState {
  seed: number = CONFIG.world.SEED;

  /** Identidade no servidor (preenchida pelo `welcome` do WebSocket). */
  playerId: string | null = null;
  playerName = '';
  /** personagem escolhido (lobby); vem do `welcome` e é persistido no servidor */
  character: CharacterId = 'shaun';
  /** fases zeradas (🏆 ao lado do nome) */
  trophies = 0;
  /** embarcou no helicóptero de resgate (fora do mundo até a cutscene) */
  boarded = false;
  /** resgate em andamento ao entrar (helicóptero já chamado) */
  evac: EvacState | null = null;
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
  magSize: number = GAME.weapon.glock.MAG;
  reloading = false;
  /** Upgrades da Glock (por partida). */
  upgrades: WeaponUpgrades = { damage: 0, ammo: 0, recoil: 0, stamina: 0, laser: 0, weight: 0 };
  /** preços atuais da sala (sobem a cada compra de qualquer jogador) */
  upgradePrices: UpgradePrices = { damage: 40, ammo: 30, recoil: 40, stamina: 35, laser: 60, weight: 35 };
  /** preço atual da bateria na sala (sobe a cada compra) */
  batteryPrice: number = ITEMS.battery.buy ?? 150;
  /** virou zumbi (fogo amigo): id do zumbi que a câmera segue; null = controla o personagem */
  spectateZombieId: number | null = null;
  /** mortes nesta partida (vidas restantes = GAME.lives.MAX_DEATHS - deaths) */
  deaths = 0;
  /** jogadores sem vidas esperando uma Medalha de Ressurreição */
  eliminated = new Set<string>();
  /** preço atual da Medalha de Ressurreição na sala */
  revivePrice: number = GAME.lives.REVIVE_BASE_PRICE;

  get livesLeft(): number {
    return Math.max(0, GAME.lives.MAX_DEATHS - this.deaths);
  }

  get carriedWeight(): number {
    return totalWeight(this.inventory);
  }

  get maxWeight(): number {
    return maxWeight(this.upgrades);
  }

  /** Velocidade × peso carregado (1 vazio … 0.5 no limite). */
  get weightSpeedMult(): number {
    return weightSpeedMult(this.carriedWeight, this.maxWeight);
  }

  /** Vigor máximo com o upgrade de corrida. */
  get maxStamina(): number {
    return CONFIG.player.MAX_STAMINA * staminaMultiplier(this.upgrades);
  }

  /** Zumbis abatidos na sessão. */
  kills = 0;

  /** Posição da torre nesta sala (vem do servidor). */
  tower = { x: 4, z: 4 };
  towerHp = 1500;
  towerMaxHp = 1500;
  towerLevel = 0;
  /** paredes colocadas na sala (snapshot inicial; depois mantidas pelo World) */
  structures: StructureSnapshot[] = [];
  drops: DroppedItem[] = [];
  /** recursos da sala (minimapa começa desligado) */
  features: RoomFeatures = { minimap: false };

  /** Estado das waves da sala (vem do servidor). */
  wave: WaveState = { phase: 'idle', wave: 0, total: 5, bossNext: false, alive: 0, nextIn: null, timeLeft: null };

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
