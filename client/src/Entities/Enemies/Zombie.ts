import * as pc from 'playcanvas';
import { CONFIG } from '@/config';
import { instantiateModel, MODEL_SCALE, type CharacterAnimName } from '@/Assets/ModelAssets';
import { AnimatedModel } from '@/Entities/AnimatedModel';
import { makeBox } from '@/Assets/Primitives';
import { yawToward } from '@/Core/Spatial';

export type ZombieState = 'wander' | 'chase' | 'attack' | 'special' | 'dead';

/** Tom aplicado ao worker.glb pra virar zumbi (multiplica a textura). */
const ZOMBIE_TINT = new pc.Color(0.45, 0.85, 0.4);
const HURT_TINT = new pc.Color(1.6, 0.5, 0.5);
const HURT_FLASH_TIME = 0.12;

/**
 * Entidade visual + estado do zumbi. A IA (decisões) fica no ZombieSystem; aqui só
 * representação, HP, animação e feedback (flash de dano, barra de vida).
 */
export class Zombie {
  readonly entity: pc.Entity;
  private model: pc.Entity;
  readonly anim: AnimatedModel;
  private materials: pc.StandardMaterial[] = [];
  private hpFill: pc.Entity;
  private hpBar: pc.Entity;
  private hurtTimer = 0;

  hp: number = CONFIG.zombie.MAX_HP;
  state: ZombieState = 'wander';
  /** tempo (s) no estado atual */
  stateTime = 0;
  velocity = new pc.Vec3();

  constructor(
    readonly id: number,
    x: number,
    z: number,
  ) {
    this.entity = new pc.Entity(`zombie#${id}`);
    this.entity.setPosition(x, 0, z);
    this.model = instantiateModel('player');
    this.entity.addChild(this.model);
    this.tint();
    this.anim = new AnimatedModel(this.entity, this.model);

    // barra de vida acima da cabeça (fundo escuro + preenchimento verde)
    const bar = new pc.Entity('hpbar');
    this.hpBar = bar;
    bar.setLocalPosition(0, 2.15, 0);
    const bg = makeBox({ color: '#111', scale: [0.9, 0.09, 0.09], emissive: 0.6 });
    this.hpFill = makeBox({ color: '#7ed957', scale: [0.86, 0.06, 0.1], emissive: 1 });
    bar.addChild(bg);
    bar.addChild(this.hpFill);
    this.entity.addChild(bar);
  }

  /** Clona os materiais do GLB (pra não tingir o player, que usa o mesmo asset) e aplica o tom verde. */
  private tint(): void {
    const renders = this.model.findComponents('render') as pc.RenderComponent[];
    for (const r of renders) {
      const cloned = r.meshInstances.map((mi) => {
        const m = (mi.material as pc.StandardMaterial).clone();
        m.diffuse.copy(ZOMBIE_TINT);
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
    return this.state !== 'dead';
  }

  setState(s: ZombieState): void {
    if (this.state === s) return;
    this.state = s;
    this.stateTime = 0;
  }

  play(name: CharacterAnimName, restart = false): void {
    this.anim.play(name, 0.1, restart);
  }

  lookAt(point: pc.Vec3): void {
    yawToward(this.entity, point);
  }

  /** Aplica dano; retorna true se morreu com este hit. */
  damage(amount: number): boolean {
    if (!this.alive) return false;
    this.hp = Math.max(0, this.hp - amount);
    this.hurtTimer = HURT_FLASH_TIME;
    this.setTint(HURT_TINT);
    const ratio = this.hp / CONFIG.zombie.MAX_HP;
    this.hpFill.setLocalScale(0.86 * ratio, 0.06, 0.1);
    this.hpFill.setLocalPosition(-0.43 * (1 - ratio), 0, 0);
    if (this.hp <= 0) {
      this.setState('dead');
      this.velocity.set(0, 0, 0);
      this.play('Death');
      this.hpFill.parent!.enabled = false;
      return true;
    }
    return false;
  }

  private setTint(c: pc.Color): void {
    for (const m of this.materials) {
      m.diffuse.copy(c);
      m.update();
    }
  }

  /** Feedbacks por frame (flash de dano). */
  tick(dt: number): void {
    this.stateTime += dt;
    // barra sempre de frente pra câmera isométrica (yaw fixo), independente de pra onde o zumbi olha
    this.hpBar.setEulerAngles(0, CONFIG.camera.YAW, 0);
    if (this.hurtTimer > 0) {
      this.hurtTimer -= dt;
      if (this.hurtTimer <= 0) this.setTint(ZOMBIE_TINT);
    }
  }

  destroy(): void {
    this.anim.dispose();
    this.entity.destroy();
  }
}

export const ZOMBIE_SCALE = MODEL_SCALE.player;
