import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Icon } from './Icon';
import { Avatar } from './Account';
import { TContext } from './i18n';
import { ProfileCard } from './room/ProfileCard';
import { EntranceEffect } from './room/Entrance';
import { authClient, logout } from '../lib/authClient';
import { translator, type Key, type Lang } from '../lib/i18n';
import { entrances, themePresets, type Entrance, type Theme } from '../lib/themes';
import { resizeImage } from '../lib/resize';
import type { Me } from '../lib/users';

const BIO_MAX = 190;

/** Your profile: what people see when they click you in a room, and your plan. */
export default function ProfileEditor({ lang, me: initial }: { lang: Lang; me: Me }) {
  const t = useMemo(() => translator(lang), [lang]);
  const [me, setMe] = useState(initial);
  const [name, setName] = useState(me.name);
  const [bio, setBio] = useState(me.bio);
  const [theme, setTheme] = useState<Theme | null>(me.theme);
  const [entrance, setEntrance] = useState<Entrance | null>(me.entrance);
  const [preview, setPreview] = useState<{ id: number; kind: Entrance } | null>(null);
  const [uploading, setUploading] = useState<'avatar' | 'banner' | null>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  // An entrance preview plays once, like in a room
  useEffect(() => {
    if (!preview) return;
    const id = setTimeout(() => setPreview(null), 3200);
    return () => clearTimeout(id);
  }, [preview]);
  const locale = lang === 'en' ? 'en-US' : lang === 'es' ? 'es-ES' : 'pt-BR';
  const until = me.premiumUntil ? new Date(me.premiumUntil).toLocaleDateString(locale) : '';

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const clean = name.trim().replace(/\s+/g, ' ').slice(0, 32);
      if (clean && clean !== me.name) {
        const { error } = await authClient.updateUser({ name: clean });
        if (error) throw new Error(error.message);
      }
      const res = await fetch('/api/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bio, ...(me.premium ? { theme, entrance } : {}) }),
      });
      if (!res.ok) throw new Error(t('profile.saveFailed'));
      setMe(await res.json());
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // ---- pictures: resized here, stored by the server; the picture also goes through better-auth
  // so the header (which reads a cached session) shows it at once
  async function upload(kind: 'avatar' | 'banner', e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(kind);
    setError('');
    try {
      const blob = await resizeImage(file, kind);
      const res = await fetch(`/api/me/image?kind=${kind}`, { method: 'PUT', headers: { 'Content-Type': blob.type }, body: blob });
      if (!res.ok) throw new Error();
      const { url } = await res.json();
      if (kind === 'avatar') {
        await authClient.updateUser({ image: url });
        setMe((m) => ({ ...m, image: url }));
      } else setMe((m) => ({ ...m, banner: url }));
    } catch {
      setError(t('profile.uploadFailed'));
    } finally {
      setUploading(null);
    }
  }
  async function removePicture(kind: 'avatar' | 'banner') {
    await fetch(`/api/me/image?kind=${kind}`, { method: 'DELETE' }).catch(() => {});
    if (kind === 'avatar') {
      await authClient.updateUser({ image: null });
      setMe((m) => ({ ...m, image: null }));
    } else setMe((m) => ({ ...m, banner: null }));
  }

  async function cancel() {
    if (!confirmCancel) return setConfirmCancel(true);
    setBusy(true);
    const res = await fetch('/api/billing/cancel', { method: 'POST' }).catch(() => null);
    if (res?.ok) setMe(await res.json());
    else setError(t('profile.cancelFailed'));
    setBusy(false);
    setConfirmCancel(false);
  }

  return (
    <TContext.Provider value={t}>
      <div className="profile-page">
        <form className="profile-form" onSubmit={save}>
          <div className="field">
            <span className="label">{t('profile.picture')}</span>
            <div className="picture-row">
              <Avatar name={name || me.name} image={me.image} size={56} />
              <button type="button" className="btn" onClick={() => avatarInput.current?.click()} disabled={!!uploading}>
                <Icon name="screen" size={14} /> {uploading === 'avatar' ? t('profile.uploading') : t('profile.upload')}
              </button>
              {me.image && (
                <button type="button" className="btn ghost" onClick={() => removePicture('avatar')}>
                  {t('profile.remove')}
                </button>
              )}
              <input ref={avatarInput} type="file" accept="image/*" hidden onChange={(e) => upload('avatar', e)} />
            </div>
          </div>

          <label className="field">
            <span className="label">{t('profile.name')}</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={32} required />
          </label>
          <label className="field">
            <span className="label">
              {t('profile.bio')} <span className="counter">{bio.length}/{BIO_MAX}</span>
            </span>
            <textarea
              className="input textarea"
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))}
              rows={3}
              placeholder={t('profile.bioPlaceholder')}
            />
          </label>

          <fieldset className={`themes ${me.premium ? '' : 'locked'}`} disabled={!me.premium}>
            <legend className="label">
              {t('profile.theme')} <span className="premium-tag">✦ premium</span>
            </legend>
            <div className="theme-grid">
              <button type="button" className={`theme-opt none ${!theme ? 'on' : ''}`} onClick={() => setTheme(null)}>
                {t('profile.noTheme')}
              </button>
              {Object.entries(themePresets).map(([key, p]) => (
                <button
                  key={key}
                  type="button"
                  className={`theme-opt ${theme?.primary === p.primary && theme.accent === p.accent ? 'on' : ''}`}
                  style={{ background: `linear-gradient(135deg, ${p.primary}, ${p.accent})` }}
                  onClick={() => setTheme(p)}
                  aria-label={key}
                  title={key}
                />
              ))}
            </div>
            <div className="custom-colors">
              <label>
                <input
                  type="color"
                  value={theme?.primary ?? '#2a2a28'}
                  onChange={(e) => setTheme({ primary: e.target.value, accent: theme?.accent ?? '#b9c48f' })}
                />
                {t('profile.primary')}
              </label>
              <label>
                <input
                  type="color"
                  value={theme?.accent ?? '#b9c48f'}
                  onChange={(e) => setTheme({ primary: theme?.primary ?? '#2a2a28', accent: e.target.value })}
                />
                {t('profile.accent')}
              </label>
            </div>
            <p className="muted small">{me.premium ? t('profile.themeHint') : t('profile.themeLocked')}</p>
          </fieldset>

          <fieldset className={`themes ${me.premium ? '' : 'locked'}`} disabled={!me.premium}>
            <legend className="label">
              {t('profile.banner')} <span className="premium-tag">✦ premium</span>
            </legend>
            <div
              className="banner-preview"
              style={me.banner ? { backgroundImage: `url("${me.banner}")` } : undefined}
              aria-hidden="true"
            />
            <div className="picture-row">
              <button type="button" className="btn" onClick={() => bannerInput.current?.click()} disabled={!!uploading}>
                <Icon name="screen" size={14} /> {uploading === 'banner' ? t('profile.uploading') : t('profile.upload')}
              </button>
              {me.banner && (
                <button type="button" className="btn ghost" onClick={() => removePicture('banner')}>
                  {t('profile.remove')}
                </button>
              )}
              <input ref={bannerInput} type="file" accept="image/*" hidden onChange={(e) => upload('banner', e)} />
            </div>
            <p className="muted small">{me.premium ? t('profile.bannerHint') : t('profile.themeLocked')}</p>
          </fieldset>

          <fieldset className={`themes ${me.premium ? '' : 'locked'}`} disabled={!me.premium}>
            <legend className="label">
              {t('profile.entrance')} <span className="premium-tag">✦ premium</span>
            </legend>
            <div className="theme-grid">
              <button type="button" className={`theme-opt none ${!entrance ? 'on' : ''}`} onClick={() => setEntrance(null)}>
                {t('profile.noTheme')}
              </button>
              {entrances.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`theme-opt none ${entrance === k ? 'on' : ''}`}
                  onClick={() => {
                    setEntrance(k);
                    setPreview({ id: Math.random(), kind: k });
                  }}
                >
                  {t(`profile.entrance.${k}` as Key)}
                </button>
              ))}
            </div>
            <p className="muted small">{me.premium ? t('profile.entranceHint') : t('profile.themeLocked')}</p>
          </fieldset>

          <div className="profile-actions">
            <button className="btn primary" disabled={busy}>
              {busy ? t('profile.saving') : t('profile.save')}
            </button>
            {saved && (
              <span className="muted small">
                <Icon name="check" size={13} /> {t('profile.saved')}
              </span>
            )}
          </div>
          {error && <p className="error">{error}</p>}
        </form>

        <aside className="profile-side">
          <p className="label">{t('profile.preview')}</p>
          <div className="card-stage">
            <ProfileCard
              name={name || me.name}
              meta={{
                uid: me.id,
                image: me.image,
                bio: bio.trim() || undefined,
                premium: me.premium || undefined,
                theme: me.premium ? (theme ?? undefined) : undefined,
                banner: me.banner ?? undefined,
              }}
            />
            {preview && (
              <EntranceEffect key={preview.id} kind={preview.kind} name={name || me.name} accent={theme?.accent} />
            )}
          </div>
          {entrance && me.premium && (
            <button type="button" className="btn ghost" onClick={() => setPreview({ id: Math.random(), kind: entrance })}>
              <Icon name="sparkle" size={14} /> {t('profile.previewEntrance')}
            </button>
          )}

          <section className="plan">
            <p className="label">{t('profile.plan')}</p>
            {me.premium ? (
              <>
                <p>
                  <strong>✦ premium</strong> ·{' '}
                  {me.plan === 'active'
                    ? t('premium.renewsOn', { date: until })
                    : me.plan === 'granted'
                      ? t('profile.gifted', { date: until })
                      : t('premium.endsOn', { date: until })}
                </p>
                {me.plan === 'active' && (
                  <button className={`btn ${confirmCancel ? 'danger' : ''}`} onClick={cancel} onBlur={() => setConfirmCancel(false)} disabled={busy}>
                    {confirmCancel ? t('profile.cancelConfirm') : t('profile.cancel')}
                  </button>
                )}
              </>
            ) : (
              <>
                <p className="muted">{t('profile.free')}</p>
                <a className="btn primary" href="/premium">
                  <Icon name="sparkle" size={14} /> {t('account.getPremium')}
                </a>
              </>
            )}
          </section>

          <button className="btn ghost logout" onClick={logout}>
            <Icon name="leave" size={14} /> {t('account.logout')}
          </button>
        </aside>
      </div>
    </TContext.Provider>
  );
}
