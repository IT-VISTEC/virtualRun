import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { ChallengeRow, Run, listChallenges, listRuns } from '../lib/api';
import { formatShort, parseISODate, toISODate, weekStart } from '../lib/dates';
import { fmtKm, fmtSteps } from '../lib/format';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HERO = `${import.meta.env.BASE_URL}hero.webp`;

function WeekBars({ perDay, todayIdx }: { perDay: number[]; todayIdx: number }) {
  const max = Math.max(1, ...perDay);
  const label = perDay.map((v, i) => `${DAYS[i]} ${fmtKm(v)} km`).join(', ');
  return (
    <div className="bars" role="img" aria-label={`Daily distance this week: ${label}`}>
      {perDay.map((v, i) => (
        <div key={i} className={`bar-col${i === todayIdx ? ' today' : ''}`}>
          <span className="bar-val">{v > 0 ? fmtKm(v) : ''}</span>
          <div className="bar-track">
            <div className={`bar-fill${v === 0 ? ' zero' : ''}`} style={{ height: v > 0 ? `${Math.max(6, (v / max) * 100)}%` : undefined }} />
          </div>
          <span className="bar-day">{DAYS[i]}</span>
        </div>
      ))}
    </div>
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
  const first = displayName.split(' ')[0] || 'Runner';
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
          <h1>Hi, {first}!</h1>
          <p className="muted">Ready for a run today?</p>
        </div>
        <Link to="/runs" className="btn-accent">Log Run</Link>
      </header>

      {error && <p className="alert" role="alert">Failed to load data: {error}</p>}

      <div className="home-grid">
        <div className="metrics">
          <section className={`metric metric-km ${active === 'km' ? 'hot' : ''} reveal`}
            style={{ animationDelay: '80ms', ['--hero' as string]: `url(${HERO})` }}
            aria-label="This week distance">
            <div className="metric-top">
              <span>This Week</span>
              {active === 'km' && <span className="pill">Latest</span>}
            </div>
            <div className="metric-big">{fmtKm(weekKm)}<small>km</small></div>
            <span className="metric-sub">Since Mon {formatShort(start)}</span>
          </section>
          <section className={`metric metric-steps ${active === 'steps' ? 'hot' : ''} reveal`} style={{ animationDelay: '140ms' }}
            aria-label="This week steps">
            <div className="metric-top">
              <span>Weekly Steps</span>
              {active === 'steps' && <span className="pill">Latest</span>}
            </div>
            <div className="metric-mid">{fmtSteps(weekSteps)}<small>steps</small></div>
          </section>
          <section className="card reveal" style={{ animationDelay: '200ms' }}>
            <h2>Daily (km)</h2>
            <WeekBars perDay={perDay} todayIdx={todayIdx} />
            {runs && runs.length === 0 && (
              <p className="muted">No runs yet. <Link to="/runs">Log your first run</Link></p>
            )}
          </section>
        </div>

        <section className="goal reveal" style={{ animationDelay: '160ms' }} aria-label="First milestone">
          <svg width="44" height="48" viewBox="0 0 40 44" aria-hidden="true">
            <polygon points="20,2 37,11 37,33 20,42 3,33 3,11" fill="#111" stroke="var(--accent)" strokeWidth="2.5" />
            <text x="20" y="27" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff">5K</text>
          </svg>
          <div className="goal-text">
            <strong>{totalKm >= 5 ? 'First 5K milestone completed!' : 'First Milestone: Run 5 km'}</strong>
            <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={5}
              aria-valuenow={Math.min(5, Number(totalKm.toFixed(1)))}>
              <span style={{ width: `${goalPct}%` }} />
            </div>
            <span className="small on-dark">{fmtKm(Math.min(totalKm, 5))} of 5.0 km logged</span>
          </div>
        </section>
      </div>

      <div className="section-head reveal" style={{ animationDelay: '240ms' }}>
        <h2>Challenges for You</h2>
        <Link to="/challenges" className="link-quiet">View all</Link>
      </div>

      {challenges && challenges.length === 0 && (
        <p className="muted">No active challenges</p>
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
              {c.target_km != null ? <strong>{fmtKm(c.target_km)} <span>km</span></strong> : <span />}
              <span className="chip">{c.joined ? 'Joined' : `${c.member_count.toLocaleString('en-US')} joined`}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
