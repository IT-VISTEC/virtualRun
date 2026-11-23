import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Run, addRun, deleteRun, getImageUrls, listRuns } from '../lib/api';
import { ACCEPT, FORMATS_LABEL, toPng } from '../lib/image';
import { formatLong, toISODate } from '../lib/dates';
import { fmtKm, fmtSteps, kmToSteps, stepsToKm } from '../lib/format';

type Mode = 'km' | 'steps';

export default function Runs() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<Mode>('km');
  const [form, setForm] = useState({ ran_on: toISODate(new Date()), value: '' });
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [converting, setConverting] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const valueRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      setRuns(await listRuns());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // พิมพ์ตัวเลขได้ทันที: โฟกัสช่องกรอกเมื่อเปิดหน้า และเมื่อสลับ km/steps
  useEffect(() => {
    valueRef.current?.focus();
  }, [mode]);

  // ลิงก์ดูรูปของรายการที่มีรูป
  useEffect(() => {
    const paths = (runs ?? []).map((r) => r.image_path).filter((p): p is string => !!p);
    if (paths.length === 0) return;
    let alive = true;
    getImageUrls(paths).then((u) => alive && setThumbs(u)).catch(() => {});
    return () => { alive = false; };
  }, [runs]);

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);

  async function onPickPhoto(file: File | undefined) {
    if (!file) return;
    setError(null);
    setConverting(true);
    try {
      const blob = await toPng(file);
      setPhoto({ blob, url: URL.createObjectURL(blob) });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setConverting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => {
    const val = e.target.value;
    if (k === 'value' && val !== '') {
      if (mode === 'km' && !/^\d*(\.\d{0,2})?$/.test(val)) return;
      if (mode === 'steps' && !/^\d*$/.test(val)) return;
    }
    setForm((f) => ({ ...f, [k]: val }));
  };

  const num = Number(form.value);
  const hint =
    form.value && Number.isFinite(num) && num > 0
      ? mode === 'km'
        ? `≈ ${fmtSteps(kmToSteps(num))} steps`
        : `≈ ${fmtKm(stepsToKm(num))} km`
      : ' ';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    let distance: number;
    let steps: number;
    if (mode === 'km') {
      if (!Number.isFinite(num) || num <= 0 || num > 300) return setError('Distance must be between 0.01 and 300 km.');
      distance = Math.round(num * 100) / 100;
      steps = kmToSteps(distance);
    } else {
      if (!Number.isInteger(num) || num <= 0 || num > 400000) return setError('Steps must be a whole number between 1 and 400,000.');
      steps = num;
      distance = stepsToKm(steps);
      if (distance <= 0) return setError('Step count is too small.');
    }

    if (!photo) return setError('Please upload a proof photo.');

    setSaving(true);
    try {
      await addRun({
        ran_on: form.ran_on,
        distance_km: distance,
        duration_min: null,
        elevation_m: null,
        steps,
        entry_type: mode,
        note: null,
      }, photo?.blob);
      setForm((f) => ({ ...f, value: '' }));
      setPhoto(null);
      valueRef.current?.focus();
      setOk('Saved');
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(r: Run) {
    if (!window.confirm(`Delete run on ${formatLong(r.ran_on)} (${fmtKm(r.distance_km)} km)?`)) return;
    try {
      await deleteRun(r.id, r.image_path);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="page">
      <header className="page-head reveal">
        <div>
          <h1>Log Run</h1>
          <p className="muted">Log your activity in km or steps. Distance counts toward your joined challenges.</p>
        </div>
      </header>

      <div className="runs-layout">
        <form className="card form reveal" onSubmit={onSubmit} style={{ animationDelay: '60ms' }}>
          <h2>Add Activity</h2>
          <div className="seg" role="tablist" aria-label="Entry unit">
            {(['km', 'steps'] as const).map((m) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m}
                className={mode === m ? 'on' : ''} onClick={() => { setMode(m); setForm((f) => ({ ...f, value: '' })); }}>
                {m === 'km' ? 'km' : 'steps'}
              </button>
            ))}
          </div>
          <label>Date
            <input type="date" value={form.ran_on} max={toISODate(new Date())} onChange={set('ran_on')} required />
          </label>
          <label>{mode === 'km' ? 'Distance (km)' : 'Steps'}
            <div className="input-unit">
              <input className="big-input" type="number" inputMode={mode === 'km' ? 'decimal' : 'numeric'}
                placeholder={mode === 'km' ? '0.00' : '0'}
                onKeyDown={(e) => {
                  if (['e', 'E', '+', '-'].includes(e.key) || (mode === 'steps' && e.key === '.')) {
                    e.preventDefault();
                  }
                }}
                step={mode === 'km' ? '0.01' : '1'} min={mode === 'km' ? '0.01' : '1'} max={mode === 'km' ? '300' : '400000'}
                ref={valueRef} autoFocus value={form.value} onChange={set('value')} required />
              <span aria-hidden="true">{mode === 'km' ? 'km' : 'steps'}</span>
            </div>
            <span className="muted small">{hint}</span>
          </label>
          <div className="field">
            <span className="field-label">Photo <span className="muted small">(optional)</span></span>
            <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={(e) => void onPickPhoto(e.target.files?.[0])} />
            {photo ? (
              <div className="photo-preview">
                <img src={photo.url} alt="Selected photo preview" />
                <button type="button" className="btn-link" onClick={() => setPhoto(null)}>Remove</button>
              </div>
            ) : (
              <button type="button" className="btn-ghost photo-add" disabled={converting} onClick={() => fileRef.current?.click()}>
                {converting ? 'Converting…' : 'Add photo'}
              </button>
            )}
            <span className="muted small">{FORMATS_LABEL} · up to 15 MB · saved as PNG</span>
          </div>
          {error && <p className="alert" role="alert">{error}</p>}
          {ok && <p className="ok" role="status">{ok}</p>}
          <button className="btn-accent" type="submit" disabled={saving || converting}>{saving ? 'Saving…' : 'Save'}</button>
        </form>

        <section className="card reveal" style={{ animationDelay: '120ms' }}>
          <h2>History</h2>
          {runs === null && <p className="muted">Loading…</p>}
          {runs && runs.length === 0 && <p className="muted">No runs yet. Use the form to log your first run.</p>}
          <ul className="run-list">
            {(runs ?? []).map((r) => (
              <li key={r.id}>
                <div className="run-main">
                  <strong className={r.entry_type === 'km' ? 'hl' : ''}>{fmtKm(r.distance_km)} km</strong>
                  {r.steps != null && <strong className={r.entry_type === 'steps' ? 'hl' : 'dim'}>{fmtSteps(r.steps)} steps</strong>}
                  <span className="muted">{formatLong(r.ran_on)}</span>
                </div>
                {r.image_path && thumbs[r.image_path] && (
                  <a className="run-thumb" href={thumbs[r.image_path]} target="_blank" rel="noreferrer" aria-label="Open photo">
                    <img src={thumbs[r.image_path]} alt="Run photo" loading="lazy" />
                  </a>
                )}
                {r.note && <p className="run-note">{r.note}</p>}
                <button className="btn-link" onClick={() => onDelete(r)} aria-label={`Delete run on ${formatLong(r.ran_on)}`}>Delete</button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
