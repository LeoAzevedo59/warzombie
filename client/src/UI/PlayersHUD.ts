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
    bus: EventBus,
    private myName: string,
    private remotes: () => Iterable<RemotePlayer>,
    private camera: () => pc.CameraComponent,
  ) {
    this.box = document.createElement('div');
    this.box.className = 'hud-players';
    parent.appendChild(this.box);
    this.labels = document.createElement('div');
    this.labels.className = 'name-labels';
    parent.appendChild(this.labels);
    this.render([...remotes()].length + 1);
    this.unsubs.push(
      bus.on('net:onlineCount', ({ count }) => this.render(count)),
      bus.on('net:playerJoined', ({ name }) => bus.emit('ui:toast', { text: `${name} entrou no jogo` })),
      bus.on('net:playerLeft', ({ name }) => bus.emit('ui:toast', { text: `${name} saiu do jogo` })),
    );
  }

  private render(count: number): void {
    this.box.innerHTML = `Você: <b></b><br/>Online: <span class="count">${count}</span>`;
    this.box.querySelector('b')!.textContent = this.myName;
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
