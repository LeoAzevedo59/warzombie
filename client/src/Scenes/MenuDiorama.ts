import * as pc from 'playcanvas';
import { HUMAN_STATES, instantiateModel, RIBCAGE_STATES, showCharacterWeapon, ZOMBIE_STATES, type ModelKey } from '@/Assets/ModelAssets';
import { AnimatedModel } from '@/Entities/AnimatedModel';
import { groundMaterial } from '@/Assets/GroundTextures';
import { makeDirtPatch } from '@/World/Map';

interface Walker {
  entity: pc.Entity;
  speed: number;
  startZ: number;
}

/**
 * Cena 3D decorativa atrás do menu/lobby: sobrevivente de pistola no acampamento, zumbis vindo do
 * fundo em loop, picape, caixa d'água e árvores no entardecer. Câmera em perspectiva com um
 * balanço lento. Só instancia quando os modelos terminam de carregar.
 */
export class MenuDiorama {
  private anims: AnimatedModel[] = [];
  private walkers: Walker[] = [];
  private camera: pc.Entity | null = null;
  private t = 0;
  private built = false;
  private disposed = false;

  constructor(
    private app: pc.Application,
    private root: pc.Entity,
    ready: Promise<void>,
  ) {
    ready.then(() => {
      if (!this.disposed) this.build();
    }).catch(() => undefined);
  }

  private build(): void {
    this.built = true;
    const scene = this.app.scene;
    scene.ambientLight = new pc.Color(0.34, 0.36, 0.44);
    scene.fog.type = pc.FOG_LINEAR;
    scene.fog.color = new pc.Color(0.18, 0.2, 0.26);
    scene.fog.start = 12;
    scene.fog.end = 42;

    const sun = new pc.Entity('sun');
    sun.addComponent('light', {
      type: 'directional',
      color: new pc.Color(1, 0.78, 0.55),
      intensity: 1.5,
      castShadows: true,
      shadowBias: 0.2,
      normalOffsetBias: 0.05,
      shadowResolution: 2048,
      shadowDistance: 40,
    });
    sun.setEulerAngles(38, 140, 0);
    this.root.addChild(sun);

    this.camera = new pc.Entity('menu-camera');
    this.camera.addComponent('camera', { fov: 32, nearClip: 0.1, farClip: 80, clearColor: new pc.Color(0.13, 0.15, 0.2) });
    this.root.addChild(this.camera);

    // chão
    const ground = new pc.Entity('ground');
    ground.addComponent('render', { type: 'box', material: groundMaterial(this.app, 'grass', 16), castShadows: false });
    ground.setLocalScale(64, 0.1, 64);
    ground.setLocalPosition(0, -0.05, 0);
    this.root.addChild(ground);
    this.root.addChild(makeDirtPatch(this.app, 0.5, 2, 6, 0.7, 20));

    const place = (key: ModelKey, x: number, z: number, yaw: number, scale = 1): pc.Entity => {
      const e = instantiateModel(key);
      const s = e.getLocalScale().x * scale;
      e.setLocalScale(s, s, s);
      e.setLocalPosition(x, 0, z);
      e.setLocalEulerAngles(0, yaw, 0);
      this.root.addChild(e);
      return e;
    };
    place('pickup', -4.6, 4.5, 120);
    place('water_tower', 5.5, 9, 0);
    place('barrel', 3.2, 2.2, 0);
    place('barrel', 3.9, 2.6, 40);
    place('cone', 0.4, 0.2, 15);
    place('barrier', 3.4, -0.4, -25);
    place('blood_1', 1.2, 1.4, 70);
    place('blood_2', -2.2, 3.5, 0);
    place('pallet', -3, -0.2, 10);
    place('tree_oak', -8, 8, 0);
    place('tree_pine', -3.5, 12, 30);
    place('tree_default', 9, 4, 0);
    place('tree_detailed', 11, 11, 60);
    place('tree_thin', -10, 2, 0);
    place('bush', 2.2, 6.5, 0);
    place('grass_large', -1, 5.8, 0);
    place('grass', 1.5, -1.5, 0);
    place('grass_large', 6, 0.5, 0);
    place('mushroom_red', -5.2, 1.2, 0);

    // herói: Shaun com a pistola, olhando pra câmera (modelo olha pra +Z)
    const hero = this.character('char_shaun', -2.6, -0.4, 200, 'Pistol', 'Idle_Gun');
    void hero;

    // zumbis vindo do fundo em loop
    const specs: Array<[ModelKey, number, number, number]> = [
      ['zombie_basic', -1.8, 7, 0.55],
      ['zombie_basic', 2.6, 9.5, 0.5],
      ['zombie_ribcage', 0.6, 11, 0.6],
      ['zombie_basic', -3.6, 12.5, 0.45],
    ];
    for (const [key, x, z, speed] of specs) {
      const e = this.character(key, x, z, 180, null, 'Walk');
      this.walkers.push({ entity: e, speed, startZ: z + 4 });
    }
    const boss = this.character('zombie_chubby', 4.5, 13.5, 195, null, 'Idle', 2.0);
    void boss;
  }

  private character(key: ModelKey, x: number, z: number, yaw: number, weapon: 'Pistol' | null, anim: 'Idle' | 'Idle_Gun' | 'Walk', scale = 1): pc.Entity {
    const holder = new pc.Entity(`diorama:${key}`);
    const model = instantiateModel(key);
    const s = model.getLocalScale().x * scale;
    model.setLocalScale(s, s, s);
    if (key.startsWith('char_')) showCharacterWeapon(model, weapon);
    holder.addChild(model);
    holder.setLocalPosition(x, 0, z);
    holder.setLocalEulerAngles(0, yaw, 0);
    this.root.addChild(holder);
    const am = new AnimatedModel(holder, model, key);
    am.init(key.startsWith('char_') ? HUMAN_STATES : key === 'zombie_ribcage' ? RIBCAGE_STATES : ZOMBIE_STATES, anim);
    this.anims.push(am);
    return holder;
  }

  update(dt: number): void {
    if (!this.built || !this.camera) return;
    this.t += dt;
    // câmera: arco lento ao redor do herói
    const a = -0.35 + Math.sin(this.t * 0.12) * 0.22;
    const r = 11.5;
    this.camera.setPosition(Math.sin(a) * r, 4.2 + Math.sin(this.t * 0.2) * 0.15, -Math.cos(a) * r);
    this.camera.lookAt(0.3, 1.3, 2.5);
    for (const w of this.walkers) {
      const p = w.entity.getPosition();
      let z = p.z - w.speed * dt;
      if (z < 2.2) z = w.startZ;
      w.entity.setPosition(p.x, 0, z);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const a of this.anims) a.dispose();
    this.anims = [];
    this.walkers = [];
    this.app.scene.fog.type = pc.FOG_NONE;
  }
}
