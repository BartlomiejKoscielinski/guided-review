/** Moves focus between a menu's items with the arrow keys, Home and End. */
export function moveMenuFocus(menu: HTMLElement, key: string): boolean {
  const items = [...menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
  const at = items.indexOf(document.activeElement as HTMLElement);
  const last = items.length - 1;
  const next: Partial<Record<string, number>> = {
    ArrowDown: at >= last ? 0 : at + 1,
    ArrowUp: at <= 0 ? last : at - 1,
    Home: 0,
    End: last,
  };
  const index = next[key];
  if (index === undefined) return false;
  items[index]?.focus();
  return true;
}
