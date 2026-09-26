import { useState } from 'react';
import { describeError } from '../api/errors';
import { useSession } from '../auth/Session';
import { PinPad } from '../components/PinPad';
import { S } from '../i18n';

/**
 * The whole app sits behind this. One PIN box, two PINs: the counter PIN opens the
 * working screens, the owner's PIN opens those plus the books. Which one was typed
 * is decided on the server — nothing here says which is which.
 */
export function LoginScreen() {
  const { login } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <section className="card card--center">
      <PinPad
        title={S.auth.title}
        busy={busy}
        error={error}
        onSubmit={async (pin) => {
          setBusy(true);
          setError(null);
          try {
            await login(pin);
          } catch (err) {
            setError(describeError(err));
          } finally {
            setBusy(false);
          }
        }}
      />
      <p className="muted small center">{S.auth.help}</p>
    </section>
  );
}
