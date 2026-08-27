import * as pc from 'playcanvas';
import { GAME } from '@shared/gameconfig';
import { makeBox, makeGroundX } from '@/Assets/Primitives';
import { HUMAN_STATES, instantiateModel, showCharacterWeapon } from '@/Assets/ModelAssets';
import { AnimatedModel } from '@/Entities/AnimatedModel';

export type HubKind = 'vendor' | 'tower';

/**
 * Estrutura fixa do centro do mapa: o vendedor (bancada + tenda + personagem) e a torre
 * (caixa d'água com o suporte da bateria). Mesma interface de interação dos WorldObjects.
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
      const tower = instantiateModel('water_tower');
      this.entity.addChild(tower);
      // suporte da bateria (vazio até comprar) na base
      const socket = makeBox({ color: '#2b2f36', scale: [0.6, 0.35, 0.6], position: [0, 0.18, 1.0] });
      this.entity.addChild(socket);
      const barrel = instantiateModel('barrel');
      barrel.setLocalPosition(-1.5, 0, 0.6);
      this.entity.addChild(barrel);
      this.hpBar = new pc.Entity('hpbar');
      this.hpBar.setLocalPosition(0, 5.3, 0);
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

  update(): void {
    this.hpBar?.setEulerAngles(0, 45, 0);
  }

  get position(): pc.Vec3 {
    return this.entity.getPosition();
  }

  promptLabel(): string {
    return this.kind === 'vendor' ? '[E] Negociar com o Vendedor' : '[E] Colocar Bateria na Torre (inicia as waves)';
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
