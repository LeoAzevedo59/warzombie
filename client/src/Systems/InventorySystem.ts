import type { System } from '@/Core/GameLoop';
import type { GameState } from '@/Core/GameState';
import type { EventBus } from '@/Core/EventBus';
import type { ItemId, ItemStack } from '@/Items/Item';
import { ItemDatabase } from '@/Items/ItemDatabase';

/** Regras de inventário sobre GameState.inventory. */
export class InventorySystem implements System {
  readonly name = 'Inventory';

  constructor(
    private state: GameState,
    private bus: EventBus,
  ) {}

  update(): void {
    /* sem lógica por frame */
  }

  count(itemId: ItemId): number {
    return this.state.inventory.reduce((n, s) => n + (s?.itemId === itemId ? s.count : 0), 0);
  }

  /** Retorna quantos NÃO couberam. */
  add(itemId: ItemId, count = 1): number {
    const def = ItemDatabase.get(itemId);
    const inv = this.state.inventory;
    let left = count;

    for (const s of inv) {
      if (left === 0) break;
      if (s && s.itemId === itemId && s.count < def.stackMax) {
        const take = Math.min(left, def.stackMax - s.count);
        s.count += take;
        left -= take;
      }
    }
    for (let i = 0; i < inv.length && left > 0; i++) {
      if (inv[i] === null) {
        const take = Math.min(left, def.stackMax);
        inv[i] = { itemId, count: take };
        left -= take;
      }
    }
    if (left !== count) this.notify();
    return left;
  }

  /** Todos os stacks dados cabem no inventário atual (simulação, sem mutar)? */
  canFit(stacks: ItemStack[]): boolean {
    const inv = this.state.inventory.map((s) => (s ? { ...s } : null));
    for (const { itemId, count } of stacks) {
      const max = ItemDatabase.get(itemId).stackMax;
      let left = count;
      for (const s of inv) {
        if (left === 0) break;
        if (s && s.itemId === itemId && s.count < max) {
          const take = Math.min(left, max - s.count);
          s.count += take;
          left -= take;
        }
      }
      for (let i = 0; i < inv.length && left > 0; i++) {
        if (inv[i] === null) {
          const take = Math.min(left, max);
          inv[i] = { itemId, count: take };
          left -= take;
        }
      }
      if (left > 0) return false;
    }
    return true;
  }

  has(itemId: ItemId, count: number): boolean {
    return this.count(itemId) >= count;
  }

  remove(itemId: ItemId, count: number): boolean {
    if (!this.has(itemId, count)) return false;
    const inv = this.state.inventory;
    let left = count;
    for (let i = inv.length - 1; i >= 0 && left > 0; i--) {
      const s = inv[i];
      if (!s || s.itemId !== itemId) continue;
      const take = Math.min(left, s.count);
      s.count -= take;
      left -= take;
      if (s.count === 0) inv[i] = null;
    }
    this.notify();
    return true;
  }

  notify(): void {
    this.bus.emit('inventory:changed', { stacks: this.state.inventory });
  }
}
