import { useLayoutEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { isConfigured } from '../lib/supabase';
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
  const { loading, session, signInWithMicrosoft } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intro] = useState(shouldPlayIntro);
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
    <div className={`login${intro ? ' intro' : ''}`} ref={rootRef}>
      <div className="hero" aria-hidden="true">
        <img src={WALL} alt="" />
        <div className="hero-blur" />
        <div className="hero-fade" />
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
          <button className="btn-ms" onClick={onSignIn} disabled={busy || !isConfigured}>
            <MicrosoftLogo />
            {busy ? 'Redirecting to Microsoft…' : 'Sign in with Microsoft'}
          </button>
          {error && <p className="alert" role="alert">{error}</p>}
          <p className="small">Sign in with your VISTEC Microsoft 365 account only</p>
          <p className="legal">By signing in, you agree to the event rules and privacy policy.</p>
        </div>
      </div>
    </div>
  );
}
