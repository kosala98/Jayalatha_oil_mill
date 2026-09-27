import { type FormEvent, useState } from 'react';
import { describeError } from '../api/errors';
import { useSession } from '../auth/Session';
import { Field } from '../components/Field';
import { S } from '../i18n';

/**
 * The whole app sits behind this. Two accounts: "user" opens the working screens,
 * "admin" opens those plus the books. Which one it is comes from the server.
 */
export function LoginScreen() {
  const { login } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !username.trim() || password.length < 4) return;
    setBusy(true);
    setError(null);
    try {
      await login(username.trim().toLowerCase(), password);
    } catch (err) {
      setError(describeError(err));
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card card--center">
      <form onSubmit={submit} noValidate>
        <h2 className="pinpad__prompt">{S.auth.title}</h2>
        <Field
          label={S.auth.username}
          value={username}
          onChange={setUsername}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={40}
          autoFocus
        />
        <Field
          label={S.auth.password}
          value={password}
          onChange={setPassword}
          type="password"
          autoComplete="current-password"
          maxLength={64}
          error={error}
        />
        <button type="submit" className="btn btn--primary" disabled={busy || !username.trim() || password.length < 4}>
          {S.auth.submit}
        </button>
      </form>
      <p className="muted small center">{S.auth.help}</p>
    </section>
  );
}
