import * as pc from 'playcanvas';
import { CONFIG } from '@/config';
import { GAME } from '@shared/gameconfig';
import { characterForId, INFECTED_STATES, instantiateModel, MODELS, RIBCAGE_STATES, showCharacterWeapon, tintModel, ZOMBIE_STATES, type CharacterAnimName, type ModelKey } from '@/Assets/ModelAssets';
import { AnimatedModel } from '@/Entities/AnimatedModel';
import { makeBox } from '@/Assets/Primitives';
import type { ZombieAnim, ZombieKind, ZombieSnapshot } from '@shared/protocol';

/** Modelo por tipo de zumbi (Quaternius Zombie Apocalypse Kit); infectado usa o personagem do jogador dono. */
const ZOMBIE_MODEL: Record<ZombieKind, ModelKey> = {
  zombie: 'zombie_basic',
  spitter: 'zombie_ribcage',
  boss: 'zombie_chubby',
  infected: 'char_shaun',
};

/** Tons multiplicados sobre o atlas (o zumbi comum fica com a cor original; infectado esverdeado). */
const BASE_TINT: Record<ZombieKind, pc.Color> = {
  zombie: new pc.Color(1, 1, 1),
  spitter: new pc.Color(0.85, 0.7, 1.1),
  boss: new pc.Color(1.1, 0.75, 0.7),
  infected: new pc.Color(0.5, 1.15, 0.55),
};
const HURT_TINT = new pc.Color(1.8, 0.45, 0.45);
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
  /** infectado: jogador que virou este zumbi */
  readonly owner: string | null;
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
    this.owner = snap.owner ?? null;
    this.entity = new pc.Entity(`${snap.kind}#${id}`);
    this.entity.setPosition(snap.x, 0, snap.z);
    this.entity.setEulerAngles(0, snap.yaw, 0);
    this.target.set(snap.x, 0, snap.z);
    this.targetYaw = this.currentYaw = snap.yaw;
    const key = snap.kind === 'infected' && this.owner ? characterForId(this.owner) : ZOMBIE_MODEL[snap.kind];
    this.model = instantiateModel(key);
    if (snap.kind === 'infected') showCharacterWeapon(this.model, null); // rig humano: sem armas na mão
    const scale = MODELS[key].scale * (snap.kind === 'boss' ? GAME.boss.SCALE : 1);
    this.model.setLocalScale(scale, scale, scale);
    this.entity.addChild(this.model);
    this.baseTint = BASE_TINT[snap.kind];
    this.materials = tintModel(this.model, this.baseTint);
    this.anim = new AnimatedModel(this.entity, this.model, key);

    // barra de vida acima da cabeça (fundo escuro + preenchimento)
    const bar = new pc.Entity('hpbar');
    this.hpBar = bar;
    const h = snap.kind === 'boss' ? 2.0 * GAME.boss.SCALE : 2.0;
    const w = snap.kind === 'boss' ? 1.8 : 0.9;
    bar.setLocalPosition(0, h, 0);
    const bg = makeBox({ color: '#111', scale: [w, 0.09, 0.09], emissive: 0.6 });
    this.hpFill = makeBox({ color: snap.kind === 'boss' ? '#ff5a4d' : snap.kind === 'infected' ? '#c8ff4d' : '#7ed957', scale: [w - 0.04, 0.06, 0.1], emissive: 1 });
    bar.addChild(bg);
    bar.addChild(this.hpFill);
    this.entity.addChild(bar);
  }

  /** Chame só depois de `entity` estar na cena. */
  initAnimation(): void {
    this.anim.init(this.kind === 'spitter' ? RIBCAGE_STATES : this.kind === 'infected' ? INFECTED_STATES : ZOMBIE_STATES, 'Idle');
  }

  get position(): pc.Vec3 {
    return this.entity.getPosition();
  }

  get alive(): boolean {
    return !this.dead;
  }

  /** Está numa animação de ataque (Punch_Left / Kick_Right). */
  get attacking(): boolean {
    return this.currentAnim === 'Punch_Left' || this.currentAnim === 'Kick_Right';
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
    if (this.dead) {
      this.deadTime += dt;
      // afunda no chão nos últimos 0,6 s antes de o corpo ser removido
      if (this.deadTime > CONFIG.zombie.CORPSE_TIME - 0.6) {
        const p = this.entity.getPosition();
        this.entity.setPosition(p.x, p.y - 1.4 * dt, p.z);
        this.target.y = this.entity.getPosition().y;
      }
    }
    this.hpBar.setEulerAngles(0, CONFIG.camera.YAW, 0); // barra sempre de frente pra câmera isométrica
    if (this.hurtTimer > 0) {
      this.hurtTimer -= dt;
      if (this.hurtTimer <= 0) this.setTint(this.baseTint);
    }
    const t = 1 - Math.exp(-LERP_SPEED * dt);
    const pos = this.entity.getPosition();
    this.entity.setPosition(pos.x + (this.target.x - pos.x) * t, this.dead ? pos.y : 0, pos.z + (this.target.z - pos.z) * t);
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
