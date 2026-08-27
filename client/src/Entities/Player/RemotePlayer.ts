import * as pc from 'playcanvas';
import { characterForId, HUMAN_STATES, instantiateModel, showCharacterWeapon, type CharacterWeaponNode, type ModelKey } from '@/Assets/ModelAssets';
import { AnimatedModel } from '@/Entities/AnimatedModel';
import { CharacterFx } from '@/Entities/CharacterFx';
import type { NetAnim, PlayerPose, PlayerSnapshot } from '@shared/protocol';

/** Velocidade da interpolação de posição/rotação (maior = segue mais perto, menos suave). */
const LERP_SPEED = 12;

/**
 * Representação visual de outro jogador. Recebe poses discretas do servidor (tickRate Hz)
 * e interpola entre elas a cada frame para o movimento ficar contínuo.
 */
export class RemotePlayer {
  readonly entity: pc.Entity;
  readonly anim: AnimatedModel;
  readonly fx: CharacterFx;
  private modelKey: ModelKey;
  /** s restantes mostrando a arma inferida da última animação (o snapshot remoto não traz o item equipado) */
  private weaponTimer = 0;
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
    this.modelKey = characterForId(id);
    this.model = instantiateModel(this.modelKey);
    showCharacterWeapon(this.model, null);
    this.entity.addChild(this.model);
    this.anim = new AnimatedModel(this.entity, this.model, this.modelKey);
    this.fx = new CharacterFx(this.model);
    this.entity.setPosition(snapshot.x, 0, snapshot.z);
    this.entity.setEulerAngles(0, snapshot.yaw, 0);
    this.target.set(snapshot.x, 0, snapshot.z);
    this.targetYaw = this.currentYaw = snapshot.yaw;
    this.targetAnim = snapshot.anim;
  }

  /** Chame só depois de `entity` estar na cena. */
  initAnimation(): void {
    this.anim.init(HUMAN_STATES, 'Idle');
  }

  get position(): pc.Vec3 {
    return this.entity.getPosition();
  }

  dead = false;

  playShoot(): void {
    if (!this.dead) this.anim.play('Gun_Shoot', 0.05, true);
    this.showWeapon('Pistol');
    this.fx.shoot();
  }

  playMelee(): void {
    if (!this.dead) this.anim.play('Punch_Left', 0.05, true);
    this.showWeapon('Knife');
  }

  die(): void {
    this.dead = true;
    this.anim.play('Death', 0.1, true);
  }

  /** Virou zumbi: o corpo some (o zumbi `infected` com `owner` = este jogador o representa). */
  hide(): void {
    this.entity.enabled = false;
  }

  get visible(): boolean {
    return this.entity.enabled;
  }

  respawn(x: number, z: number): void {
    this.dead = false;
    this.entity.enabled = true;
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
    this.crouching = pose.crouching;
    if (this.crouching && pose.anim === 'Idle') this.anim.play('Duck', 0.1);
  }

  private showWeapon(node: CharacterWeaponNode): void {
    showCharacterWeapon(this.model, node);
    this.weaponTimer = 6;
  }

  update(dt: number): void {
    if (this.weaponTimer > 0) {
      this.weaponTimer -= dt;
      if (this.weaponTimer <= 0) showCharacterWeapon(this.model, null);
    }
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
    this.fx.dispose();
    this.anim.dispose();
    this.entity.destroy();
  }
}
