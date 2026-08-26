import * as pc from 'playcanvas';
import type { EventBus } from '@/Core/EventBus';
import type { RemotePlayer } from '@/Entities/Player/RemotePlayer';

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
    this.box.classList.toggle('visible', open);
    this.onOpenChanged?.(open);
  }

  toggle(): void {
    this.setOpen(!this._open);
  }

  private render(count: number): void {
    this.count = count;
    this.box.innerHTML = `<h2>MENU</h2>
      <p>Você: <b></b></p>
      <p>Online: <span class="count">${count}</span></p>
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
      seen.add(r);
      let el = this.labelByPlayer.get(r);
      if (!el) {
        el = document.createElement('div');
        el.className = 'name-label';
        el.textContent = r.name;
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
