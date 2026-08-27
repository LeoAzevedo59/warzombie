import * as pc from 'playcanvas';
import { makeBox, makeCylinder, makeSphere } from '@/Assets/Primitives';

const OLIVE = '#5b6b3a';
const OLIVE_DARK = '#3f4a2a';
const GLASS = '#1e3a55';
const STEEL = '#6b7076';

/** Altura de onde o helicóptero desce e para onde sobe ao decolar. */
const SKY_Y = 26;

type Phase = 'landing' | 'landed' | 'takeoff';

/**
 * Helicóptero de resgate feito de primitivas: fuselagem, cabine, cauda, esquis, rotor principal e
 * de cauda girando. Desce até o chão em `landsIn` s (com balanço), fica pousado com o rotor em
 * marcha lenta e, na decolagem, sobe e afasta enquanto a câmera o segue.
 */
export class Helicopter {
  readonly entity: pc.Entity;
  private rotor: pc.Entity;
  private tailRotor: pc.Entity;
  private beacon: pc.Entity;
  private phase: Phase = 'landing';
  private t = 0;
  private landsIn: number;
  private readonly ground: pc.Vec3;
  private rotorSpeed = 1400; // graus/s
  private beaconT = 0;

  constructor(x: number, z: number, landsIn: number, alreadyLanded = false) {
    this.ground = new pc.Vec3(x, 0, z);
    this.landsIn = Math.max(0.1, landsIn);
    this.entity = new pc.Entity('helicopter');
    const body = new pc.Entity('body');
    this.entity.addChild(body);
    // fuselagem + cabine
    body.addChild(makeBox({ color: OLIVE, scale: [3.2, 1.4, 1.7], position: [0, 1.3, 0] }));
    body.addChild(makeBox({ color: GLASS, scale: [0.9, 0.9, 1.5], position: [1.75, 1.45, 0], emissive: 0.25 }));
    body.addChild(makeBox({ color: OLIVE_DARK, scale: [1.0, 0.9, 0.12], position: [0.2, 1.2, 0.86] })); // porta lateral
    body.addChild(makeBox({ color: OLIVE_DARK, scale: [1.0, 0.9, 0.12], position: [0.2, 1.2, -0.86] }));
    // cauda + estabilizador
    body.addChild(makeBox({ color: OLIVE, scale: [3.4, 0.42, 0.42], position: [-3.0, 1.5, 0] }));
    body.addChild(makeBox({ color: OLIVE_DARK, scale: [0.6, 1.1, 0.12], position: [-4.5, 2.0, 0] }));
    body.addChild(makeBox({ color: OLIVE_DARK, scale: [0.9, 0.08, 1.4], position: [-4.2, 1.7, 0] }));
    // esquis
    for (const s of [1, -1]) {
      body.addChild(makeBox({ color: STEEL, scale: [3.0, 0.08, 0.1], position: [0.2, 0.06, s * 0.9] }));
      body.addChild(makeBox({ color: STEEL, scale: [0.08, 0.6, 0.08], position: [1.0, 0.35, s * 0.9] }));
      body.addChild(makeBox({ color: STEEL, scale: [0.08, 0.6, 0.08], position: [-0.6, 0.35, s * 0.9] }));
    }
    // mastro + rotor principal (4 pás)
    body.addChild(makeCylinder({ color: STEEL, scale: [0.22, 0.4, 0.22], position: [0, 2.15, 0] }));
    this.rotor = new pc.Entity('rotor');
    this.rotor.setLocalPosition(0, 2.4, 0);
    for (let i = 0; i < 4; i++) {
      const blade = makeBox({ color: '#2b2f36', scale: [5.4, 0.05, 0.26], position: [0, 0, 0] });
      blade.setLocalEulerAngles(0, i * 45, 0);
      this.rotor.addChild(blade);
    }
    this.rotor.addChild(makeCylinder({ color: '#2b2f36', scale: [0.35, 0.12, 0.35] }));
    body.addChild(this.rotor);
    // rotor de cauda
    this.tailRotor = new pc.Entity('tail-rotor');
    this.tailRotor.setLocalPosition(-4.55, 2.0, 0.12);
    for (let i = 0; i < 2; i++) {
      const blade = makeBox({ color: '#2b2f36', scale: [1.0, 0.18, 0.04] });
      blade.setLocalEulerAngles(0, 0, i * 90);
      this.tailRotor.addChild(blade);
    }
    body.addChild(this.tailRotor);
    // luz de sinalização
    this.beacon = makeSphere({ color: '#ff3b3b', scale: [0.18, 0.18, 0.18], position: [-1.2, 2.05, 0], emissive: 2 });
    body.addChild(this.beacon);
    // ponto de pouso no chão (anel)
    const pad = makeCylinder({ color: '#ffd34d', scale: [5.2, 0.03, 5.2], emissive: 1 });
    pad.setLocalPosition(0, 0.02, 0);
    const padHole = makeCylinder({ color: '#3f4a2a', scale: [4.6, 0.035, 4.6] });
    padHole.setLocalPosition(0, 0.02, 0);
    const padGroup = new pc.Entity('pad');
    padGroup.addChild(pad);
    padGroup.addChild(padHole);
    padGroup.setPosition(x, 0, z);
    this.pad = padGroup;

    this.entity.setPosition(x, alreadyLanded ? 0 : SKY_Y, z);
    if (alreadyLanded) {
      this.phase = 'landed';
      this.rotorSpeed = 500;
    }
  }

  readonly pad: pc.Entity;

  get landed(): boolean {
    return this.phase === 'landed';
  }

  /** Decolagem (cutscene): sobe e afasta; a câmera acompanha `entity`. */
  takeOff(): void {
    this.phase = 'takeoff';
    this.t = 0;
    this.rotorSpeed = 1600;
  }

  update(dt: number): void {
    this.t += dt;
    const rot = this.rotor.getLocalEulerAngles();
    this.rotor.setLocalEulerAngles(0, (rot.y + this.rotorSpeed * dt) % 360, 0);
    const tr = this.tailRotor.getLocalEulerAngles();
    this.tailRotor.setLocalEulerAngles(0, 0, (tr.z + this.rotorSpeed * 2 * dt) % 360);
    this.beaconT += dt;
    this.beacon.enabled = Math.sin(this.beaconT * 6) > 0;
    const g = this.ground;
    if (this.phase === 'landing') {
      const k = Math.min(1, this.t / this.landsIn);
      const ease = 1 - Math.pow(1 - k, 3);
      const y = SKY_Y * (1 - ease);
      const sway = (1 - k) * 0.6;
      this.entity.setPosition(g.x + Math.sin(this.t * 1.7) * sway, y, g.z + Math.cos(this.t * 1.3) * sway);
      this.entity.setEulerAngles(Math.sin(this.t * 1.3) * 3 * (1 - k), 0, -4 * (1 - k) + Math.cos(this.t * 1.7) * 2 * (1 - k));
      if (k >= 1) {
        this.phase = 'landed';
        this.entity.setPosition(g.x, 0, g.z);
        this.entity.setEulerAngles(0, 0, 0);
      }
      this.rotorSpeed = 900 + 500 * (1 - k);
    } else if (this.phase === 'landed') {
      this.rotorSpeed = Math.max(500, this.rotorSpeed - 300 * dt);
    } else {
      // decolagem: sobe rápido, inclina o nariz e vai embora pela lateral
      const y = Math.min(SKY_Y + 10, 0.5 * 4.5 * this.t * this.t);
      const drift = Math.max(0, this.t - 1.5) * 4;
      this.entity.setPosition(g.x + drift, y, g.z + drift * 0.6);
      this.entity.setEulerAngles(Math.min(12, this.t * 4), 0, Math.sin(this.t) * 3);
    }
  }

  destroy(): void {
    this.entity.destroy();
    this.pad.destroy();
  }
}
