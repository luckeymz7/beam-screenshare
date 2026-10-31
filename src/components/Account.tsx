import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Icon } from './Icon';
import { authClient, login, logout } from '../lib/authClient';
import { translator, type Lang, type T } from '../lib/i18n';
import type { Provider } from '../lib/auth';

export type AccountMe = { name: string; image: string | null; premium: boolean; admin: boolean } | null;

/**
 * The header's account button: "Log in" (email and password, or Google / Discord), or your
 * avatar and a menu.
 */
export default function Account({
  me,
  providers,
  email,
  requests = 0,
  lang,
}: {
  me: AccountMe;
  providers: Provider[];
  /** Email + password login is available */
  email: boolean;
  /** Friend requests waiting for an answer */
  requests?: number;
  lang: Lang;
}) {
  const t = translator(lang);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Provider | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // Other parts of the page (premium page, locked features) can ask for the login picker
  useEffect(() => {
    const show = () => setOpen(true);
    addEventListener('beam:login', show);
    return () => removeEventListener('beam:login', show);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  if (!me && providers.length === 0 && !email) return null;

  return (
    <div className="account" ref={box}>
      {me ? (
        <button className="avatar-btn" onClick={() => setOpen(!open)} aria-label={t('account.menu')} aria-expanded={open}>
          <Avatar name={me.name} image={me.image} />
          {me.premium && <span className="star" aria-hidden="true">✦</span>}
          {requests > 0 && <span className="badge-count">{requests > 9 ? '9+' : requests}</span>}
        </button>
      ) : (
        <button className="nav-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
          {t('account.login')}
        </button>
      )}

      {open && (
        <div className="account-pop" role="dialog" aria-label={me ? t('account.menu') : t('account.login')}>
          {me ? (
            <>
              <p className="account-name">
                {me.name}
                {me.premium && <span className="premium-tag">premium</span>}
              </p>
              <a href="/profile">
                <Icon name="users" size={14} /> {t('account.profile')}
              </a>
              <a href="/friends">
                <Icon name="smile" size={14} /> {t('friends.menu')}
                {requests > 0 && <span className="menu-count">{requests}</span>}
              </a>
              <a href="/premium">
                <Icon name="sparkle" size={14} /> {me.premium ? t('account.yourPlan') : t('account.getPremium')}
              </a>
              {me.admin && (
                <a href="/admin">
                  <Icon name="stats" size={14} /> admin
                </a>
              )}
              <button onClick={logout}>
                <Icon name="leave" size={14} /> {t('account.logout')}
              </button>
            </>
          ) : (
            <>
              <p className="account-title">{t('account.loginTitle')}</p>
              <p className="account-hint">{t('account.loginHint')}</p>
              {email && <EmailLogin t={t} />}
              {email && providers.length > 0 && <p className="account-or">{t('account.or')}</p>}
              {providers.map((p) => (
                <button
                  key={p}
                  className="provider"
                  disabled={!!busy}
                  onClick={() => {
                    setBusy(p);
                    login(p).catch(() => setBusy(null));
                  }}
                >
                  <Icon name={p} size={16} /> {busy === p ? t('account.redirecting') : t(`account.with.${p}`)}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Email and password: log in, or create an account (with a name) on the other tab. */
function EmailLogin({ t }: { t: T }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get('email')).trim();
    const password = String(f.get('password'));
    setBusy(true);
    setError('');
    const result =
      mode === 'login'
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name: String(f.get('name')).trim() || email.split('@')[0] });
    if (result.error) {
      setBusy(false);
      const status = result.error.status;
      return setError(
        status === 429
          ? t('account.tooMany')
          : mode === 'login'
            ? t('account.wrong')
            : result.error.code === 'USER_ALREADY_EXISTS' || status === 422
              ? t('account.exists')
              : (result.error.message ?? t('account.signupFailed')),
      );
    }
    location.reload();
  }

  return (
    <form className="email-login" onSubmit={submit}>
      {mode === 'signup' && (
        <input className="input" name="name" placeholder={t('account.name')} maxLength={32} autoComplete="nickname" required />
      )}
      <input className="input" name="email" type="email" placeholder={t('account.email')} autoComplete="email" required />
      <input
        className="input"
        name="password"
        type="password"
        placeholder={mode === 'signup' ? t('account.passwordNew') : t('account.password')}
        minLength={8}
        maxLength={128}
        autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
        required
      />
      <button className="provider primary" disabled={busy}>
        {busy ? '…' : mode === 'login' ? t('account.login') : t('account.signup')}
      </button>
      {error && <p className="error">{error}</p>}
      <button
        type="button"
        className="switch"
        onClick={() => {
          setMode(mode === 'login' ? 'signup' : 'login');
          setError('');
        }}
      >
        {mode === 'login' ? t('account.toSignup') : t('account.toLogin')}
      </button>
    </form>
  );
}

export function Avatar({ name, image, size = 28 }: { name: string; image?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?';
  return image && !broken ? (
    <img
      className="avatar-img"
      src={image}
      alt=""
      width={size}
      height={size}
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
    />
  ) : (
    <span className="avatar-initials" style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {initials}
    </span>
  );
}
