/** Joins CSS module class names, skipping empty ones (CSS module lookups may be undefined). */
export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
