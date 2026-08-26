import * as pc from 'playcanvas';
import { instantiateModel, MODEL_SCALE } from '@/Assets/ModelAssets';
import { AnimatedModel } from '@/Entities/AnimatedModel';
import { yawToward, facingDir } from '@/Core/Spatial';
import type { PlayerStats } from './PlayerStats';

/** Ajuste de rotação para alinhar a frente do modelo com o eixo +Z (yaw=0), usado por lookAt(). */
const MODEL_YAW_OFFSET = 0;

/** Abaixo dessa velocidade o player é considerado parado (toca Idle). */
const MOVE_EPSILON = 0.05;

/**
 * Entidade visual do jogador: modelo GLB (worker.glb) orientado por lookAt(), com Idle/Walk/Run.
 * Toda a lógica delicada de animação (skinning, bind pose, corrida de ticks) vive em AnimatedModel.
 */
export class Player {
  readonly entity: pc.Entity;
  private model: pc.Entity;
  readonly anim: AnimatedModel;

  velocity = new pc.Vec3();
  crouching = false;
  running = false;
  /** Enquanto > 0 o player mantém a pose de tiro (não troca pra Idle/Walk/Run). */
  private shootPoseTimer = 0;
  /** Lentidão (cuspe de zumbi): fator aplicado à velocidade até `slowUntil` (ms). */
  private slowFactor = 1;
  private slowUntil = 0;

  applySlow(factor: number, seconds: number): void {
    this.slowFactor = factor;
    this.slowUntil = performance.now() + seconds * 1000;
  }

  /** Multiplicador de velocidade atual (1 = normal). */
  get speedMult(): number {
    return performance.now() < this.slowUntil ? this.slowFactor : 1;
  }

  constructor(readonly stats: PlayerStats) {
    this.entity = new pc.Entity('player');
    this.model = instantiateModel('player');
    this.model.setLocalEulerAngles(0, MODEL_YAW_OFFSET, 0);
    this.entity.addChild(this.model);
    this.anim = new AnimatedModel(this.entity, this.model);
  }

  /** Chame só depois de `entity` já estar na árvore da cena. */
  initAnimation(): void {
    this.anim.init(
      [{ name: 'Idle' }, { name: 'Walk' }, { name: 'Run' }, { name: 'Gun_Shoot', loop: false }, { name: 'Death', loop: false }],
      'Idle',
    );
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
    if (this.crouching === on) return;
    this.crouching = on;
    const base = MODEL_SCALE.player;
    const s = on ? 0.6 : 1;
    this.model.setLocalScale(base, base * s, base);
  }

  /** Dispara a animação de tiro por um curto período. */
  playShoot(): void {
    this.shootPoseTimer = 0.25;
    this.anim.play('Gun_Shoot', 0.05, true);
  }

  /** Troca Idle/Walk/Run conforme a velocidade atual. Chamado pelo MovementSystem a cada frame. */
  updateAnimation(dt: number): void {
    if (this.stats.dead) return; // Death fica até o respawn
    if (this.shootPoseTimer > 0) {
      this.shootPoseTimer -= dt;
      return;
    }
    const moving = this.velocity.lengthSq() > MOVE_EPSILON * MOVE_EPSILON;
    this.anim.play(!moving ? 'Idle' : this.running ? 'Run' : 'Walk');
  }

  dispose(): void {
    this.anim.dispose();
  }
}
