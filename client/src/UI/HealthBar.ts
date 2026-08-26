import type { EventBus } from '@/Core/EventBus';

/** Barras de HP e stamina (DOM). */
export class HealthBar {
  private el: HTMLElement;
  private hpFill: HTMLElement;
  private stFill: HTMLElement;
  private unsub: () => void;

  constructor(parent: HTMLElement, bus: EventBus) {
    this.el = document.createElement('div');
    this.el.className = 'hud-stats';
    this.el.innerHTML = `
      <div class="bar hp"><div style="width:100%"></div></div>
      <div class="bar stamina"><div style="width:100%"></div></div>`;
    parent.appendChild(this.el);
    this.hpFill = this.el.querySelector('.hp > div')!;
    this.stFill = this.el.querySelector('.stamina > div')!;

    this.unsub = bus.on('player:statsChanged', ({ hp, stamina, maxHp, maxStamina }) => {
      this.hpFill.style.width = `${(hp / maxHp) * 100}%`;
      this.stFill.style.width = `${(stamina / maxStamina) * 100}%`;
    });
  }

  dispose(): void {
    this.unsub();
    this.el.remove();
  }
}
