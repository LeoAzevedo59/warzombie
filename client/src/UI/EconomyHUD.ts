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
      }),
    );
  }

  private render(amount: number, delta: number): void {
    this.el.innerHTML = `<b>$${amount}</b>`;
    this.el.title = 'Dinheiro da sala';
    if (delta === 0) return;
    // número flutuante (+$X verde / -$X vermelho) que sobe e some — todos da sala recebem o mesmo `money`
    const float = document.createElement('div');
    float.className = `money-float ${delta > 0 ? 'gain' : 'loss'}`;
    float.textContent = `${delta > 0 ? '+' : '-'}$${Math.abs(delta)}`;
    this.el.parentElement?.appendChild(float);
    float.addEventListener('animationend', () => float.remove());
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
