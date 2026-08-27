import * as pc from 'playcanvas';
import type { Game } from '@/Core/Game';

/** Cena = ciclo de vida (enter/exit) + update. Cada cena cria suas entidades sob `root`. */
export abstract class BaseScene {
  readonly root: pc.Entity;

  constructor(protected game: Game) {
    this.root = new pc.Entity(this.constructor.name);
  }

  abstract enter(): void;
  abstract update(dt: number): void;

  exit(): void {
    this.root.destroy();
  }

  /** Iluminação padrão: luz direcional + ambiente. */
  protected addDefaultLighting(): void {
    const light = new pc.Entity('sun');
    light.addComponent('light', {
      type: 'directional',
      color: new pc.Color(1, 0.94, 0.82),
      intensity: 1.35,
      castShadows: true,
      shadowBias: 0.2,
      normalOffsetBias: 0.05,
      shadowResolution: 2048,
      shadowDistance: 60,
    });
    light.setEulerAngles(52, -35, 0);
    this.root.addChild(light);
    const scene = this.game.app.scene;
    scene.ambientLight = new pc.Color(0.4, 0.44, 0.48);
    // névoa suave nas bordas do mapa (esconde o fim do mundo e dá profundidade)
    scene.fog.type = pc.FOG_LINEAR;
    scene.fog.color = new pc.Color(0.62, 0.76, 0.88); // esmaece para o azul do céu
    scene.fog.start = 38;
    scene.fog.end = 95;
  }
}
