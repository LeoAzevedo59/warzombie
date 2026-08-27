import type { ItemId, ItemStack } from '@/Items/Item';
import type { SfxName } from '@/Assets/SoundAssets';
import type { DroppedItem, PlayerSummary, ProjectileSnapshot, RoomFeatures, StructureSnapshot, UpgradePrices, WaveState, WeaponUpgrades, ZombieKind, ZombieSnapshot } from '@shared/protocol';

/** Mapa de eventos do jogo -> payload. Systems se comunicam exclusivamente por aqui. */
export interface GameEvents {
  'input:interact': void;
  'input:fire': void;
  'input:reload': void;
  'input:closePanel': void;
  'input:escape': void;
  'input:place': void;
  /** tecla Q: larga a pilha equipada no chão */
  'input:drop': void;
  /** roda do mouse (para girar a parede no modo construção) */
  'input:wheel': { delta: number };
  'input:selectSlot': { index: number };

  'equip:changed': { slotIndex: number; itemId: ItemId | null };

  'item:collected': { itemId: ItemId; count: number };
  'inventory:changed': { stacks: ReadonlyArray<ItemStack | null> };

  'shop:open': void;
  'tower:open': void;
  'shop:transaction': { kind: 'buy' | 'sell' | 'upgrade' };
  /** pedido genérico de efeito sonoro (posicional se x/z vierem) */
  'audio:sfx': { name: SfxName; x?: number; z?: number; volume?: number };
  /** zumbi começou um ataque (para o som) */
  'zombie:attack': { id: number; x: number; z: number };

  'player:statsChanged': { hp: number; stamina: number; maxHp: number; maxStamina: number };
  'player:damaged': { amount: number; special: boolean };
  /** curou (consumível): quanto recuperou */
  'player:healed': { amount: number };
  'player:died': { killerName: string | null; respawnIn: number; livesLeft: number };
  /** ficou sem vidas: fica no chão até um aliado comprar a Medalha de Ressurreição */
  'player:eliminated': { killerName: string | null };
  'net:revivePrice': { price: number };
  /** lista de eliminados mudou (loja re-renderiza a medalha) */
  'net:eliminatedChanged': void;
  /** fogo amigo: virou zumbi por `seconds` (só assiste o zumbi `zombieId`), caçando `targetName` */
  'player:infected': { targetName: string | null; seconds: number; zombieId: number };
  'player:respawned': void;

  'remote:shot': { playerId: string };
  'zombie:damaged': { id: number; hp: number; maxHp: number };
  'zombie:killed': { id: number; kills: number };
  'zombie:countChanged': { alive: number };

  'chunk:loaded': { cx: number; cz: number };
  'chunk:unloaded': { cx: number; cz: number };

  'interaction:targetChanged': { label: string | null };
  'ui:toast': { text: string };
  'ui:leaveRoom': void;
  'scene:change': { scene: 'menu' | 'lobby' | 'world' };

  'net:playerJoined': { name: string };
  'net:playerLeft': { name: string };
  'net:onlineCount': { count: number };
  'net:disconnected': { reason: string };
  'net:roomLeft': { reason: string };
  'net:hotbar': { slots: ReadonlyArray<ItemStack | null>; equipped: number };
  'net:money': { amount: number; delta: number };
  'net:objectRemoved': { objectId: number };
  'net:nodeHit': { objectId: number; hits: number; required: number };
  'net:melee': { playerId: string; hitPlayerId: string | null; hitZombieId: number | null };
  'net:shot': { playerId: string; dx: number; dz: number; length: number; hitPlayerId: string | null };
  'net:ammo': { mag: number; magSize: number; reloading: boolean };
  'net:zombies': { zombies: ZombieSnapshot[] };
  'net:projectiles': { projectiles: ProjectileSnapshot[] };
  'player:slowed': { factor: number; seconds: number };
  'net:shield': { playerId: string; seconds: number };
  'net:upgrades': { upgrades: WeaponUpgrades };
  'net:upgradePrices': { prices: UpgradePrices };
  'net:batteryPrice': { price: number };
  /** resgate: helicóptero a caminho / alguém embarcou / decolou (cutscene + créditos) */
  'evac:helicopter': { x: number; z: number; landsIn: number; timeout: number };
  'evac:boarded': { playerId: string };
  'evac:complete': { rescued: string[]; leftBehind: string[] };
  'net:trophy': { playerId: string; trophies: number };
  'wave:failed': { wave: number; boss: boolean };
  'net:towerHp': { hp: number; maxHp: number };
  'net:features': { features: RoomFeatures };
  'net:gameOver': { restartIn: number; reason: 'tower_destroyed' | 'all_dead' };
  'net:structureAdded': { structure: StructureSnapshot };
  'net:structureHp': { id: number; hp: number };
  'net:structureHit': { id: number; hits: number; required: number };
  'net:structureRemoved': { id: number };
  'net:dropAdded': { drop: DroppedItem };
  'net:dropRemoved': { id: number };
  'net:objectRespawned': { objectId: number };
  'net:knockback': { dx: number; dz: number; force: number };
  'wave:state': { wave: WaveState };
  'wave:started': { wave: number; count: number; players: number };
  'boss:spawned': { id: number; hp: number; wave: number };
  'boss:incoming': { wave: number; inSeconds: number };
  /** chefão da wave morto (ainda faltam waves): a antena espera a próxima bateria */
  'wave:cleared': { wave: number; total: number };
  'boss:slam': { x: number; z: number; radius: number; windup: number };
  'zombie:died': { id: number; kind: ZombieKind; killerId: string | null };
  'phase:complete': { summary: PlayerSummary[]; duration: number };
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<keyof GameEvents, Set<Handler<unknown>>>();

  on<K extends keyof GameEvents>(event: K, handler: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<unknown>);
    return () => this.off(event, handler);
  }

  off<K extends keyof GameEvents>(event: K, handler: Handler<GameEvents[K]>): void {
    this.handlers.get(event)?.delete(handler as Handler<unknown>);
  }

  emit<K extends keyof GameEvents>(
    event: K,
    ...args: GameEvents[K] extends void ? [] : [GameEvents[K]]
  ): void {
    const set = this.handlers.get(event);
    if (!set) return;
    const payload = args[0];
    for (const h of set) h(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}
