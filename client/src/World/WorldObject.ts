import * as pc from 'playcanvas';
import type { ItemId, ItemStack } from '@/Items/Item';
import { ItemDatabase } from '@/Items/ItemDatabase';
import { makeBox, makeGroundX, makeSphere, setEntityColor } from '@/Assets/Primitives';
import { instantiateModel } from '@/Assets/ModelAssets';

export type WorldObjectKind = 'stick' | 'stone' | 'tree' | 'rock' | 'pistol';

interface WorldObjectDef {
  name: string;
  /** null = pegar direto com E; senão exige ferramenta e vários hits */
  requiredTool: ItemId | null;
  hitsRequired: number;
  drops: ItemStack[];
  verb: string;
  /** gerúndio usado enquanto o canal de hits automáticos está ativo (só nós usam) */
  verbing?: string;
}

export const WORLD_OBJECTS: Record<WorldObjectKind, WorldObjectDef> = {
  stick: { name: 'Graveto', requiredTool: null, hitsRequired: 1, drops: [{ itemId: 'stick', count: 1 }], verb: 'Pegar' },
  stone: { name: 'Pedra', requiredTool: null, hitsRequired: 1, drops: [{ itemId: 'stone', count: 1 }], verb: 'Pegar' },
  pistol: { name: 'Pistola', requiredTool: null, hitsRequired: 1, drops: [{ itemId: 'pistol', count: 1 }], verb: 'Pegar' },
  tree: {
    name: 'Árvore',
    requiredTool: 'axe',
    hitsRequired: 3,
    drops: [{ itemId: 'wood', count: 3 }],
    verb: 'Cortar',
    verbing: 'Cortando',
  },
  rock: {
    name: 'Rocha',
    requiredTool: 'pickaxe',
    hitsRequired: 4,
    drops: [{ itemId: 'stone', count: 3 }],
    verb: 'Minerar',
    verbing: 'Minerando',
  },
};

const COLORS: Record<WorldObjectKind, string> = {
  stick: ItemDatabase.get('stick').color,
  stone: ItemDatabase.get('stone').color,
  tree: '#2e6b2a',
  rock: '#6f757c',
  pistol: ItemDatabase.get('pistol').color,
};

/** Objeto interativo no mundo: coletável simples ou nó de recurso (árvore/rocha). */
export class WorldObject {
  readonly entity: pc.Entity;
  readonly def: WorldObjectDef;
  hits = 0;
  private highlighted = false;
  /** partes que recebem highlight (recoloridas); usado por stick/stone com primitivas */
  private parts: pc.Entity[] = [];
  /** anel de destaque no chão; usado por tree/rock (modelos GLB importados) */
  private highlightMark: pc.Entity | null = null;

  constructor(
    readonly id: number,
    readonly kind: WorldObjectKind,
    x: number,
    z: number,
    rotY: number,
  ) {
    this.def = WORLD_OBJECTS[kind];
    this.entity = new pc.Entity(`${kind}#${id}`);
    this.entity.setLocalPosition(x, 0, z);
    this.entity.setLocalEulerAngles(0, rotY, 0);
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
      case 'pistol': {
        // cano + cabo, deitada no chão
        const barrel = makeBox({ color: c, scale: [0.45, 0.08, 0.1], position: [0.05, 0.06, 0] });
        const grip = makeBox({ color: '#5a3a1e', scale: [0.1, 0.08, 0.22], position: [-0.12, 0.06, 0.1] });
        const glow = makeGroundX('#ffd34d', 0.8);
        this.parts = [barrel, grip];
        this.entity.addChild(glow);
        break;
      }
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
    return this.kind === 'tree' || this.kind === 'rock' ? 1.2 : 0;
  }

  /** Raio sólido pra colisão física (0 = não bloqueia, o player anda por cima). */
  get solidRadius(): number {
    if (this.kind === 'tree') return 0.4; // tronco
    if (this.kind === 'rock') return 0.9;
    return 0;
  }

  get isNode(): boolean {
    return this.def.requiredTool !== null;
  }

  get broken(): boolean {
    return this.hits >= this.def.hitsRequired;
  }

  /** Registra um hit e dá feedback visual (encolhe um pouco). */
  hit(): void {
    this.hits++;
    const s = 1 - 0.08 * this.hits;
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
