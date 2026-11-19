import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Run, addRun, deleteRun, listRuns } from '../lib/api';
import { formatLong, toISODate } from '../lib/dates';
import { fmtDuration, fmtKm, fmtPace } from '../lib/format';

export default function Runs() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ ran_on: toISODate(new Date()), distance: '', duration: '', elevation: '', note: '' });

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

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    const distance = Number(form.distance);
    const duration = form.duration.trim() === '' ? null : Number(form.duration);
    const elevation = form.elevation.trim() === '' ? null : Number(form.elevation);
    if (!Number.isFinite(distance) || distance <= 0 || distance > 300) return setError('ระยะทางต้องมากกว่า 0 และไม่เกิน 300 กม.');
    if (duration !== null && (!Number.isFinite(duration) || duration <= 0)) return setError('เวลาต้องมากกว่า 0 นาที');
    if (elevation !== null && (!Number.isInteger(elevation) || elevation < 0)) return setError('ความสูงสะสมต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป');

    setSaving(true);
    try {
      await addRun({
        ran_on: form.ran_on,
        distance_km: distance,
        duration_min: duration,
        elevation_m: elevation,
        note: form.note.trim() || null,
      });
      setForm((f) => ({ ...f, distance: '', duration: '', elevation: '', note: '' }));
      setOk('บันทึกการวิ่งแล้ว');
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(r: Run) {
    if (!window.confirm(`ลบการวิ่งวันที่ ${formatLong(r.ran_on)} (${fmtKm(r.distance_km)} กม.)?`)) return;
    try {
      await deleteRun(r.id);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="page">
      <header className="page-head reveal">
        <div>
          <h1>บันทึกการวิ่ง</h1>
          <p className="muted">กรอกรายละเอียดหลังวิ่งเสร็จ ระยะจะถูกนับในชาเลนจ์ที่คุณเข้าร่วมอยู่</p>
        </div>
      </header>

      <div className="runs-layout">
        <form className="card form reveal" onSubmit={onSubmit} style={{ animationDelay: '60ms' }}>
          <h2>เพิ่มการวิ่ง</h2>
          <label>วันที่วิ่ง
            <input type="date" value={form.ran_on} max={toISODate(new Date())} onChange={set('ran_on')} required />
          </label>
          <label>ระยะทาง (กม.)
            <input type="number" inputMode="decimal" step="0.01" min="0.01" max="300" value={form.distance} onChange={set('distance')} required />
          </label>
          <div className="two">
            <label>เวลา (นาที)
              <input type="number" inputMode="decimal" step="0.1" min="0.1" value={form.duration} onChange={set('duration')} />
            </label>
            <label>ความสูงสะสม (ม.)
              <input type="number" inputMode="numeric" step="1" min="0" value={form.elevation} onChange={set('elevation')} />
            </label>
          </div>
          <label>บันทึกเพิ่มเติม
            <textarea rows={3} maxLength={500} value={form.note} onChange={set('note')} />
          </label>
          {error && <p className="alert" role="alert">{error}</p>}
          {ok && <p className="ok" role="status">{ok}</p>}
          <button className="btn-dark" type="submit" disabled={saving}>{saving ? 'กำลังบันทึก…' : 'บันทึกการวิ่ง'}</button>
        </form>

        <section className="card reveal" style={{ animationDelay: '120ms' }}>
          <h2>ประวัติการวิ่ง</h2>
          {runs === null && <p className="muted">กำลังโหลด…</p>}
          {runs && runs.length === 0 && <p className="muted">ยังไม่มีการวิ่ง กรอกฟอร์มเพื่อบันทึกครั้งแรก</p>}
          <ul className="run-list">
            {(runs ?? []).map((r) => (
              <li key={r.id}>
                <div className="run-main">
                  <strong>{fmtKm(r.distance_km)} กม.</strong>
                  <span className="muted">{formatLong(r.ran_on)}</span>
                </div>
                <div className="run-meta muted small">
                  {r.duration_min != null && <span>{fmtDuration(r.duration_min)} · เพซ {fmtPace(r.duration_min, r.distance_km)} /กม.</span>}
                  {r.elevation_m != null && <span>ขึ้น {r.elevation_m.toLocaleString('th-TH')} ม.</span>}
                </div>
                {r.note && <p className="run-note">{r.note}</p>}
                <button className="btn-link" onClick={() => onDelete(r)} aria-label={`ลบการวิ่งวันที่ ${formatLong(r.ran_on)}`}>ลบ</button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
