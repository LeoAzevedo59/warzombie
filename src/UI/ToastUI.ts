import type { EventBus } from '@/Core/EventBus';
import { ItemDatabase } from '@/Items/ItemDatabase';

const LIFETIME_MS = 2200;

/** Toasts no canto inferior direito para itens coletados/craftados. */
export class ToastUI {
  private container: HTMLElement;
  private unsubs: Array<() => void> = [];

  constructor(parent: HTMLElement, bus: EventBus) {
    this.container = document.createElement('div');
    this.container.className = 'toast-stack';
    parent.appendChild(this.container);

    this.unsubs.push(
      bus.on('item:collected', ({ itemId, count }) => this.push(itemId, count)),
      bus.on('item:crafted', ({ itemId }) => this.push(itemId, 1)),
      bus.on('ui:toast', ({ text }) => this.pushText(text)),
    );
  }

  /** Toast genérico de aviso (sem ícone de item). */
  private pushText(text: string): void {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<div class="toast-icon" style="background:#d6a23d"></div><span></span>`;
    el.querySelector('span')!.textContent = text;
    this.show(el);
  }

  private push(itemId: Parameters<typeof ItemDatabase.get>[0], count: number): void {
    const def = ItemDatabase.get(itemId);
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<div class="toast-icon" style="background:${def.color}"></div><span>+${count} ${def.name}</span>`;
    this.show(el);
  }

  private show(el: HTMLElement): void {
    this.container.appendChild(el);
    requestAnimationFrame(() => el.classList.add('visible'));
    setTimeout(() => {
      el.classList.remove('visible');
      el.addEventListener('transitionend', () => el.remove(), { once: true });
    }, LIFETIME_MS);
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
    this.container.remove();
  }
}
