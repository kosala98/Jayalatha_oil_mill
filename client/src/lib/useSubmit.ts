import { useState } from 'react';
import { describeError } from '../api/errors';
import { S, t } from '../i18n';
import { formatMoney } from './numbers';
import { type OutboxKind, submit } from '../offline/outbox';
import { useToast } from '../components/Toast';

/**
 * Shared save flow for the three entry screens.
 * Returns true when the transaction is safe (on the server or in the offline queue),
 * so the form can clear. Returns false when the cashier needs to fix something.
 */
export function useSubmit(kind: OutboxKind, savedTemplate: string) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(payload: object): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      const result = await submit<{ total?: string; amount?: string }>(kind, payload);
      if (result.status === 'sent') {
        toast(t(savedTemplate, { total: formatMoney(result.record.total ?? result.record.amount ?? '0') }), 'success');
        return true;
      }
      if (result.status === 'queued') {
        toast(S.common.savedOffline, 'queued');
        return true;
      }
      setError(describeError(result.error));
      return false;
    } catch (err) {
      // Could not reach the server AND could not store locally.
      setError(`${S.common.notSaved} ${describeError(err)}`);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { save, busy, error, clearError: () => setError(null) };
}
