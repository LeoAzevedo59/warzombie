import type { EventBus } from '@/Core/EventBus';
import type { ItemId } from '@/Items/Item';
import { GAME } from '@shared/gameconfig';
import type { WeaponUpgrades } from '@shared/protocol';

/** Contador de zumbis/abates, munição, flash de dano e tela de morte com contagem de respawn. */
export class CombatHUD {
  private panel: HTMLElement;
  private flash: HTMLElement;
  private death: HTMLElement;
  private alive = 0;
  private kills = 0;
  private equipped: ItemId | null = null;
  private ammo = { mag: 0, magSize: 10, reloading: false };
  private unsubs: Array<() => void> = [];
  private flashTimer: number | null = null;
  private countdown: number | null = null;
  private slowedUntil = 0;
  private shieldUntil = 0;
  private shieldTimer: number | null = null;
  /** Medalhas de Ressurreição em posse (botão na tela de eliminado) */
  private medals = 0;
  private medalFx: HTMLElement;
  private medalFxTimer: number | null = null;

  constructor(
    parent: HTMLElement,
    private bus: EventBus,
    myId: string | null,
    initialKills = 0,
    initialUpgrades?: WeaponUpgrades,
    initialMedals = 0,
  ) {
    this.kills = initialKills;
    this.medals = initialMedals;
    void initialUpgrades;
    this.panel = document.createElement('div');
    this.panel.className = 'hud-status';
    parent.appendChild(this.panel);

    this.flash = document.createElement('div');
    this.flash.className = 'damage-flash';
    parent.appendChild(this.flash);

    this.death = document.createElement('div');
    this.death.className = 'death-screen';
    this.death.innerHTML = `<h1>VOCÊ MORREU</h1><p class="cause"></p><p class="timer"></p><button class="use-medal"></button>`;
    parent.appendChild(this.death);
    this.death.querySelector<HTMLButtonElement>('.use-medal')!.onclick = () => this.bus.emit('medal:useSelf');

    // animação da Medalha de Ressurreição (camada própria: aparece por cima da tela de morte e sobrevive ao respawn)
    this.medalFx = document.createElement('div');
    this.medalFx.className = 'medal-revive';
    this.medalFx.innerHTML = `
      <div class="medal-rays"></div>
      <div class="medal-icon"><svg viewBox="0 0 512 512" aria-hidden="true"><path d="M144 32h72l40 96 40-96h72l-84 176h-56L144 32zm112 160c70 0 128 58 128 128s-58 128-128 128-128-58-128-128 58-128 128-128zm0 48l24 50 56 8-40 39 10 55-50-26-50 26 10-55-40-39 56-8 24-50z"/></svg></div>
      <div class="medal-title">MEDALHA DE RESSURREIÇÃO</div>
      <div class="medal-hearts"><span>♥</span><span>♥</span><span>♥</span></div>
      <div class="medal-sub"></div>`;
    parent.appendChild(this.medalFx);

    this.unsubs.push(
      bus.on('zombie:countChanged', ({ alive }) => {
        this.alive = alive;
        this.render();
      }),
      bus.on('zombie:died', ({ killerId }) => {
        if (killerId === myId) this.kills++;
        this.render();
      }),
      bus.on('equip:changed', ({ itemId }) => {
        this.equipped = itemId;
        this.render();
      }),
      bus.on('net:ammo', (a) => {
        this.ammo = a;
        this.render();
      }),
      bus.on('player:damaged', ({ special }) => this.showFlash(special)),
      bus.on('player:healed', ({ amount }) => this.bus.emit('ui:toast', { text: `+${amount} de vida` })),
      bus.on('net:shield', ({ playerId, seconds }) => {
        if (playerId !== myId) return;
        this.shieldUntil = Date.now() + seconds * 1000;
        if (this.shieldTimer) clearInterval(this.shieldTimer);
        this.shieldTimer = window.setInterval(() => {
          this.render();
          if (Date.now() >= this.shieldUntil && this.shieldTimer) clearInterval(this.shieldTimer);
        }, 250);
        this.render();
      }),
      bus.on('player:slowed', ({ seconds }) => {
        this.slowedUntil = Date.now() + seconds * 1000;
        this.render();
        window.setTimeout(() => this.render(), seconds * 1000 + 50);
      }),
      bus.on('player:died', ({ killerName, respawnIn, livesLeft }) => this.showDeath(killerName, respawnIn, livesLeft)),
      bus.on('player:eliminated', ({ killerName }) => this.showEliminated(killerName)),
      bus.on('net:medals', ({ count }) => {
        this.medals = count;
        this.renderMedalButton();
      }),
      bus.on('player:medalRevive', ({ byName, medalsLeft }) => this.showMedalRevive(byName, medalsLeft)),
      bus.on('net:gameOver', () => {
        this.hideDeath();
        this.medalFx.classList.remove('visible');
      }),
      bus.on('player:infected', ({ targetName, seconds }) => this.showInfected(targetName, seconds)),
      bus.on('player:respawned', () => this.hideDeath()),
    );
    this.render();
  }

  private showFlash(strong: boolean): void {
    this.flash.style.background = strong ? 'rgba(214,61,61,.55)' : 'rgba(214,61,61,.3)';
    this.flash.classList.add('visible');
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => this.flash.classList.remove('visible'), 90);
  }

  private showDeath(killerName: string | null, respawnIn: number, livesLeft: number): void {
    this.death.classList.remove('infected', 'eliminated');
    this.renderMedalButton();
    this.death.querySelector('h1')!.textContent = 'VOCÊ MORREU';
    const hearts = '♥'.repeat(livesLeft) + '♡'.repeat(Math.max(0, GAME.lives.MAX_DEATHS - livesLeft));
    this.death.querySelector('.cause')!.textContent = `${killerName ? `${killerName} te matou.` : 'Os zumbis te pegaram.'} Vidas: ${hearts} (${livesLeft} restante${livesLeft === 1 ? '' : 's'})`;
    this.startCountdown(respawnIn, (left) => `Renascendo em ${left}s...`);
    this.death.classList.add('visible');
  }

  /** Sem vidas: fica no chão; só um aliado com a Medalha de Ressurreição traz de volta. */
  private showEliminated(killerName: string | null): void {
    this.death.classList.remove('infected');
    this.death.classList.add('eliminated');
    this.death.querySelector('h1')!.textContent = 'VOCÊ FOI ELIMINADO';
    this.death.querySelector('.cause')!.textContent = `${killerName ? `${killerName} te matou` : 'Os zumbis te pegaram'} pela ${GAME.lives.MAX_DEATHS}ª vez: suas vidas acabaram.`;
    if (this.countdown) clearInterval(this.countdown);
    this.countdown = null;
    this.death.querySelector<HTMLElement>('.timer')!.textContent = 'Um aliado pode usar uma Medalha de Ressurreição em você — ou use a sua, se tiver.';
    this.renderMedalButton();
    this.death.classList.add('visible');
  }

  /**
   * Medalha usada em mim: a medalha desce girando, os 3 corações reacendem um a um e o texto diz de
   * onde vieram as vidas. Fica ~3 s por cima da tela de morte (que continua com o countdown) e some.
   */
  private showMedalRevive(byName: string | null, medalsLeft: number): void {
    this.medalFx.querySelector('.medal-sub')!.textContent = byName
      ? `${byName} usou uma medalha em você — vidas restauradas`
      : `Sua medalha foi usada — vidas restauradas · medalhas restantes: ${medalsLeft}`;
    // reinicia as animações mesmo se a camada ainda estiver visível
    this.medalFx.classList.remove('visible');
    void this.medalFx.offsetWidth;
    this.medalFx.classList.add('visible');
    // a tela de morte por trás passa a mostrar as vidas cheias e o motivo
    if (this.death.classList.contains('visible') && !this.death.classList.contains('infected')) {
      this.death.classList.remove('eliminated');
      this.death.querySelector('h1')!.textContent = 'RESSUSCITADO';
      this.death.querySelector('.cause')!.textContent = `Medalha de Ressurreição${byName ? ` de ${byName}` : ''}: vidas ${'♥'.repeat(GAME.lives.MAX_DEATHS)} (${GAME.lives.MAX_DEATHS} restantes)`;
      this.renderMedalButton();
    }
    // enquanto a medalha anima, o texto da tela de morte some (senão os dois se sobrepõem)
    this.death.classList.add('medal-fx');
    if (this.medalFxTimer) clearTimeout(this.medalFxTimer);
    this.medalFxTimer = window.setTimeout(() => {
      this.medalFx.classList.remove('visible');
      this.death.classList.remove('medal-fx');
    }, 3200);
  }

  /** Eliminado com medalha no bolso: botão para voltar com todas as vidas. */
  private renderMedalButton(): void {
    const btn = this.death.querySelector<HTMLButtonElement>('.use-medal')!;
    const show = this.death.classList.contains('eliminated') && this.medals > 0;
    btn.style.display = show ? '' : 'none';
    btn.textContent = `🎖 Usar Medalha de Ressurreição (${this.medals})`;
  }

  /** Fogo amigo: virou zumbi — só assiste; o aviso fica discreto no topo para não cobrir o zumbi. */
  private showInfected(targetName: string | null, seconds: number): void {
    this.death.classList.add('infected');
    this.renderMedalButton();
    this.death.querySelector('h1')!.textContent = 'VOCÊ VIROU ZUMBI';
    this.death.querySelector('.cause')!.textContent = targetName
      ? `Seu zumbi caça ${targetName} — mais forte, mais rápido e sem controle: você só assiste. Se ele matar ${targetName}, ${targetName} também vira zumbi.`
      : 'Seu zumbi caça qualquer sobrevivente — mais forte, mais rápido e sem controle: você só assiste.';
    this.startCountdown(seconds, (left) => `Volta ao normal em ${left}s (ou quando o zumbi cair)`);
    this.death.classList.add('visible');
  }

  private startCountdown(seconds: number, text: (left: number) => string): void {
    const timer = this.death.querySelector<HTMLElement>('.timer')!;
    let left = seconds;
    const tick = () => {
      timer.textContent = text(left);
      if (left-- <= 0 && this.countdown) clearInterval(this.countdown);
    };
    if (this.countdown) clearInterval(this.countdown);
    tick();
    this.countdown = window.setInterval(tick, 1000);
  }

  private hideDeath(): void {
    if (this.countdown) clearInterval(this.countdown);
    this.countdown = null;
    this.death.classList.remove('visible', 'infected', 'eliminated', 'medal-fx');
  }

  private render(): void {
    // só avisos de estado (escudo / lentidão / recarga); contadores ficam no menu ESC e no resultado da fase
    const parts: string[] = [];
    const shieldLeft = Math.ceil((this.shieldUntil - Date.now()) / 1000);
    if (shieldLeft > 0) parts.push(`<span class="shield">🛡 Escudo ${shieldLeft}s · vigor infinito</span>`);
    if (Date.now() < this.slowedUntil) parts.push('<span class="slowed">☠ Lento!</span>');
    if (this.equipped === 'glock' && this.ammo.reloading) parts.push('<span class="hud-cooldown">Recarregando...</span>');
    void this.alive;
    void this.kills;
    this.panel.innerHTML = parts.join(' · ');
    this.panel.classList.toggle('visible', parts.length > 0);
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
    if (this.flashTimer) clearTimeout(this.flashTimer);
    if (this.countdown) clearInterval(this.countdown);
    if (this.shieldTimer) clearInterval(this.shieldTimer);
    this.panel.remove();
    this.flash.remove();
    this.death.remove();
    void this.bus;
  }
}
