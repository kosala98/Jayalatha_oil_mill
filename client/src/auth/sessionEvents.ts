/**
 * The outbox sends transactions on its own, long after a screen asked for them, so it
 * needs a way to say "the server no longer accepts this session". Keeping it here,
 * rather than importing the React context, avoids a cycle between the two.
 */
type Handler = () => void;

let handler: Handler | null = null;

export function setSessionExpiredHandler(fn: Handler | null): void {
  handler = fn;
}

export function notifySessionExpired(): void {
  handler?.();
}

/**
 * The token of whoever is signed in. Every request carries it, including the ones the
 * outbox sends on its own long after a screen asked for them — which is why it lives
 * here rather than being threaded through every call site.
 */
let token: string | null = null;

export function setSessionToken(next: string | null): void {
  token = next;
}

export function currentSessionToken(): string | null {
  return token;
}
