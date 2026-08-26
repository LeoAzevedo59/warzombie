/** Itens do jogo e economia. Fonte única para client (UI) e server (regras). */

export type ItemId = 'stick' | 'stone' | 'wood' | 'bigstone' | 'axe' | 'pickaxe' | 'glock' | 'battery';
export type ItemCategory = 'resource' | 'tool' | 'weapon' | 'device';

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
  axe: { id: 'axe', name: 'Machado', category: 'tool', stackMax: 1, color: '#c8742a', buy: 30, weight: 3 },
  pickaxe: { id: 'pickaxe', name: 'Picareta', category: 'tool', stackMax: 1, color: '#5f7fa8', buy: 30, weight: 3 },
  glock: { id: 'glock', name: 'Glock', category: 'weapon', stackMax: 1, color: '#2b2f36', buy: 100, weight: 2 },
  battery: { id: 'battery', name: 'Bateria da Torre', category: 'device', stackMax: 1, color: '#ffd34d', buy: 150, weight: 5 },
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
    return (['axe', 'pickaxe', 'glock', 'battery'] as ItemId[]).map((id) => ITEMS[id]);
  },
};
