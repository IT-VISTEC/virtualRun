import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { chibiUrl, detectChibi, getDefaultAvatar } from '../lib/avatars';
import { AppSettings, Run, Summary, bkkToday, getAppSettings, listRuns, mySummary } from '../lib/api';
import { bangkokToday, dateRange, formatShort, parseISODate, toISODate } from '../lib/dates';
import { fmtKm, fmtSteps, kmToSteps } from '../lib/format';
import { Icon, IconName } from '../components/Icons';
import './Home.css';

// ───────── helpers ─────────

const round2 = (n: number) => Math.round(n * 100) / 100;

function nextDay(iso: string): string {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + 1);
  return toISODate(d);
}

/** "1–15 Dec" (or "28 Nov – 5 Dec" across months). */
function windowLabel(start: string, end: string): string {
  const a = parseISODate(start);
  const b = parseISODate(end);
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${formatShort(end)}`;
  return `${formatShort(start)} – ${formatShort(end)}`;
}

function lockLabel(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

// ───────── achievements (client-side, from own counted runs in the event window) ─────────

type BadgeKind = 'distance' | 'days' | 'streak';
type Badge = {
  key: string;
  kind: BadgeKind;
  mark: string; // short text inside the hexagon
  title: string;
  reachedOn: string | null;
  progress: string; // shown while locked
  pct: number; // 0..100
};

const DISTANCE_GOALS: { km: number; mark: string; title: string }[] = [
  { km: 5, mark: '5K', title: '5 km' },
  { km: 10, mark: '10K', title: '10 km' },
  { km: 21.1, mark: '21.1', title: 'Half marathon' },
  { km: 42.2, mark: '42.2', title: 'Marathon' },
  { km: 60, mark: '60K', title: '60 km' },
];
const DAY_GOALS = [1, 3, 5, 10, 15];
const STREAK_GOALS = [3, 7];

type Stats = {
  perDay: Map<string, number>;
  badges: Badge[];
  currentStreak: number;
};

function computeStats(runs: Run[], start: string, end: string, today: string): Stats {
  const perDay = new Map<string, number>();
  for (const r of runs) {
    if (r.status !== 'counted' || r.ran_on < start || r.ran_on > end) continue;
    perDay.set(r.ran_on, (perDay.get(r.ran_on) ?? 0) + r.distance_km);
  }
  const days = Array.from(perDay.keys()).filter((d) => (perDay.get(d) ?? 0) > 0).sort();

  // Distance: date the running total first reached each goal.
  const distReached = new Map<number, string>();
  let cum = 0;
  for (const d of days) {
    cum = round2(cum + (perDay.get(d) ?? 0));
    for (const g of DISTANCE_GOALS) if (!distReached.has(g.km) && cum >= g.km) distReached.set(g.km, d);
  }

  // Streaks: date a run of consecutive active days first hit each length.
  const streakReached = new Map<number, string>();
  let streak = 0;
  let best = 0;
  let prev: string | null = null;
  for (const d of days) {
    streak = prev && nextDay(prev) === d ? streak + 1 : 1;
    best = Math.max(best, streak);
    for (const g of STREAK_GOALS) if (!streakReached.has(g) && streak >= g) streakReached.set(g, d);
    prev = d;
  }
  // Current streak: still alive if the last active day is today or yesterday.
  const alive = prev != null && (prev === today || nextDay(prev) === today);
  const currentStreak = alive ? streak : 0;

  const badges: Badge[] = [
    ...DISTANCE_GOALS.map((g) => ({
      key: `km-${g.km}`,
      kind: 'distance' as const,
      mark: g.mark,
      title: g.title,
      reachedOn: distReached.get(g.km) ?? null,
      progress: `${fmtKm(Math.min(cum, g.km))} / ${g.km % 1 ? g.km : g.km.toFixed(0)} km`,
      pct: Math.min(100, (cum / g.km) * 100),
    })),
    ...DAY_GOALS.map((n) => ({
      key: `days-${n}`,
      kind: 'days' as const,
      mark: String(n),
      title: n === 1 ? 'First run' : `${n} active days`,
      reachedOn: days.length >= n ? days[n - 1] : null,
      progress: `${Math.min(days.length, n)} / ${n} ${n === 1 ? 'day' : 'days'}`,
      pct: Math.min(100, (days.length / n) * 100),
    })),
    ...STREAK_GOALS.map((n) => ({
      key: `streak-${n}`,
      kind: 'streak' as const,
      mark: String(n),
      title: `${n}-day streak`,
      reachedOn: streakReached.get(n) ?? null,
      progress: `Best ${Math.min(best, n)} / ${n} days`,
      pct: Math.min(100, (best / n) * 100),
    })),
  ];
  return { perDay, badges, currentStreak };
}

// ───────── pieces ─────────

function useCountdown(targetMs: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (targetMs == null) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [targetMs]);
  const left = Math.max(0, (targetMs ?? now) - now);
  const s = Math.floor(left / 1000);
  return { days: Math.floor(s / 86400), hours: Math.floor((s % 86400) / 3600), mins: Math.floor((s % 3600) / 60), secs: s % 60 };
}

function DailyChart({ dates, perDay, today }: { dates: string[]; perDay: Map<string, number>; today: string }) {
  const max = Math.max(1, ...dates.map((d) => perDay.get(d) ?? 0));
  const active = dates.filter((d) => (perDay.get(d) ?? 0) > 0);
  return (
    <>
      <div
        className={`home-chart${dates.length <= 10 ? ' few' : ''}`}
        aria-hidden="true"
        style={{ ['--home-cols' as string]: dates.length }}
      >
        {dates.map((d) => {
          const v = round2(perDay.get(d) ?? 0);
          const future = d > today;
          const pct = Math.max(5, (v / max) * 100);
          const cls = ['home-col', d === today ? 'today' : '', future ? 'future' : '', v > 0 ? 'has' : ''].join(' ');
          return (
            <div key={d} className={cls}>
              <div className="home-col-track">
                <div className="home-col-fill" style={v > 0 ? { height: `${pct}%` } : undefined} />
                {v > 0 && <span className="home-col-val" style={{ bottom: `${pct}%` }}>{fmtKm(v)}</span>}
                <span className="home-tip">
                  {formatShort(d)}: {v > 0 ? `${fmtKm(v)} km` : future ? '—' : 'rest day'}
                </span>
              </div>
              <span className="home-col-day">{parseISODate(d).getDate()}</span>
            </div>
          );
        })}
      </div>
      <table className="sr-only-home">
        <caption>Counted distance per day</caption>
        <thead>
          <tr><th scope="col">Date</th><th scope="col">Distance (km)</th></tr>
        </thead>
        <tbody>
          {(active.length ? active : []).map((d) => (
            <tr key={d}><td>{formatShort(d)}</td><td>{fmtKm(perDay.get(d) ?? 0)}</td></tr>
          ))}
          {active.length === 0 && <tr><td colSpan={2}>No counted runs yet</td></tr>}
        </tbody>
      </table>
    </>
  );
}

const KIND_META: Record<BadgeKind, { heading: string; icon: IconName }> = {
  distance: { heading: 'Distance', icon: 'flag' },
  days: { heading: 'Active days', icon: 'calendar' },
  streak: { heading: 'Streaks', icon: 'flame' },
};

function BadgeHex({ badge }: { badge: Badge }) {
  const on = badge.reachedOn != null;
  const long = badge.mark.length > 3;
  return (
    <svg className="home-hex" width="52" height="58" viewBox="0 0 40 44" aria-hidden="true" focusable="false">
      <polygon points="20,2 37,11 37,33 20,42 3,33 3,11" className={on ? 'hex-on' : 'hex-off'} />
      {badge.kind === 'streak' ? (
        <>
          <g transform="translate(13 9) scale(.58)" className="hex-glyph">
            <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
          </g>
          <text x="20" y="34" textAnchor="middle" className="hex-text" fontSize="10">{badge.mark}</text>
        </>
      ) : (
        <text x="20" y={badge.kind === 'days' ? 25 : 26.5} textAnchor="middle" className="hex-text" fontSize={long ? 10.5 : 13}>
          {badge.mark}
          {badge.kind === 'days' && <tspan x="20" dy="8" fontSize="6.5" className="hex-sub">{badge.mark === '1' ? 'DAY' : 'DAYS'}</tspan>}
        </text>
      )}
    </svg>
  );
}

function Achievements({ badges, preEvent }: { badges: Badge[]; preEvent: boolean }) {
  const unlocked = badges.filter((b) => b.reachedOn).length;
  return (
    <section className="card home-ach reveal" style={{ animationDelay: '260ms' }} aria-labelledby="home-ach-h">
      {/* shared gradient for unlocked hexes */}
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="hex-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ff9a52" />
            <stop offset="1" stopColor="#e2560f" />
          </linearGradient>
        </defs>
      </svg>
      <div className="card-head">
        <h2 id="home-ach-h">{preEvent ? 'Badges to earn' : 'Achievements'}</h2>
        <span className="home-count">{unlocked} / {badges.length} unlocked</span>
      </div>
      <div className="home-ach-total" aria-hidden="true">
        <span style={{ width: `${badges.length ? (unlocked / badges.length) * 100 : 0}%` }} />
      </div>
      {(['distance', 'days', 'streak'] as BadgeKind[]).map((kind) => (
        <div key={kind} className="home-ach-group">
          <h3 className="home-ach-h3"><Icon name={KIND_META[kind].icon} size={16} /> {KIND_META[kind].heading}</h3>
          <ul className="home-badges">
            {badges.filter((b) => b.kind === kind).map((b, _i, group) => (
              <li key={b.key}
                className={`home-badge${b.reachedOn ? ' on' : ''}${!preEvent && group.find((x) => !x.reachedOn) === b ? ' next' : ''}`}
                aria-label={`${b.title}: ${b.reachedOn ? `unlocked ${formatShort(b.reachedOn)}` : `locked, ${b.progress}`}`}>
                <BadgeHex badge={b} />
                <div className="home-badge-text">
                  <strong>{b.title}</strong>
                  {b.reachedOn ? (
                    <span className="home-badge-date"><Icon name="check" size={13} strokeWidth={3} /> {formatShort(b.reachedOn)}</span>
                  ) : (
                    <>
                      {!preEvent && group.find((x) => !x.reachedOn) === b && <span className="home-badge-next">Next up</span>}
                      <span className="home-badge-prog">{b.progress}</span>
                      <span className="home-badge-bar"><span style={{ width: `${b.pct}%` }} /></span>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

// ───────── page ─────────

export default function Home() {
  const { profile, user } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [today, setToday] = useState<string>(() => bangkokToday());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      mySummary(),
      getAppSettings(),
      listRuns(),
      bkkToday().catch(() => bangkokToday()),
    ])
      .then(([s, st, r, t]) => {
        if (!alive) return;
        setSummary(s);
        setSettings(st);
        setRuns(r);
        if (t) setToday(String(t).slice(0, 10));
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  const m365Name = (user?.user_metadata?.full_name as string) || (user?.user_metadata?.name as string) || '';
  const displayName = profile?.display_name || m365Name || user?.email || '';
  const first = displayName.split(' ')[0] || 'Runner';

  const start = settings?.event_start ?? '2026-12-01';
  const end = settings?.event_end ?? '2026-12-15';
  // Transparent chibi cut-out when we know the preset; otherwise the stored (opaque) avatar.
  const storedAvatar = profile?.avatar_url || getDefaultAvatar(user?.id || displayName);
  const [detected, setDetected] = useState<string | null>(null);
  useEffect(() => {
    // Older avatars were saved as one composed picture; recognise the chibi so we can show the cut-out.
    if (profile?.avatar_chibi) return;
    let alive = true;
    detectChibi(storedAvatar).then((id) => alive && setDetected(id));
    return () => { alive = false; };
  }, [storedAvatar, profile?.avatar_chibi]);
  const chibiId = profile?.avatar_chibi || detected;
  const heroAvatar = chibiId ? chibiUrl(chibiId) : storedAvatar;
  const phase: 'pre' | 'live' | 'post' = today < start ? 'pre' : today > end ? 'post' : 'live';
  const dates = useMemo(() => dateRange(start, end), [start, end]);
  const dayNo = dates.indexOf(today) + 1;

  const stats = useMemo(() => computeStats(runs ?? [], start, end, today), [runs, start, end, today]);
  const startMs = settings ? new Date(`${start}T00:00:00+07:00`).getTime() : null;
  const cd = useCountdown(phase === 'pre' ? startMs : null);

function useCountUp(target: number, enabled: boolean, durationMs = 700) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!enabled || target <= 0) {
      setValue(0);
      return;
    }

    let rafId = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(target * eased);
      if (progress < 1) {
        rafId = requestAnimationFrame(tick);
      }
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [target, enabled, durationMs]);

  return value;
}

  const loading = !error && (!summary || !settings || !runs);
  const totalKm = summary?.total_km ?? 0;
  const todayKm = phase === 'live' ? summary?.today_km ?? 0 : 0;
  const totalStepsTarget = summary?.steps ?? kmToSteps(totalKm);
  const activeDaysTarget = summary?.active_days ?? 0;
  const todayStepsTarget = kmToSteps(todayKm);
  const animTotalKm = useCountUp(totalKm, !loading);
  const animTodayKm = useCountUp(todayKm, !loading);
  const animTotalSteps = Math.round(useCountUp(totalStepsTarget, !loading));
  const animActiveDays = Math.round(useCountUp(activeDaysTarget, !loading));
  const animTodaySteps = Math.round(useCountUp(todayStepsTarget, !loading));
  const pending = summary?.pending_count ?? 0;

  const subtitle =
    phase === 'pre' ? `The virtual run starts ${formatShort(start)}. Get ready!`
      : phase === 'post' ? 'The event has ended. Thanks for running!'
      : `Day ${dayNo} of ${dates.length} · ${windowLabel(start, end)}`;

  return (
    <div className="page home">
      <header className="page-head reveal">
        <div>
          <h1>Hi, {first}!</h1>
          <p className="muted">{loading ? ' ' : subtitle}</p>
        </div>
        {phase === 'live' && <Link to="/log" className="btn-accent home-head-cta">Log Run</Link>}
      </header>

      {error && <p className="alert" role="alert">Failed to load data: {error}</p>}

      {pending > 0 && (
        <div className="home-notice reveal" role="status">
          <Icon name="clock" size={20} />
          <p>
            <strong>{pending} {pending === 1 ? 'run is' : 'runs are'} waiting for admin review.</strong>{' '}
            {pending === 1 ? 'It counts' : 'They count'} toward your total once approved.{' '}
            <Link to="/log">View runs</Link>
          </p>
        </div>
      )}

      {loading ? (
        <div className="home-skeleton" aria-busy="true" aria-label="Loading">
          <div /><div /><div className="wide" />
        </div>
      ) : phase === 'pre' ? (
        <>
          <section
            className="metric metric-km hot home-hero reveal"
            style={{ animationDelay: '80ms' }}
            aria-labelledby="home-cd-h">
            {/* Default chibi = transparent cut-out standing on the card; chosen/uploaded photos (opaque) get a round frame. */}
            <img
              className={`home-hero-avatar ${heroAvatar.includes('/avatars/') ? 'cutout' : 'framed'}`}
              src={heroAvatar}
              alt=""
              width={170}
              height={170}
            />
            <div className="metric-top"><span id="home-cd-h">Event starts {formatShort(start)}</span></div>
            <div className="home-cd" role="timer" aria-label={`${cd.days} days ${cd.hours} hours ${cd.mins} minutes to go`}>
              {[
                [cd.days, 'days'],
                [cd.hours, 'hrs'],
                [cd.mins, 'min'],
                [cd.secs, 'sec'],
              ].map(([v, l]) => (
                <div key={l as string} className="home-cd-cell">
                  <span className="home-cd-num">{String(v).padStart(2, '0')}</span>
                  <span className="home-cd-lbl">{l}</span>
                </div>
              ))}
            </div>
            <span className="metric-sub">{windowLabel(start, end)} · run anywhere, log it here</span>
          </section>

          <section className="card home-ready reveal" style={{ animationDelay: '160ms' }} aria-labelledby="home-ready-h">
            <h2 id="home-ready-h">Before it starts</h2>
            <ul className="home-steps">
              <li>
                <span className={`home-step-ic${profile?.group_id ? ' done' : ''}`}><Icon name={profile?.group_id ? 'check' : 'users'} size={18} /></span>
                <div>
                  <strong>{profile?.group_id ? 'You’re in a group' : 'Join or create a group'}</strong>
                  <span className="muted small">
                    Groups of up to 4. Membership locks {settings ? lockLabel(settings.group_lock_at) : '1 Dec, 00:00'} (Bangkok).{' '}
                    <Link to="/team">{profile?.group_id ? 'See your group' : 'Go to Group & Team'}</Link>
                  </span>
                </div>
              </li>
              <li>
                <span className="home-step-ic"><Icon name="camera" size={18} /></span>
                <div>
                  <strong>Log each run on the day</strong>
                  <span className="muted small">Distance, moving time and a screenshot from your running app. Runs can only be logged for today.</span>
                </div>
              </li>
              <li>
                <span className="home-step-ic"><Icon name="shield" size={18} /></span>
                <div>
                  <strong>Some runs get a quick review</strong>
                  <span className="muted small">Runs faster than 4:30 /km or longer than 20 km count after an admin approves them.</span>
                </div>
              </li>
            </ul>
          </section>

          <Achievements badges={stats.badges} preEvent />
        </>
      ) : (
        <>
          <div className="metrics home-metrics">
            <section className="metric metric-km hot home-hero reveal" style={{ animationDelay: '80ms' }}
              aria-labelledby="home-total-h">
              <img
                className={`home-hero-avatar ${heroAvatar.includes('/avatars/') ? 'cutout' : 'framed'}`}
                src={heroAvatar}
                alt=""
                width={170}
                height={170}
              />
              <div className="metric-top"><span id="home-total-h">Total</span><span className="pill">{windowLabel(start, end)}</span></div>
              <div className="metric-big">{fmtKm(animTotalKm)}<small>km</small></div>
              <span className="metric-sub">{fmtSteps(animTotalSteps)} steps · {animActiveDays} active {activeDaysTarget === 1 ? 'day' : 'days'}</span>
            </section>
            <section className="metric home-today reveal" style={{ animationDelay: '140ms' }} aria-labelledby="home-today-h">
              <div className="metric-top">
                <span id="home-today-h">Today</span>
                {phase === 'live' && <span className="home-date">{formatShort(today)}</span>}
              </div>
              {phase === 'live' ? (
                <>
                  {/* Same layout as Total: figures pinned bottom-left, extras bottom-right */}
                  <div className="home-today-body">
                    <div className="home-today-figs">
                      <div className="metric-mid">{fmtKm(animTodayKm)}<small>km</small></div>
                      <span className="metric-sub">{fmtSteps(animTodaySteps)} steps</span>
                    </div>
                    {(stats.currentStreak >= 2 || todayKm === 0) && (
                      <div className="home-today-foot">
                        {stats.currentStreak >= 2 && (
                          <span className="home-streak"><Icon name="flame" size={16} /> {stats.currentStreak}-day streak</span>
                        )}
                        {todayKm === 0 && <Link to="/log" className="home-link">Log today’s run <Icon name="chevron-right" size={16} /></Link>}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="metric-mid home-ended">Finished</div>
                  <span className="metric-sub">The event ran {windowLabel(start, end)}. See the final standings on the <Link to="/leaderboard">Leaderboard</Link>.</span>
                </>
              )}
            </section>
          </div>

          <section className="card reveal" style={{ animationDelay: '200ms' }} aria-labelledby="home-daily-h">
            <div className="card-head">
              <h2 id="home-daily-h">Daily distance</h2>
              <span className="home-count">km · counted runs</span>
            </div>
            <DailyChart dates={dates} perDay={stats.perDay} today={today} />
            {runs && runs.length === 0 && phase === 'live' && (
              <p className="muted small">No runs yet. <Link to="/log">Log your first run</Link></p>
            )}
          </section>

          <Achievements badges={stats.badges} preEvent={false} />
        </>
      )}
    </div>
  );
}
