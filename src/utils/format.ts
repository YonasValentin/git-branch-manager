/**
 * Formats age in human-readable format.
 * @param days - Number of days
 * @returns Formatted string
 */
export function formatAge(days: number): string {
  if (isNaN(days) || days < 0) return 'unknown';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
