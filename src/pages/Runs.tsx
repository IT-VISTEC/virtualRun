import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Run, addRun, deleteRun, listRuns } from '../lib/api';
import { formatLong, toISODate } from '../lib/dates';
import { fmtKm, fmtSteps, kmToSteps, stepsToKm } from '../lib/format';

type Mode = 'km' | 'steps';

export default function Runs() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<Mode>('km');
  const [form, setForm] = useState({ ran_on: toISODate(new Date()), value: '', note: '' });

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

  const num = Number(form.value);
  const hint =
    form.value && Number.isFinite(num) && num > 0
      ? mode === 'km'
        ? `≈ ${fmtSteps(kmToSteps(num))} ก้าว`
        : `≈ ${fmtKm(stepsToKm(num))} กม.`
      : ' ';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    let distance: number;
    let steps: number;
    if (mode === 'km') {
      if (!Number.isFinite(num) || num <= 0 || num > 300) return setError('ระยะทางต้องมากกว่า 0 และไม่เกิน 300 กม.');
      distance = Math.round(num * 100) / 100;
      steps = kmToSteps(distance);
    } else {
      if (!Number.isInteger(num) || num <= 0 || num > 400000) return setError('จำนวนก้าวต้องเป็นจำนวนเต็ม 1 – 400,000');
      steps = num;
      distance = stepsToKm(steps);
      if (distance <= 0) return setError('จำนวนก้าวน้อยเกินไป');
    }

    setSaving(true);
    try {
      await addRun({
        ran_on: form.ran_on,
        distance_km: distance,
        duration_min: null,
        elevation_m: null,
        steps,
        entry_type: mode,
        note: form.note.trim() || null,
      });
      setForm((f) => ({ ...f, value: '', note: '' }));
      setOk('บันทึกแล้ว');
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(r: Run) {
    if (!window.confirm(`ลบรายการวันที่ ${formatLong(r.ran_on)} (${fmtKm(r.distance_km)} กม.)?`)) return;
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
          <p className="muted">เลือกบันทึกเป็น กม. หรือ ก้าว ระยะจะถูกนับในชาเลนจ์ที่คุณเข้าร่วมอยู่</p>
        </div>
      </header>

      <div className="runs-layout">
        <form className="card form reveal" onSubmit={onSubmit} style={{ animationDelay: '60ms' }}>
          <h2>เพิ่มรายการ</h2>
          <div className="seg" role="tablist" aria-label="หน่วยที่บันทึก">
            {(['km', 'steps'] as const).map((m) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m}
                className={mode === m ? 'on' : ''} onClick={() => { setMode(m); setForm((f) => ({ ...f, value: '' })); }}>
                {m === 'km' ? 'กม.' : 'ก้าว'}
              </button>
            ))}
          </div>
          <label>วันที่
            <input type="date" value={form.ran_on} max={toISODate(new Date())} onChange={set('ran_on')} required />
          </label>
          <label>{mode === 'km' ? 'ระยะทาง (กม.)' : 'จำนวนก้าว'}
            <input className="big-input" type="number" inputMode={mode === 'km' ? 'decimal' : 'numeric'}
              step={mode === 'km' ? '0.01' : '1'} min={mode === 'km' ? '0.01' : '1'} max={mode === 'km' ? '300' : '400000'}
              value={form.value} onChange={set('value')} required />
            <span className="muted small">{hint}</span>
          </label>
          <label>บันทึกเพิ่มเติม
            <textarea rows={2} maxLength={500} value={form.note} onChange={set('note')} />
          </label>
          {error && <p className="alert" role="alert">{error}</p>}
          {ok && <p className="ok" role="status">{ok}</p>}
          <button className="btn-accent" type="submit" disabled={saving}>{saving ? 'กำลังบันทึก…' : 'บันทึก'}</button>
        </form>

        <section className="card reveal" style={{ animationDelay: '120ms' }}>
          <h2>ประวัติ</h2>
          {runs === null && <p className="muted">กำลังโหลด…</p>}
          {runs && runs.length === 0 && <p className="muted">ยังไม่มีรายการ กรอกฟอร์มเพื่อบันทึกครั้งแรก</p>}
          <ul className="run-list">
            {(runs ?? []).map((r) => (
              <li key={r.id}>
                <div className="run-main">
                  <strong className={r.entry_type === 'km' ? 'hl' : ''}>{fmtKm(r.distance_km)} กม.</strong>
                  {r.steps != null && <strong className={r.entry_type === 'steps' ? 'hl' : 'dim'}>{fmtSteps(r.steps)} ก้าว</strong>}
                  <span className="muted">{formatLong(r.ran_on)}</span>
                </div>
                {r.note && <p className="run-note">{r.note}</p>}
                <button className="btn-link" onClick={() => onDelete(r)} aria-label={`ลบรายการวันที่ ${formatLong(r.ran_on)}`}>ลบ</button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
