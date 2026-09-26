/**
 * Lets a screen hand the cashier to another tab — "I've added the copra, now take me
 * to the sale side". The app shell registers the setter; nothing else knows about tabs.
 */
type Go = (tab: string) => void;

let go: Go | null = null;

export function setTabNavigator(fn: Go | null): void {
  go = fn;
}

export function goToTab(tab: string): void {
  go?.(tab);
}
