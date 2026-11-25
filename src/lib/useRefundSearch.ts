import type { SeedWorld } from './types';
import { useMemo } from 'react';

export function useRefundSearch(world: SeedWorld, query: string) {
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return world.refunds
      .filter((r) => r.id.toLowerCase().includes(q) || r.customerId.toLowerCase().includes(q) || r.orderId.toLowerCase().includes(q))
      .slice(0, 20);
  }, [world, query]);
}
