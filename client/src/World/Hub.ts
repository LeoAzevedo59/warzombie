import * as pc from 'playcanvas';
import { GAME } from '@shared/gameconfig';
import { makeBox, makeCylinder, makeGroundX, makeSphere } from '@/Assets/Primitives';
import { HUMAN_STATES, instantiateModel, showCharacterWeapon } from '@/Assets/ModelAssets';
import { AnimatedModel } from '@/Entities/AnimatedModel';

export type HubKind = 'vendor' | 'tower';

/** Cor do aço da torre e das faixas vermelhas/brancas do mastro. */
const STEEL = '#8e939a';
const STEEL_DARK = '#5c636b';

/**
 * Torre de comunicação treliçada feita de primitivas (~5,8 m): 4 pernas inclinadas, travessas por
 * nível, plataforma, mastro vermelho/branco com antenas, parabólica e luz de sinalização no topo.
 */
function buildCommTower(): pc.Entity {
  const t = new pc.Entity('comm-tower');
  const H = 4.2; // altura da treliça
  const baseHalf = 0.95;
  const topHalf = 0.42;
  const levels = 4;
  // pernas inclinadas (box fino girado para ir da base ao topo)
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    const leg = makeBox({ color: STEEL, scale: [0.11, 1, 0.11] });
    const x0 = sx * baseHalf;
    const z0 = sz * baseHalf;
    const x1 = sx * topHalf;
    const z1 = sz * topHalf;
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz, H);
    leg.setLocalScale(0.11, len, 0.11);
    leg.setLocalPosition((x0 + x1) / 2, H / 2, (z0 + z1) / 2);
    // orienta o eixo Y do box na direção (dx, H, dz)
    const dir = new pc.Vec3(dx, H, dz).normalize();
    const q = new pc.Quat();
    const up = pc.Vec3.UP;
    const axis = new pc.Vec3().cross(up, dir);
    const angle = Math.acos(Math.max(-1, Math.min(1, up.dot(dir)))) * pc.math.RAD_TO_DEG;
    if (axis.lengthSq() > 1e-6) q.setFromAxisAngle(axis.normalize(), angle);
    leg.setLocalRotation(q);
    t.addChild(leg);
    // pé de concreto
    t.addChild(makeBox({ color: '#6b7076', scale: [0.34, 0.16, 0.34], position: [x0, 0.08, z0] }));
  }
  // travessas horizontais por nível (quadro) + diagonais em X nas faces
  for (let i = 1; i <= levels; i++) {
    const y = (H * i) / levels;
    const half = baseHalf + (topHalf - baseHalf) * (i / levels);
    for (const [rx, rz, sx, sz] of [
      [0, half, half * 2, 0.07],
      [0, -half, half * 2, 0.07],
      [half, 0, 0.07, half * 2],
      [-half, 0, 0.07, half * 2],
    ] as const) {
      t.addChild(makeBox({ color: STEEL_DARK, scale: [sx, 0.07, sz], position: [rx, y, rz] }));
    }
    if (i < levels) {
      const halfLo = baseHalf + (topHalf - baseHalf) * ((i - 1) / levels);
      const yLo = (H * (i - 1)) / levels;
      const midHalf = (half + halfLo) / 2;
      const midY = (y + yLo) / 2;
      const dh = y - yLo;
      const dw = halfLo + half;
      const len = Math.hypot(dw, dh);
      const ang = Math.atan2(dh, dw) * pc.math.RAD_TO_DEG;
      for (const face of [1, -1]) {
        for (const sgn of [1, -1]) {
          const d = makeBox({ color: STEEL_DARK, scale: [len, 0.05, 0.05], position: [0, midY, face * midHalf] });
          d.setLocalEulerAngles(0, 0, sgn * ang);
          t.addChild(d);
        }
      }
    }
  }
  // plataforma + guarda-corpo
  t.addChild(makeBox({ color: '#4a5058', scale: [1.3, 0.1, 1.3], position: [0, H + 0.05, 0] }));
  for (const [x, z, sx, sz] of [
    [0, 0.62, 1.3, 0.05],
    [0, -0.62, 1.3, 0.05],
    [0.62, 0, 0.05, 1.3],
    [-0.62, 0, 0.05, 1.3],
  ] as const) {
    t.addChild(makeBox({ color: STEEL, scale: [sx, 0.05, sz], position: [x, H + 0.55, z] }));
  }
  // mastro vermelho/branco
  const mastH = 2.0;
  const bands = 4;
  for (let i = 0; i < bands; i++) {
    const seg = makeCylinder({ color: i % 2 === 0 ? '#d63d3d' : '#f2f2f2', scale: [0.16, mastH / bands, 0.16], position: [0, H + 0.1 + (mastH / bands) * (i + 0.5), 0] });
    t.addChild(seg);
  }
  // antenas laterais e parabólica
  for (const side of [1, -1]) {
    t.addChild(makeBox({ color: STEEL, scale: [0.05, 0.9, 0.05], position: [side * 0.32, H + 1.1, 0] }));
    t.addChild(makeBox({ color: STEEL, scale: [0.7, 0.04, 0.04], position: [0, H + 1.5, 0] }));
  }
  const dish = makeCylinder({ color: '#d8dde2', scale: [0.6, 0.06, 0.6], position: [0.45, H + 0.75, 0.45] });
  dish.setLocalEulerAngles(0, 45, 60);
  t.addChild(dish);
  t.addChild(makeCylinder({ color: STEEL_DARK, scale: [0.05, 0.4, 0.05], position: [0.32, H + 0.6, 0.32] }));
  // luz de sinalização (pisca no update)
  const beacon = makeSphere({ name: 'beacon', color: '#ff3b3b', scale: [0.2, 0.2, 0.2], position: [0, H + 0.1 + mastH + 0.12, 0], emissive: 2 });
  t.addChild(beacon);
  return t;
}

/**
 * Estrutura fixa do centro do mapa: o vendedor (bancada + tenda + personagem) e a torre de
 * comunicação (treliça de primitivas com o suporte da bateria). Mesma interface de interação dos WorldObjects.
 */
export class HubStructure {
  readonly entity: pc.Entity;
  /** raio extra de interação: dá para negociar de qualquer lado do balcão */
  readonly radius = 1.8;
  readonly solidRadius: number;
  private highlightMark: pc.Entity;
  private highlighted = false;
  private anim: AnimatedModel | null = null;
  private hpFill: pc.Entity | null = null;
  private hpBar: pc.Entity | null = null;
  private beacon: pc.Entity | null = null;
  private blink = 0;

  constructor(
    readonly kind: HubKind,
    spot: { x: number; z: number } = kind === 'vendor' ? GAME.hub.VENDOR : GAME.hub.TOWER,
  ) {
    this.solidRadius = kind === 'vendor' ? GAME.hub.VENDOR_RADIUS : GAME.hub.TOWER_RADIUS;
    this.entity = new pc.Entity(`hub:${kind}`);
    this.entity.setLocalPosition(spot.x, 0, spot.z);

    if (kind === 'vendor') {
      // bancada na frente (lado +Z, virada pro centro), tenda atrás, caixas e fogueira ao lado
      const bench = instantiateModel('workbench');
      bench.setLocalPosition(0, 0, 0.9);
      const tent = instantiateModel('tent');
      tent.setLocalPosition(0, 0, -1.7);
      const tentFrame = instantiateModel('tent_frame');
      tentFrame.setLocalPosition(0, 0, -1.7);
      const sign = instantiateModel('signpost');
      sign.setLocalPosition(1.5, 0, 0.9);
      sign.setLocalEulerAngles(0, 20, 0);
      const box1 = instantiateModel('box');
      box1.setLocalPosition(-1.5, 0, 0.5);
      const box2 = instantiateModel('box');
      box2.setLocalPosition(-1.5, 0.75, 0.5);
      box2.setLocalEulerAngles(0, 30, 0);
      const fire = instantiateModel('campfire');
      fire.setLocalPosition(2.4, 0, -0.6);
      for (const e of [bench, tent, tentFrame, sign, box1, box2, fire]) this.entity.addChild(e);

      const model = instantiateModel('char_lis');
      showCharacterWeapon(model, null);
      const holder = new pc.Entity('vendor-model');
      holder.addChild(model);
      holder.setLocalPosition(0, 0, 0.1);
      holder.setLocalEulerAngles(0, 0, 0); // olha para +Z (centro do mapa, já que o vendedor fica em z negativo)
      this.entity.addChild(holder);
      this.anim = new AnimatedModel(holder, model, 'char_lis');
    } else {
      this.entity.addChild(buildCommTower());
      this.beacon = this.entity.findByName('beacon') as pc.Entity;
      // suporte da bateria (vazio até comprar) na base
      const socket = makeBox({ color: '#2b2f36', scale: [0.6, 0.35, 0.6], position: [0, 0.18, 1.0] });
      this.entity.addChild(socket);
      const barrel = instantiateModel('barrel');
      barrel.setLocalPosition(-1.5, 0, 0.6);
      this.entity.addChild(barrel);
      this.hpBar = new pc.Entity('hpbar');
      this.hpBar.setLocalPosition(0, 6.9, 0);
      this.hpBar.addChild(makeBox({ color: '#111', scale: [2.4, 0.12, 0.1], emissive: 0.6 }));
      this.hpFill = makeBox({ color: '#4db8ff', scale: [2.34, 0.09, 0.12], emissive: 1 });
      this.hpBar.addChild(this.hpFill);
      this.entity.addChild(this.hpBar);
    }

    this.highlightMark = makeGroundX('#ffd34d', 2.2);
    this.highlightMark.enabled = false;
    this.entity.addChild(this.highlightMark);
  }

  /** Chame só depois de `entity` estar na cena (o vendedor tem animação Idle). */
  initAnimation(): void {
    this.anim?.init(HUMAN_STATES, 'Idle');
  }

  /** Vida da torre (0..1) na barra 3D. */
  setHpRatio(ratio: number): void {
    if (!this.hpFill) return;
    const r = Math.max(0, Math.min(1, ratio));
    this.hpFill.setLocalScale(2.34 * r, 0.09, 0.12);
    this.hpFill.setLocalPosition(-1.17 * (1 - r), 0, 0);
  }

  update(dt = 1 / 60): void {
    this.hpBar?.setEulerAngles(0, 45, 0);
    if (this.beacon) {
      this.blink += dt;
      const on = this.blink % 1.6 < 0.25;
      const s = on ? 0.26 : 0.16;
      this.beacon.setLocalScale(s, s, s);
    }
  }

  get position(): pc.Vec3 {
    return this.entity.getPosition();
  }

  promptLabel(): string {
    return this.kind === 'vendor' ? '[E] Negociar com o Vendedor' : '[E] Torre de Comunicação';
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
