export type TileType = 'grass' | 'dirt';

export interface TileDef {
  type: TileType;
  color: string;
}

export const TILES: Record<TileType, TileDef> = {
  grass: { type: 'grass', color: '#3f7a3a' },
  dirt: { type: 'dirt', color: '#6b4f2e' },
};

/** Define o tipo de tile de um chunk por ruído simples (variação visual entre chunks). */
export function tileForChunk(cx: number, cz: number): TileDef {
  const n = Math.abs(Math.sin(cx * 12.9898 + cz * 78.233) * 43758.5453) % 1;
  return n < 0.8 ? TILES.grass : TILES.dirt;
}
