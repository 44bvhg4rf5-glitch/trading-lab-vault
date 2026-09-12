/** Tiny clock helpers so server components don't call Date.now() inline during render. */
export function now(): Date {
  return new Date();
}

export function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86400_000);
}

export function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86400_000);
}
