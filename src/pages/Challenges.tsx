import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { ChallengeRow, LeaderRow, getLeaderboard, joinChallenge, leaveChallenge, listChallenges } from '../lib/api';
import { formatShort } from '../lib/dates';
import { fmtKm } from '../lib/format';

function Podium({ row, tall }: { row?: LeaderRow; tall?: boolean }) {
  if (!row) return <div className="podium empty" aria-hidden="true" />;
  return (
    <div className={`podium${tall ? ' first' : ''}`}>
      <div className="podium-avatar"><span>{row.rank}</span></div>
      <div className="podium-name">{row.display_name || 'Runner'}</div>
      <div className="podium-km">{fmtKm(row.total_km)} km</div>
    </div>
  );
}

export default function Challenges() {
  const { user } = useAuth();
  const [list, setList] = useState<ChallengeRow[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [board, setBoard] = useState<LeaderRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const rows = await listChallenges();
      setList(rows);
      setSelected((cur) => cur ?? rows.find((r) => r.joined)?.id ?? rows[0]?.id ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!selected) return setBoard(null);
    let alive = true;
    setBoard(null);
    getLeaderboard(selected)
      .then((b) => alive && setBoard(b))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [selected, list]);

  async function toggle(c: ChallengeRow) {
    if (!user) return;
    setBusyId(c.id);
    setError(null);
    try {
      if (c.joined) await leaveChallenge(c.id, user.id);
      else await joinChallenge(c.id);
      await reload();
      setSelected(c.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const current = list?.find((c) => c.id === selected) ?? null;
  const top = board?.slice(0, 3) ?? [];
  const rest = board?.slice(3) ?? [];

  return (
    <div className="page">
      <header className="page-head reveal">
        <div>
          <h1>Challenges</h1>
          <p className="muted">Join a challenge and your logged runs during its date range will count automatically.</p>
        </div>
      </header>

      {error && <p className="alert" role="alert">Error: {error}</p>}
      {list && list.length === 0 && (
        <p className="muted">No challenges yet — add one in Supabase Dashboard (see <code>supabase/seed.sql</code>).</p>
      )}

      <div className="challenges-layout">
        <div className="challenge-list">
          {(list ?? []).map((c, i) => (
            <article key={c.id} className={`card challenge reveal${c.id === selected ? ' selected' : ''}`}
              style={{ animationDelay: `${60 + i * 60}ms` }}>
              <h2>{c.title}</h2>
              <p className="muted small">{formatShort(c.starts_on)} – {formatShort(c.ends_on)}
                {c.target_km != null && <> · Target {fmtKm(c.target_km)} km</>}</p>
              {c.description && <p>{c.description}</p>}
              <p className="muted small">{c.member_count.toLocaleString('en-US')} joined</p>
              <div className="row-actions">
                <button className={c.joined ? 'btn-ghost' : 'btn-accent'} onClick={() => toggle(c)} disabled={busyId === c.id}>
                  {c.joined ? 'Leave' : 'Join Challenge'}
                </button>
                <button className="btn-ghost" onClick={() => setSelected(c.id)} aria-pressed={c.id === selected}>
                  Leaderboard
                </button>
              </div>
            </article>
          ))}
        </div>

        <section className="card board reveal" style={{ animationDelay: '120ms' }} aria-live="polite">
          <h2>Leaderboard{current ? ` · ${current.title}` : ''}</h2>
          {!current && <p className="muted">Select a challenge to view the leaderboard.</p>}
          {current && board === null && <p className="muted">Loading…</p>}
          {current && board && board.length === 0 && <p className="muted">No participants yet — be the first to join!</p>}
          {board && board.length > 0 && (
            <>
              <div className="podium-row">
                <Podium row={top[1]} />
                <Podium row={top[0]} tall />
                <Podium row={top[2]} />
              </div>
              <ol className="rank-list" start={4}>
                {rest.map((r) => (
                  <li key={r.user_id} className={r.user_id === user?.id ? 'me' : ''}>
                    <span className="rank-no">{r.rank}</span>
                    <span className="rank-avatar" aria-hidden="true" />
                    <span className="rank-name">{r.display_name || 'Runner'}{r.user_id === user?.id && ' (You)'}</span>
                    <strong>{fmtKm(r.total_km)} km</strong>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
