import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { isConfigured } from '../lib/supabase';
import { MicrosoftLogo } from '../components/Icons';

const WALL = `${import.meta.env.BASE_URL}vitrun.webp`;

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

  return (
    <div className="login">
      <div className="hero" aria-hidden="true">
        <img src={WALL} alt="" />
        <div className="hero-blur" />
        <div className="hero-fade" />
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
