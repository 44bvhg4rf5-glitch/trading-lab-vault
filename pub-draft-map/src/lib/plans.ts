/** Plan gates. Safe to import from client components (no server deps). */
export const PLAN_LIMITS = {
  FREE: { events: 0, deals: 0, promoted: false, pricePerMonthGbp: 0 },
  LISTED: { events: 4, deals: 2, promoted: false, pricePerMonthGbp: 19 },
  PROMOTED: { events: Infinity, deals: Infinity, promoted: true, pricePerMonthGbp: 49 },
} as const;

export type Plan = keyof typeof PLAN_LIMITS;

export function planOf(plan: string | undefined | null): Plan {
  return plan === "LISTED" || plan === "PROMOTED" ? plan : "FREE";
}
