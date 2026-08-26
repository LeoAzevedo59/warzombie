export type ItemId = 'stick' | 'stone' | 'axe' | 'pickaxe' | 'wood' | 'plank' | 'workbench' | 'pistol';

export type ItemCategory = 'resource' | 'tool' | 'structure' | 'weapon';

export interface ItemDef {
  id: ItemId;
  name: string;
  category: ItemCategory;
  stackMax: number;
  /** cor hex usada no primitivo (mundo) e no ícone (UI) */
  color: string;
}

export interface ItemStack {
  itemId: ItemId;
  count: number;
}
