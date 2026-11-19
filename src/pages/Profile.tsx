import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { updateAvatarUrl, updateDisplayName } from '../lib/api';
import { RunnerIcon } from '../components/Icons';

function resizeAvatarToDataUrl(
  src: string,
  zoom = 1,
  offset = { x: 0, y: 0 },
  previewSize = 160,
  outputSize = 240,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error('ไฟล์ไม่ใช่รูปภาพที่รองรับ'));
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = outputSize;
      canvas.height = outputSize;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas error'));

      const minSide = Math.min(img.width, img.height);
      const cropSize = minSide / zoom;
      const scaleToImg = cropSize / previewSize;

      let sx = (img.width - cropSize) / 2 - offset.x * scaleToImg;
      let sy = (img.height - cropSize) / 2 - offset.y * scaleToImg;

      sx = Math.max(0, Math.min(img.width - cropSize, sx));
      sy = Math.max(0, Math.min(img.height - cropSize, sy));

      ctx.drawImage(img, sx, sy, cropSize, cropSize, 0, 0, outputSize, outputSize);
      resolve(canvas.toDataURL('image/jpeg', 0.88));
    };
    img.src = src;
  });
}

export default function Profile() {
  const { user, profile, refreshProfile, signOut } = useAuth();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [pendingSrc, setPendingSrc] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragStartRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const m365Name = (user?.user_metadata?.full_name as string) || (user?.user_metadata?.name as string) || '';
    setName(profile?.display_name || m365Name);
  }, [profile, user]);

  function onAvatarSelect(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setPendingSrc(ev.target?.result as string);
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      setMsg(null);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!pendingSrc) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    // จำกัดระยะลากไม่ให้หลุดขอบวงกลมจนเห็นพื้นหลังว่าง
    const maxPan = Math.max(0, (160 * (zoom - 1)) / 2);
    setOffset({
      x: Math.max(-maxPan, Math.min(maxPan, dragStartRef.current.ox + dx)),
      y: Math.max(-maxPan, Math.min(maxPan, dragStartRef.current.oy + dy)),
    });
  }

  function onPointerUp() {
    dragStartRef.current = null;
  }

  async function onSaveAvatar() {
    if (!pendingSrc || !user) return;
    setSaving(true);
    setMsg(null);
    try {
      const dataUrl = await resizeAvatarToDataUrl(pendingSrc, zoom, offset, 160, 240);
      await updateAvatarUrl(user.id, dataUrl);
      await refreshProfile();
      setPendingSrc(null);
      setMsg({ kind: 'ok', text: 'อัปเดตรูปโปรไฟล์แล้ว' });
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
    if (!trimmed) return setMsg({ kind: 'err', text: 'กรุณากรอกชื่อที่แสดง' });
    setSaving(true);
    setMsg(null);
    try {
      await updateDisplayName(user.id, trimmed);
      await refreshProfile();
      setMsg({ kind: 'ok', text: 'บันทึกแล้ว' });
    } catch (err) {
      setMsg({ kind: 'err', text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page narrow">
      <header className="page-head reveal">
        <h1>โปรไฟล์</h1>
      </header>

      <section className="card profile reveal" style={{ animationDelay: '60ms' }}>
        <div
          className="avatar-lg"
          onClick={() => !pendingSrc && fileInputRef.current?.click()}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          title={pendingSrc ? 'ลากเพื่อจัดตำแหน่งรูป' : 'คลิกเพื่อเปลี่ยนรูปโปรไฟล์'}
          style={{
            width: pendingSrc ? 160 : undefined,
            height: pendingSrc ? 160 : undefined,
            cursor: pendingSrc ? 'grab' : 'pointer',
            overflow: 'hidden',
            position: 'relative',
            touchAction: 'none',
            userSelect: 'none',
          }}
        >
          {pendingSrc ? (
            <img
              src={pendingSrc}
              alt="Preview"
              draggable={false}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                pointerEvents: 'none',
              }}
            />
          ) : (profile?.avatar_url || (user?.user_metadata?.avatar_url as string) || (user?.user_metadata?.picture as string)) ? (
            <img
              src={profile?.avatar_url || (user?.user_metadata?.avatar_url as string) || (user?.user_metadata?.picture as string)}
              alt="Avatar"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <RunnerIcon size={44} />
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={onAvatarSelect}
          style={{ display: 'none' }}
        />
        {pendingSrc ? (
          <div style={{ width: '100%', maxWidth: 260, display: 'grid', gap: 8 }}>
            <p className="muted" style={{ fontSize: 12, textAlign: 'center', margin: 0 }}>ลากรูปเพื่อจัดตำแหน่ง หรือเลื่อนซูม</p>
            <label style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
              <span>ซูม</span>
              <span>{zoom.toFixed(1)}x</span>
            </label>
            <input
              type="range"
              min="1"
              max="3"
              step="0.05"
              value={zoom}
              style={{ accentColor: '#FC4C02', width: '100%', cursor: 'pointer' }}
              onChange={(e) => {
                const nextZoom = Number(e.target.value);
                setZoom(nextZoom);
                const maxPan = Math.max(0, (160 * (nextZoom - 1)) / 2);
                setOffset((prev) => ({
                  x: Math.max(-maxPan, Math.min(maxPan, prev.x)),
                  y: Math.max(-maxPan, Math.min(maxPan, prev.y)),
                }));
              }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn-dark" onClick={onSaveAvatar} disabled={saving} style={{ flex: 1 }}>
                {saving ? 'กำลังบันทึก…' : 'บันทึกรูป'}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setPendingSrc(null)} disabled={saving}>
                ยกเลิก
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn-ghost" onClick={() => fileInputRef.current?.click()} disabled={saving}>
            เปลี่ยนรูปโปรไฟล์
          </button>
        )}
        <p className="muted">{user?.email}</p>
        <form className="form" onSubmit={onSave}>
          <label>ชื่อที่แสดงในอันดับ
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
          </label>
          {msg && <p className={msg.kind === 'ok' ? 'ok' : 'alert'} role={msg.kind === 'ok' ? 'status' : 'alert'}>{msg.text}</p>}
          <button className="btn-dark" type="submit" disabled={saving}>{saving ? 'กำลังบันทึก…' : 'บันทึกชื่อ'}</button>
        </form>
        <button className="btn-ghost" onClick={() => void signOut()}>ออกจากระบบ</button>
      </section>
    </div>
  );
}
