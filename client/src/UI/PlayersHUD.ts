import * as pc from 'playcanvas';
import type { EventBus } from '@/Core/EventBus';
import type { RemotePlayer } from '@/Entities/Player/RemotePlayer';
import type { GameState } from '@/Core/GameState';
import { accuracyPercent, damageMultiplier, magSize, staminaMultiplier } from '@shared/upgrades';
import { GAME } from '@shared/gameconfig';

/**
 * Contador de jogadores online + etiqueta com o nome flutuando sobre cada jogador remoto
 * (DOM posicionado por worldToScreen — mais simples que texto 3D e sempre legível).
 */
export class PlayersHUD {
  private box: HTMLElement;
  private labels: HTMLElement;
  private labelByPlayer = new Map<RemotePlayer, HTMLElement>();
  private unsubs: Array<() => void> = [];
  private screen = new pc.Vec3();
  private head = new pc.Vec3();

  constructor(
    parent: HTMLElement,
    private bus: EventBus,
    private myName: string,
    private state: GameState,
    private remotes: () => Iterable<RemotePlayer>,
    private camera: () => pc.CameraComponent,
  ) {
    this.box = document.createElement('div');
    this.box.className = 'game-menu';
    parent.appendChild(this.box);
    this.labels = document.createElement('div');
    this.labels.className = 'name-labels';
    parent.appendChild(this.labels);
    this.render([...remotes()].length + 1);
    this.unsubs.push(
      bus.on('net:onlineCount', ({ count }) => this.render(count)),
      bus.on('net:trophy', ({ playerId, trophies }) => {
        // rótulo do remoto muda: recria
        for (const [r, el] of this.labelByPlayer) if (r.id === playerId) el.textContent = `${r.name} 🏆${trophies > 1 ? `×${trophies}` : ''}`;
        this.render(this.count);
      }),
      bus.on('net:playerJoined', ({ name }) => bus.emit('ui:toast', { text: `${name} entrou no jogo` })),
      bus.on('net:playerLeft', ({ name }) => {
        bus.emit('ui:toast', { text: `${name} saiu do jogo` });
        this.update(); // remove o rótulo mesmo se a aba estiver oculta (sem rAF)
      }),
    );
  }

  private count = 1;
  private _open = false;
  onOpenChanged: ((open: boolean) => void) | null = null;

  get open(): boolean {
    return this._open;
  }

  /** Menu de pausa (ESC): identidade, jogadores online e sair da sala. */
  setOpen(open: boolean): void {
    if (this._open === open) return;
    this._open = open;
    if (open) this.render(this.count); // status atualizados na hora de abrir
    this.box.classList.toggle('visible', open);
    this.onOpenChanged?.(open);
  }

  toggle(): void {
    this.setOpen(!this._open);
  }

  private render(count: number): void {
    this.count = count;
    const u = this.state.upgrades;
    const glock = GAME.weapon.glock;
    this.box.innerHTML = `<h2>MENU</h2>
      <p>Você: <b></b>${this.state.trophies > 0 ? ` <span class="trophy" title="Fases zeradas">🏆${this.state.trophies > 1 ? `×${this.state.trophies}` : ''}</span>` : ''} · Online: <span class="count">${count}</span></p>
      <h3>Arma (Glock)</h3>
      <ul class="stats">
        <li>Dano <b>${Math.round(glock.DAMAGE * damageMultiplier(u))}</b> <span class="lvl">Lv ${u.damage}</span></li>
        <li>Pente <b>${this.state.ammo}/${magSize(u)}</b> <span class="lvl">Lv ${u.ammo}</span></li>
        <li>Precisão <b>${accuracyPercent(u)}%</b> <span class="lvl">Lv ${u.recoil}</span></li>
        <li>Mira laser <b>${u.laser ? 'sim' : 'não'}</b></li>
      </ul>
      <h3>Personagem</h3>
      <ul class="stats">
        <li>Vida <b>${Math.round(this.state.hp)}/${GAME.player.MAX_HP}</b></li>
        <li>Vigor <b>${Math.round(this.state.stamina)}/${Math.round(this.state.maxStamina)}</b> <span class="lvl">Lv ${u.stamina} · +${Math.round((staminaMultiplier(u) - 1) * 100)}%</span></li>
        <li>Peso <b>${this.state.carriedWeight}/${this.state.maxWeight}</b> <span class="lvl">Lv ${u.weight}${this.state.hasBackpack ? ' · mochila' : ''}</span></li>
        <li>Medalhas <b>${this.state.medals}</b></li>
        <li>Abates <b>${this.state.kills}</b></li>
      </ul>
      <button class="resume">Voltar ao jogo (Esc)</button>
      <button class="leave">Sair da sala</button>`;
    this.box.querySelector('b')!.textContent = this.myName;
    this.box.querySelector<HTMLButtonElement>('.resume')!.onclick = () => this.setOpen(false);
    this.box.querySelector<HTMLButtonElement>('.leave')!.onclick = () => this.bus.emit('ui:leaveRoom');
    void this.count;
  }

  /** Chamado a cada frame pela cena. */
  update(): void {
    const cam = this.camera();
    const seen = new Set<RemotePlayer>();
    for (const r of this.remotes()) {
      if (!r.visible) continue; // virou zumbi: sem rótulo no corpo escondido
      seen.add(r);
      let el = this.labelByPlayer.get(r);
      if (!el) {
        el = document.createElement('div');
        el.className = 'name-label';
        el.textContent = r.trophies > 0 ? `${r.name} 🏆${r.trophies > 1 ? `×${r.trophies}` : ''}` : r.name;
        this.labels.appendChild(el);
        this.labelByPlayer.set(r, el);
      }
      this.head.copy(r.position);
      this.head.y += 2.2;
      cam.worldToScreen(this.head, this.screen);
      el.style.transform = `translate(-50%, -100%) translate(${this.screen.x.toFixed(0)}px, ${this.screen.y.toFixed(0)}px)`;
    }
    for (const [r, el] of this.labelByPlayer) {
      if (!seen.has(r)) {
        el.remove();
        this.labelByPlayer.delete(r);
      }
    }
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
    this.box.remove();
    this.labels.remove();
  }
}
