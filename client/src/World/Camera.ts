import * as pc from 'playcanvas';
import { CONFIG } from '@/config';

/** Câmera isométrica ortográfica que segue um alvo com lerp. */
export class IsoCamera {
  readonly entity: pc.Entity;
  target: pc.Entity | null = null;
  private offset = new pc.Vec3();
  private goal = new pc.Vec3();

  constructor() {
    const c = CONFIG.camera;
    this.entity = new pc.Entity('camera');
    this.entity.addComponent('camera', {
      projection: pc.PROJECTION_ORTHOGRAPHIC,
      orthoHeight: c.ORTHO_HEIGHT,
      nearClip: 0.1,
      farClip: 200,
      clearColor: new pc.Color(0.06, 0.08, 0.1),
    });
    this.entity.setEulerAngles(-c.PITCH, c.YAW, 0);

    // offset = -forward * distance (câmera "atrás e acima" olhando para o alvo)
    const fwd = this.entity.forward.clone();
    this.offset.copy(fwd).mulScalar(-c.DISTANCE);
  }

  get component(): pc.CameraComponent {
    return this.entity.camera!;
  }

  private targetOrtho: number = CONFIG.camera.ORTHO_HEIGHT;

  /** Altura ortográfica desejada (upgrade Visão amplia); a transição é suave no update. */
  setOrthoHeight(h: number): void {
    this.targetOrtho = h;
  }

  follow(target: pc.Entity, snap = true): void {
    this.target = target;
    if (snap) {
      this.goal.copy(target.getPosition()).add(this.offset);
      this.entity.setPosition(this.goal);
    }
  }

  update(dt: number): void {
    if (!this.target) return;
    this.goal.copy(this.target.getPosition()).add(this.offset);
    const pos = this.entity.getPosition();
    const t = 1 - Math.exp(-CONFIG.camera.FOLLOW_LERP * dt);
    pos.lerp(pos, this.goal, t);
    this.entity.setPosition(pos);
    const cam = this.component;
    if (Math.abs(cam.orthoHeight - this.targetOrtho) > 0.01) cam.orthoHeight += (this.targetOrtho - cam.orthoHeight) * Math.min(1, dt * 3);
  }

  /** Eixos "frente" e "direita" da câmera projetados no plano XZ e normalizados. */
  groundAxes(outForward: pc.Vec3, outRight: pc.Vec3): void {
    outForward.copy(this.entity.forward);
    outForward.y = 0;
    outForward.normalize();
    outRight.copy(this.entity.right);
    outRight.y = 0;
    outRight.normalize();
  }
}
