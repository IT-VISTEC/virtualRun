import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Run, listRuns, updateAvatarUrl, updateDisplayName } from '../lib/api';
import { CHIBI_AVATARS, getDefaultAvatar } from '../lib/avatars';
import { fmtKm, fmtSteps } from '../lib/format';

const STAGE = 240; // ขนาดวงกลมครอปในหน้าต่างปรับรูป (px)
const OUTPUT = 256; // ขนาดไฟล์รูปโปรไฟล์ที่บันทึก (px)
const HERO = `${import.meta.env.BASE_URL}hero.webp`;

function cropToDataUrl(src: string, zoom: number, offset: { x: number; y: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error('Unsupported image file'));
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT;
      canvas.height = OUTPUT;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas error'));

      const minSide = Math.min(img.width, img.height);
      const cropSize = minSide / zoom;
      const scaleToImg = cropSize / STAGE;
      let sx = (img.width - cropSize) / 2 - offset.x * scaleToImg;
      let sy = (img.height - cropSize) / 2 - offset.y * scaleToImg;
      sx = Math.max(0, Math.min(img.width - cropSize, sx));
      sy = Math.max(0, Math.min(img.height - cropSize, sy));

      ctx.drawImage(img, sx, sy, cropSize, cropSize, 0, 0, OUTPUT, OUTPUT);
      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };
    img.src = src;
  });
}

const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));
const maxPanFor = (zoom: number) => (STAGE * (zoom - 1)) / 2;

export default function Profile() {
  const { user, profile, refreshProfile, signOut } = useAuth();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [runs, setRuns] = useState<Run[] | null>(null);

  const [pendingSrc, setPendingSrc] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [modalErr, setModalErr] = useState<string | null>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const saveBtnRef = useRef<HTMLButtonElement | null>(null);

  const m365Name = (user?.user_metadata?.full_name as string) || (user?.user_metadata?.name as string) || '';
  const avatar =
    profile?.avatar_url || (user?.user_metadata?.avatar_url as string) || (user?.user_metadata?.picture as string) || '';

  useEffect(() => {
    setName(profile?.display_name || m365Name);
  }, [profile, m365Name]);

  useEffect(() => {
    let alive = true;
    listRuns().then((r) => alive && setRuns(r)).catch(() => {});
    return () => { alive = false; };
  }, []);

  // ปิดหน้าต่างปรับรูปด้วย Esc และโฟกัสปุ่มบันทึกเมื่อเปิด
  useEffect(() => {
    if (!pendingSrc) return;
    saveBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) setPendingSrc(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingSrc, saving]);

  function onAvatarSelect(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return setMsg({ kind: 'err', text: 'Please choose an image file.' });
    if (file.size > 15 * 1024 * 1024) return setMsg({ kind: 'err', text: 'Image is too large (max 15 MB).' });
    const reader = new FileReader();
    reader.onload = (ev) => {
      setPendingSrc(ev.target?.result as string);
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      setModalErr(null);
      setMsg(null);
    };
    reader.readAsDataURL(file);
  }

  function setZoomClamped(next: number) {
    const z = Math.max(1, Math.min(3, next));
    setZoom(z);
    const lim = maxPanFor(z);
    setOffset((p) => ({ x: clamp(p.x, lim), y: clamp(p.y, lim) }));
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d) return;
    const lim = maxPanFor(zoom);
    setOffset({ x: clamp(d.ox + e.clientX - d.x, lim), y: clamp(d.oy + e.clientY - d.y, lim) });
  }
  const onPointerUp = () => { dragRef.current = null; };

  async function onSaveAvatar() {
    if (!pendingSrc || !user) return;
    setSaving(true);
    setModalErr(null);
    try {
      const dataUrl = await cropToDataUrl(pendingSrc, zoom, offset);
      await updateAvatarUrl(user.id, dataUrl);
      await refreshProfile();
      setPendingSrc(null);
      setMsg({ kind: 'ok', text: 'Profile photo updated' });
    } catch (err) {
      setModalErr((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function onPickChibi(url: string) {
    if (!user) return;
    setSaving(true);
    setMsg(null);
    try {
      await updateAvatarUrl(user.id, url);
      await refreshProfile();
      setPendingSrc(null);
      setMsg({ kind: 'ok', text: 'Profile photo updated' });
    } catch (err) {
      setMsg({ kind: 'err', text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function onRemoveAvatar() {
    if (!user) return;
    setSaving(true);
    setMsg(null);
    try {
      await updateAvatarUrl(user.id, null);
      await refreshProfile();
      setPendingSrc(null);
      setMsg({ kind: 'ok', text: 'Profile photo removed' });
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
            <button type="button" className="pf-avatar" onClick={() => fileRef.current?.click()} aria-label="Change profile photo">
              <img src={avatar || getDefaultAvatar(user?.id || shownName)} alt={shownName} />
            </button>
            <button type="button" className="pf-edit" onClick={() => fileRef.current?.click()} aria-label="Edit profile photo">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
          </div>
          <h1 className="pf-name">{shownName}</h1>
          <p className="muted pf-email">{user?.email}</p>
        </div>
        <input ref={fileRef} type="file" accept="image/*" onChange={onAvatarSelect} hidden />

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
            <span className="muted small">Choose a chibi avatar or upload your own</span>
            {profile?.avatar_url && (
              <button type="button" className="btn-link" style={{ padding: 0, minHeight: 'auto' }} onClick={onRemoveAvatar} disabled={saving}>
                Remove photo
              </button>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 56px))', justifyContent: 'space-between', rowGap: 12 }}>
            {CHIBI_AVATARS.map((c) => {
              const selected = profile?.avatar_url === c.url;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onPickChibi(c.url)}
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
                    background: 'transparent',
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

      {pendingSrc && (
        <div className="modal-backdrop" onClick={() => !saving && setPendingSrc(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Adjust profile photo" onClick={(e) => e.stopPropagation()}>
            <h2>Adjust photo</h2>
            <div
              className="crop-stage"
              style={{ width: STAGE, height: STAGE }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onWheel={(e) => setZoomClamped(zoom - e.deltaY * 0.002)}
            >
              <img
                src={pendingSrc}
                alt="Photo being adjusted"
                draggable={false}
                style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}
              />
            </div>
            <p className="muted small">Drag to reposition</p>
            <label className="zoom-row">
              <span>Size</span>
              <input type="range" min="1" max="3" step="0.05" value={zoom} aria-label="Zoom"
                onChange={(e) => setZoomClamped(Number(e.target.value))} />
              <span className="zoom-val">{zoom.toFixed(1)}×</span>
            </label>
            {modalErr && <p className="alert" role="alert">{modalErr}</p>}
            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={() => setPendingSrc(null)} disabled={saving}>Cancel</button>
              <button type="button" ref={saveBtnRef} className="btn-accent" onClick={onSaveAvatar} disabled={saving}>
                {saving ? 'Saving…' : 'Save photo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
