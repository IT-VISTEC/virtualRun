import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { ChallengeRow, Run, listChallenges, listRuns } from '../lib/api';
import { formatShort, parseISODate, toISODate, weekStart } from '../lib/dates';
import { fmtKm, fmtSteps } from '../lib/format';

const DAYS = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'];

function WeekBars({ perDay, todayIdx }: { perDay: number[]; todayIdx: number }) {
  const max = Math.max(1, ...perDay);
  const label = perDay.map((v, i) => `${DAYS[i]} ${fmtKm(v)} กม.`).join(', ');
  return (
    <svg viewBox="0 0 280 130" className="weekbars" role="img" aria-label={`ระยะทางรายวันสัปดาห์นี้: ${label}`}>
      <line x1="0" y1="96" x2="280" y2="96" stroke="var(--line)" strokeWidth="2" />
      {perDay.map((v, i) => {
        const h = v > 0 ? Math.max(6, (v / max) * 84) : 3;
        return (
          <g key={i}>
            <rect x={i * 40 + 6} y={96 - h} width="28" height={h} rx="8"
              fill={v === 0 ? 'var(--tile-mid)' : i === todayIdx ? 'var(--accent)' : 'var(--bar)'} />
            <text x={i * 40 + 20} y="118" textAnchor="middle" fontSize="13" fill="var(--muted)"
              fontWeight={i === todayIdx ? 700 : 400}>{DAYS[i]}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default function Home() {
  const { profile, user } = useAuth();
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [challenges, setChallenges] = useState<ChallengeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([listRuns(), listChallenges()])
      .then(([r, c]) => {
        if (!alive) return;
        setRuns(r);
        setChallenges(c);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  const m365Name = (user?.user_metadata?.full_name as string) || (user?.user_metadata?.name as string) || '';
  const displayName = profile?.display_name || m365Name || user?.email || '';
  const first = displayName.split(' ')[0] || 'นักวิ่ง';
  const start = toISODate(weekStart());
  const weekRuns = (runs ?? []).filter((r) => r.ran_on >= start);
  const perDay = Array<number>(7).fill(0);
  for (const r of weekRuns) perDay[(parseISODate(r.ran_on).getDay() + 6) % 7] += r.distance_km;
  const weekKm = perDay.reduce((a, b) => a + b, 0);
  const weekSteps = weekRuns.reduce((a, r) => a + (r.steps ?? 0), 0);
  const active: 'km' | 'steps' = runs && runs.length > 0 ? runs[0].entry_type : 'km';
  const totalKm = (runs ?? []).reduce((a, r) => a + r.distance_km, 0);
  const goalPct = Math.min(100, (totalKm / 5) * 100);
  const todayIdx = (new Date().getDay() + 6) % 7;

  return (
    <div className="page">
      <header className="page-head reveal">
        <div>
          <h1>สวัสดี {first}!</h1>
          <p className="muted">วันนี้วิ่งกันไหม</p>
        </div>
        <Link to="/runs" className="btn-accent">บันทึกการวิ่ง</Link>
      </header>

      {error && <p className="alert" role="alert">โหลดข้อมูลไม่สำเร็จ: {error}</p>}

      <div className="home-grid">
        <div className="metrics">
          <section className={`metric metric-km ${active === 'km' ? 'hot' : ''} reveal`} style={{ animationDelay: '80ms' }}
            aria-label="ระยะทางสัปดาห์นี้">
            <div className="metric-top">
              <span>ระยะทางสัปดาห์นี้</span>
              {active === 'km' && <span className="pill">อัปเดตล่าสุด</span>}
            </div>
            <div className="metric-big">{fmtKm(weekKm)}<small>กม.</small></div>
            <span className="metric-sub">เริ่มวันจันทร์ที่ {formatShort(start)}</span>
          </section>
          <section className={`metric metric-steps ${active === 'steps' ? 'hot' : ''} reveal`} style={{ animationDelay: '140ms' }}
            aria-label="ก้าวสัปดาห์นี้">
            <div className="metric-top">
              <span>ก้าวสัปดาห์นี้</span>
              {active === 'steps' && <span className="pill">อัปเดตล่าสุด</span>}
            </div>
            <div className="metric-mid">{fmtSteps(weekSteps)}<small>ก้าว</small></div>
          </section>
          <section className="card reveal" style={{ animationDelay: '200ms' }}>
            <h2>รายวัน (กม.)</h2>
            <WeekBars perDay={perDay} todayIdx={todayIdx} />
            {runs && runs.length === 0 && (
              <p className="muted">ยังไม่มีรายการ <Link to="/runs">บันทึกครั้งแรก</Link></p>
            )}
          </section>
        </div>

        <section className="goal reveal" style={{ animationDelay: '160ms' }} aria-label="เป้าหมายแรก">
          <svg width="44" height="48" viewBox="0 0 40 44" aria-hidden="true">
            <polygon points="20,2 37,11 37,33 20,42 3,33 3,11" fill="#111" stroke="var(--accent)" strokeWidth="2.5" />
            <text x="20" y="27" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff">5K</text>
          </svg>
          <div className="goal-text">
            <strong>{totalKm >= 5 ? 'ทำเป้าหมายแรกสำเร็จแล้ว' : 'เป้าหมายแรก: วิ่งให้ครบ 5 กม.'}</strong>
            <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={5}
              aria-valuenow={Math.min(5, Number(totalKm.toFixed(1)))}>
              <span style={{ width: `${goalPct}%` }} />
            </div>
            <span className="small on-dark">สะสมแล้ว {fmtKm(Math.min(totalKm, 5))} จาก 5.0 กม.</span>
          </div>
        </section>
      </div>

      <div className="section-head reveal" style={{ animationDelay: '240ms' }}>
        <h2>ชาเลนจ์สำหรับคุณ</h2>
        <Link to="/challenges" className="link-quiet">ดูทั้งหมด</Link>
      </div>

      {challenges && challenges.length === 0 && (
        <p className="muted">ยังไม่มีชาเลนจ์ในระบบ</p>
      )}
      <div className="event-grid">
        {(challenges ?? []).slice(0, 4).map((c, i) => (
          <Link key={c.id} to="/challenges" className={`event ${i % 2 ? 'event-b' : 'event-a'} reveal`}
            style={{ animationDelay: `${300 + i * 70}ms` }}>
            <svg viewBox="0 0 120 100" className="event-route" aria-hidden="true">
              <path d={i % 2 ? 'M10 20 C35 25 30 60 55 58 S80 30 95 55 S104 80 112 92' : 'M10 90 C30 80 20 50 45 48 S70 70 85 40 S100 20 112 8'}
                fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <div>
              <h3>{c.title}</h3>
              <p>{formatShort(c.starts_on)} – {formatShort(c.ends_on)}</p>
            </div>
            <div className="event-foot">
              {c.target_km != null ? <strong>{fmtKm(c.target_km)} <span>กม.</span></strong> : <span />}
              <span className="chip">{c.joined ? 'เข้าร่วมแล้ว' : `${c.member_count.toLocaleString('th-TH')} คน`}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
