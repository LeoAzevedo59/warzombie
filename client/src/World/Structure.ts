import * as pc from 'playcanvas';
import { makeBox, makeGroundX } from '@/Assets/Primitives';

/** Mesa de marceneiro: estrutura colocável pelo jogador que abre o painel de refino. */
export class Workbench {
  readonly kind = 'workbench' as const;
  readonly entity: pc.Entity;
  readonly radius = 1.4;
  /** Raio sólido pra colisão física. */
  readonly solidRadius = 0.8;
  private highlightMark: pc.Entity;
  private highlighted = false;

  constructor(
    readonly id: number,
    x: number,
    z: number,
  ) {
    this.entity = new pc.Entity(`workbench#${id}`);
    this.entity.setLocalPosition(x, 0, z);

    const top = makeBox({ name: 'top', color: '#8a5a2b', scale: [1.6, 0.15, 1], position: [0, 0.9, 0] });
    const legPositions: [number, number, number][] = [
      [-0.65, 0.45, -0.4],
      [0.65, 0.45, -0.4],
      [-0.65, 0.45, 0.4],
      [0.65, 0.45, 0.4],
    ];
    this.entity.addChild(top);
    for (const pos of legPositions) {
      this.entity.addChild(makeBox({ color: '#5a3b1e', scale: [0.15, 0.9, 0.15], position: pos }));
    }

    this.highlightMark = makeGroundX('#e23c3c', 1.7); // mesa tem base larga; X precisa passar dela
    this.highlightMark.enabled = false;
    this.entity.addChild(this.highlightMark);
  }

  get position(): pc.Vec3 {
    return this.entity.getPosition();
  }

  promptLabel(): string {
    return '[E] Usar Mesa de Marceneiro';
  }

  setHighlight(on: boolean): void {
    if (this.highlighted === on) return;
    this.highlighted = on;
    this.highlightMark.enabled = on;
  }

  destroy(): void {
    this.entity.destroy();
  }
}
