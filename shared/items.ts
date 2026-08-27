/** Itens do jogo e economia. Fonte única para client (UI) e server (regras). */

export type ItemId = 'stick' | 'stone' | 'wood' | 'bigstone' | 'knife' | 'axe' | 'pickaxe' | 'glock' | 'battery' | 'bandage' | 'painkiller' | 'boss_heart' | 'wall_wood' | 'wall_stone' | 'wall_iron' | 'gate';
export type ItemCategory = 'resource' | 'tool' | 'weapon' | 'device' | 'consumable' | 'wall';

export type WallKind = 'wall_wood' | 'wall_stone' | 'wall_iron' | 'gate';
/** Vida de cada parede (porteira: jogadores atravessam, zumbis não; mais frágil e mais cara). */
export const WALL_HP: Record<WallKind, number> = { wall_wood: 150, wall_stone: 400, wall_iron: 900, gate: 100 };
/** Ferramenta que derruba cada parede (segurando E, como árvore/rocha) e quantos golpes leva. */
export const WALL_TOOL: Record<WallKind, 'axe' | 'pickaxe'> = { wall_wood: 'axe', wall_stone: 'pickaxe', wall_iron: 'pickaxe', gate: 'axe' };
export const WALL_HITS: Record<WallKind, number> = { wall_wood: 3, wall_stone: 5, wall_iron: 8, gate: 2 };
/** Jogadores atravessam (zumbis não). */
export const WALL_PASSABLE: Record<WallKind, boolean> = { wall_wood: false, wall_stone: false, wall_iron: false, gate: true };
export function isWallKind(id: ItemId): id is WallKind {
  return id in WALL_HP;
}

export interface ItemDef {
  id: ItemId;
  name: string;
  category: ItemCategory;
  stackMax: number;
  /** cor hex usada no primitivo (mundo) e no ícone (UI) */
  color: string;
  /** valor de venda por unidade (só recursos) */
  sell?: number;
  /** preço de compra no vendedor */
  buy?: number;
  /** peso por unidade (capacidade do jogador em GAME.weight) */
  weight: number;
  /** consumível: vida recuperada ao usar (clique com o item equipado) */
  heal?: number;
}

export interface ItemStack {
  itemId: ItemId;
  count: number;
}

export const HOTBAR_SLOTS = 5;

export const ITEMS: Record<ItemId, ItemDef> = {
  stick: { id: 'stick', name: 'Graveto', category: 'resource', stackMax: 20, color: '#8a5a2b', sell: 1, weight: 1 },
  stone: { id: 'stone', name: 'Pedra', category: 'resource', stackMax: 20, color: '#8e939a', sell: 2, weight: 2 },
  wood: { id: 'wood', name: 'Tronco', category: 'resource', stackMax: 20, color: '#6b4226', sell: 5, weight: 3 },
  bigstone: { id: 'bigstone', name: 'Pedra Grande', category: 'resource', stackMax: 20, color: '#5c6670', sell: 6, weight: 4 },
  knife: { id: 'knife', name: 'Faca', category: 'weapon', stackMax: 1, color: '#c0c8d0', buy: 10, weight: 1 },
  axe: { id: 'axe', name: 'Machado', category: 'tool', stackMax: 1, color: '#c8742a', buy: 30, weight: 3 },
  pickaxe: { id: 'pickaxe', name: 'Picareta', category: 'tool', stackMax: 1, color: '#5f7fa8', buy: 30, weight: 3 },
  glock: { id: 'glock', name: 'Glock', category: 'weapon', stackMax: 1, color: '#2b2f36', buy: 100, weight: 2 },
  battery: { id: 'battery', name: 'Bateria da Antena', category: 'device', stackMax: 1, color: '#ffd34d', buy: 150, weight: 22 }, // o item mais pesado: carregar até a torre é lento
  boss_heart: { id: 'boss_heart', name: 'Coração do Chefão', category: 'resource', stackMax: 5, color: '#c8102e', sell: 300, weight: 4 }, // cai do chefão; vale muito no vendedor
  bandage: { id: 'bandage', name: 'Bandagem', category: 'consumable', stackMax: 5, color: '#f2e8dc', buy: 15, weight: 1, heal: 35 },
  painkiller: { id: 'painkiller', name: 'Analgésico', category: 'consumable', stackMax: 5, color: '#ff8fb1', buy: 40, weight: 1, heal: 75 },
  wall_wood: { id: 'wall_wood', name: 'Parede de Madeira', category: 'wall', stackMax: 5, color: '#8a5a2b', buy: 20, weight: 4 },
  wall_stone: { id: 'wall_stone', name: 'Parede de Pedra', category: 'wall', stackMax: 5, color: '#7a8088', buy: 45, weight: 6 },
  wall_iron: { id: 'wall_iron', name: 'Parede de Ferro', category: 'wall', stackMax: 5, color: '#4a5a6a', buy: 90, weight: 8 },
  gate: { id: 'gate', name: 'Porteira', category: 'wall', stackMax: 5, color: '#d9b25c', buy: 100, weight: 5 },
};

/** Peso total carregado. */
export function totalWeight(hotbar: ReadonlyArray<ItemStack | null>): number {
  return hotbar.reduce((n, s) => n + (s ? ITEMS[s.itemId].weight * s.count : 0), 0);
}

export const ItemDatabase = {
  get(id: ItemId): ItemDef {
    return ITEMS[id];
  },
  all(): ItemDef[] {
    return Object.values(ITEMS);
  },
  /** Itens à venda no vendedor, na ordem da loja. */
  shop(): ItemDef[] {
    return (['knife', 'axe', 'pickaxe', 'glock', 'bandage', 'painkiller', 'battery', 'wall_wood', 'wall_stone', 'wall_iron', 'gate'] as ItemId[]).map((id) => ITEMS[id]);
  },
};
