import * as pc from 'playcanvas';
import { instantiateModel } from '@/Assets/ModelAssets';
import { AnimatedModel } from '@/Entities/AnimatedModel';
import { MODEL_SCALE } from '@/Assets/ModelAssets';
import type { NetAnim, PlayerPose, PlayerSnapshot } from '@shared/protocol';

/** Tom azulado para diferenciar outros jogadores do local (mesmo worker.glb). */
const REMOTE_TINT = new pc.Color(0.7, 0.8, 1.0);
/** Velocidade da interpolação de posição/rotação (maior = segue mais perto, menos suave). */
const LERP_SPEED = 12;

/**
 * Representação visual de outro jogador. Recebe poses discretas do servidor (tickRate Hz)
 * e interpola entre elas a cada frame para o movimento ficar contínuo.
 */
export class RemotePlayer {
  readonly entity: pc.Entity;
  readonly anim: AnimatedModel;
  private model: pc.Entity;
  private target = new pc.Vec3();
  private targetYaw = 0;
  private currentYaw = 0;
  private targetAnim: NetAnim = 'Idle';
  private crouching = false;
  name: string;
  hp: number;
  kills: number;

  constructor(readonly id: string, snapshot: PlayerSnapshot) {
    this.name = snapshot.name;
    this.hp = snapshot.hp;
    this.kills = snapshot.kills;
    this.entity = new pc.Entity(`remote:${snapshot.name}`);
    this.model = instantiateModel('player');
    this.entity.addChild(this.model);
    this.tint();
    this.anim = new AnimatedModel(this.entity, this.model);
    this.entity.setPosition(snapshot.x, 0, snapshot.z);
    this.entity.setEulerAngles(0, snapshot.yaw, 0);
    this.target.set(snapshot.x, 0, snapshot.z);
    this.targetYaw = this.currentYaw = snapshot.yaw;
    this.targetAnim = snapshot.anim;
  }

  /** Chame só depois de `entity` estar na cena. */
  initAnimation(): void {
    this.anim.init([{ name: 'Idle' }, { name: 'Walk' }, { name: 'Run' }, { name: 'Gun_Shoot', loop: false }, { name: 'Death', loop: false }], 'Idle');
  }

  private tint(): void {
    const renders = this.model.findComponents('render') as pc.RenderComponent[];
    for (const r of renders) {
      const cloned = r.meshInstances.map((mi) => {
        const m = (mi.material as pc.StandardMaterial).clone();
        m.diffuse.copy(REMOTE_TINT);
        m.update();
        return m;
      });
      r.meshInstances.forEach((mi, i) => (mi.material = cloned[i]));
    }
  }

  get position(): pc.Vec3 {
    return this.entity.getPosition();
  }

  dead = false;

  playShoot(): void {
    if (!this.dead) this.anim.play('Gun_Shoot', 0.05, true);
  }

  die(): void {
    this.dead = true;
    this.anim.play('Death', 0.1, true);
  }

  respawn(x: number, z: number): void {
    this.dead = false;
    this.hp = 100;
    this.entity.setPosition(x, 0, z);
    this.target.set(x, 0, z);
    this.targetAnim = 'Idle';
    this.anim.play('Idle', 0.1, true);
  }

  applyPose(pose: PlayerPose): void {
    if (this.dead) return; // o servidor congela a pose de quem morreu
    this.target.set(pose.x, 0, pose.z);
    this.targetYaw = pose.yaw;
    if (pose.anim !== this.targetAnim) {
      this.targetAnim = pose.anim;
      this.anim.play(pose.anim, 0.1, pose.anim === 'Gun_Shoot');
    }
    if (pose.crouching !== this.crouching) {
      this.crouching = pose.crouching;
      const base = MODEL_SCALE.player;
      this.model.setLocalScale(base, base * (pose.crouching ? 0.6 : 1), base);
    }
  }

  update(dt: number): void {
    const t = 1 - Math.exp(-LERP_SPEED * dt);
    const pos = this.entity.getPosition();
    const nx = pos.x + (this.target.x - pos.x) * t;
    const nz = pos.z + (this.target.z - pos.z) * t;
    this.entity.setPosition(nx, 0, nz);

    // menor diferença angular (evita girar 350° em vez de -10°)
    let diff = ((this.targetYaw - this.currentYaw + 540) % 360) - 180;
    this.currentYaw += diff * t;
    this.entity.setEulerAngles(0, this.currentYaw, 0);
  }

  dispose(): void {
    this.anim.dispose();
    this.entity.destroy();
  }
}
