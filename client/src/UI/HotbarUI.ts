import type { EventBus } from '@/Core/EventBus';
import type { ItemStack } from '@/Items/Item';
import { ItemDatabase } from '@/Items/ItemDatabase';

/** Hotbar de 5 slots sempre visível + prompt de interação. */
export class HotbarUI {
  private hotbar: HTMLElement;
  private prompt: HTMLElement;
  private stacks: ReadonlyArray<ItemStack | null> = [];
  private equippedSlot = 0;
  private unsubs: Array<() => void> = [];

  constructor(
    parent: HTMLElement,
    private bus: EventBus,
  ) {
    this.hotbar = document.createElement('div');
    this.hotbar.className = 'hotbar';
    this.hotbar.onclick = (e) => {
      const slot = (e.target as HTMLElement).closest<HTMLElement>('.slot');
      const index = slot ? Number(slot.dataset.index) : NaN;
      if (!Number.isNaN(index)) this.bus.emit('input:selectSlot', { index });
    };
    parent.appendChild(this.hotbar);

    this.prompt = document.createElement('div');
    this.prompt.className = 'prompt';
    parent.appendChild(this.prompt);

    this.unsubs.push(
      bus.on('inventory:changed', ({ stacks }) => {
        this.stacks = stacks;
        this.render();
      }),
      bus.on('interaction:targetChanged', ({ label }) => {
        this.prompt.textContent = label ?? '';
        this.prompt.classList.toggle('visible', !!label);
      }),
      bus.on('equip:changed', ({ slotIndex }) => {
        this.equippedSlot = slotIndex;
        this.render();
      }),
    );
    this.render();
  }

  private slotHtml(s: ItemStack | null, i: number): string {
    const cls = `slot${i === this.equippedSlot ? ' equipped' : ''}`;
    const number = `<span class="slot-number">${i + 1}</span>`;
    if (!s) return `<div class="${cls}" data-index="${i}">${number}</div>`;
    const def = ItemDatabase.get(s.itemId);
    return `<div class="${cls}" data-index="${i}" title="${def.name}">${number}<div class="icon" style="background:${def.color}"></div>${def.name}<span class="count">${s.count > 1 ? s.count : ''}</span></div>`;
  }

  private render(): void {
    this.hotbar.innerHTML = this.stacks.map((s, i) => this.slotHtml(s, i)).join('');
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
    this.hotbar.remove();
    this.prompt.remove();
  }
}
