import type { ItemDef, ItemId } from './Item';

const ITEMS: Record<ItemId, ItemDef> = {
  stick: { id: 'stick', name: 'Graveto', category: 'resource', stackMax: 20, color: '#8a5a2b' },
  stone: { id: 'stone', name: 'Pedra', category: 'resource', stackMax: 20, color: '#8e939a' },
  axe: { id: 'axe', name: 'Machado', category: 'tool', stackMax: 1, color: '#c8742a' },
  pickaxe: { id: 'pickaxe', name: 'Picareta', category: 'tool', stackMax: 1, color: '#5f7fa8' },
  wood: { id: 'wood', name: 'Tronco de Madeira', category: 'resource', stackMax: 20, color: '#6b4226' },
  plank: { id: 'plank', name: 'Tábua', category: 'resource', stackMax: 20, color: '#c9a06a' },
  workbench: { id: 'workbench', name: 'Mesa de Marceneiro', category: 'structure', stackMax: 5, color: '#8a5a2b' },
  pistol: { id: 'pistol', name: 'Pistola', category: 'weapon', stackMax: 1, color: '#2b2f36' },
};

export const ItemDatabase = {
  get(id: ItemId): ItemDef {
    return ITEMS[id];
  },
  all(): ItemDef[] {
    return Object.values(ITEMS);
  },
};
