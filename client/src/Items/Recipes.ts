import type { ItemId, ItemStack } from './Item';

export type RecipeId = 'axe' | 'pickaxe' | 'workbench';

export interface Recipe {
  id: RecipeId;
  output: ItemStack;
  inputs: ItemStack[];
  /** segundos de espera até o item ficar pronto; omitido = instantâneo */
  duration?: number;
}

export const RECIPES: Record<RecipeId, Recipe> = {
  axe: {
    id: 'axe',
    output: { itemId: 'axe', count: 1 },
    inputs: [
      { itemId: 'stick', count: 2 },
      { itemId: 'stone', count: 1 },
    ],
    duration: 5,
  },
  pickaxe: {
    id: 'pickaxe',
    output: { itemId: 'pickaxe', count: 1 },
    inputs: [
      { itemId: 'stick', count: 2 },
      { itemId: 'stone', count: 2 },
    ],
    duration: 5,
  },
  workbench: {
    id: 'workbench',
    output: { itemId: 'workbench', count: 1 },
    inputs: [
      { itemId: 'wood', count: 4 },
      { itemId: 'stick', count: 2 },
    ],
  },
};

export function allRecipes(): Recipe[] {
  return Object.values(RECIPES);
}

export function recipeFor(itemId: ItemId): Recipe | undefined {
  return allRecipes().find((r) => r.output.itemId === itemId);
}
