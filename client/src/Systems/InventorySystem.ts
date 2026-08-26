import type { System } from '@/Core/GameLoop';
import type { GameState } from '@/Core/GameState';
import type { EventBus } from '@/Core/EventBus';
import type { ItemId, ItemStack } from '@/Items/Item';

/**
 * Espelho local da hotbar: o servidor é o dono (mensagem `hotbar`); aqui só guardamos e
 * notificamos a UI. Nenhuma regra de inventário roda no client.
 */
export class InventorySystem implements System {
  readonly name = 'Inventory';

  constructor(
    private state: GameState,
    private bus: EventBus,
  ) {}

  update(): void {
    /* sem lógica por frame */
  }

  /** Aplica a hotbar vinda do servidor. */
  apply(slots: ReadonlyArray<ItemStack | null>, equipped: number): void {
    this.state.inventory = slots.map((s) => (s ? { ...s } : null));
    this.state.equippedSlot = equipped;
    this.notify();
  }

  count(itemId: ItemId): number {
    return this.state.inventory.reduce((n, s) => n + (s?.itemId === itemId ? s.count : 0), 0);
  }

  has(itemId: ItemId, count = 1): boolean {
    return this.count(itemId) >= count;
  }

  notify(): void {
    this.bus.emit('inventory:changed', { stacks: this.state.inventory });
  }
}
