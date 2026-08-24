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
      color: new pc.Color(1, 0.96, 0.9),
      intensity: 1.4,
      castShadows: true,
      shadowBias: 0.2,
      normalOffsetBias: 0.05,
      shadowResolution: 2048,
      shadowDistance: 60,
    });
    light.setEulerAngles(55, 30, 0);
    this.root.addChild(light);
    this.game.app.scene.ambientLight = new pc.Color(0.35, 0.38, 0.42);
  }
}
