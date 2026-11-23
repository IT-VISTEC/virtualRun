import { FormEvent, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { TEAMS, Team, completeRegistration, createGroup, getAppSettings, getMyGroup, isGroupNameAvailable, joinGroup, updateAvatarUrl } from '../lib/api';
import { AVATAR_BG_COLORS, CHIBI_AVATARS, DEFAULT_AVATAR_BG, chibiIdFromUrl, composeChibiAvatar, getDefaultAvatar } from '../lib/avatars';
import './Onboarding.css';

const LOGO = `${import.meta.env.BASE_URL}logo.webp`;
/** Fallback when app_settings cannot be read: 1 Dec 2026 00:00 Asia/Bangkok. */
const DEFAULT_LOCK_AT = '2026-12-01T00:00:00+07:00';

const TEAM_INFO: Record<Team, string> = {
  MSE: 'Molecular Science and Engineering',
  ESE: 'Energy Science and Engineering',
  BSE: 'Biomolecular Science and Engineering',
  IST: 'Information Science and Technology',
  STAFF: 'VISTEC staff',
};

const STEPS = ['Name', 'Team', 'Avatar', 'Group'] as const;
type Step = 0 | 1 | 2 | 3;
type GroupMode = 'create' | 'join' | 'skip';
type GroupDone = { kind: 'created'; name: string; code: string | null } | { kind: 'joined'; name: string | null };

function fmtLock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '1 Dec, 00:00';
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' });
  return `${date}, ${time}`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function AvatarGrid({
  value,
  onPick,
  label,
  disabled,
}: {
  value: string;
  onPick: (url: string, chibiUrl?: string) => void;
  label: string;
  disabled?: boolean;
}) {
  const [bgColor, setBgColor] = useState<string>(DEFAULT_AVATAR_BG);
  const [selectedUrl, setSelectedUrl] = useState<string>(() =>
    CHIBI_AVATARS.find((c) => c.url === value)?.url || CHIBI_AVATARS[0].url,
  );

  async function apply(chibiUrl: string, color: string) {
    setSelectedUrl(chibiUrl);
    setBgColor(color);
    try {
      const composed = await composeChibiAvatar(chibiUrl, color);
      onPick(composed, chibiUrl);
    } catch {
      onPick(chibiUrl, chibiUrl);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
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
              disabled={disabled}
              onClick={() => void apply(selectedUrl, b.color)}
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
      </div>
      <div className="ob-avatars" role="radiogroup" aria-label={label}>
        {CHIBI_AVATARS.map((c) => {
          const on = selectedUrl === c.url || value === c.url;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={c.label}
              title={c.label}
              className={`ob-avatar${on ? ' on' : ''}`}
              style={{ background: bgColor, transition: 'background-color .15s ease' }}
              onClick={() => void apply(c.url, bgColor)}
              disabled={disabled}
            >
              <img src={c.url} alt="" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function Onboarding() {
  const { user, profile, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();

  // Only decide once, on arrival: someone already registered has no business here.
  const [alreadyRegistered] = useState(() => !!profile?.registered_at);

  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const m365Name = (meta.full_name as string) || (meta.name as string) || '';
  const emailName = user?.email?.split('@')[0] ?? '';
  const seed = user?.id || emailName || 'runner';

  const [step, setStep] = useState<Step>(0);
  const [name, setName] = useState(() => (profile?.display_name || m365Name || emailName).slice(0, 60));
  const [team, setTeam] = useState<Team | null>(profile?.team ?? null);
  const [avatar, setAvatar] = useState<string>(() => profile?.avatar_url || getDefaultAvatar(seed));
  const [avatarChibi, setAvatarChibi] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);

  // Group step
  const [lockAt, setLockAt] = useState<string>(DEFAULT_LOCK_AT);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [mode, setMode] = useState<GroupMode>('create');
  const [groupName, setGroupName] = useState('');
  const [nameStatus, setNameStatus] = useState<'idle' | 'checking' | 'ok' | 'taken'>('idle');
  const [groupAvatar, setGroupAvatar] = useState<string>(
    () => CHIBI_AVATARS.find((c) => c.url !== (profile?.avatar_url || getDefaultAvatar(seed)))?.url ?? CHIBI_AVATARS[0].url,
  );
  const [code, setCode] = useState('');
  const [groupDone, setGroupDone] = useState<GroupDone | null>(null);
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);

  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    let alive = true;
    getAppSettings()
      .then((s) => alive && s?.group_lock_at && setLockAt(s.group_lock_at))
      .catch(() => { });
    return () => {
      alive = false;
    };
  }, []);

  // Check group name availability while typing (350 ms debounce).
  useEffect(() => {
    const trimmed = groupName.trim();
    if (!trimmed) {
      setNameStatus('idle');
      return;
    }
    setNameStatus('checking');
    let alive = true;
    const t = window.setTimeout(() => {
      isGroupNameAvailable(trimmed)
        .then((ok) => alive && setNameStatus(ok ? 'ok' : 'taken'))
        .catch(() => alive && setNameStatus('idle'));
    }, 350);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [groupName]);

  // Re-check the lock every 30 s while the page is open.
  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  // Move focus to the new step's heading so screen readers announce it.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step, groupDone]);

  if (alreadyRegistered) return <Navigate to="/" replace />;

  const lockTime = new Date(lockAt).getTime();
  const locked = Number.isFinite(lockTime) && nowMs >= lockTime;
  const lockLabel = fmtLock(lockAt);
  const trimmedName = name.trim();
  const doneCount = groupDone ? STEPS.length : step;

  function go(next: Step) {
    setErr(null);
    setStep(next);
  }

  function onName(e: FormEvent) {
    e.preventDefault();
    if (!trimmedName) return setErr('Please enter a display name.');
    go(1);
  }

  function onTeam(e: FormEvent) {
    e.preventDefault();
    if (!team) return setErr('Please choose your team.');
    go(2);
  }

  async function onRegister(e: FormEvent) {
    e.preventDefault();
    if (!team || !trimmedName) return;
    setBusy(true);
    setErr(null);
    try {
      await completeRegistration(trimmedName, team, avatar || null);
      if (avatarChibi && user) await updateAvatarUrl(user.id, avatar, avatarChibi).catch(() => {});
      setRegistered(true);
      // A returning user may already be in a group (e.g. added by an admin).
      const g = await getMyGroup().catch(() => null);
      if (g) setGroupDone({ kind: 'joined', name: g.name });
      go(3);
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onCreateGroup(e: FormEvent) {
    e.preventDefault();
    const n = groupName.trim();
    if (!n) return setErr('Please enter a group name.');
    setBusy(true);
    setErr(null);
    try {
      await createGroup(n, groupAvatar);
      const g = await getMyGroup().catch(() => null);
      setGroupDone({ kind: 'created', name: g?.name ?? n, code: g?.join_code ?? null });
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onJoinGroup(e: FormEvent) {
    e.preventDefault();
    const c = code.trim();
    if (!c) return setErr('Please enter a join code.');
    setBusy(true);
    setErr(null);
    try {
      await joinGroup(c);
      const g = await getMyGroup().catch(() => null);
      setGroupDone({ kind: 'joined', name: g?.name ?? null });
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    try {
      await refreshProfile();
    } finally {
      setBusy(false);
    }
    navigate('/', { replace: true });
  }

  async function onCopy(text: string) {
    setCopied((await copyText(text)) ? 'ok' : 'fail');
    window.setTimeout(() => setCopied(null), 2500);
  }

  const errBox = err && (
    <p className="alert" role="alert">
      {err}
    </p>
  );

  return (
    <div className="ob">
      <header className="ob-top">
        <img className="ob-logo" src={LOGO} alt="VISTEC Virtual Run" />
        <button type="button" className="btn-link ob-signout" onClick={() => void signOut()} disabled={busy}>
          Sign out
        </button>
      </header>

      <main className="ob-main">
        <div className="ob-intro reveal">
          <p className="ob-kicker">Step {step + 1} of {STEPS.length}</p>
          <ol className="ob-steps" aria-label="Registration progress">
            {STEPS.map((s, i) => (
              <li key={s} className={i < doneCount ? 'done' : i === step ? 'now' : ''} aria-current={i === step ? 'step' : undefined}>
                <span className="ob-dot" aria-hidden="true">
                  {i < doneCount ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </span>
                <span className="ob-step-label">{s}</span>
                {i < doneCount && <span className="sr-only"> (done)</span>}
              </li>
            ))}
          </ol>
        </div>

        {step === 0 && (
          <form className="card ob-card reveal" onSubmit={onName} noValidate key="s0">
            <h1 ref={headingRef} tabIndex={-1}>Welcome! What should we call you?</h1>
            <p className="muted">This name appears on the leaderboard and in your group.</p>
            <label className="ob-field">
              <span className="field-label">Display name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                autoComplete="nickname"
                autoFocus
                required
                aria-invalid={!!err && !trimmedName}
              />
              <span className="muted small">{name.length}/60 · You can change it later in Profile.</span>
            </label>
            {errBox}
            <div className="ob-actions">
              <button className="btn-accent" type="submit" disabled={!trimmedName}>
                Next
              </button>
            </div>
          </form>
        )}

        {step === 1 && (
          <form className="card ob-card reveal" onSubmit={onTeam} key="s1">
            <h1 ref={headingRef} tabIndex={-1}>Pick your team</h1>
            <p className="muted">Your distance also counts toward your team's total.</p>
            <fieldset className="ob-teams">
              <legend className="sr-only">Team</legend>
              {TEAMS.map((t) => (
                <label key={t} className={`ob-team${team === t ? ' on' : ''}`}>
                  <input type="radio" name="team" value={t} checked={team === t} onChange={() => setTeam(t)} />
                  <span className="ob-team-code">{t}</span>
                  <span className="ob-team-name">{TEAM_INFO[t]}</span>
                  <span className="ob-check" aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  </span>
                </label>
              ))}
            </fieldset>
            <p className="ob-note" role="note">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="4" y="10" width="16" height="11" rx="2" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              </svg>
              <span>Your team can't be changed after registration. If you pick the wrong one, ask an admin.</span>
            </p>
            {errBox}
            <div className="ob-actions">
              <button className="btn-ghost" type="button" onClick={() => go(0)}>
                Back
              </button>
              <button className="btn-accent" type="submit" disabled={!team}>
                Next
              </button>
            </div>
          </form>
        )}

        {step === 2 && (
          <form className="card ob-card reveal" onSubmit={onRegister} key="s2">
            <h1 ref={headingRef} tabIndex={-1}>Choose an avatar</h1>
            <p className="muted">Pick your runner buddy and background color.</p>
            <div className="ob-preview">
              <img src={avatar} alt="Your selected avatar" style={{ background: DEFAULT_AVATAR_BG }} />
              <div className="ob-preview-text">
                <strong>{trimmedName}</strong>
                <span className="muted small">{team}{team ? ` · ${TEAM_INFO[team]}` : ''}</span>
              </div>
            </div>
            <AvatarGrid value={avatar} onPick={(u, c) => { setAvatar(u); setAvatarChibi(c ? chibiIdFromUrl(c) : null); }} label="Chibi avatars" disabled={busy} />
            {errBox}
            <div className="ob-actions">
              <button className="btn-ghost" type="button" onClick={() => go(1)} disabled={busy}>
                Back
              </button>
              <button className="btn-accent" type="submit" disabled={busy || !team || !trimmedName}>
                {busy ? 'Saving…' : 'Next'}
              </button>
            </div>
          </form>
        )}

        {step === 3 && registered && groupDone && (
          <section className="card ob-card reveal" key="s3-done" aria-labelledby="ob-done-h">
            <div className="ob-done-badge" aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </div>
            <h1 id="ob-done-h" ref={headingRef} tabIndex={-1}>
              {groupDone.kind === 'created'
                ? `${groupDone.name} is ready`
                : groupDone.name
                  ? `You're in ${groupDone.name}`
                  : "You're in the group"}
            </h1>
            {groupDone.kind === 'created' ? (
              <>
                <p className="muted">Share this join code with up to 3 teammates so they can join your group.</p>
                {groupDone.code ? (
                  <div className="ob-code">
                    <span className="ob-code-value" aria-label={`Join code ${groupDone.code.split('').join(' ')}`}>
                      {groupDone.code}
                    </span>
                    <button type="button" className="btn-ghost" onClick={() => onCopy(groupDone.code!)}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" />
                      </svg>
                      {copied === 'ok' ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                ) : (
                  <p className="muted small">You'll find the join code on the Group &amp; Team page.</p>
                )}
                <p className="sr-only" role="status" aria-live="polite">
                  {copied === 'ok' ? 'Join code copied' : copied === 'fail' ? 'Could not copy. Select the code and copy it manually.' : ''}
                </p>
                {copied === 'fail' && <p className="muted small">Couldn't copy automatically. Select the code and copy it.</p>}
              </>
            ) : (
              <p className="muted">Your distance now counts for your group as well as for you and your team.</p>
            )}
            <p className="ob-note" role="note">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="4" y="10" width="16" height="11" rx="2" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              </svg>
              <span>Group membership locks on {lockLabel} (Bangkok time). Manage your group any time before that on the Group &amp; Team page.</span>
            </p>
            <div className="ob-actions">
              <button className="btn-accent" type="button" onClick={finish} disabled={busy}>
                {busy ? 'Loading…' : 'Go to home'}
              </button>
            </div>
          </section>
        )}

        {step === 3 && registered && !groupDone && (
          <section className="card ob-card reveal" key="s3" aria-labelledby="ob-group-h">
            <h1 id="ob-group-h" ref={headingRef} tabIndex={-1}>
              You're registered! Join a group?
            </h1>
            <p className="muted">
              Groups have up to 4 people, and every member's distance adds up. A group is optional.
            </p>

            {locked ? (
              <>
                <p className="ob-note" role="note">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="4" y="10" width="16" height="11" rx="2" />
                    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                  </svg>
                  <span>Group membership locked on {lockLabel} (Bangkok time). You can still run for yourself and your team.</span>
                </p>
                <div className="ob-actions">
                  <button className="btn-accent" type="button" onClick={finish} disabled={busy}>
                    {busy ? 'Loading…' : 'Go to home'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="ob-tabs" role="tablist" aria-label="Group options">
                  {(
                    [
                      ['create', 'Create'],
                      ['join', 'Join'],
                      ['skip', 'Skip'],
                    ] as const
                  ).map(([m, label]) => (
                    <button
                      key={m}
                      type="button"
                      role="tab"
                      id={`ob-tab-${m}`}
                      aria-selected={mode === m}
                      aria-controls={`ob-panel-${m}`}
                      className={mode === m ? 'on' : ''}
                      onClick={() => {
                        setMode(m);
                        setErr(null);
                      }}
                      disabled={busy}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {mode === 'create' && (
                  <form className="ob-panel" id="ob-panel-create" role="tabpanel" aria-labelledby="ob-tab-create" onSubmit={onCreateGroup}>
                    <label className="ob-field">
                      <span className="field-label">Group name</span>
                      <input
                        value={groupName}
                        onChange={(e) => setGroupName(e.target.value)}
                        maxLength={40}
                        placeholder="e.g. Pace Pandas"
                        autoComplete="off"
                        aria-invalid={nameStatus === 'taken'}
                        required
                      />
                      {nameStatus === 'checking' && <span className="muted small">Checking name…</span>}
                      {nameStatus === 'taken' && <span className="alert" style={{ padding: '6px 10px', fontSize: 12 }}>This group name is already taken</span>}
                      {nameStatus === 'ok' && <span className="ok" style={{ padding: '6px 10px', fontSize: 12 }}>Available</span>}
                    </label>
                    <div className="ob-field">
                      <span className="field-label">Group avatar</span>
                      <AvatarGrid value={groupAvatar} onPick={setGroupAvatar} label="Group avatar" disabled={busy} />
                    </div>
                    <p className="muted small">You'll be the group leader and get a join code to share.</p>
                    {errBox}
                    <div className="ob-actions">
                      <button className="btn-accent" type="submit" disabled={busy || !groupName.trim() || nameStatus === 'taken' || nameStatus === 'checking'}>
                        {busy ? 'Creating…' : 'Create group'}
                      </button>
                    </div>
                  </form>
                )}

                {mode === 'join' && (
                  <form className="ob-panel" id="ob-panel-join" role="tabpanel" aria-labelledby="ob-tab-join" onSubmit={onJoinGroup}>
                    <label className="ob-field">
                      <span className="field-label">Join code</span>
                      <input
                        className="ob-code-input"
                        value={code}
                        onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s+/g, ''))}
                        maxLength={16}
                        placeholder="ABCD2345"
                        autoComplete="off"
                        autoCapitalize="characters"
                        spellCheck={false}
                        inputMode="text"
                        required
                      />
                      <span className="muted small">Ask your group leader for the 8-character code.</span>
                    </label>
                    {errBox}
                    <div className="ob-actions">
                      <button className="btn-accent" type="submit" disabled={busy || !code.trim()}>
                        {busy ? 'Joining…' : 'Join group'}
                      </button>
                    </div>
                  </form>
                )}

                {mode === 'skip' && (
                  <div className="ob-panel" id="ob-panel-skip" role="tabpanel" aria-labelledby="ob-tab-skip">
                    <p className="muted">
                      No problem. You can create or join a group later on the Group &amp; Team page.
                    </p>
                    <div className="ob-actions">
                      <button className="btn-accent" type="button" onClick={finish} disabled={busy}>
                        {busy ? 'Loading…' : 'Go to home'}
                      </button>
                    </div>
                  </div>
                )}

                <p className="ob-note" role="note">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="4" y="10" width="16" height="11" rx="2" />
                    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                  </svg>
                  <span>
                    Groups lock on <strong>{lockLabel}</strong> (Bangkok time). After that nobody can create, join or leave a group.
                  </span>
                </p>
              </>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
