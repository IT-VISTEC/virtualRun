import { ChangeEvent, DragEvent, FormEvent, KeyboardEvent, RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppSettings, Run, RunStatus, bkkToday, deleteRun, getAppSettings, listRuns, signedUrls, submitRun } from '../lib/api';
import { createPortal } from 'react-dom';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icons';
import { ACCEPT, FORMATS_LABEL, compressImage, sha256Hex, type CompressedImage } from '../lib/image';
import { OcrResult, checkPhotoDate, extractRunFromImage } from '../lib/ocr';
import { bangkokToday, parseISODate } from '../lib/dates';
import { REVIEW_DISTANCE_KM, REVIEW_PACE_SEC, fmtHms, fmtPaceSec, fmtSteps, kmToSteps } from '../lib/format';
import './LogRun.css';

// ───────── helpers (local to this page) ─────────

/** 5 -> "5.0", 5.25 -> "5.25" */
const fmtDist = (km: number) => km.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 });

const fmtDayLong = (iso: string) =>
  parseISODate(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtDayShort = (iso: string) =>
  parseISODate(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtDayMonth = (iso: string) => parseISODate(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

function fmtBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const STATUS_LABEL: Record<RunStatus, string> = {
  counted: 'Counted',
  pending: 'Pending review',
  rejected: 'Rejected',
};

type Photo = { name: string; size: number; img: CompressedImage; sha: string; url: string };
type Time = { h: string; m: string; s: string };
const EMPTY_TIME: Time = { h: '', m: '', s: '' };

/** Parse the distance text ("5", "5.2", "5,25") -> km, or NaN. */
function parseKm(v: string): number {
  if (!v) return NaN;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

function timeToSec(t: Time): number {
  return (Number(t.h) || 0) * 3600 + (Number(t.m) || 0) * 60 + (Number(t.s) || 0);
}

// ───────── page ─────────

export default function LogRun() {
  const { isAdmin } = useAuth();

  const [today, setToday] = useState<string>(() => bangkokToday());
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const [runs, setRuns] = useState<Run[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  const [kmText, setKmText] = useState('');
  const [time, setTime] = useState<Time>(EMPTY_TIME);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [ocrNote, setOcrNote] = useState<string | null>(null);
  /** frame colour of the proof card: ok = read fine (green), flag = will be reviewed (orange) */
  const [ocrTone, setOcrTone] = useState<'ok' | 'flag' | null>(null);
  /** full-size viewer: the image URL being shown (upload preview or a past run's photo) */
  const [viewing, setViewing] = useState<string | null>(null);
  const ocrRef = useRef<Promise<OcrResult> | null>(null);
  useEffect(() => {
    if (!viewing) return;
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && setViewing(null);
    window.addEventListener('keydown', onKey);
    // lock the page behind the viewer (overflow alone doesn't stop iOS Safari, so pin the body)
    const y = window.scrollY;
    const b = document.body.style;
    const prev = { position: b.position, top: b.top, width: b.width, overflow: b.overflow };
    Object.assign(b, { position: 'fixed', top: `-${y}px`, width: '100%', overflow: 'hidden' });
    return () => {
      window.removeEventListener('keydown', onKey);
      Object.assign(b, prev);
      window.scrollTo(0, y);
    };
  }, [viewing]);
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<{ text: string; pending: boolean } | null>(null);

  const [confirmRun, setConfirmRun] = useState<Run | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const kmRef = useRef<HTMLInputElement>(null);
  const hRef = useRef<HTMLInputElement>(null);
  const mRef = useRef<HTMLInputElement>(null);
  const sRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pickToken = useRef(0);

  // ── load settings + server "today"
  useEffect(() => {
    let alive = true;
    Promise.all([getAppSettings(), bkkToday().catch(() => bangkokToday())])
      .then(([s, t]) => {
        if (!alive) return;
        setSettings(s);
        if (t) setToday(t);
      })
      .catch((e: Error) => alive && setSettingsError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  const reload = useCallback(async () => {
    try {
      setRuns(await listRuns());
      setListError(null);
    } catch (e) {
      setListError((e as Error).message);
      setRuns((r) => r ?? []);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // ── signed thumbnails for the history list
  useEffect(() => {
    const missing = (runs ?? []).map((r) => r.image_path).filter((p): p is string => !!p && !thumbs[p]);
    if (missing.length === 0) return;
    let alive = true;
    signedUrls(missing)
      .then((u) => alive && setThumbs((t) => ({ ...t, ...u })))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs]);

  // ── release the preview object URL
  useEffect(() => () => {
    if (photo) URL.revokeObjectURL(photo.url);
  }, [photo]);

  // ── event window
  const windowState: 'loading' | 'before' | 'open' | 'after' | 'unknown' = settingsError
    ? 'unknown'
    : !settings
      ? 'loading'
      : today < settings.event_start
        ? 'before'
        : today > settings.event_end
          ? 'after'
          : 'open';
  const outside = windowState === 'before' || windowState === 'after';
  const canSubmit = windowState === 'open' || windowState === 'unknown' || (outside && isAdmin);

  // ── live derived values
  const km = parseKm(kmText);
  const sec = timeToSec(time);
  const kmValid = Number.isFinite(km) && km > 0;
  const paceSec = kmValid && sec > 0 ? sec / km : NaN;
  const steps = kmValid ? kmToSteps(km) : null;
  const tooFast = Number.isFinite(paceSec) && paceSec < REVIEW_PACE_SEC;
  const tooFar = kmValid && km > REVIEW_DISTANCE_KM;
  const willReview = tooFast || tooFar;

  // ── inputs
  function onKm(e: ChangeEvent<HTMLInputElement>) {
    const v = e.target.value.replace(/\s/g, '');
    if (v === '' || /^\d{0,4}([.,]\d{0,2})?$/.test(v)) setKmText(v);
  }

  function onTime(part: keyof Time, next?: RefObject<HTMLInputElement>) {
    return (e: ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value.replace(/\D/g, '').slice(0, 2);
      setTime((t) => ({ ...t, [part]: v }));
      if (v.length === 2 && next?.current) {
        next.current.focus();
        next.current.select();
      }
    };
  }

  function onTimeKey(prev?: RefObject<HTMLInputElement>) {
    return (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Backspace' && e.currentTarget.value === '' && prev?.current) {
        e.preventDefault();
        prev.current.focus();
      }
      if (e.key === ':' || e.key === '.') {
        e.preventDefault();
        const order = [hRef, mRef, sRef];
        const i = order.findIndex((r) => r.current === e.currentTarget);
        order[i + 1]?.current?.focus();
      }
    };
  }

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    const token = ++pickToken.current;
    setError(null);
    setOk(null);
    setPreparing(true);
    try {
      if (file.type && !ACCEPT.split(',').includes(file.type)) {
        throw new Error(`Unsupported image. Please use ${FORMATS_LABEL}.`);
      }
      // Hash the ORIGINAL bytes (duplicate check), then compress (WebP, or JPEG on Safari) for upload.
      const [sha, img] = await Promise.all([sha256Hex(file), compressImage(file)]);
      if (token !== pickToken.current) return;
      if (photo) resetValues(); // replacing a photo (only once the new one is good): let it fill the form
      setPhoto({ name: file.name, size: file.size, img, sha, url: URL.createObjectURL(img.blob) });
      setOcrNote('Reading screenshot…');
      setOcrTone(null);
      const ocr = extractRunFromImage(file, today);
      ocrRef.current = ocr;
      void ocr.then((res) => {
        if (token !== pickToken.current) return;
        let filled = false;
        if (res.distanceKm != null) {
          setKmText((prev) => (prev ? prev : res.distanceKm!.toFixed(2)));
          filled = true;
        }
        if (res.durationSec != null) {
          const h = Math.floor(res.durationSec / 3600);
          const m = Math.floor((res.durationSec % 3600) / 60);
          const s = res.durationSec % 60;
          setTime((prev) =>
            prev.h || prev.m || prev.s
              ? prev
              : {
                  h: h > 0 ? String(h) : '',
                  m: String(m).padStart(2, '0'),
                  s: String(s).padStart(2, '0'),
                },
          );
          filled = true;
        }
        const dateState = checkPhotoDate(res.dates, today).state;
        setOcrTone(dateState === 'match' ? 'ok' : 'flag');
        const fillNote = filled ? 'Auto-filled — please verify' : 'Could not auto-read — please enter manually';
        setOcrNote(
          dateState === 'mismatch'
            ? `Screenshot date isn't today — an admin will check this run · ${fillNote}`
            : dateState === 'unknown'
              ? `No date found on screenshot — an admin will check this run · ${fillNote}`
              : filled
                ? 'Auto-filled from screenshot — please verify'
                : 'Could not auto-read — please enter manually',
        );
      });
    } catch (err) {
      if (token === pickToken.current) setError((err as Error).message);
    } finally {
      if (token === pickToken.current) setPreparing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (saving) return;
    void pickPhoto(e.dataTransfer.files?.[0]);
  }

  function clearPhoto() {
    pickToken.current++;
    setPreparing(false);
    setOcrNote(null);
    setOcrTone(null);
    setPhoto(null);
    setViewing(null);
    ocrRef.current = null;
    resetValues();
  }

  function resetValues() {
    setKmText('');
    setTime(EMPTY_TIME);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);
    setOk(null);

    if (!kmValid) {
      setError('Enter the distance in km (for example 5.25).');
      kmRef.current?.focus();
      return;
    }
    if (Number(time.m) > 59 || Number(time.s) > 59) {
      setError('Minutes and seconds must be between 0 and 59.');
      (Number(time.m) > 59 ? mRef : sRef).current?.focus();
      return;
    }
    if (sec <= 0) {
      setError('Enter your moving time.');
      (time.h ? hRef : mRef).current?.focus();
      return;
    }
    if (preparing) {
      setError('Your photo is still being prepared. Try again in a moment.');
      return;
    }
    if (!photo) {
      setError('A proof screenshot is required.');
      fileRef.current?.focus();
      return;
    }

    setSaving(true);
    try {
      const distance = Math.round(km * 100) / 100;
      // Uploads to run-images/<uid>/<uuid>.webp|jpg, inserts, and removes the photo if the insert fails.
      // Date shown on the screenshot (if OCR read one). Wait briefly if OCR is still running.
      const ocr = ocrRef.current
        ? await Promise.race([ocrRef.current, new Promise<null>((r) => setTimeout(() => r(null), 8000))])
        : null;
      const photo_date = ocr ? checkPhotoDate(ocr.dates, today).date : null;
      const run = await submitRun({ distance_km: distance, duration_sec: sec, photo_date }, photo.img, photo.sha);
      const pending = run.status === 'pending';
      setOk({
        pending,
        text: pending
          ? `Saved ${fmtDist(run.distance_km)} km. It will count once an admin approves it.`
          : `Saved ${fmtDist(run.distance_km)} km. Nice run!`,
      });
      setKmText('');
      setTime(EMPTY_TIME);
      setPhoto(null);
      setOcrNote(null);
      setOcrTone(null);
      ocrRef.current = null;
      setRuns((rs) => [run, ...(rs ?? []).filter((r) => r.id !== run.id)]);
      void reload();
      kmRef.current?.focus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function onConfirmDelete() {
    if (!confirmRun) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteRun(confirmRun.id, confirmRun.image_path);
      setRuns((rs) => (rs ?? []).filter((r) => r.id !== confirmRun.id));
      setConfirmRun(null);
      setOk(null);
      void reload();
    } catch (err) {
      setDeleteError((err as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  // Escape closes the delete dialog
  useEffect(() => {
    if (!confirmRun) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && !deleting) setConfirmRun(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmRun, deleting]);

  // ── history grouped by day (runs come newest first)
  const groups = useMemo(() => {
    const out: { day: string; runs: Run[] }[] = [];
    for (const r of runs ?? []) {
      const last = out[out.length - 1];
      if (last && last.day === r.ran_on) last.runs.push(r);
      else out.push({ day: r.ran_on, runs: [r] });
    }
    return out;
  }, [runs]);

  const todayCounted = (runs ?? [])
    .filter((r) => r.ran_on === today && r.status === 'counted')
    .reduce((a, r) => a + r.distance_km, 0);

  // ───────── render ─────────

  const form = (
    <form className="card lr-form reveal" onSubmit={onSubmit} noValidate aria-labelledby="lr-form-title" style={{ animationDelay: '60ms' }}>
      <div className="lr-form-head">
        <h2 id="lr-form-title">New run</h2>
        <p className="lr-date">
          <Icon name="calendar" size={16} />
          <span>
            <span className="lr-sr">Date: </span>Today · {fmtDayLong(today)}
          </span>
        </p>
      </div>

      {outside && isAdmin && (
        <p className="lr-admin-note" role="note">
          <Icon name="shield" size={16} />
          <span>Outside the event window. As an admin you can still submit for testing.</span>
        </p>
      )}

      <div className="lr-field">
        <span className="lr-label" id="lr-photo-label">Proof screenshot <span className="lr-req">required</span></span>
        <input
          ref={fileRef}
          id="lr-file"
          className="lr-file-input"
          type="file"
          accept={ACCEPT}
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => void pickPhoto(e.target.files?.[0])}
        />
        {viewing && createPortal(
          <div className="lr-viewer" role="dialog" aria-modal="true" aria-label="Screenshot" onClick={() => setViewing(null)}>
            <img src={viewing} alt="Proof screenshot, full size" />
            <button type="button" className="lr-viewer-close" onClick={() => setViewing(null)} aria-label="Close" autoFocus>✕</button>
          </div>,
          document.body,
        )}
        {photo ? (
          <div className={`lr-photo${ocrTone ? ` lr-photo-${ocrTone}` : ''}`}>
            <button type="button" className="lr-photo-thumb" onClick={() => setViewing(photo.url)} aria-label="View screenshot full size">
              <img src={photo.url} alt="Selected proof screenshot" />
              <span className="lr-photo-zoom" aria-hidden="true">⤢</span>
            </button>
            <div className="lr-photo-info">
              <span className="lr-photo-name" title={photo.name}>{photo.name}</span>
              <span className="lr-hint">{ocrNote ?? `${fmtBytes(photo.size)} · ready`}</span>
              <div className="lr-photo-actions">
                <button type="button" className="btn-ghost lr-sm" onClick={() => fileRef.current?.click()} disabled={saving}>Change</button>
                <button type="button" className="btn-link lr-sm-link" onClick={clearPhoto} disabled={saving}>Remove</button>
              </div>
            </div>
          </div>
        ) : (
          <div
            className={`lr-drop${dragOver ? ' over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <button
              type="button"
              className="lr-drop-btn"
              onClick={() => fileRef.current?.click()}
              disabled={preparing || saving}
              aria-labelledby="lr-photo-label lr-drop-text"
              aria-describedby="lr-photo-hint"
            >
              <span className="lr-drop-icon"><Icon name="camera" size={22} /></span>
              <span id="lr-drop-text" className="lr-drop-text">{preparing ? 'Preparing photo…' : 'Choose screenshot'}</span>
            </button>
            <span id="lr-photo-hint" className="lr-hint">
              Screenshot of today's run from your app or watch. {FORMATS_LABEL}, up to 15 MB.
            </span>
          </div>
        )}
      </div>

      <div className="lr-field">
        <label htmlFor="lr-km" className="lr-label">Distance</label>
        <div className="lr-km">
          <input
            id="lr-km"
            ref={kmRef}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="next"
            placeholder="0.00"
            value={kmText}
            onChange={onKm}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                hRef.current?.focus();
              }
            }}
            autoFocus
            required
            disabled={saving}
            aria-describedby="lr-km-hint"
          />
          <span aria-hidden="true">km</span>
        </div>
        <span id="lr-km-hint" className="lr-hint">Up to 2 decimals, as shown in your running app.</span>
      </div>

      <fieldset className="lr-field lr-time" disabled={saving}>
        <legend className="lr-label">Moving time</legend>
        <div className="lr-time-row">
          <div className="lr-time-cell">
            <input ref={hRef} id="lr-h" type="text" inputMode="numeric" autoComplete="off" placeholder="0"
              aria-label="Hours" value={time.h} onChange={onTime('h', mRef)} onKeyDown={onTimeKey()} onFocus={(e) => e.target.select()} />
            <span aria-hidden="true">h</span>
          </div>
          <span className="lr-colon" aria-hidden="true">:</span>
          <div className="lr-time-cell">
            <input ref={mRef} id="lr-m" type="text" inputMode="numeric" autoComplete="off" placeholder="00"
              aria-label="Minutes" value={time.m} onChange={onTime('m', sRef)} onKeyDown={onTimeKey(hRef)} onFocus={(e) => e.target.select()}
              aria-invalid={Number(time.m) > 59 || undefined} />
            <span aria-hidden="true">min</span>
          </div>
          <span className="lr-colon" aria-hidden="true">:</span>
          <div className="lr-time-cell">
            <input ref={sRef} id="lr-s" type="text" inputMode="numeric" autoComplete="off" placeholder="00"
              aria-label="Seconds" value={time.s} onChange={onTime('s')} onKeyDown={onTimeKey(mRef)} onFocus={(e) => e.target.select()}
              aria-invalid={Number(time.s) > 59 || undefined} />
            <span aria-hidden="true">sec</span>
          </div>
        </div>
      </fieldset>

      <dl className="lr-live" aria-live="polite">
        <div>
          <dt>Pace</dt>
          <dd>{Number.isFinite(paceSec) ? <>{fmtPaceSec(paceSec)}<small> /km</small></> : <span className="lr-dash">–:–</span>}</dd>
        </div>
        <div>
          <dt>Steps</dt>
          <dd>{steps ? <>{fmtSteps(steps)}</> : <span className="lr-dash">–</span>}</dd>
        </div>
      </dl>

      {willReview && (
        <p className="lr-review" role="status">
          <Icon name="flag" size={18} />
          <span>
            <strong>This run will be reviewed by an admin before it counts.</strong>
            <span className="lr-review-why">
              {tooFar && tooFast
                ? `Over ${REVIEW_DISTANCE_KM} km and faster than 4:30 /km.`
                : tooFar
                  ? `Runs over ${REVIEW_DISTANCE_KM} km are checked by an admin.`
                  : 'Paces faster than 4:30 /km are checked by an admin.'}
            </span>
          </span>
        </p>
      )}

      {error && <p className="alert" role="alert">{error}</p>}
      {ok && (
        <p className={ok.pending ? 'lr-ok-pending' : 'ok'} role="status">
          {ok.text}
        </p>
      )}

      <button className="btn-accent lr-submit" type="submit" disabled={saving || preparing}>
        {saving ? 'Saving…' : 'Save run'}
      </button>
    </form>
  );

  const closed = (
    <section className="card lr-closed reveal" style={{ animationDelay: '60ms' }} aria-labelledby="lr-closed-title">
      <span className="lr-closed-icon"><Icon name={windowState === 'before' ? 'calendar' : 'flag'} size={26} /></span>
      {windowState === 'before' && settings ? (
        <>
          <h2 id="lr-closed-title">Logging opens {fmtDayMonth(settings.event_start)}</h2>
          <p className="muted">
            The event runs {fmtDayMonth(settings.event_start)} – {fmtDayMonth(settings.event_end)}. Come back on the first day to
            log your run. Each run is logged on the day you run it.
          </p>
        </>
      ) : (
        <>
          <h2 id="lr-closed-title">The event has ended</h2>
          <p className="muted">
            Submissions closed after {settings ? fmtDayMonth(settings.event_end) : 'the last day'}. Thanks for running! Results
            appear on the leaderboard once distances are revealed.
          </p>
        </>
      )}
    </section>
  );

  return (
    <div className="page">
      <header className="page-head reveal">
        <div>
          <h1>Log Run</h1>
          <p className="muted">Log today's run with your moving time and a screenshot as proof.</p>
        </div>
      </header>

      {settingsError && (
        <p className="alert" role="alert">Could not load event settings: {settingsError}</p>
      )}

      <div className="lr-layout">
        {windowState === 'loading' ? (
          <section className="card lr-loading" aria-busy="true">
            <p className="muted">Loading…</p>
          </section>
        ) : canSubmit ? (
          form
        ) : (
          closed
        )}

        <section className="card lr-history reveal" style={{ animationDelay: '120ms' }} aria-labelledby="lr-history-title">
          <div className="lr-history-head">
            <h2 id="lr-history-title">My runs</h2>
            {todayCounted > 0 && (
              <span className="lr-today-total">Today {fmtDist(todayCounted)} km</span>
            )}
          </div>
          {listError && <p className="alert" role="alert">{listError}</p>}
          {runs === null && <p className="muted">Loading…</p>}
          {runs && runs.length === 0 && !listError && (
            <p className="muted lr-empty">No runs yet. Your runs will show up here after you save them.</p>
          )}
          {groups.map((g) => (
            <div key={g.day} className="lr-day">
              <h3 className="lr-day-title">{g.day === today ? 'Today' : fmtDayShort(g.day)}</h3>
              <ul className="lr-list">
                {g.runs.map((r) => {
                  const pace = r.duration_sec && r.distance_km > 0 ? r.duration_sec / r.distance_km : NaN;
                  const thumb = r.image_path ? thumbs[r.image_path] : undefined;
                  const canDelete = r.ran_on === today;
                  return (
                    <li key={r.id} className="lr-run">
                      {thumb ? (
                        <button type="button" className="lr-thumb" onClick={() => setViewing(thumb)} aria-label={`View photo of ${fmtDist(r.distance_km)} km run`}>
                          <img src={thumb} alt="" loading="lazy" />
                        </button>
                      ) : (
                        <span className="lr-thumb lr-thumb-empty" aria-hidden="true"><Icon name="camera" size={18} /></span>
                      )}
                      <div className="lr-run-body">
                        <div className="lr-run-top">
                          <strong className="lr-run-km">{fmtDist(r.distance_km)}<small> km</small></strong>
                          <span className={`lr-chip lr-chip-${r.status}`}>{STATUS_LABEL[r.status]}</span>
                        </div>
                        <p className="lr-run-meta">
                          {r.duration_sec ? <span><Icon name="clock" size={14} /> {fmtHms(r.duration_sec)}</span> : null}
                          {Number.isFinite(pace) && <span>{fmtPaceSec(pace)} /km</span>}
                          <span>{fmtSteps(r.steps ?? kmToSteps(r.distance_km))} steps</span>
                        </p>
                        {r.status === 'rejected' && (
                          <p className="lr-run-note lr-note-rejected">{r.review_note || 'Rejected by an admin.'}</p>
                        )}
                        {r.status === 'pending' && <p className="lr-run-note">Waiting for an admin to review.</p>}
                        {r.status === 'counted' && r.review_note && <p className="lr-run-note">{r.review_note}</p>}
                      </div>
                      {canDelete && (
                        <button
                          type="button"
                          className="lr-del"
                          onClick={() => {
                            setDeleteError(null);
                            setConfirmRun(r);
                          }}
                          aria-label={`Delete ${fmtDist(r.distance_km)} km run from today`}
                          title="Delete"
                        >
                          <Icon name="trash" size={18} />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {runs && runs.length > 0 && (
            <p className="lr-hint lr-history-foot">You can delete a run only on the day you logged it.</p>
          )}
        </section>
      </div>

      {confirmRun && (
        <div className="modal-backdrop" onClick={() => !deleting && setConfirmRun(null)}>
          <div className="modal lr-modal" role="dialog" aria-modal="true" aria-labelledby="lr-del-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="lr-del-title">Delete this run?</h2>
            <p className="muted lr-modal-text">
              {fmtDist(confirmRun.distance_km)} km
              {confirmRun.duration_sec ? ` in ${fmtHms(confirmRun.duration_sec)}` : ''} from today will be removed with its photo.
              You can log it again afterwards.
            </p>
            {deleteError && <p className="alert" role="alert">{deleteError}</p>}
            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={() => setConfirmRun(null)} disabled={deleting} autoFocus>
                Cancel
              </button>
              <button type="button" className="btn-ghost lr-danger" onClick={() => void onConfirmDelete()} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
