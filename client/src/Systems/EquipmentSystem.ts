import { CONFIG } from '@/config';
import type { System } from '@/Core/GameLoop';
import type { EventBus } from '@/Core/EventBus';
import type { GameState } from '@/Core/GameState';
import type { NetworkClient } from '@/Net/NetworkClient';
import type { ItemId } from '@/Items/Item';

/** Controla qual slot da hotbar (1..5, teclas Digit1-5) está equipado. Seleção é confirmada pelo servidor (`hotbar`). */
export class EquipmentSystem implements System {
  readonly name = 'Equipment';
  private unsubs: Array<() => void> = [];
  private lastItem: ItemId | null | undefined;

  constructor(
    private bus: EventBus,
    private state: GameState,
    private net: NetworkClient,
  ) {
    this.unsubs.push(
      bus.on('input:selectSlot', ({ index }) => this.select(index)),
      // o item na mão pode mudar sem trocar de slot (pegou algo que caiu no slot equipado, vendeu)
      bus.on('inventory:changed', () => {
        const item = this.equippedItem();
        if (item !== this.lastItem) this.emitChanged();
      }),
    );
  }

  private emitChanged(): void {
    this.lastItem = this.equippedItem();
    this.bus.emit('equip:changed', { slotIndex: this.state.equippedSlot, itemId: this.lastItem });
  }

  update(): void {
    /* sem lógica por frame */
  }

  select(index: number): void {
    if (index < 0 || index >= CONFIG.inventory.HOTBAR_SLOTS || index === this.state.equippedSlot) return;
    // previsão local + confirmação do servidor
    this.state.equippedSlot = index;
    this.emitChanged();
    this.net.send({ type: 'select_slot', index });
  }

  /** Item atualmente na mão, ou null se o slot equipado está vazio. */
  equippedItem(): ItemId | null {
    return this.state.inventory[this.state.equippedSlot]?.itemId ?? null;
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
  }
}
