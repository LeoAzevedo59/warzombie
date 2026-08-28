import type { EventBus } from '@/Core/EventBus';
import type { GameState } from '@/Core/GameState';

const R = 22;
const CIRC = 2 * Math.PI * R;

/** Vida e vigor como anéis circulares com ícone (canto inferior esquerdo). */
export class HealthBar {
  private el: HTMLElement;
  private hpRing: SVGCircleElement;
  private stRing: SVGCircleElement;
  private hpText: HTMLElement;
  private wRing: SVGCircleElement;
  private wText: HTMLElement;
  private unsubs: Array<() => void> = [];

  constructor(parent: HTMLElement, bus: EventBus, private state: GameState) {
    this.el = document.createElement('div');
    this.el.className = 'hud-vitals';
    this.el.innerHTML = `
      ${this.ring('hp', '<path d="M12 21s-7-4.6-9.3-8.6C.8 9 2.6 5 6.4 5c2 0 3.4 1 4.6 2.6C12.2 6 13.6 5 15.6 5c3.8 0 5.6 4 3.7 7.4C19 16.4 12 21 12 21z"/>')}
      ${this.ring('stamina', '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/>')}
      ${this.ring('weight', '<path d="M12 2a3 3 0 0 0-3 3v1H7a3 3 0 0 0-3 3v9a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V9a3 3 0 0 0-3-3h-2V5a3 3 0 0 0-3-3zm-1 4V5a1 1 0 0 1 2 0v1h-2z"/>')}`;
    parent.appendChild(this.el);
    this.hpRing = this.el.querySelector('.ring.hp .fill')!;
    this.stRing = this.el.querySelector('.ring.stamina .fill')!;
    this.hpText = this.el.querySelector('.ring.hp .value')!;
    this.wRing = this.el.querySelector('.ring.weight .fill')!;
    this.wText = this.el.querySelector('.ring.weight .value')!;
    this.updateWeight();

    this.unsubs.push(bus.on('inventory:changed', () => this.updateWeight()), bus.on('net:upgrades', () => this.updateWeight()), bus.on('net:bag', () => this.updateWeight()));
    this.unsubs.push(bus.on('player:statsChanged', ({ hp, stamina, maxHp, maxStamina }) => {
      this.set(this.hpRing, hp / maxHp);
      this.set(this.stRing, stamina / maxStamina);
      this.hpText.textContent = String(Math.round(hp));
      this.el.classList.toggle('low-hp', hp / maxHp <= 0.3);
    }));
  }

  private updateWeight(): void {
    const w = this.state.carriedWeight;
    const max = this.state.maxWeight;
    this.set(this.wRing, w / max);
    this.wText.textContent = `${w}/${max}`;
    this.el.classList.toggle('heavy', w / max >= 0.8);
  }

  private ring(kind: string, iconPath: string): string {
    return `<div class="ring ${kind}" title="${kind === 'hp' ? 'Vida' : kind === 'stamina' ? 'Vigor de corrida' : 'Peso carregado (quanto mais, mais lento)'}">
      <svg viewBox="0 0 56 56">
        <circle class="track" cx="28" cy="28" r="${R}"/>
        <circle class="fill" cx="28" cy="28" r="${R}" stroke-dasharray="${CIRC}" stroke-dashoffset="0"/>
      </svg>
      <svg class="icon" viewBox="0 0 24 24">${iconPath}</svg>
      <span class="value"></span>
    </div>`;
  }

  private set(ring: SVGCircleElement, ratio: number): void {
    const r = Math.max(0, Math.min(1, ratio));
    ring.style.strokeDashoffset = String(CIRC * (1 - r));
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
    this.el.remove();
  }
}
