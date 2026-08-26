import * as pc from 'playcanvas';
import { ItemDatabase } from '@/Items/ItemDatabase';
import { makeBox, makeGroundX, makeSphere, setEntityColor } from '@/Assets/Primitives';
import { instantiateModel } from '@/Assets/ModelAssets';
import { WORLD_OBJECTS, type WorldObjectDef, type WorldObjectKind, type WorldObjectSpec } from '@shared/worldgen';

export type { WorldObjectKind };

const COLORS: Record<WorldObjectKind, string> = {
  stick: ItemDatabase.get('stick').color,
  stone: ItemDatabase.get('stone').color,
  tree: '#2e6b2a',
  rock: '#6f757c',
};

/** Objeto interativo no mundo: coletável simples ou nó de recurso (árvore/rocha). Visual apenas — regras no server. */
export class WorldObject {
  readonly id: number;
  readonly kind: WorldObjectKind;
  readonly entity: pc.Entity;
  readonly def: WorldObjectDef;
  /** hits conhecidos (o server é a fonte; atualizado por node_hit) */
  hits = 0;
  private highlighted = false;
  /** partes que recebem highlight (recoloridas); usado por stick/stone com primitivas */
  private parts: pc.Entity[] = [];
  /** anel de destaque no chão; usado por tree/rock (modelos GLB importados) */
  private highlightMark: pc.Entity | null = null;

  constructor(spec: WorldObjectSpec) {
    this.id = spec.id;
    this.kind = spec.kind;
    this.def = WORLD_OBJECTS[spec.kind];
    this.entity = new pc.Entity(`${spec.kind}#${spec.id}`);
    this.entity.setLocalPosition(spec.x, 0, spec.z);
    this.entity.setLocalEulerAngles(0, spec.rotY, 0);
    this.build();
  }

  private build(): void {
    const c = COLORS[this.kind];
    switch (this.kind) {
      case 'stick':
        this.parts = [makeBox({ color: c, scale: [0.7, 0.08, 0.08], position: [0, 0.05, 0] })];
        break;
      case 'stone':
        this.parts = [makeSphere({ color: c, scale: [0.35, 0.25, 0.3], position: [0, 0.12, 0] })];
        break;
      case 'tree':
        this.entity.addChild(instantiateModel('tree'));
        this.addHighlightMark(0.9);
        return;
      case 'rock':
        this.entity.addChild(instantiateModel('rock'));
        this.addHighlightMark(2.6); // rocha tem base larga; precisa de um X maior pra não ficar escondido embaixo
        return;
    }
    for (const p of this.parts) this.entity.addChild(p);
  }

  /** X vermelho no chão, ligado/desligado pelo highlight (modelos GLB não têm material próprio pra recolorir). */
  private addHighlightMark(size: number): void {
    this.highlightMark = makeGroundX('#e23c3c', size);
    this.highlightMark.enabled = false;
    this.entity.addChild(this.highlightMark);
  }

  get position(): pc.Vec3 {
    return this.entity.getPosition();
  }

  /** Raio de interação extra para objetos grandes. */
  get radius(): number {
    return this.def.radius;
  }

  /** Raio sólido pra colisão física (0 = não bloqueia, o player anda por cima). */
  get solidRadius(): number {
    return this.def.solidRadius;
  }

  get isNode(): boolean {
    return this.def.requiredTool !== null;
  }

  /** Feedback visual de hit confirmado pelo server (encolhe um pouco). */
  setHits(hits: number): void {
    this.hits = hits;
    const s = 1 - 0.08 * hits;
    this.entity.setLocalScale(s, s, s);
  }

  /** Texto do prompt dado o estado (tem ferramenta, canalizando hits automáticos, etc). */
  promptLabel(hasTool: boolean, channeling = false): string {
    const d = this.def;
    if (!this.isNode) return `[E] ${d.verb} ${d.name}`;
    if (!hasTool) return `Equipe ${ItemDatabase.get(d.requiredTool!).name} (1-5) para ${d.verb.toLowerCase()} ${d.name}`;
    if (channeling) return `${d.verbing} ${d.name}... (${this.hits}/${d.hitsRequired})`;
    return `[E] ${d.verb} ${d.name} (${this.hits}/${d.hitsRequired})`;
  }

  setHighlight(on: boolean): void {
    if (this.highlighted === on) return;
    this.highlighted = on;
    if (this.highlightMark) {
      this.highlightMark.enabled = on;
      return;
    }
    const c = COLORS[this.kind];
    for (const p of this.parts) setEntityColor(p, c, on ? 0.6 : 0);
  }

  destroy(): void {
    this.entity.destroy();
  }
}
