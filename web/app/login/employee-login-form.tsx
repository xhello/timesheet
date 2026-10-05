'use client';

import { useState, type FormEvent } from 'react';
import styles from './auth.module.css';

export default function EmployeeLoginForm({ returnTo }: { returnTo: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/employee-login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: data.get('phone') }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to sign in. Please try again.');
      window.location.assign(returnTo);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to sign in. Please try again.');
      setBusy(false);
    }
  }
  return <form onSubmit={submit} className="form-stack">
    <label htmlFor="phone">Phone number<input id="phone" name="phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="(604) 555-0123" required maxLength={50} disabled={busy} aria-describedby="phone-help"/></label>
    <p id="phone-help" className={styles.formNote}>Use the number your admin registered. Enter 10 digits for US/Canada, or include +country code for other numbers.</p>
    {error && <p className={`${styles.notice} ${styles.error}`} role="alert">{error}</p>}
    <button type="submit" className="btn primary full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in with phone'}</button>
  </form>;
}
