import * as pc from 'playcanvas';

/**
 * Batching estático do cenário. Cada enfeite (grama, flor, pedrinha, árvore do outro lado do rio)
 * era uma entity com o próprio draw call — ~1.900 mesh instances no mundo, ~1.200 draw calls por
 * frame antes de qualquer zumbi, tudo ainda projetando sombra (segundo passe). O BatchManager do
 * PlayCanvas funde mesh instances com o mesmo material num único draw call por lote; lotes têm no
 * máximo MAX_AABB de lado para a câmera ainda descartar o que está fora da tela (24 dava 413 lotes; 40 reduz bem mais os draw calls).
 *
 * Só para o que nunca muda: árvores/rochas coletáveis (WorldObject) e paredes ficam de fora.
 */
const GROUP_NAME = 'world_static';
const MAX_AABB = 40;
let groupId: number | null = null;

/** Id do grupo de batching estático (criado uma vez por app). */
export function staticBatchGroup(app: pc.Application): number {
  if (groupId === null) groupId = app.batcher.addGroup(GROUP_NAME, false, MAX_AABB).id;
  return groupId;
}

/** Põe todos os render components da entity no lote estático e define se projetam sombra. */
export function markStatic(app: pc.Application, entity: pc.Entity, castShadows: boolean): void {
  const id = staticBatchGroup(app);
  for (const r of entity.findComponents('render') as pc.RenderComponent[]) {
    r.castShadows = castShadows;
    r.batchGroupId = id;
  }
}
