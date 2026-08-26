import type { ItemId, ItemStack } from '@/Items/Item';

/** Mapa de eventos do jogo -> payload. Systems se comunicam exclusivamente por aqui. */
export interface GameEvents {
  'input:interact': void;
  'input:fire': void;
  'input:reload': void;
  'input:closePanel': void;
  'input:selectSlot': { index: number };

  'equip:changed': { slotIndex: number; itemId: ItemId | null };

  'item:collected': { itemId: ItemId; count: number };
  'inventory:changed': { stacks: ReadonlyArray<ItemStack | null> };

  'shop:open': void;

  'player:statsChanged': { hp: number; stamina: number; maxHp: number; maxStamina: number };
  'player:damaged': { amount: number; special: boolean };
  'player:died': { killerName: string | null; respawnIn: number };
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
  'net:shot': { playerId: string; dx: number; dz: number; length: number; hitPlayerId: string | null };
  'net:ammo': { mag: number; magSize: number; reloading: boolean };
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
