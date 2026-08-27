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

  constructor(
    parent: HTMLElement,
    private bus: EventBus,
    myId: string | null,
    initialKills = 0,
    initialUpgrades?: WeaponUpgrades,
  ) {
    this.kills = initialKills;
    void initialUpgrades;
    this.panel = document.createElement('div');
    this.panel.className = 'hud-status';
    parent.appendChild(this.panel);

    this.flash = document.createElement('div');
    this.flash.className = 'damage-flash';
    parent.appendChild(this.flash);

    this.death = document.createElement('div');
    this.death.className = 'death-screen';
    this.death.innerHTML = `<h1>VOCÊ MORREU</h1><p class="cause"></p><p class="timer"></p>`;
    parent.appendChild(this.death);

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
      bus.on('net:gameOver', () => this.hideDeath()),
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
    this.death.querySelector<HTMLElement>('.timer')!.textContent = 'Um aliado pode comprar uma Medalha de Ressurreição no vendedor para te reviver.';
    this.death.classList.add('visible');
  }

  /** Fogo amigo: virou zumbi — só assiste; o aviso fica discreto no topo para não cobrir o zumbi. */
  private showInfected(targetName: string | null, seconds: number): void {
    this.death.classList.add('infected');
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
    this.death.classList.remove('visible', 'infected', 'eliminated');
  }

  private render(): void {
    // só avisos de estado (escudo / lentidão / recarga); contadores ficam no menu ESC e no resultado da fase
    const parts: string[] = [];
    const shieldLeft = Math.ceil((this.shieldUntil - Date.now()) / 1000);
    if (shieldLeft > 0) parts.push(`<span class="shield">🛡 Escudo ${shieldLeft}s</span>`);
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
