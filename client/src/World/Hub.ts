import * as pc from 'playcanvas';
import { GAME } from '@shared/gameconfig';
import { makeBox, makeCylinder, makeGroundX } from '@/Assets/Primitives';
import { instantiateModel } from '@/Assets/ModelAssets';
import { AnimatedModel } from '@/Entities/AnimatedModel';

export type HubKind = 'vendor' | 'tower';

const VENDOR_TINT = new pc.Color(1.0, 0.85, 0.45);

/**
 * Estrutura fixa do centro do mapa: o vendedor (compra/venda) e a torre (bateria → waves, M3).
 * Mesma interface de interação dos WorldObjects (position/radius/promptLabel/setHighlight).
 */
export class HubStructure {
  readonly entity: pc.Entity;
  /** raio extra de interação: dá para negociar de qualquer lado do balcão */
  readonly radius = 1.8;
  readonly solidRadius: number;
  private highlightMark: pc.Entity;
  private highlighted = false;
  private anim: AnimatedModel | null = null;

  constructor(readonly kind: HubKind) {
    const spot = kind === 'vendor' ? GAME.hub.VENDOR : GAME.hub.TOWER;
    this.solidRadius = kind === 'vendor' ? GAME.hub.VENDOR_RADIUS : GAME.hub.TOWER_RADIUS;
    this.entity = new pc.Entity(`hub:${kind}`);
    this.entity.setLocalPosition(spot.x, 0, spot.z);

    if (kind === 'vendor') {
      // balcão + vendedor (worker.glb tingido, parado em Idle olhando para o centro)
      const counter = makeBox({ color: '#7a4a24', scale: [2.2, 0.9, 0.7], position: [0, 0.45, 0.9] });
      const top = makeBox({ color: '#c9a06a', scale: [2.4, 0.08, 0.9], position: [0, 0.94, 0.9] });
      const sign = makeBox({ color: '#ffd34d', scale: [1.6, 0.4, 0.06], position: [0, 2.1, 0.9], emissive: 0.6 });
      const post1 = makeBox({ color: '#5a3b1e', scale: [0.08, 2.1, 0.08], position: [-1, 1.05, 1.3] });
      const post2 = makeBox({ color: '#5a3b1e', scale: [0.08, 2.1, 0.08], position: [1, 1.05, 1.3] });
      for (const e of [counter, top, sign, post1, post2]) this.entity.addChild(e);
      const model = instantiateModel('player');
      this.tint(model, VENDOR_TINT);
      const holder = new pc.Entity('vendor-model');
      holder.addChild(model);
      holder.setLocalEulerAngles(0, 0, 0); // olha para +Z (centro do mapa, já que o vendedor fica em z negativo)
      this.entity.addChild(holder);
      this.anim = new AnimatedModel(holder, model);
    } else {
      // torre: base de pedra + coluna + suporte da bateria (vazio até comprar)
      const base = makeCylinder({ color: '#4a5058', scale: [1.8, 0.3, 1.8], position: [0, 0.15, 0] });
      const column = makeCylinder({ color: '#5c6670', scale: [0.6, 2.4, 0.6], position: [0, 1.5, 0] });
      const socket = makeBox({ color: '#2b2f36', scale: [0.7, 0.4, 0.7], position: [0, 2.9, 0] });
      const antenna = makeCylinder({ color: '#8e939a', scale: [0.08, 1.2, 0.08], position: [0, 3.6, 0] });
      for (const e of [base, column, socket, antenna]) this.entity.addChild(e);
    }

    this.highlightMark = makeGroundX('#ffd34d', 2.2);
    this.highlightMark.enabled = false;
    this.entity.addChild(this.highlightMark);
  }

  /** Chame só depois de `entity` estar na cena (o vendedor tem animação Idle). */
  initAnimation(): void {
    this.anim?.init([{ name: 'Idle' }], 'Idle');
  }

  private tint(model: pc.Entity, color: pc.Color): void {
    const renders = model.findComponents('render') as pc.RenderComponent[];
    for (const r of renders) {
      const cloned = r.meshInstances.map((mi) => {
        const m = (mi.material as pc.StandardMaterial).clone();
        m.diffuse.copy(color);
        m.update();
        return m;
      });
      r.meshInstances.forEach((mi, i) => (mi.material = cloned[i]));
    }
  }

  get position(): pc.Vec3 {
    return this.entity.getPosition();
  }

  promptLabel(): string {
    return this.kind === 'vendor' ? '[E] Negociar com o Vendedor' : 'Torre — coloque uma Bateria (E) para iniciar as waves';
  }

  setHighlight(on: boolean): void {
    if (this.highlighted === on) return;
    this.highlighted = on;
    this.highlightMark.enabled = on;
  }

  destroy(): void {
    this.anim?.dispose();
    this.entity.destroy();
  }
}
