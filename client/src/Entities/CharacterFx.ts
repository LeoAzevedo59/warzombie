import * as pc from 'playcanvas';
import { makeSphere } from '@/Assets/Primitives';

/**
 * Efeitos procedurais por cima da animação esquelética (o rig do Zombie Apocalypse Kit não tem tracks
 * de tiro/recarga): recuo do braço da arma + clarão no cano ao atirar, e braço baixando/mexendo no
 * carregador durante a recarga. Aplica os offsets nos ossos em `postupdate` (depois do anim system,
 * antes do render); o AnimatedModel repõe a bind pose a cada frame, então nada acumula.
 */
export class CharacterFx {
  private upperArm: pc.GraphNode | null;
  private lowerArm: pc.GraphNode | null;
  private flash: pc.Entity | null = null;
  private pistol: pc.GraphNode | null = null;
  private fwd = new pc.Vec3();
  private pos = new pc.Vec3();
  private recoil = 0;
  private flashTimer = 0;
  private reloadT = -1;
  private reloadDuration = 1.5;
  private app: pc.AppBase | null;
  private q = new pc.Quat();
  private tmp = new pc.Quat();

  constructor(private model: pc.Entity) {
    this.upperArm = model.findByName('UpperArm.L');
    this.lowerArm = model.findByName('LowerArm.L');
    this.pistol = model.findByName('Pistol');
    if (this.pistol) {
      // o clarão fica no root do modelo e é posicionado em mundo (pistola + frente do personagem)
      this.flash = makeSphere({ name: 'muzzle-flash', color: '#ffd27a', scale: [0.24, 0.24, 0.24], emissive: 3 });
      this.flash.enabled = false;
      model.addChild(this.flash);
    }
    this.app = pc.AppBase.getApplication() ?? null;
    // `app.systems` dispara 'postUpdate' depois do anim system (o evento 'postupdate' do app não roda em app.update())
    this.app?.systems.on('postUpdate', this.onPostUpdate, this);
  }

  /** Disparo: recuo + clarão. */
  shoot(): void {
    this.recoil = 1;
    this.flashTimer = 0.06;
    if (this.flash) {
      this.flash.enabled = true;
      this.flash.setLocalScale(0.18 + Math.random() * 0.12, 0.18 + Math.random() * 0.12, 0.18 + Math.random() * 0.12);
    }
  }

  /** Início/fim da recarga (duração em s). */
  setReloading(on: boolean, duration = 1.5): void {
    if (on) {
      this.reloadT = 0;
      this.reloadDuration = duration;
    } else this.reloadT = -1;
  }

  get reloading(): boolean {
    return this.reloadT >= 0;
  }

  private onPostUpdate(dt: number): void {
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flash && this.pistol) {
        // frente do personagem (plano do chão) a partir da pistola
        const wt = this.model.getWorldTransform();
        wt.getZ(this.fwd);
        this.fwd.y = 0;
        this.fwd.normalize();
        this.pos.copy(this.pistol.getPosition()).add(this.fwd.mulScalar(0.55));
        this.flash.setPosition(this.pos);
      }
      if (this.flashTimer <= 0 && this.flash) this.flash.enabled = false;
    }
    if (this.recoil > 0) {
      this.recoil = Math.max(0, this.recoil - dt * 9);
      // braço sobe com o coice e volta
      this.rotate(this.upperArm, 16 * this.recoil, 0, 0);
      this.rotate(this.lowerArm, 8 * this.recoil, 0, 0);
    }
    if (this.reloadT >= 0) {
      this.reloadT += dt;
      const t = Math.min(1, this.reloadT / this.reloadDuration);
      if (this.reloadT >= this.reloadDuration) this.reloadT = -1;
      const env = smooth(0, 0.2, t) * (1 - smooth(0.82, 1, t));
      // baixa o braço da arma e "puxa" o carregador com um vaivém do antebraço
      const wiggle = Math.sin(t * Math.PI * 6) * 14 * smooth(0.25, 0.4, t) * (1 - smooth(0.7, 0.8, t));
      this.rotate(this.upperArm, -58 * env, 0, -12 * env);
      this.rotate(this.lowerArm, 30 * env + wiggle, 0, 0);
    }
  }

  private rotate(node: pc.GraphNode | null, x: number, y: number, z: number): void {
    if (!node) return;
    this.tmp.setFromEulerAngles(x, y, z);
    this.q.copy(node.getLocalRotation()).mul(this.tmp);
    node.setLocalRotation(this.q);
  }

  dispose(): void {
    this.app?.systems.off('postUpdate', this.onPostUpdate, this);
    this.app = null;
  }
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
