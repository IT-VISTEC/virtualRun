import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Run, getMyGroup, getPinLoginEnabled, listRuns, updateAvatarUrl, updateDisplayName } from '../lib/api';
import { AVATAR_BG_COLORS, CHIBI_AVATARS, DEFAULT_AVATAR_BG, chibiIdFromUrl, composeChibiAvatar, getDefaultAvatar } from '../lib/avatars';
import { fmtKm, fmtSteps, kmToSteps } from '../lib/format';
import { Icon } from '../components/Icons';
import './Profile.css';

const HERO = `${import.meta.env.BASE_URL}hero.webp`;
const BG_KEY = (uid: string) => `pf-avatar-bg:${uid}`;

function readBg(uid: string | undefined): string {
  if (!uid) return DEFAULT_AVATAR_BG;
  try {
    return localStorage.getItem(BG_KEY(uid)) || DEFAULT_AVATAR_BG;
  } catch {
    return DEFAULT_AVATAR_BG;
  }
}
function writeBg(uid: string, color: string) {
  try {
    localStorage.setItem(BG_KEY(uid), color);
  } catch {
    /* storage blocked: color just isn't remembered */
  }
}

function useCountUp(target: number, enabled: boolean, durationMs = 700) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!enabled || target <= 0) {
      setValue(0);
      return;
    }
    let rafId = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      setValue(target * (1 - Math.pow(1 - progress, 3)));
      if (progress < 1) rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [target, enabled, durationMs]);
  return value;
}

function PinCard() {
  const { setPin } = useAuth();
  const [pin, setPinValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!/^\d{6}$/.test(pin)) return setMsg({ kind: 'err', text: 'PIN must be exactly 6 digits.' });
    if (pin !== confirm) return setMsg({ kind: 'err', text: 'The two PINs do not match.' });
    if (/^(\d)\1{5}$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin))
      return setMsg({ kind: 'err', text: 'Choose a PIN that is harder to guess (not 111111 or 123456).' });
    setBusy(true);
    const err = await setPin(pin);
    setBusy(false);
    if (err) return setMsg({ kind: 'err', text: err });
    setPinValue('');
    setConfirm('');
    setMsg({ kind: 'ok', text: 'PIN saved. You can now sign in with your email and this PIN.' });
  }

  return (
    <section className="card reveal" style={{ animationDelay: '110ms' }} aria-labelledby="pin-h">
      <h2 id="pin-h">Sign-in PIN</h2>
      <p className="muted small">Optional. Lets you sign in with your email and a 6-digit PIN instead of Microsoft. 5 wrong tries lock PIN sign-in for 15 minutes.</p>
      <form className="form pin-form" onSubmit={onSave} noValidate>
        <div className="two">
          <label>New PIN
            <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={pin}
              onChange={(e) => setPinValue(digits(e.target.value))} />
          </label>
          <label>Confirm PIN
            <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={confirm}
              onChange={(e) => setConfirm(digits(e.target.value))} />
          </label>
        </div>
        {msg && <p className={msg.kind === 'ok' ? 'ok' : 'alert'} role={msg.kind === 'ok' ? 'status' : 'alert'}>{msg.text}</p>}
        <button className="btn-ghost" type="submit" disabled={busy || pin.length < 6 || confirm.length < 6}>{busy ? 'Saving…' : 'Set PIN'}</button>
      </form>
    </section>
  );
}

export default function Profile() {
  const { user, profile, refreshProfile, signOut } = useAuth();
  const [pinEnabled, setPinEnabled] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [groupName, setGroupName] = useState<string | null>(null);
  const [bgColor, setBgColor] = useState<string>(() => readBg(user?.id));
  const [selectedChibi, setSelectedChibi] = useState<string>('');
  const [editing, setEditing] = useState(false);
  const colorTimer = useRef<number | undefined>(undefined);

  const m365Name = (user?.user_metadata?.full_name as string) || (user?.user_metadata?.name as string) || '';
  const avatar = profile?.avatar_url || '';
  const shownName = profile?.display_name || m365Name || user?.email || 'Runner';

  useEffect(() => {
    let alive = true;
    getPinLoginEnabled().then((on) => alive && setPinEnabled(on)).catch(() => {});
    listRuns().then((r) => alive && setRuns(r)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    setName(profile?.display_name || m365Name);
  }, [profile, m365Name]);

  useEffect(() => setBgColor(readBg(user?.id)), [user?.id]);

  useEffect(() => {
    let alive = true;
    if (!profile?.group_id) {
      setGroupName(null);
      return;
    }
    getMyGroup()
      .then((g) => alive && setGroupName(g?.name ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [profile?.group_id]);

  useEffect(() => () => window.clearTimeout(colorTimer.current), []);

  async function onPickChibi(url: string, color = bgColor) {
    if (!user) return;
    setSelectedChibi(url);
    setSaving(true);
    setMsg(null);
    try {
      const dataUrl = await composeChibiAvatar(url, color);
      await updateAvatarUrl(user.id, dataUrl, chibiIdFromUrl(url));
      writeBg(user.id, color);
      await refreshProfile();
      setMsg({ kind: 'ok', text: 'Avatar updated' });
    } catch (err) {
      setMsg({ kind: 'err', text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  function toggleEdit() {
    setEditing((v) => !v);
    setMsg(null);
  }

  const currentChibi = () =>
    selectedChibi ||
    CHIBI_AVATARS.find((c) => c.id === profile?.avatar_chibi || c.url === profile?.avatar_url)?.url ||
    getDefaultAvatar(user?.id || shownName);

  function onPickBgColor(color: string) {
    setBgColor(color);
    void onPickChibi(currentChibi(), color);
  }

  /** Custom color: preview while dragging, save once the picker settles. */
  function onCustomColor(color: string) {
    setBgColor(color);
    window.clearTimeout(colorTimer.current);
    colorTimer.current = window.setTimeout(() => void onPickChibi(currentChibi(), color), 600);
  }

  async function onResetAvatar() {
    if (!user) return;
    setSaving(true);
    setMsg(null);
    try {
      await updateAvatarUrl(user.id, null);
      setSelectedChibi('');
      setBgColor(DEFAULT_AVATAR_BG);
      writeBg(user.id, DEFAULT_AVATAR_BG);
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

  const all = runs ?? [];
  const counted = all.filter((r) => r.status === 'counted');
  const pending = all.filter((r) => r.status === 'pending').length;
  const rejected = all.filter((r) => r.status === 'rejected').length;
  const totalKm = counted.reduce((a, r) => a + Number(r.distance_km), 0);
  // Same rule as Home: steps follow distance (stays right after an admin edits the km).
  const totalSteps = counted.reduce((a, r) => a + kmToSteps(Number(r.distance_km)), 0);
  const animKm = useCountUp(totalKm, runs !== null);
  const animSteps = Math.round(useCountUp(totalSteps, runs !== null));
  const animActivities = Math.round(useCountUp(counted.length, runs !== null));

  return (
    <div className="page narrow">
      <section className="card pf reveal" style={{ ['--hero' as string]: `url(${HERO})` }}>
        <div className="pf-cover" aria-hidden="true" />
        <div className="pf-head">
          <div className="pf-avatar-wrap">
            <div className="pf-avatar pf-avatar-static" style={{ background: bgColor }}>
              <img src={avatar || getDefaultAvatar(user?.id || shownName)} alt={shownName} />
            </div>
            <button
              type="button"
              className="pf-edit"
              aria-label="Edit profile"
              title="Edit profile"
              aria-expanded={editing}
              onClick={toggleEdit}
            >
              <Icon name={editing ? 'x' : 'edit'} size={18} />
            </button>
          </div>
          <h1 className="pf-name">{shownName}</h1>
          <p className="muted pf-email">{user?.email}</p>
          <p className="pf-meta">
            {profile?.team ? <span className="team-tag">{profile.team}</span> : <span className="muted">No team</span>}
            <span className="pf-dot" aria-hidden="true">·</span>
            {profile?.group_id ? (
              <Link to="/team" className="pf-group">
                <Icon name="users" size={15} />
                {groupName ?? 'Your group'}
              </Link>
            ) : (
              <Link to="/team" className="pf-group">
                <Icon name="users" size={15} />
                Join a group
              </Link>
            )}
          </p>
        </div>

        <div className="pf-stats">
          <div><strong>{fmtKm(animKm)}</strong><span>km counted</span></div>
          <div><strong>{fmtSteps(animSteps)}</strong><span>steps</span></div>
          <div><strong>{animActivities}</strong><span>activities</span></div>
        </div>
        {(pending > 0 || rejected > 0) && (
          <p className="pf-review small">
            {pending > 0 && (
              <span className="pf-pill pf-pending">
                {pending} {pending === 1 ? 'run' : 'runs'} waiting for admin review
              </span>
            )}
            {rejected > 0 && (
              <span className="pf-pill pf-rejected">
                {rejected} rejected
              </span>
            )}
            <Link to="/log">See your runs</Link>
          </p>
        )}
      </section>

      {editing && (
      <section className="card reveal" aria-labelledby="pf-edit-h">
        <div className="pf-section-head" style={{ marginBottom: 14 }}>
          <h2 id="pf-edit-h">Edit profile</h2>
          <button type="button" className="btn-ghost" onClick={toggleEdit}>
            Done
          </button>
        </div>
          <>
            <div className="pf-picker">
              <div className="pf-picker-head">
                <span className="muted small">Choose your avatar &amp; background color</span>
                {profile?.avatar_url && (
                  <button type="button" className="btn-link pf-reset" onClick={onResetAvatar} disabled={saving}>
                    Reset default
                  </button>
                )}
              </div>
              <div className="pf-colors" role="group" aria-label="Background color">
                <span className="muted small">Background:</span>
                {AVATAR_BG_COLORS.map((b) => {
                  const active = bgColor.toLowerCase() === b.color.toLowerCase();
                  return (
                    <button
                      key={b.id}
                      type="button"
                      className={`pf-swatch${active ? ' on' : ''}`}
                      title={b.label}
                      aria-label={`Background ${b.label}`}
                      aria-pressed={active}
                      disabled={saving}
                      onClick={() => onPickBgColor(b.color)}
                      style={{ background: b.color }}
                    />
                  );
                })}
                <label className="pf-swatch pf-swatch-custom" title="Custom background color">
                  <span aria-hidden="true">+</span>
                  <span className="pf-sr">Custom background color</span>
                  <input type="color" value={bgColor} disabled={saving} onChange={(e) => onCustomColor(e.target.value)} />
                </label>
              </div>
              <div className="pf-chibis" role="group" aria-label="Avatar">
                {CHIBI_AVATARS.map((c) => {
                  const selected = selectedChibi ? selectedChibi === c.url : profile?.avatar_chibi === c.id || profile?.avatar_url === c.url;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className={`pf-chibi${selected ? ' on' : ''}`}
                      onClick={() => void onPickChibi(c.url, bgColor)}
                      disabled={saving}
                      title={c.label}
                      aria-pressed={selected}
                      style={{ background: bgColor }}
                    >
                      <img src={c.url} alt={c.label} />
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
          </>
      </section>
      )}

      {pinEnabled && <PinCard />}

      <button className="btn-ghost pf-signout reveal" style={{ animationDelay: '140ms' }} onClick={() => void signOut()}>Sign out</button>
    </div>
  );
}
