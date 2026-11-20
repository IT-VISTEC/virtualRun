import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { isConfigured } from '../lib/supabase';
import { MicrosoftLogo, RunnerIcon } from '../components/Icons';

type Tone = 'ink' | 'light' | 'mid' | 'accent';
// photo: zoom = ความสูงรูปเป็น % ของช่อง, x/y = จุดโฟกัสของรูป (%)
type Photo = { zoom: number; x: number; y: number };
type Tile = { w: number; round?: boolean; tone: Tone; photo?: Photo };
const WALL = `${import.meta.env.BASE_URL}loginwall.webp`;
type Row = { ml: number; tiles: Tile[] };

// ภาพตัดปะ: ช่องที่มี photo ครอปมาจากรูปเดียว (public/loginwall.webp) ช่องอื่นเป็นไอคอน
const ROWS: Row[] = [
  { ml: -44, tiles: [{ w: 170, tone: 'ink' }, { w: 100, round: true, tone: 'light' }, { w: 100, round: true, tone: 'accent' }, { w: 110, tone: 'mid', photo: { zoom: 450, x: 98, y: 62 } }] },
  { ml: -62, tiles: [{ w: 100, round: true, tone: 'mid' }, { w: 270, round: true, tone: 'ink', photo: { zoom: 467, x: 86, y: 56 } }, { w: 120, tone: 'light' }] },
  { ml: -22, tiles: [{ w: 100, round: true, tone: 'ink' }, { w: 112, tone: 'light', photo: { zoom: 600, x: 58, y: 57 } }, { w: 190, tone: 'mid', photo: { zoom: 300, x: 29, y: 43 } }] },
];

export default function Login() {
  const { loading, session, signInWithMicrosoft } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && session) return <Navigate to="/" replace />;

  async function onSignIn() {
    setError(null);
    setBusy(true);
    const err = await signInWithMicrosoft();
    if (err) {
      setError(`เข้าสู่ระบบไม่สำเร็จ: ${err}`);
      setBusy(false);
    }
  }

  let n = 0;
  return (
    <div className="login">
      <div className="collage" aria-hidden="true">
        {ROWS.map((row, r) => (
          <div key={r} className="collage-row" style={{ marginLeft: row.ml }}>
            {row.tiles.map((t, i) => (
              <div
                key={i}
                className={`tile tone-${t.tone}${t.round ? ' round' : ''}${t.photo ? ' photo' : ''}`}
                style={{
                  width: t.w,
                  animationDelay: `${70 * n++}ms`,
                  ...(t.photo && {
                    backgroundImage: `url(${WALL})`,
                    backgroundSize: `auto ${t.photo.zoom}%`,
                    backgroundPosition: `${t.photo.x}% ${t.photo.y}%`,
                  }),
                }}
              >
                {!t.photo && <RunnerIcon size={44} />}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="login-body">
        <div className="login-copy">
          <h1>ลงสนามวิ่ง<br />กับเพื่อนทั่วโลก</h1>
          <p>ลงทะเบียนงานวิ่งเสมือนจริง บันทึกระยะทางของคุณ และไม่ต้องวิ่งคนเดียวอีกต่อไป</p>
        </div>

        <div className="login-actions">
          {!isConfigured && (
            <p className="alert" role="alert">
              ยังไม่ได้ตั้งค่า Supabase — สร้างไฟล์ <code>.env.local</code> ตาม README
            </p>
          )}
          <button className="btn-ms" onClick={onSignIn} disabled={busy || !isConfigured}>
            <MicrosoftLogo />
            {busy ? 'กำลังพาไปหน้า Microsoft…' : 'เข้าสู่ระบบด้วย Microsoft'}
          </button>
          {error && <p className="alert" role="alert">{error}</p>}
          <p className="small">
            ยังไม่มีบัญชี Microsoft?{' '}
            <a href="https://account.microsoft.com" target="_blank" rel="noreferrer">สร้างบัญชีใหม่</a>
          </p>
          <p className="legal">การเข้าสู่ระบบถือว่าคุณยอมรับเงื่อนไขการใช้งานและนโยบายความเป็นส่วนตัว</p>
        </div>
      </div>
    </div>
  );
}
