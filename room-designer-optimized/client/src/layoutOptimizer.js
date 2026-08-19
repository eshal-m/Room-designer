// Lightweight constraint-based layout optimizer.
// It scores candidate layouts instead of blindly trusting AI coordinates.

const ROOM_SIZE = 8;
const WALL_MARGIN = 0.08;
const DOORWAY = { x: 0, z: ROOM_SIZE / 2 - 0.35, width: 1.2, depth: 0.8 };

export const getCatalogSize = (catalog, item) => {
  const def = catalog.find((c) => c.id === item.typeId);
  return def?.size ?? [1, 1, 1];
};

export const footprint = (catalog, item) => {
  const [w, , d] = getCatalogSize(catalog, item);
  const quarterTurns = Math.round((item.rotation ?? 0) / (Math.PI / 2));
  return Math.abs(quarterTurns) % 2 === 1 ? [d, w] : [w, d];
};

export function isInsideRoom(catalog, item) {
  const [w, d] = footprint(catalog, item);
  const half = ROOM_SIZE / 2;
  return Math.abs(item.x) + w / 2 <= half - WALL_MARGIN &&
    Math.abs(item.z) + d / 2 <= half - WALL_MARGIN;
}

export function overlaps(a, b, catalog) {
  const [aw, ad] = footprint(catalog, a);
  const [bw, bd] = footprint(catalog, b);
  return Math.abs(a.x - b.x) < (aw + bw) / 2 &&
    Math.abs(a.z - b.z) < (ad + bd) / 2;
}

function distanceToDoor(item) {
  const dx = item.x - DOORWAY.x;
  const dz = item.z - DOORWAY.z;
  return Math.hypot(dx, dz);
}

function pairwiseCollisions(items, catalog) {
  let count = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (overlaps(items[i], items[j], catalog)) count++;
    }
  }
  return count;
}

function scoreLayout(items, catalog) {
  let score = 0;
  const collisions = pairwiseCollisions(items, catalog);
  score -= collisions * 1000;

  for (const item of items) {
    if (!isInsideRoom(catalog, item)) score -= 500;
    // Keep the doorway reasonably clear.
    score -= Math.max(0, 1.6 - distanceToDoor(item)) * 25;
  }

  // Encourage furniture to stay somewhat near walls while preserving a
  // central walking area. This produces layouts that feel more intentional.
  for (const item of items) {
    const wallDistance = Math.min(
      ROOM_SIZE / 2 - Math.abs(item.x),
      ROOM_SIZE / 2 - Math.abs(item.z)
    );
    score -= Math.max(0, 1.4 - wallDistance) * 4;
  }

  // Reward separation between furniture, but avoid pushing everything to walls.
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const d = Math.hypot(items[i].x - items[j].x, items[i].z - items[j].z);
      score += Math.min(d, 2.0) * 2;
    }
  }

  return score;
}

function clampItem(catalog, item) {
  const [w, d] = footprint(catalog, item);
  const half = ROOM_SIZE / 2 - WALL_MARGIN;
  return {
    ...item,
    x: Math.max(-half + w / 2, Math.min(half - w / 2, item.x)),
    z: Math.max(-half + d / 2, Math.min(half - d / 2, item.z)),
  };
}

/**
 * Random-restart hill climbing. Gemini proposes the initial arrangement;
 * this algorithm improves it using explicit spatial constraints.
 */
export function optimizeLayout(items, catalog, iterations = 900) {
  if (items.length < 2) return items.map((item) => clampItem(catalog, item));

  let best = items.map((item) => clampItem(catalog, item));
  let bestScore = scoreLayout(best, catalog);
  let current = best;
  let currentScore = bestScore;

  for (let i = 0; i < iterations; i++) {
    const index = Math.floor(Math.random() * current.length);
    const item = current[index];
    const candidate = [...current];
    const step = i < iterations * 0.25 ? 0.65 : 0.28;
    candidate[index] = clampItem(catalog, {
      ...item,
      x: item.x + (Math.random() * 2 - 1) * step,
      z: item.z + (Math.random() * 2 - 1) * step,
    });

    const candidateScore = scoreLayout(candidate, catalog);
    if (candidateScore > currentScore || Math.random() < 0.01) {
      current = candidate;
      currentScore = candidateScore;
    }

    if (currentScore > bestScore) {
      best = current;
      bestScore = currentScore;
    }
  }

  return best;
}

export function layoutStats(items, catalog) {
  const collisions = pairwiseCollisions(items, catalog);
  const valid = items.filter((item) => isInsideRoom(catalog, item)).length;
  const total = Math.max(items.length, 1);
  return {
    collisions,
    inBounds: valid,
    score: Math.round(scoreLayout(items, catalog)),
    quality: Math.max(0, Math.round(((valid / total) * 100) - collisions * 20)),
  };
}
