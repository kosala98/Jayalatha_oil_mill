import type {
  CustomerPayment,
  CashEntry,
  ChequeDay,
  Customer,
  CustomerProfile,
  Page,
  Period,
  Product,
  Purchase,
  Sale,
  Stats,
} from '../domain/types';
import { request } from './http';

export type HistoryKind = 'sale' | 'purchase' | 'cash' | 'payment';
/** Everything the counter can record, including things queued while offline. */
export const COLLECTION_PATH: Record<HistoryKind | 'customer', string> = {
  sale: '/api/sales',
  purchase: '/api/purchases',
  cash: '/api/cash-entries',
  payment: '/api/customer-payments',
  customer: '/api/customers',
};

export interface HistoryRecord {
  sale: Sale;
  purchase: Purchase;
  cash: CashEntry;
  payment: CustomerPayment;
}

export const api = {
  products: () => request<Product[]>('/api/products', { timeoutMs: 6000 }),

  /** The last five sales / purchases, for the counter's check under the form. */
  recentSales: () => request<(Sale & { customerName?: string | null })[]>('/api/sales/recent', { timeoutMs: 8000 }),
  recentPurchases: () =>
    request<(Purchase & { customerName?: string | null })[]>('/api/purchases/recent', { timeoutMs: 8000 }),

  stats: (period: Period, token: string) => request<Stats>(`/api/stats?period=${period}`, { token }),

  list<K extends HistoryKind>(
    kind: K,
    q: { period: Period; range?: { from: string; to: string } | null; cursor?: string | null; includeDeleted?: boolean },
    token: string,
  ) {
    const params = new URLSearchParams({ period: q.period, limit: '50' });
    // A chosen calendar range replaces the period on the server.
    if (q.range) {
      params.set('from', q.range.from);
      params.set('to', q.range.to);
    }
    if (q.cursor) params.set('cursor', q.cursor);
    if (q.includeDeleted) params.set('includeDeleted', 'true');
    return request<Page<HistoryRecord[K]>>(`${COLLECTION_PATH[kind]}?${params}`, { token });
  },

  remove<K extends HistoryKind>(kind: K, id: string, reason: string, token: string) {
    return request<HistoryRecord[K]>(`${COLLECTION_PATH[kind]}/${id}`, { method: 'DELETE', body: { reason }, token });
  },

  // ---------- price book ----------

  prices: () => request<{ id: string; amount: string; updatedAt: string }[]>('/api/prices'),

  savePrices: (prices: { id: string; amount: string }[]) =>
    request<{ updated: number; prices: { id: string; amount: string }[] }>('/api/prices', {
      method: 'PUT',
      body: { prices },
    }),

  // ---------- customers ----------

  customers: (q?: string) =>
    request<Customer[]>(`/api/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`, { timeoutMs: 8000 }),

  customer: (id: string) => request<CustomerProfile>(`/api/customers/${id}`),

  /** Direct create: a customer must exist on the server before anyone can owe them. */
  createCustomer: (body: { clientId: string; name: string; phone: string | null; note: string | null }) =>
    request<Customer>('/api/customers', { method: 'POST', body }),

  updateCustomer: (id: string, body: { name: string; phone: string | null; note: string | null }, token: string) =>
    request<Customer>(`/api/customers/${id}`, { method: 'PATCH', body, token }),

  removeCustomer: (id: string, reason: string, token: string) =>
    request<Customer>(`/api/customers/${id}`, { method: 'DELETE', body: { reason }, token }),

  // ---------- cheques due for deposit ----------

  cheques: (from: string, to: string, token: string) =>
    request<ChequeDay>(`/api/cheques?from=${from}&to=${to}`, { token }),

  // ---------- charcoal stock correction ----------

  adjustCharcoal: (body: { clientId: string; countedKg: string; reason: string }, token: string) =>
    request<{ deltaKg?: string; unchanged?: boolean }>('/api/charcoal/adjustments', { method: 'POST', body, token }),

  // ---------- temporary admin access ----------

  // ---------- temporary admin access ----------

  grantAccess: (minutes: number, reason: string | null, token: string) =>
    request<{ id: string; expiresAt: string; reason: string | null }>('/api/auth/temporary-access', {
      method: 'POST',
      body: { minutes, reason },
      token,
    }),

  endAccess: (token: string) => request<{ ended: number }>('/api/auth/temporary-access', { method: 'DELETE', token }),

  temporaryAccess: (token: string) =>
    request<{ expiresAt: string | null }>('/api/auth/temporary-access', { token }),

  /** Username and password; the account's role decides which screens open. */
  login: (username: string, password: string) =>
    request<{ token: string; role: 'USER' | 'ADMIN'; username: string; expiresAt: string; temporaryAdminUntil: string | null }>(
      '/api/auth/login',
      { method: 'POST', body: { username, password } },
    ),

  session: (token: string) =>
    request<{ role: 'USER' | 'ADMIN' | null; expiresAt: string | null; temporaryAdminUntil: string | null }>(
      '/api/auth/session',
      { token },
    ),

  changePin: (role: 'USER' | 'ADMIN', currentPin: string, newPin: string, token: string) =>
    request<{ token?: string; role?: 'USER' | 'ADMIN'; expiresAt?: string }>('/api/auth/change-pin', {
      method: 'POST',
      body: { role, currentPin, newPin },
      token,
    }),
};
