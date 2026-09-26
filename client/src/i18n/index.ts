import { si } from './si';

/** Active language. Swap to another object with the same shape to translate the app. */
export const S = si;

/** Fill {placeholders}: t(S.sale.saved, { total: '1,200.00' }) */
export function t(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}
