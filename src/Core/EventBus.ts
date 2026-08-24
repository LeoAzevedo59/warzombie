import type { ItemId, ItemStack } from '@/Items/Item';
import type { RecipeId } from '@/Items/Recipes';

/** Mapa de eventos do jogo -> payload. Systems se comunicam exclusivamente por aqui. */
export interface GameEvents {
  'input:interact': void;
  'input:fire': void;
  'input:toggleInventory': void;
  'input:closePanel': void;
  'input:place': void;
  'input:selectSlot': { index: number };

  'equip:changed': { slotIndex: number; itemId: ItemId | null };

  'item:collected': { itemId: ItemId; count: number };
  'item:crafted': { itemId: ItemId };
  'node:hit': { kind: string; hits: number; hitsRequired: number };
  'inventory:changed': { stacks: ReadonlyArray<ItemStack | null> };

  'workbench:interact': { workbenchId: number };
  'workbench:jobStarted': { workbenchId: number; output: ItemId; duration: number };
  'workbench:jobProgress': { workbenchId: number; remaining: number; total: number };
  'workbench:jobComplete': { workbenchId: number; output: ItemId };

  'craft:jobStarted': { recipeId: RecipeId; duration: number };
  'craft:jobProgress': { recipeId: RecipeId; remaining: number; total: number };
  'craft:jobComplete': { recipeId: RecipeId };

  'player:statsChanged': { hp: number; stamina: number; maxHp: number; maxStamina: number };
  'player:damaged': { amount: number; special: boolean };
  'player:died': void;
  'player:respawned': void;

  'weapon:fired': { itemId: ItemId; hit: boolean };
  'zombie:damaged': { id: number; hp: number; maxHp: number };
  'zombie:killed': { id: number; kills: number };
  'zombie:countChanged': { alive: number };

  'chunk:loaded': { cx: number; cz: number };
  'chunk:unloaded': { cx: number; cz: number };

  'interaction:targetChanged': { label: string | null };
  'ui:toast': { text: string };
  'scene:change': { scene: 'menu' | 'world' };
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
