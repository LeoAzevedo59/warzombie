import * as pc from 'playcanvas';
import { EventBus } from './EventBus';
import { GameState } from './GameState';
import type { BaseScene } from '@/Scenes/BaseScene';
import { MainMenu } from '@/Scenes/MainMenu';
import { WorldScene } from '@/Scenes/WorldScene';
import { preloadModels } from '@/Assets/ModelAssets';
import { NetworkClient } from '@/Net/NetworkClient';

/** Raiz do jogo: cria a pc.Application, gerencia a cena ativa e o frame update. */
export class Game {
  readonly app: pc.Application;
  readonly bus = new EventBus();
  readonly state = new GameState();
  /** Conexão com o servidor multiplayer; o join acontece no MainMenu. */
  readonly net = new NetworkClient();
  /** Promise do preload em andamento; recriada por ensureModels() se a anterior falhou. */
  private modelsPromise: Promise<void>;
  private modelsFailed = false;
  private scene: BaseScene | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    readonly ui: HTMLElement,
  ) {
    this.app = new pc.Application(canvas, {
      mouse: new pc.Mouse(canvas),
      keyboard: new pc.Keyboard(window),
      graphicsDeviceOptions: { antialias: true },
    });
    this.app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    this.app.setCanvasResolution(pc.RESOLUTION_AUTO);
    window.addEventListener('resize', () => this.app.resizeCanvas());

    this.app.on('update', (dt: number) => this.scene?.update(dt));
    this.bus.on('scene:change', ({ scene }) => this.changeScene(scene));

    this.modelsPromise = this.loadModels();
  }

  private loadModels(): Promise<void> {
    this.modelsFailed = false;
    const p = preloadModels(this.app);
    p.catch(() => {
      this.modelsFailed = true;
    });
    return p;
  }

  /** Aguarda os modelos GLB; se o preload anterior falhou, tenta de novo (retry do menu). */
  ensureModels(): Promise<void> {
    if (this.modelsFailed) this.modelsPromise = this.loadModels();
    return this.modelsPromise;
  }

  start(): void {
    this.app.start();
    this.changeScene('menu');
  }

  changeScene(name: 'menu' | 'world'): void {
    this.scene?.exit();
    this.scene = name === 'menu' ? new MainMenu(this) : new WorldScene(this);
    this.app.root.addChild(this.scene.root);
    this.scene.enter();
  }
}
