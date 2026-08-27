import type { EventBus } from '@/Core/EventBus';
import type { WaveState } from '@shared/protocol';

/** Painel das waves: fase, contagem regressiva, zumbis vivos, barra do boss e banner de conclusão. */
export class WaveHUD {
  private el: HTMLElement;
  private banner: HTMLElement;
  private unsubs: Array<() => void> = [];
  private state: WaveState;
  private boss: { hp: number; maxHp: number } | null = null;
  private tower = { hp: 1, maxHp: 1 };
  private bannerTimer: number | null = null;
  private collapsed = false;

  constructor(
    parent: HTMLElement,
    bus: EventBus,
    initial: WaveState,
    private bossHp: () => { hp: number; maxHp: number } | null,
    tower: { hp: number; maxHp: number },
  ) {
    this.state = initial;
    this.tower = tower;
    this.el = document.createElement('div');
    this.el.className = 'hud-wave';
    parent.appendChild(this.el);
    try {
      this.collapsed = localStorage.getItem('warzombie:missionCollapsed') === '1';
    } catch {
      /* sem storage */
    }
    this.el.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('.mission-toggle')) return;
      this.collapsed = !this.collapsed;
      try {
        localStorage.setItem('warzombie:missionCollapsed', this.collapsed ? '1' : '0');
      } catch {
        /* sem storage */
      }
      this.render();
    });
    this.banner = document.createElement('div');
    this.banner.className = 'wave-banner';
    parent.appendChild(this.banner);
    this.unsubs.push(
      bus.on('wave:state', ({ wave }) => {
        this.state = wave;
        this.render();
      }),
      bus.on('wave:started', ({ wave, count }) => this.showBanner(`WAVE ${wave}`, `${count} zumbis a caminho`)),
      bus.on('boss:incoming', ({ wave, inSeconds }) => this.showBanner('HORDA LIMPA', `O chefão da wave ${wave} chega em ${inSeconds}s. Prepare-se.`, inSeconds * 1000)),
      bus.on('boss:spawned', ({ wave }) => this.showBanner(`CHEFÃO ${wave}/${this.state.total}`, wave >= this.state.total ? 'O último. O mais insano. Não deixe ele chegar perto.' : 'Ele está vindo. Não deixe ele chegar perto.')),
      bus.on('wave:cleared', ({ wave, total }) => this.showBanner(`WAVE ${wave} CONCLUÍDA`, `Baterias na antena: ${wave}/${total}. Compre outra Bateria e coloque na antena para a wave ${wave + 1}.`, 7000)),
      bus.on('net:towerHp', ({ hp, maxHp }) => {
        this.tower = { hp, maxHp };
        this.render();
      }),
      bus.on('net:gameOver', ({ restartIn }) => this.showBanner('VOCÊ PERDEU!', `A torre de comunicação foi destruída. Tudo recomeça do zero em ${restartIn}s…`, restartIn * 1000)),
      bus.on('wave:failed', ({ wave, boss }) =>
        this.showBanner('TEMPO ESGOTADO', boss ? `O chefão da wave ${wave} venceu. A bateria dessa wave foi perdida — compre outra e tente de novo.` : `A wave ${wave} não foi limpa a tempo. A bateria dessa wave foi perdida — compre outra e tente de novo.`, 6000),
      ),
      bus.on('phase:complete', () => {
        this.showBanner('FASE 1 CONCLUÍDA', 'Os 5 chefões caíram. A sala está livre.', 8000);
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
        line =
          s.wave === 0
            ? 'Compre uma <b>Bateria</b> no vendedor e leve até a <b>torre de comunicação</b> (ponto azul no minimapa) — ela é pesada! Cada bateria dispara uma wave.'
            : `Wave ${s.wave} concluída! Compre outra <b>Bateria</b> (mais cara a cada compra) e coloque na antena para a <b>wave ${s.wave + 1}</b>.`;
        break;
      case 'countdown':
        line = s.bossNext ? `Horda limpa! O <span class="boss-label">CHEFÃO</span> da wave ${s.wave} chega em <b>${s.nextIn ?? 0}s</b>` : `Wave ${s.wave} começa em <b>${s.nextIn ?? 0}s</b>`;
        break;
      case 'wave':
        line = `Wave <b>${s.wave}/${s.total}</b> · vivos: <b>${s.alive}</b> · <span class="${(s.timeLeft ?? 99) <= 15 ? 'urgent' : ''}">tempo: <b>${s.timeLeft ?? 0}s</b></span>`;
        break;
      case 'boss':
        line = `<span class="boss-label">CHEFÃO ${s.wave}/${s.total}</span> · vivos: <b>${s.alive}</b> · <span class="${(s.timeLeft ?? 99) <= 20 ? 'urgent' : ''}">tempo: <b>${s.timeLeft ?? 0}s</b></span>`;
        break;
      case 'complete':
        line = '<span class="done">Fase 1 concluída!</span>';
        break;
    }
    // baterias na antena (= waves iniciadas)
    const cells = Array.from({ length: s.total }, (_, i) => `<i class="${i < s.wave ? 'on' : ''}"></i>`).join('');
    const batteries = `<div class="battery-line">Baterias <b>${s.wave}</b>/${s.total} <span class="cells">${cells}</span></div>`;
    const bossBar =
      s.phase === 'boss' && this.boss
        ? `<div class="bar boss"><div style="width:${((100 * this.boss.hp) / this.boss.maxHp).toFixed(1)}%"></div></div>`
        : '';
    this.el.classList.toggle('collapsed', this.collapsed);
    const toggle = `<button class="mission-toggle" title="${this.collapsed ? 'Maximizar' : 'Minimizar'}">${this.collapsed ? '＋' : '－'}</button>`;
    // minimizado: só o essencial numa linha (wave/tempo ou ícone)
    const short =
      s.phase === 'wave' || s.phase === 'boss'
        ? `${s.phase === 'boss' ? `CHEFÃO ${s.wave}/${s.total}` : `Wave ${s.wave}/${s.total}`} · ${s.timeLeft ?? 0}s`
        : s.phase === 'countdown'
          ? `${s.bossNext ? 'Chefão' : 'Horda'} em ${s.nextIn ?? 0}s`
          : s.phase === 'complete'
            ? 'Fase concluída'
            : `Baterias ${s.wave}/${s.total}`;
    const tr = this.tower.maxHp > 0 ? this.tower.hp / this.tower.maxHp : 1;
    const towerBar = `<div class="tower-line ${tr <= 0.3 ? 'urgent' : ''}">Antena <b>${Math.round(this.tower.hp)}</b>/${this.tower.maxHp}<div class="bar tower"><div style="width:${(tr * 100).toFixed(1)}%"></div></div></div>`;
    this.el.innerHTML = this.collapsed
      ? `<span class="mission">Missão</span><span class="short">${short}</span>${toggle}`
      : `<span class="mission">Missão</span>${toggle}${line}${bossBar}${batteries}${towerBar}`;
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    this.el.remove();
    this.banner.remove();
  }
}
