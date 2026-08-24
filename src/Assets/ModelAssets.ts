import * as pc from 'playcanvas';

export type ModelKey = 'player' | 'tree' | 'rock';

const MODEL_URLS: Record<ModelKey, string> = {
  player: '/models/characters/worker.glb',
  tree: '/models/nature/tree.glb',
  rock: '/models/nature/rock-medium.glb',
};

/**
 * Escala aplicada a cada modelo instanciado. Medida contra a altura real do GLB
 * (via AABB) para ficar em proporção com CONFIG.player.HEIGHT (~1.8) e o resto do mundo.
 */
export const MODEL_SCALE: Record<ModelKey, number> = {
  player: 1, // worker.glb já sai com ~1.86 de altura, praticamente 1:1
  tree: 0.5, // tree.glb bruto tem ~9.4 de altura, grande demais para a escala do jogo
  rock: 0.85, // rock-medium.glb bruto tem ~1.9 de altura
};

const assets = new Map<ModelKey, pc.Asset>();

/** Tracks do worker.glb pelo nome curto (parte depois do "|": Idle, Walk, Run, Punch_Left, Kick_Right, Death...). */
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
  | 'Run_Shoot';
/** @deprecated use CharacterAnimName */
export type PlayerAnimName = CharacterAnimName;

const characterAnimTracks = new Map<string, pc.AnimTrack>();

/** Carrega todos os modelos GLB usados no jogo. Chame uma vez, cedo, e aguarde antes de instanciar. */
export function preloadModels(app: pc.Application): Promise<void> {
  const loads = (Object.entries(MODEL_URLS) as [ModelKey, string][]).map(
    ([key, url]) =>
      new Promise<void>((resolve, reject) => {
        app.assets.loadFromUrl(url, 'container', (err, asset) => {
          if (err || !asset) {
            reject(new Error(`Falha ao carregar modelo "${key}" (${url}): ${err}`));
            return;
          }
          assets.set(key, asset);
          if (key === 'player') extractPlayerAnimations(asset.resource as pc.ContainerResource);
          resolve();
        });
      }),
  );
  return Promise.all(loads).then(() => undefined);
}

/** Mapeia as tracks do GLB (ex: "CharacterArmature|Walk") para os nomes curtos que usamos. */
function extractPlayerAnimations(container: pc.ContainerResource): void {
  // `animations` existe em runtime (documentado via JSDoc no engine) mas falta no .d.ts do pacote.
  const animations = (container as unknown as { animations: pc.Asset[] }).animations;
  for (const animAsset of animations) {
    const track = animAsset.resource as pc.AnimTrack;
    const short = track.name.includes('|') ? track.name.slice(track.name.lastIndexOf('|') + 1) : track.name;
    characterAnimTracks.set(short, track);
  }
}

/** Track de animação do personagem (worker.glb) pelo nome curto, se encontrada no GLB. */
export function getCharacterAnimTrack(name: CharacterAnimName): pc.AnimTrack | undefined {
  return characterAnimTracks.get(name);
}
/** @deprecated use getCharacterAnimTrack */
export const getPlayerAnimTrack = getCharacterAnimTrack;

/** Instancia uma cópia (já escalada) de um modelo pré-carregado. */
export function instantiateModel(key: ModelKey): pc.Entity {
  const asset = assets.get(key);
  if (!asset) throw new Error(`Modelo "${key}" não foi pré-carregado — chame preloadModels() antes`);
  const entity = (asset.resource as pc.ContainerResource).instantiateRenderEntity();
  const s = MODEL_SCALE[key];
  entity.setLocalScale(s, s, s);
  return entity;
}
