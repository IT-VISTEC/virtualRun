import { FormEvent, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Run, listRuns, updateAvatarUrl, updateDisplayName } from '../lib/api';
import { AVATAR_BG_COLORS, CHIBI_AVATARS, DEFAULT_AVATAR_BG, chibiIdFromUrl, composeChibiAvatar, getDefaultAvatar } from '../lib/avatars';
import { fmtKm, fmtSteps } from '../lib/format';
import './Profile.css';

const HERO = `${import.meta.env.BASE_URL}hero.webp`;

export default function Profile() {
  const { user, profile, refreshProfile, signOut } = useAuth();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [bgColor, setBgColor] = useState<string>(DEFAULT_AVATAR_BG);
  const [selectedChibi, setSelectedChibi] = useState<string>('');

  const m365Name = (user?.user_metadata?.full_name as string) || (user?.user_metadata?.name as string) || '';
  const avatar = profile?.avatar_url || '';

  useEffect(() => {
    setName(profile?.display_name || m365Name);
  }, [profile, m365Name]);

  useEffect(() => {
    let alive = true;
    listRuns().then((r) => alive && setRuns(r)).catch(() => {});
    return () => { alive = false; };
  }, []);

  async function onPickChibi(url: string, color = bgColor) {
    if (!user) return;
    setSelectedChibi(url);
    setSaving(true);
    setMsg(null);
    try {
      const dataUrl = await composeChibiAvatar(url, color);
      await updateAvatarUrl(user.id, dataUrl, chibiIdFromUrl(url));
      await refreshProfile();
      setMsg({ kind: 'ok', text: 'Avatar updated' });
    } catch (err) {
      setMsg({ kind: 'err', text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function onPickBgColor(color: string) {
    setBgColor(color);
    const targetChibi =
      selectedChibi ||
      CHIBI_AVATARS.find((c) => c.url === profile?.avatar_url)?.url ||
      getDefaultAvatar(user?.id || shownName);
    await onPickChibi(targetChibi, color);
  }

  async function onResetAvatar() {
    if (!user) return;
    setSaving(true);
    setMsg(null);
    try {
      await updateAvatarUrl(user.id, null);
      setSelectedChibi('');
      setBgColor(DEFAULT_AVATAR_BG);
      await refreshProfile();
      setMsg({ kind: 'ok', text: 'Avatar reset to default' });
    } catch (err) {
      setMsg({ kind: 'err', text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    const trimmed = name.trim();
    if (!trimmed) return setMsg({ kind: 'err', text: 'Please enter a display name' });
    setSaving(true);
    setMsg(null);
    try {
      await updateDisplayName(user.id, trimmed);
      await refreshProfile();
      setMsg({ kind: 'ok', text: 'Saved' });
    } catch (err) {
      setMsg({ kind: 'err', text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  const totalKm = (runs ?? []).reduce((a, r) => a + r.distance_km, 0);
  const totalSteps = (runs ?? []).reduce((a, r) => a + (r.steps ?? 0), 0);
  const shownName = profile?.display_name || m365Name || user?.email || 'Runner';

  return (
    <div className="page narrow">
      <section className="card pf reveal" style={{ ['--hero' as string]: `url(${HERO})` }}>
        <div className="pf-cover" aria-hidden="true" />
        <div className="pf-head">
          <div className="pf-avatar-wrap">
            <div className="pf-avatar" style={{ background: bgColor, cursor: 'default' }}>
              <img src={avatar || getDefaultAvatar(user?.id || shownName)} alt={shownName} />
            </div>
          </div>
          <h1 className="pf-name">{shownName}</h1>
          <p className="muted pf-email">{user?.email}</p>
        </div>

        <div className="pf-stats">
          <div><strong>{fmtKm(totalKm)}</strong><span>km total</span></div>
          <div><strong>{fmtSteps(totalSteps)}</strong><span>steps</span></div>
          <div><strong>{runs ? runs.length : '–'}</strong><span>activities</span></div>
        </div>
      </section>

      <section className="card reveal" style={{ animationDelay: '80ms' }}>
        <h2>Account</h2>
        <div style={{ display: 'grid', gap: 10, marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <span className="muted small">Choose your avatar &amp; background color</span>
            {profile?.avatar_url && (
              <button type="button" className="btn-link" style={{ padding: 0, minHeight: 'auto' }} onClick={onResetAvatar} disabled={saving}>
                Reset default
              </button>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="muted small" style={{ marginRight: 4 }}>Background:</span>
            {AVATAR_BG_COLORS.map((b) => {
              const active = bgColor.toLowerCase() === b.color.toLowerCase();
              return (
                <button
                  key={b.id}
                  type="button"
                  title={b.label}
                  aria-label={`Background ${b.label}`}
                  disabled={saving}
                  onClick={() => void onPickBgColor(b.color)}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    background: b.color,
                    border: active ? '2px solid var(--ink)' : '1px solid rgba(0,0,0,0.18)',
                    boxShadow: active ? '0 0 0 2px var(--accent)' : 'none',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                />
              );
            })}
            <label
              title="Custom background color"
              style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                border: '1px dashed var(--muted)',
                display: 'inline-grid',
                placeItems: 'center',
                cursor: 'pointer',
                overflow: 'hidden',
                fontSize: 12,
              }}
            >
              +
              <input
                type="color"
                value={bgColor}
                disabled={saving}
                onChange={(e) => void onPickBgColor(e.target.value)}
                style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }}
              />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 56px))', justifyContent: 'space-between', rowGap: 12 }}>
            {CHIBI_AVATARS.map((c) => {
              const selected = selectedChibi === c.url || profile?.avatar_url === c.url;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => void onPickChibi(c.url, bgColor)}
                  disabled={saving}
                  title={c.label}
                  style={{
                    width: 56,
                    height: 56,
                    padding: 0,
                    borderRadius: '50%',
                    overflow: 'hidden',
                    border: selected ? '2px solid var(--accent)' : '2px solid transparent',
                    cursor: 'pointer',
                    background: bgColor,
                    transition: 'background-color .15s ease',
                  }}
                >
                  <img src={c.url} alt={c.label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </button>
              );
            })}
          </div>
        </div>
        <form className="form" onSubmit={onSave}>
          <label>Display name <span className="muted small">(shown on leaderboard)</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
          </label>
          {msg && <p className={msg.kind === 'ok' ? 'ok' : 'alert'} role={msg.kind === 'ok' ? 'status' : 'alert'}>{msg.text}</p>}
          <button className="btn-accent" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save name'}</button>
        </form>
      </section>

      <button className="btn-ghost pf-signout reveal" style={{ animationDelay: '140ms' }} onClick={() => void signOut()}>Sign out</button>
    </div>
  );
}
