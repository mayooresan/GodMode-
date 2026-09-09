import type { Tribe } from './types.js';

/**
 * Settlement lookups.
 *
 * Kept in their own module because both the agent FSM and the tribal logic need
 * them, and importing one from the other would close a cycle.
 */

/** The tribe settlement closest to a point. Every tribe always has at least one. */
export function nearestCamp(tribe: Tribe, x: number, y: number): { x: number; y: number } {
  let best = tribe.camps[0] ?? { x: tribe.cx, y: tribe.cy };
  let bestD = Infinity;
  for (const camp of tribe.camps) {
    const d = (camp.x - x) ** 2 + (camp.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = camp;
    }
  }
  return best;
}

/** Distance from a point to the tribe's closest settlement. */
export function campDistance(tribe: Tribe, x: number, y: number): number {
  const c = nearestCamp(tribe, x, y);
  return Math.hypot(c.x - x, c.y - y);
}
