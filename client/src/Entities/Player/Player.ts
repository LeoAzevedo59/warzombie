import * as pc from 'playcanvas';
import { HUMAN_STATES, instantiateModel, showCharacterBattery, showCharacterWeapon, type CharacterAnimName, type CharacterWeaponNode } from '@/Assets/ModelAssets';
import { AnimatedModel } from '@/Entities/AnimatedModel';
import { CharacterFx } from '@/Entities/CharacterFx';
import { yawToward, facingDir } from '@/Core/Spatial';
import type { ItemId } from '@/Items/Item';
import type { PlayerStats } from './PlayerStats';
import type { CharacterId } from '@shared/protocol';

/** Ajuste de rotação para alinhar a frente do modelo com o eixo +Z (yaw=0), usado por lookAt(). */
const MODEL_YAW_OFFSET = 0;

/** Abaixo dessa velocidade o player é considerado parado (toca Idle). */
const MOVE_EPSILON = 0.05;

/** Item equipado -> nó de arma embutido no GLB do personagem. */
export function weaponNodeFor(item: ItemId | null): CharacterWeaponNode | null {
  switch (item) {
    case 'knife':
      return 'Knife';
    case 'glock':
      return 'Pistol';
    case 'axe':
    case 'pickaxe':
      return 'Axe';
    default:
      return null;
  }
}

/**
 * Entidade visual do jogador: personagem do Zombie Apocalypse Kit orientado por lookAt(), com
 * Idle/Walk/Run (variantes _Gun quando a pistola está na mão), Stab (faca), Duck (agachado) e Death.
 * Toda a lógica delicada de animação (skinning, bind pose, corrida de ticks) vive em AnimatedModel.
 */
export class Player {
  readonly entity: pc.Entity;
  private model: pc.Entity;
  readonly anim: AnimatedModel;
  readonly fx: CharacterFx;

  velocity = new pc.Vec3();
  crouching = false;
  running = false;
  /** Enquanto > 0 o player mantém a pose de tiro/golpe (não troca pra Idle/Walk/Run). */
  private shootPoseTimer = 0;
  /** Lentidão (cuspe de zumbi): fator aplicado à velocidade até `slowUntil` (ms). */
  private slowFactor = 1;
  private slowUntil = 0;
  private equipped: ItemId | null = null;

  applySlow(factor: number, seconds: number): void {
    this.slowFactor = factor;
    this.slowUntil = performance.now() + seconds * 1000;
  }

  /** Multiplicador de velocidade atual (1 = normal). */
  get speedMult(): number {
    return performance.now() < this.slowUntil ? this.slowFactor : 1;
  }

  constructor(
    readonly stats: PlayerStats,
    character: CharacterId = 'shaun',
  ) {
    const key = `char_${character}` as const;
    this.entity = new pc.Entity('player');
    this.model = instantiateModel(key);
    this.model.setLocalEulerAngles(0, MODEL_YAW_OFFSET, 0);
    showCharacterWeapon(this.model, null);
    this.entity.addChild(this.model);
    this.anim = new AnimatedModel(this.entity, this.model, key);
    this.fx = new CharacterFx(this.model);
  }

  /** Chame só depois de `entity` já estar na árvore da cena. */
  initAnimation(): void {
    this.anim.init(HUMAN_STATES, 'Idle');
  }

  /** Item equipado: mostra a arma correspondente na mão e muda o conjunto Idle/Walk/Run. */
  setEquipped(item: ItemId | null): void {
    this.equipped = item;
    showCharacterWeapon(this.model, weaponNodeFor(item));
    showCharacterBattery(this.model, item === 'battery');
  }

  private get gunMode(): boolean {
    return this.equipped === 'glock';
  }

  get position(): pc.Vec3 {
    return this.entity.getPosition();
  }

  setPosition(x: number, y: number, z: number): void {
    this.entity.setPosition(x, y, z);
  }

  /** Gira o corpo para olhar para um ponto no plano do chão. */
  lookAt(point: pc.Vec3): void {
    yawToward(this.entity, point);
  }

  /** Vetor unitário para onde o personagem está olhando (plano do chão). */
  forward(out = new pc.Vec3()): pc.Vec3 {
    return facingDir(this.entity, out);
  }

  setCrouch(on: boolean): void {
    this.crouching = on;
  }

  /** Golpe de faca / machado. */
  playMelee(): void {
    this.shootPoseTimer = 0.4;
    this.anim.play(this.equipped === 'axe' || this.equipped === 'pickaxe' ? 'Slash' : 'Punch_Left', 0.05, true);
  }

  /** Dispara a animação de tiro por um curto período. */
  playShoot(): void {
    this.shootPoseTimer = 0.25;
    this.anim.play('Gun_Shoot', 0.05, true);
    this.fx.shoot();
  }

  /** Troca Idle/Walk/Run conforme a velocidade atual. Chamado pelo MovementSystem a cada frame. */
  updateAnimation(dt: number): void {
    if (this.stats.dead) return; // Death fica até o respawn
    if (this.shootPoseTimer > 0) {
      this.shootPoseTimer -= dt;
      return;
    }
    const moving = this.velocity.lengthSq() > MOVE_EPSILON * MOVE_EPSILON;
    let next: CharacterAnimName;
    if (!moving) next = this.crouching ? 'Duck' : this.gunMode ? 'Idle_Gun' : 'Idle';
    else if (this.running) next = this.gunMode ? 'Run_Gun' : 'Run';
    else next = this.gunMode ? 'Walk_Gun' : 'Walk';
    this.anim.play(next);
  }

  dispose(): void {
    this.fx.dispose();
    this.anim.dispose();
  }
}
