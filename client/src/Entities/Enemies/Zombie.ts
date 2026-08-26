import * as pc from 'playcanvas';
import { CONFIG } from '@/config';
import { GAME } from '@shared/gameconfig';
import { instantiateModel, MODEL_SCALE, type CharacterAnimName } from '@/Assets/ModelAssets';
import { AnimatedModel } from '@/Entities/AnimatedModel';
import { makeBox } from '@/Assets/Primitives';
import type { ZombieAnim, ZombieKind, ZombieSnapshot } from '@shared/protocol';

/** Tom aplicado ao worker.glb pra virar zumbi (multiplica a textura). */
const ZOMBIE_TINT = new pc.Color(0.45, 0.85, 0.4);
const BOSS_TINT = new pc.Color(0.9, 0.3, 0.25);
const HURT_TINT = new pc.Color(1.6, 0.5, 0.5);
const HURT_FLASH_TIME = 0.12;
const LERP_SPEED = 12;

/**
 * Representação visual de um zumbi simulado no servidor: interpola a pose recebida a cada tick,
 * reproduz a animação do estado e mostra barra de vida + flash de dano. Nenhuma IA aqui.
 */
export class Zombie {
  readonly entity: pc.Entity;
  readonly kind: ZombieKind;
  private model: pc.Entity;
  readonly anim: AnimatedModel;
  private materials: pc.StandardMaterial[] = [];
  private hpFill: pc.Entity;
  private hpBar: pc.Entity;
  private hurtTimer = 0;
  private target = new pc.Vec3();
  private targetYaw = 0;
  private currentYaw = 0;
  private currentAnim: ZombieAnim = 'Idle';
  private baseTint: pc.Color;

  hp: number;
  maxHp: number;
  dead = false;
  /** s desde que morreu (para remover o corpo) */
  deadTime = 0;

  constructor(
    readonly id: number,
    snap: ZombieSnapshot,
  ) {
    this.kind = snap.kind;
    this.hp = snap.hp;
    this.maxHp = snap.maxHp;
    this.entity = new pc.Entity(`${snap.kind}#${id}`);
    this.entity.setPosition(snap.x, 0, snap.z);
    this.entity.setEulerAngles(0, snap.yaw, 0);
    this.target.set(snap.x, 0, snap.z);
    this.targetYaw = this.currentYaw = snap.yaw;
    this.model = instantiateModel('player');
    const scale = MODEL_SCALE.player * (snap.kind === 'boss' ? GAME.boss.SCALE : 1);
    this.model.setLocalScale(scale, scale, scale);
    this.entity.addChild(this.model);
    this.baseTint = snap.kind === 'boss' ? BOSS_TINT : ZOMBIE_TINT;
    this.tint();
    this.anim = new AnimatedModel(this.entity, this.model);

    // barra de vida acima da cabeça (fundo escuro + preenchimento)
    const bar = new pc.Entity('hpbar');
    this.hpBar = bar;
    const h = snap.kind === 'boss' ? 2.15 * GAME.boss.SCALE : 2.15;
    const w = snap.kind === 'boss' ? 1.8 : 0.9;
    bar.setLocalPosition(0, h, 0);
    const bg = makeBox({ color: '#111', scale: [w, 0.09, 0.09], emissive: 0.6 });
    this.hpFill = makeBox({ color: snap.kind === 'boss' ? '#ff5a4d' : '#7ed957', scale: [w - 0.04, 0.06, 0.1], emissive: 1 });
    bar.addChild(bg);
    bar.addChild(this.hpFill);
    this.entity.addChild(bar);
  }

  /** Clona os materiais do GLB (pra não tingir o player, que usa o mesmo asset) e aplica o tom. */
  private tint(): void {
    const renders = this.model.findComponents('render') as pc.RenderComponent[];
    for (const r of renders) {
      const cloned = r.meshInstances.map((mi) => {
        const m = (mi.material as pc.StandardMaterial).clone();
        m.diffuse.copy(this.baseTint);
        m.update();
        this.materials.push(m);
        return m;
      });
      r.meshInstances.forEach((mi, i) => (mi.material = cloned[i]));
    }
  }

  /** Chame só depois de `entity` estar na cena. */
  initAnimation(): void {
    this.anim.init(
      [
        { name: 'Idle' },
        { name: 'Walk' },
        { name: 'Run' },
        { name: 'Punch_Left', loop: false },
        { name: 'Kick_Right', loop: false },
        { name: 'Death', loop: false },
      ],
      'Idle',
    );
  }

  get position(): pc.Vec3 {
    return this.entity.getPosition();
  }

  get alive(): boolean {
    return !this.dead;
  }

  /** Aplica o snapshot do servidor (pose alvo, animação, HP). */
  apply(snap: ZombieSnapshot): void {
    this.target.set(snap.x, 0, snap.z);
    this.targetYaw = snap.yaw;
    if (snap.hp < this.hp) {
      this.hurtTimer = HURT_FLASH_TIME;
      this.setTint(HURT_TINT);
    }
    this.hp = snap.hp;
    this.maxHp = snap.maxHp;
    const w = this.kind === 'boss' ? 1.76 : 0.86;
    const ratio = Math.max(0, this.hp / this.maxHp);
    this.hpFill.setLocalScale(w * ratio, 0.06, 0.1);
    this.hpFill.setLocalPosition((-w / 2) * (1 - ratio), 0, 0);
    if (snap.anim !== this.currentAnim) {
      const restart = snap.anim === 'Punch_Left' || snap.anim === 'Kick_Right';
      this.currentAnim = snap.anim;
      this.anim.play(snap.anim as CharacterAnimName, 0.1, restart);
    }
    if (snap.anim === 'Death' && !this.dead) {
      this.dead = true;
      this.hpBar.enabled = false;
    }
  }

  update(dt: number): void {
    if (this.dead) this.deadTime += dt;
    this.hpBar.setEulerAngles(0, CONFIG.camera.YAW, 0); // barra sempre de frente pra câmera isométrica
    if (this.hurtTimer > 0) {
      this.hurtTimer -= dt;
      if (this.hurtTimer <= 0) this.setTint(this.baseTint);
    }
    const t = 1 - Math.exp(-LERP_SPEED * dt);
    const pos = this.entity.getPosition();
    this.entity.setPosition(pos.x + (this.target.x - pos.x) * t, 0, pos.z + (this.target.z - pos.z) * t);
    const diff = ((this.targetYaw - this.currentYaw + 540) % 360) - 180;
    this.currentYaw += diff * t;
    this.entity.setEulerAngles(0, this.currentYaw, 0);
  }

  private setTint(c: pc.Color): void {
    for (const m of this.materials) {
      m.diffuse.copy(c);
      m.update();
    }
  }

  destroy(): void {
    this.anim.dispose();
    this.entity.destroy();
  }
}
