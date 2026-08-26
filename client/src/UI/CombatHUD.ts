import type { EventBus } from '@/Core/EventBus';
import type { ItemId } from '@/Items/Item';
import { accuracyPercent } from '@shared/upgrades';
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
  private upgrades: WeaponUpgrades = { damage: 0, ammo: 0, recoil: 0, stamina: 0 };
  private shieldTimer: number | null = null;

  constructor(
    parent: HTMLElement,
    private bus: EventBus,
    myId: string | null,
    initialKills = 0,
    initialUpgrades?: WeaponUpgrades,
  ) {
    this.kills = initialKills;
    if (initialUpgrades) this.upgrades = initialUpgrades;
    this.panel = document.createElement('div');
    this.panel.className = 'hud-zombies';
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
      bus.on('net:upgrades', ({ upgrades }) => {
        this.upgrades = upgrades;
        this.render();
      }),
      bus.on('net:ammo', (a) => {
        this.ammo = a;
        this.render();
      }),
      bus.on('player:damaged', ({ special }) => this.showFlash(special)),
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
      bus.on('player:died', ({ killerName, respawnIn }) => this.showDeath(killerName, respawnIn)),
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

  private showDeath(killerName: string | null, respawnIn: number): void {
    this.death.querySelector('.cause')!.textContent = killerName ? `${killerName} te matou.` : 'Os zumbis te pegaram.';
    const timer = this.death.querySelector<HTMLElement>('.timer')!;
    let left = respawnIn;
    const tick = () => {
      timer.textContent = `Renascendo em ${left}s...`;
      if (left-- <= 0 && this.countdown) clearInterval(this.countdown);
    };
    if (this.countdown) clearInterval(this.countdown);
    tick();
    this.countdown = window.setInterval(tick, 1000);
    this.death.classList.add('visible');
  }

  private hideDeath(): void {
    if (this.countdown) clearInterval(this.countdown);
    this.countdown = null;
    this.death.classList.remove('visible');
  }

  private render(): void {
    let hint: string;
    if (this.equipped === 'glock') {
      hint = this.ammo.reloading
        ? '<span class="hud-cooldown">Recarregando...</span>'
        : `Munição: <b>${this.ammo.mag}/${this.ammo.magSize}</b> · Precisão: <b>${accuracyPercent(this.upgrades)}%</b> <span class="hud-cooldown">· R recarrega</span>`;
    } else {
      hint = '';
    }
    const slow = Date.now() < this.slowedUntil ? '<br/><span class="slowed">☠ Lento! (cuspe)</span>' : '';
    const shieldLeft = Math.ceil((this.shieldUntil - Date.now()) / 1000);
    const shield = shieldLeft > 0 ? `<br/><span class="shield">🛡 Escudo ${shieldLeft}s</span>` : '';
    this.panel.innerHTML = `Zumbis: <b>${this.alive}</b> · Abates: <span class="kills">${this.kills}</span>${hint ? '<br/>' + hint : ''}${shield}${slow}`;
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
