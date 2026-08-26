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
      bus.on('wave:failed', ({ wave, boss }) =>
        this.showBanner('TEMPO ESGOTADO', boss ? 'O chefão venceu. A bateria foi perdida — compre outra e recomece.' : `A wave ${wave} não foi limpa a tempo. A bateria foi perdida — compre outra e recomece.`, 6000),
      ),
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
        line = 'Compre uma <b>Bateria</b> no vendedor e coloque na torre (E) para iniciar as waves';
        break;
      case 'countdown':
        line = s.wave === 0 ? `Primeira wave em <b>${s.nextIn ?? 0}s</b>` : s.wave < s.total ? `Wave ${s.wave} limpa! Próxima em <b>${s.nextIn ?? 0}s</b>` : `Wave ${s.wave} limpa! O chefão chega em <b>${s.nextIn ?? 0}s</b>`;
        break;
      case 'wave':
        line = `Wave <b>${s.wave}/${s.total}</b> · vivos: <b>${s.alive}</b> · <span class="${(s.timeLeft ?? 99) <= 15 ? 'urgent' : ''}">tempo: <b>${s.timeLeft ?? 0}s</b></span>`;
        break;
      case 'boss':
        line = `<span class="boss-label">CHEFÃO</span> · vivos: <b>${s.alive}</b> · <span class="${(s.timeLeft ?? 99) <= 20 ? 'urgent' : ''}">tempo: <b>${s.timeLeft ?? 0}s</b></span>`;
        break;
      case 'complete':
        line = '<span class="done">Fase 1 concluída!</span>';
        break;
    }
    const bossBar =
      s.phase === 'boss' && this.boss
        ? `<div class="bar boss"><div style="width:${((100 * this.boss.hp) / this.boss.maxHp).toFixed(1)}%"></div></div>`
        : '';
    this.el.innerHTML = `<span class="mission">Missão</span>${line}${bossBar}`;
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    this.el.remove();
    this.banner.remove();
  }
}
