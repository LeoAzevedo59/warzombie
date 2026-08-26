import type { EventBus } from '@/Core/EventBus';

/** Dinheiro compartilhado da sala, com destaque quando muda. */
export class EconomyHUD {
  private el: HTMLElement;
  private unsubs: Array<() => void> = [];
  private pulseTimer: number | null = null;

  constructor(parent: HTMLElement, bus: EventBus, initial: number) {
    this.el = document.createElement('div');
    this.el.className = 'hud-money';
    parent.appendChild(this.el);
    this.render(initial, 0);
    this.unsubs.push(
      bus.on('net:money', ({ amount, delta }) => {
        this.render(amount, delta);
        if (delta !== 0) bus.emit('ui:toast', { text: `${delta > 0 ? '+' : '-'}$${Math.abs(delta)} no caixa da sala` });
      }),
    );
  }

  private render(amount: number, delta: number): void {
    this.el.innerHTML = `Caixa da sala<br/><b>$${amount}</b>`;
    if (delta === 0) return;
    this.el.classList.add(delta > 0 ? 'up' : 'down');
    if (this.pulseTimer) clearTimeout(this.pulseTimer);
    this.pulseTimer = window.setTimeout(() => this.el.classList.remove('up', 'down'), 600);
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
    if (this.pulseTimer) clearTimeout(this.pulseTimer);
    this.el.remove();
  }
}
