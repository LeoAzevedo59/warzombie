import * as pc from 'playcanvas';

/**
 * Registro de modelos GLB do jogo. Todos CC0 (ver client/public/CREDITS.md):
 * - personagens/zumbis/props urbanos: Quaternius "Zombie Apocalypse Kit"
 * - natureza: Kenney "Nature Kit"; hub/cercas/recursos: Kenney "Survival Kit"
 */
export type ModelKey =
  // personagens (Quaternius; os mesmos rig + tracks; armas como nós filhos: Knife, Pistol, Axe...)
  | 'char_shaun'
  | 'char_matt'
  | 'char_sam'
  | 'char_lis'
  // zumbis (Quaternius)
  | 'zombie_basic'
  | 'zombie_chubby'
  | 'zombie_ribcage'
  // natureza (Kenney Nature Kit)
  | 'tree_default'
  | 'tree_oak'
  | 'tree_detailed'
  | 'tree_pine'
  | 'tree_pine_round'
  | 'tree_thin'
  | 'rock_a'
  | 'rock_c'
  | 'rock_e'
  | 'rock_small'
  | 'rock_small_flat'
  | 'stone_small'
  | 'grass'
  | 'grass_large'
  | 'grass_leafs'
  | 'flower_red'
  | 'flower_yellow'
  | 'flower_purple'
  | 'mushroom_red'
  | 'mushroom_tan'
  | 'stump'
  | 'log'
  | 'bush'
  | 'bush_small'
  // props (Kenney Survival Kit + Quaternius)
  | 'resource_stone'
  | 'resource_wood'
  | 'log_small'
  | 'fence_wood'
  | 'fence_stone'
  | 'fence_iron'
  | 'workbench'
  | 'tent'
  | 'tent_frame'
  | 'campfire'
  | 'signpost'
  | 'box'
  | 'barrel_wood'
  | 'water_tower'
  | 'barrel'
  | 'cone'
  | 'barrier'
  | 'pallet'
  | 'blood_1'
  | 'blood_2'
  | 'pickup'
  | 'cinder'
  | 'chest';

interface ModelDef {
  url: string;
  /** escala uniforme aplicada ao instanciar (medida contra a altura real do GLB) */
  scale: number;
  /** modelo animado: extrai as tracks do GLB */
  animated?: boolean;
}

const M = (url: string, scale: number, animated = false): ModelDef => ({ url, scale, animated });

/** Kenney Nature/Survival Kit são modelos "miniatura" (~1,5 u de altura para árvores): escalas bem maiores. */
export const MODELS: Record<ModelKey, ModelDef> = {
  char_shaun: M('/models/characters/shaun.glb', 1.05, true), // 1,68 de altura -> ~1,8 m
  char_matt: M('/models/characters/matt.glb', 1.05, true),
  char_sam: M('/models/characters/sam.glb', 1.05, true),
  char_lis: M('/models/characters/lis.glb', 1.05, true),
  zombie_basic: M('/models/zombies/basic.glb', 1.2, true), // corcunda: 1,36 -> ~1,65 m
  zombie_chubby: M('/models/zombies/chubby.glb', 1.1, true),
  zombie_ribcage: M('/models/zombies/ribcage.glb', 1.45, true), // magro: 1,06 -> ~1,55 m

  tree_default: M('/models/nature/tree_default.glb', 3.2),
  tree_oak: M('/models/nature/tree_oak.glb', 3.6),
  tree_detailed: M('/models/nature/tree_detailed.glb', 3.4),
  tree_pine: M('/models/nature/tree_pineDefaultA.glb', 3.4),
  tree_pine_round: M('/models/nature/tree_pineRoundA.glb', 3.4),
  tree_thin: M('/models/nature/tree_thin.glb', 3.2),
  rock_a: M('/models/nature/rock_largeA.glb', 2.6),
  rock_c: M('/models/nature/rock_largeC.glb', 2.3),
  rock_e: M('/models/nature/rock_largeE.glb', 2.3),
  rock_small: M('/models/nature/rock_smallA.glb', 1.6),
  rock_small_flat: M('/models/nature/rock_smallC.glb', 1.8),
  stone_small: M('/models/nature/stone_smallA.glb', 1.4),
  grass: M('/models/nature/grass.glb', 1.3),
  grass_large: M('/models/nature/grass_large.glb', 1.5),
  grass_leafs: M('/models/nature/grass_leafs.glb', 2.2),
  flower_red: M('/models/nature/flower_redA.glb', 1.6),
  flower_yellow: M('/models/nature/flower_yellowA.glb', 1.6),
  flower_purple: M('/models/nature/flower_purpleA.glb', 1.6),
  mushroom_red: M('/models/nature/mushroom_red.glb', 1.4),
  mushroom_tan: M('/models/nature/mushroom_tanGroup.glb', 1.5),
  stump: M('/models/nature/stump_round.glb', 2.2),
  log: M('/models/nature/log.glb', 1.8),
  bush: M('/models/nature/plant_bush.glb', 2.4),
  bush_small: M('/models/nature/plant_bushSmall.glb', 2.0),

  resource_stone: M('/models/props/resource-stone.glb', 2.6),
  resource_wood: M('/models/props/resource-wood.glb', 3.2),
  log_small: M('/models/props/tree-log-small.glb', 1.3),
  fence_wood: M('/models/props/fence.glb', 1), // escalado por eixo em Wall (WIDTH x altura)
  fence_stone: M('/models/props/fence-fortified.glb', 1),
  fence_iron: M('/models/props/metal-panel-screws.glb', 1),
  workbench: M('/models/props/workbench.glb', 4.2),
  tent: M('/models/props/tent-canvas.glb', 4.6),
  tent_frame: M('/models/props/tent.glb', 4.6),
  campfire: M('/models/props/campfire-pit.glb', 4.0),
  signpost: M('/models/props/signpost.glb', 4.2),
  box: M('/models/props/box.glb', 3.0),
  barrel_wood: M('/models/props/barrel.glb', 1),
  water_tower: M('/models/props/zak_watertower.glb', 0.5), // 9,4 -> ~4,7 m
  barrel: M('/models/props/zak_barrel.glb', 1),
  cone: M('/models/props/zak_trafficcone_1.glb', 1),
  barrier: M('/models/props/zak_trafficbarrier_1.glb', 1),
  pallet: M('/models/props/zak_pallet.glb', 1),
  blood_1: M('/models/props/zak_blood_1.glb', 1),
  blood_2: M('/models/props/zak_blood_2.glb', 1),
  pickup: M('/models/props/zak_vehicle_pickup.glb', 1),
  cinder: M('/models/props/zak_cinderblock.glb', 1),
  chest: M('/models/props/zak_chest.glb', 1),
};

/** Nomes lógicos de animação usados pelo jogo/protocolo (Idle, Walk, Run, Punch_Left...) e extras dos novos rigs. */
export type CharacterAnimName =
  | 'Idle'
  | 'Walk'
  | 'Run'
  | 'Punch_Left'
  | 'Punch_Right'
  | 'Kick_Left'
  | 'Kick_Right'
  | 'Death'
  | 'HitRecieve'
  | 'Idle_Gun'
  | 'Gun_Shoot'
  | 'Run_Shoot'
  | 'Walk_Gun'
  | 'Run_Gun'
  | 'Duck'
  | 'Slash'
  | 'Stab'
  | 'Wave';
/** @deprecated use CharacterAnimName */
export type PlayerAnimName = CharacterAnimName;

/** Estado lógico -> track real no GLB. */
export interface AnimStateDef {
  name: CharacterAnimName;
  /** nome da track no GLB (default: igual a `name`) */
  track?: string;
  loop?: boolean;
}

/** Estados dos personagens humanos (Quaternius): tracks Idle, Walk, Run, Idle_Gun, Walk_Gun, Run_Gun, Stab, Slash, Duck, Death, HitReact, Wave. */
export const HUMAN_STATES: AnimStateDef[] = [
  { name: 'Idle' },
  { name: 'Walk' },
  { name: 'Run' },
  { name: 'Idle_Gun' },
  { name: 'Walk_Gun' },
  { name: 'Run_Gun' },
  { name: 'Gun_Shoot', track: 'Idle_Gun', loop: false },
  { name: 'Punch_Left', track: 'Stab', loop: false },
  { name: 'Slash', loop: false },
  { name: 'Duck' },
  { name: 'HitRecieve', track: 'HitReact', loop: false },
  { name: 'Death', loop: false },
];

/** Zumbi magro (ribcage) só tem Idle/Walk/Run/Crawl/Jump/HitReact/Death: o "ataque" (cuspe) usa o pulo. */
export const RIBCAGE_STATES: AnimStateDef[] = [
  { name: 'Idle' },
  { name: 'Walk' },
  { name: 'Run' },
  { name: 'Punch_Left', track: 'Jump', loop: false },
  { name: 'Kick_Right', track: 'Jump_Land', loop: false },
  { name: 'HitRecieve', track: 'HitReact', loop: false },
  { name: 'Death', loop: false },
];

/** Estados dos zumbis (Quaternius): Idle, Walk, Run_Arms (braços pra frente), Punch, Idle_Attack, HitReact, Death. */
export const ZOMBIE_STATES: AnimStateDef[] = [
  { name: 'Idle' },
  { name: 'Walk' },
  { name: 'Run', track: 'Run_Arms' },
  { name: 'Punch_Left', track: 'Punch', loop: false },
  { name: 'Kick_Right', track: 'Idle_Attack', loop: false },
  { name: 'HitRecieve', track: 'HitReact', loop: false },
  { name: 'Death', loop: false },
];

/** Nós de arma dentro dos GLBs de personagem (todos ficam visíveis por padrão; escondemos e ligamos conforme o item). */
export const CHARACTER_WEAPON_NODES = ['Axe', 'Guitar', 'Knife', 'Pistol', 'Rifle', 'Shotgun', 'SMG', 'Spear', 'WoodenBat_Barbed', 'WoodenBat_Saw'] as const;
export type CharacterWeaponNode = (typeof CHARACTER_WEAPON_NODES)[number];

const assets = new Map<ModelKey, pc.Asset>();
(window as unknown as { __wzModels: unknown }).__wzModels = assets; // debug: estado do preload no console
const animTracks = new Map<ModelKey, Map<string, pc.AnimTrack>>();

/** Carrega todos os modelos GLB usados no jogo. Chame uma vez, cedo, e aguarde antes de instanciar. */
export function preloadModels(app: pc.Application): Promise<void> {
  const loads = (Object.entries(MODELS) as [ModelKey, ModelDef][]).map(
    ([key, def]) =>
      new Promise<void>((resolve, reject) => {
        app.assets.loadFromUrl(def.url, 'container', (err, asset) => {
          if (err || !asset) {
            reject(new Error(`Falha ao carregar modelo "${key}" (${def.url}): ${err}`));
            return;
          }
          assets.set(key, asset);
          if (def.animated) extractAnimations(key, asset.resource as pc.ContainerResource);
          resolve();
        });
      }),
  );
  return Promise.all(loads).then(() => undefined);
}

/** Mapeia as tracks do GLB (ex: "CharacterArmature|Walk" ou "Walk") pelo nome curto. */
function extractAnimations(key: ModelKey, container: pc.ContainerResource): void {
  // `animations` existe em runtime (documentado via JSDoc no engine) mas falta no .d.ts do pacote.
  const animations = (container as unknown as { animations: pc.Asset[] }).animations;
  const map = new Map<string, pc.AnimTrack>();
  for (const animAsset of animations) {
    const track = animAsset.resource as pc.AnimTrack;
    const short = track.name.includes('|') ? track.name.slice(track.name.lastIndexOf('|') + 1) : track.name;
    map.set(short, track);
  }
  animTracks.set(key, map);
}

/** Track de animação de um modelo pelo nome no GLB. */
export function getAnimTrack(key: ModelKey, trackName: string): pc.AnimTrack | undefined {
  return animTracks.get(key)?.get(trackName);
}

/** Nomes das tracks disponíveis num modelo (debug). */
export function animTrackNames(key: ModelKey): string[] {
  return [...(animTracks.get(key)?.keys() ?? [])];
}

/** Instancia uma cópia (já escalada) de um modelo pré-carregado. */
export function instantiateModel(key: ModelKey): pc.Entity {
  const asset = assets.get(key);
  if (!asset) throw new Error(`Modelo "${key}" não foi pré-carregado — chame preloadModels() antes`);
  if (!asset.resource) throw new Error(`Modelo "${key}" sem resource (loaded=${asset.loaded}, loading=${asset.loading}, url=${MODELS[key].url})`);
  const entity = (asset.resource as pc.ContainerResource).instantiateRenderEntity();
  const s = MODELS[key].scale;
  entity.setLocalScale(s, s, s);
  entity.name = key;
  return entity;
}

/** Esconde todas as armas embutidas de um personagem e mostra só a pedida (se houver). */
export function showCharacterWeapon(model: pc.Entity, weapon: CharacterWeaponNode | null): void {
  for (const n of CHARACTER_WEAPON_NODES) {
    const node = model.findByName(n) as pc.Entity | null;
    if (node) node.enabled = n === weapon;
  }
}

/** Personagem remoto: escolhe um dos modelos humanos de forma estável a partir do id. */
export function characterForId(id: string): ModelKey {
  const pool: ModelKey[] = ['char_matt', 'char_sam', 'char_lis', 'char_shaun'];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return pool[h % pool.length];
}

/** Clona os materiais de um modelo instanciado (pra tingir sem afetar outras instâncias) e aplica um tom. */
export function tintModel(model: pc.Entity, color: pc.Color): pc.StandardMaterial[] {
  const out: pc.StandardMaterial[] = [];
  const renders = model.findComponents('render') as pc.RenderComponent[];
  for (const r of renders) {
    const cloned = r.meshInstances.map((mi) => {
      const m = (mi.material as pc.StandardMaterial).clone();
      m.diffuse.copy(color);
      m.update();
      out.push(m);
      return m;
    });
    r.meshInstances.forEach((mi, i) => (mi.material = cloned[i]));
  }
  return out;
}
