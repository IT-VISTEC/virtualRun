import { KeyboardEvent, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import {
  LeaderGroup,
  LeaderIndividual,
  LeaderTeam,
  getAppSettings,
  leaderboardGroups,
  leaderboardIndividual,
  leaderboardTeams,
} from '../lib/api';
import { getDefaultAvatar } from '../lib/avatars';
import { fmtKm } from '../lib/format';
import { Icon } from '../components/Icons';
import './Leaderboard.css';

type Tab = 'individual' | 'group' | 'team';
const TABS: { id: Tab; label: string }[] = [
  { id: 'individual', label: 'Individual' },
  { id: 'group', label: 'Group' },
  { id: 'team', label: 'Team' },
];

type Load<T> = { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; rows: T[] };

const isTab = (v: string | null): v is Tab => v === 'individual' || v === 'group' || v === 'team';
const ordinal = (n: number) => {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
};
const hasKm = (rows: { total_km: number | null }[]) => rows.length > 0 && rows.every((r) => r.total_km != null);
/** Everybody tied on rank 1 => nothing has been counted yet (rows include 0 km). */
const allTied = (rows: { rank: number }[]) => rows.length > 1 && rows.every((r) => r.rank === rows[0].rank);

function useBoard<T>(fetcher: () => Promise<T[]>) {
  const [state, setState] = useState<Load<T>>({ status: 'loading' });
  const load = useCallback(() => {
    let alive = true;
    setState({ status: 'loading' });
    fetcher()
      .then((rows) => alive && setState({ status: 'ready', rows }))
      .catch((e: unknown) => alive && setState({ status: 'error', error: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
  }, [fetcher]);
  useEffect(() => load(), [load]);
  return [state, load] as const;
}

function Avatar({ src, seed, size = 40, className = '' }: { src: string | null; seed: string; size?: number; className?: string }) {
  const fallback = getDefaultAvatar(seed);
  const [url, setUrl] = useState(src || fallback);
  useEffect(() => setUrl(src || fallback), [src, fallback]);
  return (
    <img
      className={`lb-avatar ${className}`}
      src={url}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => url !== fallback && setUrl(fallback)}
    />
  );
}

function Km({ km }: { km: number | null }) {
  if (km == null) return null;
  return (
    <span className="lb-km">
      {fmtKm(km)}
      <small> km</small>
    </span>
  );
}

/** rank null => not ranked yet (everyone tied before any run counts). */
function RankBadge({ rank }: { rank: number | null }) {
  if (rank == null)
    return (
      <span className="lb-rank">
        <span aria-hidden="true">–</span>
        <span className="lb-sr">Not ranked yet</span>
      </span>
    );
  return (
    <span className="lb-rank">
      <span className="lb-sr">Rank </span>
      {rank}
    </span>
  );
}

function MeChip({ label }: { label: string }) {
  return <span className="lb-me">{label}</span>;
}

/* ───────── Individual ───────── */

function IndividualBoard({ rows }: { rows: LeaderIndividual[] }) {
  if (rows.length === 0) return <Empty text="No registered runners yet." />;
  const tied = allTied(rows);
  return (
    <>
      {tied && <Empty text="No runs have been counted yet. Ranks appear after the first day of the event." soft />}
      {(
        <ol className="lb-list" aria-label="All runners">
          {rows.map((r) => (
            <li key={r.user_id} className={`${r.is_me ? 'is-me' : ''}${!tied && r.rank <= 3 ? ' is-top' : ''}`} aria-current={r.is_me ? 'true' : undefined} data-me={r.is_me || undefined}>
              <RankBadge rank={tied ? null : r.rank} />
              <Avatar src={r.avatar_url} seed={r.user_id} />
              <span className="lb-who">
                <span className="lb-name">{r.display_name}</span>
                <span className="lb-sub">
                  {r.team && <span>{r.team}</span>}
                  {r.is_me && <MeChip label="You" />}
                </span>
              </span>
              <Km km={r.total_km} />
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

/* ───────── Groups ───────── */

function GroupBoard({ rows }: { rows: LeaderGroup[] }) {
  if (rows.length === 0)
    return (
      <Empty text="No groups yet.">
        <Link className="btn-ghost" to="/team">
          Create a group
        </Link>
      </Empty>
    );
  const tied = allTied(rows);
  return (
    <>
      {tied && <Empty text="No runs have been counted yet. Ranks appear after the first day of the event." soft />}
      <ol className="lb-list" aria-label="Groups">
        {rows.map((g) => (
          <li
            key={g.group_id}
            className={`${g.is_mine ? 'is-me' : ''}${!tied && g.rank <= 3 ? ' is-top' : ''}`}
            aria-current={g.is_mine ? 'true' : undefined}
            data-me={g.is_mine || undefined}
          >
            <RankBadge rank={tied ? null : g.rank} />
            <Avatar src={g.avatar_url} seed={g.group_id} />
            <span className="lb-who">
              <span className="lb-name">{g.name}</span>
              <span className="lb-sub">
                <span className="lb-members">
                  {g.member_count}/4 members
                </span>
                {g.is_mine && <MeChip label="Your group" />}
              </span>
            </span>
            <Km km={g.total_km} />
          </li>
        ))}
      </ol>
    </>
  );
}

/* ───────── Teams ───────── */

function TeamBoard({ rows }: { rows: LeaderTeam[] }) {
  if (rows.length === 0) return <Empty text="No teams to show." />;
  const tied = allTied(rows);
  const max = Math.max(0, ...rows.map((t) => t.total_km ?? 0));
  return (
    <>
      {tied && <Empty text="No runs have been counted yet. Ranks appear after the first day of the event." soft />}
      <ol className="lb-list lb-teams" aria-label="Teams">
        {rows.map((t) => (
          <li
            key={t.team}
            className={`${t.is_mine ? 'is-me' : ''}${!tied && t.rank <= 3 ? ' is-top' : ''}`}
            aria-current={t.is_mine ? 'true' : undefined}
            data-me={t.is_mine || undefined}
          >
            <RankBadge rank={tied ? null : t.rank} />
            <span className="lb-team-code" aria-hidden="true">
              {t.team}
            </span>
            <span className="lb-who">
              <span className="lb-name">{t.team}</span>
              <span className="lb-sub">
                <span className="lb-members">
                  {t.member_count} {t.member_count === 1 ? 'member' : 'members'}
                </span>
                {t.is_mine && <MeChip label="Your team" />}
              </span>
              {t.total_km != null && max > 0 && (
                <span className="lb-team-bar" aria-hidden="true">
                  <span style={{ width: `${Math.max(2, (t.total_km / max) * 100)}%` }} />
                </span>
              )}
            </span>
            <Km km={t.total_km} />
          </li>
        ))}
      </ol>
    </>
  );
}

/* ───────── Shared bits ───────── */

function Empty({ text, soft, children }: { text: string; soft?: boolean; children?: ReactNode }) {
  return (
    <div className={`lb-empty${soft ? ' soft' : ''}`}>
      <p>{text}</p>
      {children}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="lb-list lb-skeleton" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="lb-skel-row">
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

function MyStanding({
  tab,
  state,
  onJump,
}: {
  tab: Tab;
  state: Load<LeaderIndividual> | Load<LeaderGroup> | Load<LeaderTeam>;
  onJump: () => void;
}) {
  if (state.status !== 'ready') return null;
  const rows = state.rows as Array<{ rank: number; is_me?: boolean; is_mine?: boolean; total_km: number | null }>;
  const mine = rows.find((r) => r.is_me || r.is_mine);
  const tied = allTied(rows);

  if (!mine) {
    if (tab === 'group')
      return (
        <div className="lb-standing">
          <span className="lb-standing-text">You are not in a group yet.</span>
          <Link className="btn-link" to="/team">
            Create or join a group
          </Link>
        </div>
      );
    return null;
  }

  // Nothing counted yet: the board shows its own notice, so skip the standing bar.
  if (tied) return null;

  const what = tab === 'individual' ? 'You are' : tab === 'group' ? 'Your group is' : 'Your team is';
  return (
    <div className="lb-standing">
      <span className="lb-standing-text">
        {what} <strong>{ordinal(mine.rank)}</strong> of {rows.length}
        {mine.total_km != null && <> &middot; {fmtKm(mine.total_km)} km</>}
      </span>
      {rows.length > 6 && (
        <button type="button" className="btn-link" onClick={onJump}>
          Show me
        </button>
      )}
    </div>
  );
}

/* ───────── Page ───────── */

export default function Leaderboard() {
  const { isAdmin } = useAuth();
  const [params, setParams] = useSearchParams();
  const qTab = params.get('tab');
  const tab: Tab = isTab(qTab) ? qTab : 'individual';
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ individual: null, group: null, team: null });
  const panelRef = useRef<HTMLDivElement>(null);

  const [ind, reloadInd] = useBoard(leaderboardIndividual);
  const [grp, reloadGrp] = useBoard(leaderboardGroups);
  const [team, reloadTeam] = useBoard(leaderboardTeams);
  const [revealed, setRevealed] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    getAppSettings()
      .then((s) => alive && setRevealed(!!s.reveal_distances))
      .catch(() => alive && setRevealed(null));
    return () => {
      alive = false;
    };
  }, []);

  const state = tab === 'individual' ? ind : tab === 'group' ? grp : team;
  const reload = tab === 'individual' ? reloadInd : tab === 'group' ? reloadGrp : reloadTeam;

  const setTab = (t: Tab) => {
    const next = new URLSearchParams(params);
    if (t === 'individual') next.delete('tab');
    else next.set('tab', t);
    setParams(next, { replace: true });
  };

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = TABS.findIndex((t) => t.id === tab);
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') n = (i + TABS.length - 1) % TABS.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = TABS.length - 1;
    if (n < 0) return;
    e.preventDefault();
    setTab(TABS[n].id);
    tabRefs.current[TABS[n].id]?.focus();
  };

  const jumpToMe = () => {
    const el = panelRef.current?.querySelector<HTMLElement>('[data-me]');
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
  };

  // Distances visible? (revealed for everyone, or admin preview while still hidden.)
  const shownKm = state.status === 'ready' && hasKm(state.rows as { total_km: number | null }[]);
  const adminPreview = shownKm && isAdmin && revealed === false;

  return (
    <div className="page lb-page">
      <header className="page-head reveal">
        <div>
          <h1>Leaderboard</h1>
          <p className="muted">1–15 Dec</p>
        </div>
      </header>

      <div className="lb-tabs reveal" role="tablist" aria-label="Leaderboard type">
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={(el) => (tabRefs.current[t.id] = el)}
            type="button"
            role="tab"
            id={`lb-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="lb-panel"
            tabIndex={tab === t.id ? 0 : -1}
            className={tab === t.id ? 'on' : undefined}
            onClick={() => setTab(t.id)}
            onKeyDown={onTabKey}
          >
            {t.label}
          </button>
        ))}
      </div>

      {shownKm ? (
        adminPreview ? (
          <p className="lb-note admin">
            <Icon name="shield" size={16} />
            Admin view: distances are shown to admins only. Other runners see ranks only.
          </p>
        ) : null
      ) : (
        <p className="lb-note">
          <Icon name="lock" size={16} />
          Distances stay hidden until the event ends · today's runs join the ranking after midnight
        </p>
      )}

      <div
        id="lb-panel"
        ref={panelRef}
        role="tabpanel"
        aria-labelledby={`lb-tab-${tab}`}
        aria-busy={state.status === 'loading'}
        className="lb-panel"
      >
        {state.status === 'loading' && <Skeleton />}
        {state.status === 'error' && (
          <div className="alert lb-error" role="alert">
            <span>Couldn't load the leaderboard: {state.error}</span>
            <button type="button" className="btn-ghost" onClick={reload}>
              Try again
            </button>
          </div>
        )}
        {state.status === 'ready' && (
          <>
            <MyStanding tab={tab} state={state} onJump={jumpToMe} />
            {tab === 'individual' && <IndividualBoard rows={state.rows as LeaderIndividual[]} />}
            {tab === 'group' && <GroupBoard rows={state.rows as LeaderGroup[]} />}
            {tab === 'team' && <TeamBoard rows={state.rows as LeaderTeam[]} />}
          </>
        )}
      </div>
    </div>
  );
}
