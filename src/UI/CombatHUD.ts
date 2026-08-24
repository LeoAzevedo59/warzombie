import type { EventBus } from '@/Core/EventBus';
import type { ItemId } from '@/Items/Item';

/** Contador de zumbis/abates, flash de dano na tela e tela de morte com respawn. */
export class CombatHUD {
  private panel: HTMLElement;
  private flash: HTMLElement;
  private death: HTMLElement;
  private alive = 0;
  private kills = 0;
  private equipped: ItemId | null = null;
  private unsubs: Array<() => void> = [];
  private flashTimer: number | null = null;

  constructor(
    parent: HTMLElement,
    private bus: EventBus,
    private onRespawn: () => void,
  ) {
    this.panel = document.createElement('div');
    this.panel.className = 'hud-zombies';
    parent.appendChild(this.panel);

    this.flash = document.createElement('div');
    this.flash.className = 'damage-flash';
    parent.appendChild(this.flash);

    this.death = document.createElement('div');
    this.death.className = 'death-screen';
    this.death.innerHTML = `<h1>VOCÊ MORREU</h1><p>Os zumbis te pegaram.</p><button>Renascer</button>`;
    this.death.querySelector('button')!.onclick = () => this.onRespawn();
    parent.appendChild(this.death);

    this.unsubs.push(
      bus.on('zombie:countChanged', ({ alive }) => {
        this.alive = alive;
        this.render();
      }),
      bus.on('zombie:killed', ({ kills }) => {
        this.kills = kills;
        this.render();
      }),
      bus.on('equip:changed', ({ itemId }) => {
        this.equipped = itemId;
        this.render();
      }),
      bus.on('player:damaged', ({ special }) => this.showFlash(special)),
      bus.on('player:died', () => this.death.classList.add('visible')),
      bus.on('player:respawned', () => this.death.classList.remove('visible')),
    );
    this.render();
  }

  private showFlash(strong: boolean): void {
    this.flash.style.background = strong ? 'rgba(214,61,61,.55)' : 'rgba(214,61,61,.3)';
    this.flash.classList.add('visible');
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => this.flash.classList.remove('visible'), 90);
  }

  private render(): void {
    const hint =
      this.equipped === 'pistol'
        ? '<span class="hud-cooldown">Clique para atirar</span>'
        : '<span class="hud-cooldown">Pegue uma pistola (E) e equipe (1-5)</span>';
    this.panel.innerHTML = `Zumbis: <b>${this.alive}</b> · Abates: <span class="kills">${this.kills}</span><br/>${hint}`;
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.panel.remove();
    this.flash.remove();
    this.death.remove();
    void this.bus;
  }
}
