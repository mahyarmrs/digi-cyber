import { useEffect, useState, type FormEvent } from 'react';

import { parseSignIn, signInScheme, type SignInCode } from '../../shared/signin';
import type { AppProfile, Language, Settings } from '../../shared/types';
import { Segmented } from '../components/Controls';
import { Mark } from '../components/Mark';
import { errorText, type Translate } from '../i18n';

interface Props {
  t: Translate;
  settings: Settings;
  reason: string;
  // From a digicyber:// link: it signs in at once.
  code: SignInCode | null;
  addingAccount?: boolean;
  onLanguage: (language: Language) => void;
  onSignedIn: (profile: AppProfile) => void;
  onCancel?: () => void;
}

// The brand on one side, the one field that signs in on the other.
export function Welcome({ t, settings, reason, code, addingAccount = false, onLanguage, onSignedIn, onCancel }: Props) {
  const [subLink, setSubLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(reason ? errorText(t, reason) : '');

  async function signIn(link: string, username = '') {
    setBusy(true);
    setError('');
    try {
      onSignedIn(await window.dc.login(link.trim(), username));
    } catch (err) {
      setError(errorText(t, (err as Error).message));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = parseSignIn(subLink);
    void signIn(parsed?.subLink ?? subLink, parsed?.username ?? '');
  }

  // A pasted digicyber:// link shows as the subscription link it carries.
  function change(value: string) {
    const parsed = value.trim().toLowerCase().startsWith(`${signInScheme}:`) ? parseSignIn(value) : null;
    setSubLink(parsed ? parsed.subLink : value);
  }

  useEffect(() => {
    if (!code) return;
    setSubLink(code.subLink);
    void signIn(code.subLink, code.username);
    // signIn reads only its arguments and stable setters.
  }, [code]);

  return (
    <div className="welcome">
      <section className="welcome-art" aria-hidden>
        <Mark />
        <span className="wordmark">
          <span>
            digi<b>cyber</b>
          </span>
        </span>
        <p>{t('tagline')}</p>
      </section>
      <section className="welcome-form-side">
        <div className="welcome-top">
          {addingAccount && onCancel && <button type="button" className="btn btn-line btn-small" onClick={onCancel}>{t('cancel')}</button>}
          <Segmented
            label={t('language')}
            value={settings.language}
            onChange={onLanguage}
            options={[
              { value: 'fa', label: 'فارسی' },
              { value: 'en', label: 'English' },
            ]}
          />
        </div>
        <form className="welcome-form" onSubmit={submit}>
          <h1>{addingAccount ? t('addAccount') : t('signInTitle')}</h1>
          <p>{addingAccount ? t('addAccountIntro') : t('signInIntro')}</p>
          <label className="label">
            <span>{t('subLink')}</span>
            <input className="field" dir="ltr" value={subLink} onChange={(e) => change(e.target.value)} placeholder="https://…/sub/…" required autoFocus spellCheck={false} />
            <small>{t('subLinkHint')}</small>
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn-plasma btn-wide" type="submit" disabled={busy || subLink.trim() === ''}>
            {busy ? t('signingIn') : t('signIn')}
          </button>
          <p className="tip">{t('signInLinkTip')}</p>
        </form>
      </section>
    </div>
  );
}
