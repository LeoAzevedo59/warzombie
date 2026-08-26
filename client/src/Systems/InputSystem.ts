import * as pc from 'playcanvas';
import { CONFIG } from '@/config';
import type { System } from '@/Core/GameLoop';
import type { EventBus } from '@/Core/EventBus';

const DIGIT_CODES = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'];

/** Estado de input do frame atual, consumido pelo PlayerController. */
export interface InputState {
  /** eixo -1..1 (esquerda/direita, na tela) */
  moveX: number;
  /** eixo -1..1 (baixo/cima, na tela) */
  moveY: number;
  run: boolean;
  crouch: boolean;
  /** ponto no plano do chão (y=0) apontado pelo mouse, ou null se fora; reservado pra mira de tiro (fase 2) */
  aimPoint: pc.Vec3 | null;
}

/**
 * Traduz teclado/mouse em InputState e dispara eventos de ação (E, clique, Tab).
 * Não sabe nada sobre o player — só sobre teclas.
 */
export class InputSystem implements System {
  readonly name = 'Input';
  readonly state: InputState = { moveX: 0, moveY: 0, run: false, crouch: false, aimPoint: null };
  enabled = true;

  private keys = new Set<string>();
  private mouse = { x: 0, y: 0 };
  private ray = new pc.Ray();
  private groundPlane = new pc.Plane(new pc.Vec3(0, 1, 0), 0);
  private hit = new pc.Vec3();

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    this.keys.add(e.code);
    // Esc: fecha painel aberto ou abre/fecha o menu (decidido pela cena)
    if (e.code === 'Escape') {
      this.bus.emit('input:escape');
      return;
    }
    if (!this.enabled) return;
    if (e.code === 'KeyE') this.bus.emit('input:interact');
    if (e.code === 'KeyR') this.bus.emit('input:reload');
    if (e.code === 'KeyB') this.bus.emit('input:place');
    const digitIndex = DIGIT_CODES.indexOf(e.code);
    if (digitIndex >= 0 && digitIndex < CONFIG.inventory.HOTBAR_SLOTS) {
      this.bus.emit('input:selectSlot', { index: digitIndex });
    }
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private onMouseMove = (e: MouseEvent) => {
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
  };
  private onMouseDown = (e: MouseEvent) => {
    if (e.button === 0 && this.enabled) this.bus.emit('input:fire');
  };
  private onBlur = () => this.keys.clear();
  private onWheel = (e: WheelEvent) => {
    if (this.enabled) this.bus.emit('input:wheel', { delta: Math.sign(e.deltaY) });
  };

  constructor(
    private bus: EventBus,
    private canvas: HTMLCanvasElement,
    private getCamera: () => pc.CameraComponent | null,
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('mousedown', this.onMouseDown);
    canvas.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('blur', this.onBlur);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  update(): void {
    const k = this.keys;
    const s = this.state;
    if (!this.enabled) {
      s.moveX = s.moveY = 0;
      s.run = s.crouch = false;
      return;
    }
    const left = k.has('KeyA') || k.has('ArrowLeft');
    const right = k.has('KeyD') || k.has('ArrowRight');
    const up = k.has('KeyW') || k.has('ArrowUp');
    const down = k.has('KeyS') || k.has('ArrowDown');

    s.moveX = (right ? 1 : 0) - (left ? 1 : 0);
    s.moveY = (up ? 1 : 0) - (down ? 1 : 0);
    s.run = k.has('ShiftLeft') || k.has('ShiftRight');
    s.crouch = k.has('ControlLeft') || k.has('ControlRight');
    s.aimPoint = this.raycastGround();
  }

  private raycastGround(): pc.Vec3 | null {
    const cam = this.getCamera();
    if (!cam) return null;
    const rect = this.canvas.getBoundingClientRect();
    const sx = this.mouse.x - rect.left;
    const sy = this.mouse.y - rect.top;

    cam.screenToWorld(sx, sy, cam.nearClip, this.ray.origin);
    cam.screenToWorld(sx, sy, cam.farClip, this.ray.direction);
    this.ray.direction.sub(this.ray.origin).normalize();

    return this.groundPlane.intersectsRay(this.ray, this.hit) ? this.hit.clone() : null;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    this.canvas.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('blur', this.onBlur);
  }
}
