import type { EventBus } from '@/Core/EventBus';
import type { WaveState } from '@shared/protocol';

/** Painel das waves: fase, contagem regressiva, zumbis vivos, barra do boss e banner de conclusão. */
export class WaveHUD {
  private el: HTMLElement;
  private banner: HTMLElement;
  private unsubs: Array<() => void> = [];
  private state: WaveState;
  private boss: { hp: number; maxHp: number } | null = null;
  private bannerTimer: number | null = null;

  constructor(
    parent: HTMLElement,
    bus: EventBus,
    initial: WaveState,
    private bossHp: () => { hp: number; maxHp: number } | null,
  ) {
    this.state = initial;
    this.el = document.createElement('div');
    this.el.className = 'hud-wave';
    parent.appendChild(this.el);
    this.banner = document.createElement('div');
    this.banner.className = 'wave-banner';
    parent.appendChild(this.banner);
    this.unsubs.push(
      bus.on('wave:state', ({ wave }) => {
        this.state = wave;
        this.render();
      }),
      bus.on('wave:started', ({ wave, count }) => this.showBanner(`WAVE ${wave}`, `${count} zumbis a caminho`)),
      bus.on('boss:spawned', () => this.showBanner('CHEFÃO', 'Ele está vindo. Não deixe ele chegar perto.')),
      bus.on('phase:complete', () => {
        this.showBanner('FASE 1 CONCLUÍDA', 'O chefão caiu. A sala está livre.', 8000);
        this.render();
      }),
      bus.on('zombie:countChanged', ({ alive }) => {
        this.state = { ...this.state, alive };
        this.render();
      }),
    );
    this.render();
  }

  private showBanner(title: string, sub: string, ms = 3500): void {
    this.banner.innerHTML = `<h2></h2><p></p>`;
    this.banner.querySelector('h2')!.textContent = title;
    this.banner.querySelector('p')!.textContent = sub;
    this.banner.classList.add('visible');
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.banner.classList.remove('visible'), ms);
  }

  /** Chamado a cada frame para a barra do boss acompanhar o HP. */
  update(): void {
    const b = this.bossHp();
    if ((b?.hp ?? -1) !== (this.boss?.hp ?? -1)) {
      this.boss = b;
      this.render();
    }
  }

  private render(): void {
    const s = this.state;
    let line: string;
    switch (s.phase) {
      case 'idle':
        line = 'Torre desligada — compre uma <b>Bateria</b> e coloque na torre (E)';
        break;
      case 'countdown':
        line = `Primeira wave em <b>${s.nextIn ?? 0}s</b>`;
        break;
      case 'wave':
        line = `Wave <b>${s.wave}/${s.total}</b> · vivos: <b>${s.alive}</b>` + (s.nextIn !== null ? ` · próxima em <b>${s.nextIn}s</b>` : ' · elimine todos para chamar o chefão');
        break;
      case 'boss':
        line = `<span class="boss-label">CHEFÃO</span> · vivos: <b>${s.alive}</b>`;
        break;
      case 'complete':
        line = '<span class="done">Fase 1 concluída!</span>';
        break;
    }
    const bossBar =
      s.phase === 'boss' && this.boss
        ? `<div class="bar boss"><div style="width:${((100 * this.boss.hp) / this.boss.maxHp).toFixed(1)}%"></div></div>`
        : '';
    this.el.innerHTML = `${line}${bossBar}`;
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    this.el.remove();
    this.banner.remove();
  }
}
