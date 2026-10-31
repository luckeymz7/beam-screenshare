import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { errorText, translator, type Lang } from '../lib/i18n';

type State = { loggedIn: boolean; premium: boolean; plan: string; premiumUntil: number | null };

/**
 * The premium page's button. Logged out: opens the login picker. Back from AbacatePay
 * (?paid=1): waits for the webhook to land, then says thanks.
 */
export default function Subscribe({ lang, initial, billing }: { lang: Lang; initial: State; billing: boolean }) {
  const t = translator(lang);
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [settling, setSettling] = useState(false);

  // The payment page sends people back before AbacatePay's webhook arrives: poll for a minute or two
  useEffect(() => {
    if (!new URLSearchParams(location.search).has('paid') || initial.premium) return;
    setSettling(true);
    let tries = 0;
    const id = setInterval(async () => {
      const me = await fetch('/api/me').then((r) => r.json()).catch(() => null);
      if (me?.premium || ++tries > 40) {
        clearInterval(id);
        setSettling(false);
        if (me) setState({ loggedIn: true, premium: me.premium, plan: me.plan, premiumUntil: me.premiumUntil });
      }
    }, 3000);
    return () => clearInterval(id);
  }, []);

  async function subscribe() {
    if (!state.loggedIn) return dispatchEvent(new Event('beam:login'));
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/billing/checkout', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(errorText(t, data, 'premium.failed'));
      location.href = data.url;
    } catch (e) {
      setError(e instanceof TypeError ? t('err.network') : (e as Error).message);
      setBusy(false);
    }
  }

  const until = state.premiumUntil && new Date(state.premiumUntil).toLocaleDateString(lang === 'en' ? 'en-US' : lang === 'es' ? 'es-ES' : 'pt-BR');

  if (state.premium) {
    return (
      <div className="subscribe done">
        <p className="sub-status">
          <Icon name="check" size={16} /> {settling ? t('premium.thanks') : t('premium.youHave')}
        </p>
        <p className="muted small">
          {state.plan === 'cancelled' ? t('premium.endsOn', { date: until ?? '' }) : t('premium.renewsOn', { date: until ?? '' })}{' '}
          <a className="link" href="/profile">
            {t('premium.manage')}
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="subscribe">
      {settling ? (
        <p className="sub-status">
          <span className="live-dot" /> {t('premium.settling')}
        </p>
      ) : (
        <button className="btn primary big" onClick={subscribe} disabled={busy || !billing}>
          <Icon name="sparkle" size={15} />
          {!billing ? t('premium.soon') : busy ? t('account.redirecting') : state.loggedIn ? t('premium.subscribe') : t('premium.loginFirst')}
        </button>
      )}
      {/* Payment terms only once payments are on; until then the button just says "coming soon" */}
      {billing && <p className="muted small">{t('premium.terms')}</p>}
      {!billing && import.meta.env.DEV && (
        <p className="dev-note">
          Development: payments are off until ABACATEPAY_API_KEY and ABACATEPAY_PRODUCT_ID are in .env (see
          .env.example). To try premium without paying, put your email in ADMIN_EMAILS and give yourself premium in /admin →
          Users.
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
