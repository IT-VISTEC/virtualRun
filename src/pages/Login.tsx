import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { isConfigured } from '../lib/supabase';
import { getPinLoginEnabled } from '../lib/api';
import { MicrosoftLogo } from '../components/Icons';

const LOGO = `${import.meta.env.BASE_URL}logo.webp`;
const WALL = `${import.meta.env.BASE_URL}hero.webp`;

// รีเซ็ตทุกครั้งที่โหลด/รีเฟรชหน้า (ตัวแปรระดับ module) แต่ไม่เล่นซ้ำเมื่อสลับหน้าภายในแอป
let introPlayed = false;

/** เล่น intro เมื่อโหลดหน้าใหม่ และผู้ใช้ไม่ได้ตั้งลดการเคลื่อนไหว */
function shouldPlayIntro(): boolean {
  if (introPlayed) return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function Login() {
  const { loading, session, signInWithMicrosoft, signInWithPin } = useAuth();
  const [pinMode, setPinMode] = useState(false);
  const [pinEnabled, setPinEnabled] = useState(false);
  useEffect(() => {
    if (!isConfigured) return;
    let alive = true;
    getPinLoginEnabled().then((on) => alive && setPinEnabled(on));
    return () => { alive = false; };
  }, []);
  const [email, setEmail] = useState('');
  const [pin, setPinValue] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [showPolicy, setShowPolicy] = useState(false);

  async function onPinSignIn(e: React.FormEvent) {
    e.preventDefault();
    setPinError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setPinError('Enter your VISTEC email.');
    if (!/^\d{6}$/.test(pin)) return setPinError('PIN must be 6 digits.');
    setPinBusy(true);
    const err = await signInWithPin(email, pin);
    setPinBusy(false);
    if (err) { setPinError(err); setPinValue(''); }
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intro] = useState(shouldPlayIntro);
  // True only while the logo is flying in: lets it leave the photo box without being clipped.
  // Must end afterwards, otherwise the blurred photo layers bleed a visible seam past the box edge.
  const [introRunning, setIntroRunning] = useState(intro);
  useEffect(() => {
    if (!introRunning) return;
    // Safety net only; normally cleared when the logo animation finishes (slow phones can take longer).
    const t = window.setTimeout(() => setIntroRunning(false), 5000);
    return () => window.clearTimeout(t);
  }, [introRunning]);
  const rootRef = useRef<HTMLDivElement>(null);

  // โลโก้เริ่มกลางจอ แล้วเลื่อน/ย่อไปยังตำแหน่งจริง (ตัวที่แสดงอยู่ตามขนาดจอ)
  useLayoutEffect(() => {
    if (!intro) return;
    introPlayed = true;
    const el = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('.hero-logo, .login-logo') ?? [])
      .find((e) => getComputedStyle(e).display !== 'none');
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scale = Math.min(vw * 0.7, 320) / r.width;
    const dx = vw / 2 - (r.left + r.width / 2);
    const dy = vh / 2 - (r.top + r.height / 2);
    const from = `translate(${dx}px, ${dy}px) scale(${scale})`;
    const anim = el.animate(
      [
        { transform: from, opacity: 0, offset: 0 },
        { transform: from, opacity: 1, offset: 0.35 },
        { transform: from, opacity: 1, offset: 0.5 },
        { transform: 'none', opacity: 1, offset: 1 },
      ],
      { duration: 1300, easing: 'cubic-bezier(.65,0,.25,1)', fill: 'backwards' },
    );
    // A cancelled run (unmount, or the StrictMode re-run in dev) must not end the intro early.
    anim.finished.then(() => setIntroRunning(false)).catch(() => {});
    return () => anim.cancel();
  }, [intro]);

  if (!loading && session) return <Navigate to="/" replace />;

  async function onSignIn() {
    setError(null);
    setBusy(true);
    const err = await signInWithMicrosoft();
    if (err) {
      setError(`Sign in failed: ${err}`);
      setBusy(false);
    }
  }

  return (
    <div className={`login${intro ? ' intro' : ''}${introRunning ? ' intro-running' : ''}${pinMode ? ' pin-open' : ''}${pinEnabled ? ' pin-avail' : ''}`} ref={rootRef}>
      <div className="hero" aria-hidden="true">
        {/* photo + its blur/fade layers are clipped here, so the zoom-in can never spill past the box */}
        <div className="hero-media">
          <img src={WALL} alt="" />
          <div className="hero-blur" />
          <div className="hero-fade" />
        </div>
        <img className="hero-logo" src={LOGO} alt="" />
      </div>

      <div className="login-body">
        <img className="login-logo" src={LOGO} alt="VISTEC Virtual Run" />
        <div className="login-copy">
          <h1>Virtual Run Event</h1>
          <p>A short-term running event for VISTEC students and staff. Log your distance and climb the leaderboard together.</p>
        </div>

        <div className="login-actions">
          {!isConfigured && (
            <p className="alert" role="alert">
              Supabase is not configured — create <code>.env.local</code> per README.
            </p>
          )}
          {!pinMode && (
          <div key="sso" className="login-pane">
          <button className="btn-ms" onClick={onSignIn} disabled={busy || !isConfigured}>
            <MicrosoftLogo />
            {busy ? 'Redirecting to Microsoft…' : 'Sign in with Microsoft'}
          </button>
          {error && <p className="alert" role="alert">{error}</p>}
          {!pinEnabled && <p className="small">Sign in with your VISTEC Microsoft 365 account only</p>}

          {pinEnabled && (<>
          <div className="login-or" role="separator"><span>or</span></div>
          <button
            type="button"
            className="btn-ghost"
            style={{ width: '100%', minHeight: 50 }}
            onClick={() => setPinMode(true)}
            disabled={!isConfigured}
          >
            Sign in with email &amp; PIN
          </button>
          </>)}
          </div>
          )}

          {pinMode && pinEnabled && (
            <form className="login-pin" onSubmit={onPinSignIn} noValidate aria-label="Sign in with email and PIN">
              <label>
                <span>Email</span>
                <input type="email" autoComplete="username" inputMode="email" value={email}
                  onChange={(e) => setEmail(e.target.value)} placeholder="name@vistec.ac.th" required autoFocus />
              </label>
              <label>
                <span>6-digit PIN</span>
                <input type="password" autoComplete="current-password" inputMode="numeric" pattern="\d{6}" maxLength={6}
                  value={pin} onChange={(e) => setPinValue(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="••••••" required />
              </label>
              {pinError && <p className="alert" role="alert">{pinError}</p>}
              <button type="submit" className="btn-accent login-pin-submit" disabled={pinBusy}>
                {pinBusy ? 'Signing in…' : 'Sign in'}
              </button>
              <button type="button" className="login-alt" onClick={() => { setPinMode(false); setPinError(null); }}>
                Back to Microsoft sign-in
              </button>
              <p className="small login-hint">First time? Sign in with Microsoft and register, then set a PIN in your Profile.</p>
            </form>
          )}
        </div>
        <p className="legal login-legal">
          New here? <Link to="/guide">See how it works</Link>
          <br />
          By signing in, you agree to the{' '}
          <button
            type="button"
            className="btn-link"
            style={{ padding: 0, minHeight: 'auto', fontSize: 'inherit', color: 'inherit' }}
            onClick={() => setShowPolicy(true)}
          >
            event rules and privacy policy
          </button>
        </p>
      </div>

      {showPolicy && (
        <div className="modal-backdrop" onClick={() => setShowPolicy(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Event Rules and Privacy Policy" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460, textAlign: 'left', gap: 14 }}>
            <h2 style={{ margin: 0 }}>Event Rules &amp; Privacy Policy</h2>
            <div style={{ display: 'grid', gap: 10, fontSize: 14, lineHeight: 1.55, color: 'var(--muted)' }}>
              <p style={{ margin: 0 }}><strong style={{ color: 'var(--ink)' }}>1. Data Collected:</strong> Your display name, VISTEC email, selected avatar, team/group, and submitted run logs (date, distance, duration, and proof photo).</p>
              <p style={{ margin: 0 }}><strong style={{ color: 'var(--ink)' }}>2. Purpose:</strong> Data is used solely to calculate event distances, rank leaderboards (1–15 Dec 2026), and verify run submissions by event admins.</p>
              <p style={{ margin: 0 }}><strong style={{ color: 'var(--ink)' }}>3. Visibility:</strong> Your display name, avatar, team/group, and distance totals are visible to other VISTEC participants. No data is shared externally.</p>
              <p style={{ margin: 0 }}><strong style={{ color: 'var(--ink)' }}>4. Fair Play:</strong> Runs must be logged on the same day (Bangkok time) with an original proof photo. Duplicate photos or abnormal pace may be flagged or rejected by admins.</p>
            </div>
            <div className="modal-actions" style={{ marginTop: 4 }}>
              <button type="button" className="btn-accent" onClick={() => setShowPolicy(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
