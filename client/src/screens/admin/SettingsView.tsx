import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '../../api/endpoints';
import { describeError } from '../../api/errors';
import { useSession } from '../../auth/Session';
import { Field } from '../../components/Field';
import { Segmented } from '../../components/Segmented';
import { useToast } from '../../components/Toast';
import { S, t } from '../../i18n';
import { formatTime } from '../../lib/numbers';
import { useLiveRefresh } from '../../lib/live';

const ROLES = [
  { value: 'USER', label: S.settings.roleUser },
  { value: 'ADMIN', label: S.settings.roleAdmin },
] as const;

const MINUTES = [
  { value: 30, label: t(S.tempAccess.minutesOption, { n: 30 }) },
  { value: 60, label: t(S.tempAccess.hours, { n: 1 }) },
  { value: 240, label: t(S.tempAccess.hours, { n: 4 }) },
  { value: 480, label: t(S.tempAccess.hours, { n: 8 }) },
];

/** The owner's own screen: both PINs, and lending the counter the admin screens. */
export function SettingsView() {
  const { session, replace, setTemporaryAdminUntil, handleAuthError } = useSession();
  const toast = useToast();

  const [role, setRole] = useState<'USER' | 'ADMIN'>('USER');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [repeatPin, setRepeatPin] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const [until, setUntil] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(60);
  const [reason, setReason] = useState('');
  const [grantError, setGrantError] = useState<string | null>(null);

  const loadAccess = useCallback(async () => {
    if (!session) return;
    try {
      const { expiresAt } = await api.temporaryAccess(session.token);
      setUntil(expiresAt);
    } catch (err) {
      if (!handleAuthError(err)) setGrantError(describeError(err));
    }
  }, [session, handleAuthError]);

  useEffect(() => {
    void loadAccess();
  }, [loadAccess]);
  useLiveRefresh(['temporary_admin_access'], () => void loadAccess());

  async function changePin(e: FormEvent) {
    e.preventDefault();
    if (!session) return;
    const next: Record<string, string> = {};
    if (!/^\d{4,8}$/.test(currentPin)) next.currentPin = S.settings.pinFormat;
    if (!/^\d{4,8}$/.test(newPin)) next.newPin = S.settings.pinFormat;
    if (newPin !== repeatPin) next.repeatPin = S.settings.pinMismatch;
    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    try {
      const result = await api.changePin(role, currentPin, newPin, session.token);
      // Changing the admin PIN ends this session; the server hands back a fresh one.
      if (result.token && result.expiresAt) {
        replace({ token: result.token, role: 'ADMIN', expiresAt: result.expiresAt });
      }
      toast(role === 'ADMIN' ? S.settings.adminPinChanged : S.settings.userPinChanged, 'success');
      setCurrentPin('');
      setNewPin('');
      setRepeatPin('');
    } catch (err) {
      // A wrong admin PIN is a typo, not a reason to throw the owner out.
      setErrors({ currentPin: describeError(err) });
    } finally {
      setBusy(false);
    }
  }

  async function grant() {
    if (!session) return;
    setGrantError(null);
    try {
      const g = await api.grantAccess(minutes, reason.trim() || null, session.token);
      setUntil(g.expiresAt);
      setTemporaryAdminUntil(g.expiresAt);
      setReason('');
      toast(t(S.tempAccess.granted, { time: formatTime(g.expiresAt) }), 'success');
    } catch (err) {
      if (!handleAuthError(err)) setGrantError(describeError(err));
    }
  }

  async function end() {
    if (!session) return;
    try {
      await api.endAccess(session.token);
      setUntil(null);
      setTemporaryAdminUntil(null);
      toast(S.tempAccess.ended, 'success');
    } catch (err) {
      if (!handleAuthError(err)) setGrantError(describeError(err));
    }
  }

  return (
    <div className="stack">
      <form className="card" onSubmit={changePin} noValidate>
        <h3 className="card__title">{S.settings.title}</h3>
        <p className="muted small">{S.settings.help}</p>
        <Segmented label={S.settings.whichPin} options={ROLES} value={role} onChange={setRole} />
        <Field
          label={S.settings.currentAdminPin}
          value={currentPin}
          onChange={setCurrentPin}
          error={errors.currentPin}
          inputMode="numeric"
          type="password"
          maxLength={8}
        />
        <Field label={S.settings.newPin} value={newPin} onChange={setNewPin} error={errors.newPin} inputMode="numeric" type="password" maxLength={8} />
        <Field label={S.settings.repeatPin} value={repeatPin} onChange={setRepeatPin} error={errors.repeatPin} inputMode="numeric" type="password" maxLength={8} />
        <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
          {busy ? S.common.saving : S.settings.submit}
        </button>
      </form>

      <section className="card">
        <h3 className="card__title">{S.tempAccess.title}</h3>
        <p className="muted small">{S.tempAccess.help}</p>
        {until ? (
          <>
            <p className="notice notice--temp">{t(S.tempAccess.active, { time: formatTime(until) })}</p>
            <button type="button" className="btn btn--danger-quiet btn--block" onClick={() => void end()}>
              {S.tempAccess.end}
            </button>
          </>
        ) : (
          <>
            <Segmented label={S.tempAccess.minutes} options={MINUTES} value={minutes} onChange={setMinutes} />
            <Field label={S.tempAccess.reason} value={reason} onChange={setReason} placeholder={S.tempAccess.reasonPlaceholder} maxLength={200} />
            <button type="button" className="btn btn--secondary btn--block" onClick={() => void grant()}>
              {S.tempAccess.grant}
            </button>
          </>
        )}
        {grantError && <p className="form-error">{grantError}</p>}
      </section>
    </div>
  );
}
