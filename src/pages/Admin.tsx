import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  TEAMS,
  adminDeleteRun,
  adminEditRun,
  adminListGroups,
  adminListRuns,
  adminListUsers,
  adminSetReveal,
  adminSetRunStatus,
  adminSetTeam,
  adminSetUserGroup,
  adminVoidDuplicatePair,
  getAppSettings,
  listAuditLog,
  signedUrls,
  type AdminRun,
  type AdminUser,
  type AppSettings,
  type AuditEntry,
  type RunStatus,
  type Team,
} from '../lib/api';
import { REVIEW_DISTANCE_KM, REVIEW_PACE_SEC, fmtHms, fmtPaceSec, fmtSteps, kmToSteps } from '../lib/format';
import { formatShort } from '../lib/dates';
import { Icon } from '../components/Icons';
import './Admin.css';

// ───────── helpers ─────────

type Tab = 'review' | 'runs' | 'users' | 'settings' | 'audit';
const TABS: { id: Tab; label: string }[] = [
  { id: 'review', label: 'Review' },
  { id: 'runs', label: 'All runs' },
  { id: 'users', label: 'Users' },
  { id: 'settings', label: 'Settings' },
  { id: 'audit', label: 'Audit log' },
];

type Group = { id: string; name: string; member_count: number };
type Toast = { kind: 'ok' | 'error'; text: string; id: number };
type Dialog =
  | { kind: 'reject'; run: AdminRun }
  | { kind: 'edit'; run: AdminRun }
  | { kind: 'void'; run: AdminRun; other: AdminRun }
  | { kind: 'delete'; run: AdminRun }
  | { kind: 'photo'; run: AdminRun }
  | { kind: 'team'; user: AdminUser; team: Team }
  | { kind: 'group'; user: AdminUser; groupId: string | null }
  | { kind: 'reveal'; value: boolean };

const GROUP_MAX = 4;
const URL_TTL_MS = 50 * 60 * 1000; // signed URLs live 1 h; refresh a bit earlier

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const km2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  });
const fmtLongDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
const shortId = (id: string) => id.replace(/^[a-z]+:/i, '').slice(0, 8);

const isDuplicate = (r: AdminRun) => r.flags.includes('duplicate_image');
/** Runs that need an admin: pending, or flagged and not yet looked at. */
const inQueue = (r: AdminRun) =>
  r.status === 'pending' || (r.flags.length > 0 && !r.reviewed_at && r.status !== 'rejected');

function reasons(r: AdminRun): { text: string; tone: 'warn' | 'bad' }[] {
  const out: { text: string; tone: 'warn' | 'bad' }[] = [];
  if (r.distance_km > REVIEW_DISTANCE_KM) out.push({ text: `Over ${REVIEW_DISTANCE_KM} km`, tone: 'warn' });
  if (r.pace_sec_per_km != null && r.pace_sec_per_km < REVIEW_PACE_SEC)
    out.push({ text: `Pace under ${fmtPaceSec(REVIEW_PACE_SEC)} /km`, tone: 'warn' });
  for (const f of r.flags) out.push({ text: f === 'duplicate_image' ? 'Duplicate photo' : f.replace(/_/g, ' '), tone: 'bad' });
  return out;
}

const STATUS_LABEL: Record<RunStatus, string> = { counted: 'Counted', pending: 'Pending', rejected: 'Rejected' };
const STATUS_TONE: Record<RunStatus, string> = { counted: 'adm-ok', pending: 'adm-warn', rejected: 'adm-bad' };

function StatusChip({ status }: { status: RunStatus }) {
  return <span className={`adm-chip ${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>;
}

// ───────── page ─────────

export default function Admin() {
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: Tab = TABS.some((t) => t.id === tabParam) ? (tabParam as Tab) : 'review';
  const setTab = (t: Tab) => setParams(t === 'review' ? {} : { tab: t }, { replace: true });

  const [runs, setRuns] = useState<AdminRun[] | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [auditError, setAuditError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [reloading, setReloading] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const requested = useRef(new Set<string>());
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const showToast = useCallback((kind: Toast['kind'], text: string) => setToast({ kind, text, id: Date.now() }), []);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), toast.kind === 'error' ? 7000 : 3500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const loadRuns = useCallback(async () => setRuns(await adminListRuns()), []);
  const loadUsers = useCallback(async () => {
    const [u, g] = await Promise.all([adminListUsers(), adminListGroups()]);
    setUsers(u);
    setGroups(g);
  }, []);
  const loadSettings = useCallback(async () => setSettings(await getAppSettings()), []);
  const loadAudit = useCallback(async () => {
    setAuditError('');
    try {
      setAudit(await listAuditLog(100));
    } catch (e) {
      setAuditError(msg(e));
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoadError('');
    setReloading(true);
    const results = await Promise.allSettled([loadRuns(), loadUsers(), loadSettings()]);
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) setLoadError(msg(failed.reason));
    setReloading(false);
  }, [loadRuns, loadUsers, loadSettings]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Keep the active tab visible in the horizontally scrolling tab bar (mobile).
  useEffect(() => {
    const el = document.getElementById(`adm-tab-${tab}`);
    const bar = el?.parentElement;
    if (!el || !bar) return;
    const center = () => {
      bar.scrollLeft = el.offsetLeft - (bar.clientWidth - el.offsetWidth) / 2;
    };
    center();
    void document.fonts?.ready.then(center); // widths change once the web font loads
  }, [tab]);

  useEffect(() => {
    if (tab === 'audit' && audit === null && !auditError) void loadAudit();
  }, [tab, audit, auditError, loadAudit]);

  // Signed photo URLs, fetched for what is on screen and refreshed before they expire.
  const ensureUrls = useCallback((paths: (string | null)[]) => {
    const missing = Array.from(new Set(paths.filter((p): p is string => !!p && !requested.current.has(p))));
    if (missing.length === 0) return;
    missing.forEach((p) => requested.current.add(p));
    signedUrls(missing, 3600)
      .then((m) => setUrls((u) => ({ ...u, ...m })))
      .catch(() => missing.forEach((p) => requested.current.delete(p)));
  }, []);
  useEffect(() => {
    const t = window.setInterval(() => {
      requested.current.clear();
      setUrls({});
    }, URL_TTL_MS);
    return () => window.clearInterval(t);
  }, []);

  /** Reload everything a mutation can affect. Audit reloads lazily (now if its tab is open). */
  const refresh = useCallback(async () => {
    setAudit(null);
    setAuditError('');
    await Promise.all([loadRuns(), loadUsers(), loadSettings()]);
  }, [loadRuns, loadUsers, loadSettings]);

  const afterSave = useCallback(
    (text: string) => {
      setDialog(null);
      showToast('ok', text);
      refresh().catch((e) => showToast('error', `Saved, but reloading failed: ${msg(e)}`));
    },
    [refresh, showToast],
  );

  async function approve(run: AdminRun) {
    setBusyId(run.run_id);
    try {
      await adminSetRunStatus(run.run_id, 'counted', null);
      showToast('ok', `Approved ${run.display_name}’s ${km2(run.distance_km)} km`);
      await refresh();
    } catch (e) {
      showToast('error', msg(e));
    } finally {
      setBusyId(null);
    }
  }

  const bySha = useMemo(() => {
    const m = new Map<string, AdminRun[]>();
    for (const r of runs ?? []) {
      if (!r.image_sha256) continue;
      const list = m.get(r.image_sha256);
      if (list) list.push(r);
      else m.set(r.image_sha256, [r]);
    }
    return m;
  }, [runs]);
  const partnersOf = useCallback(
    (r: AdminRun) => (r.image_sha256 ? (bySha.get(r.image_sha256) ?? []).filter((x) => x.run_id !== r.run_id) : []),
    [bySha],
  );

  const queue = useMemo(
    () => (runs ?? []).filter(inQueue).sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [runs],
  );

  const userById = useMemo(() => new Map((users ?? []).map((u) => [u.user_id, u])), [users]);
  const runById = useMemo(() => new Map((runs ?? []).map((r) => [r.run_id, r])), [runs]);
  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);

  const cardHandlers = {
    onPhoto: (run: AdminRun) => setDialog({ kind: 'photo', run }),
    onApprove: approve,
    onReject: (run: AdminRun) => setDialog({ kind: 'reject', run }),
    onEdit: (run: AdminRun) => setDialog({ kind: 'edit', run }),
    onVoid: (run: AdminRun, other: AdminRun) => setDialog({ kind: 'void', run, other }),
    onDelete: (run: AdminRun) => setDialog({ kind: 'delete', run }),
  };

  const loading = runs === null && !loadError;

  return (
    <div className="page adm">
      <header className="page-head reveal">
        <div>
          <h1>Admin console</h1>
          <p className="muted">Review runs, manage users and event settings.</p>
        </div>
        <button type="button" className="btn-ghost adm-reload" onClick={() => void loadAll()} disabled={reloading}>
          <Icon name="refresh" size={18} />
          {reloading ? 'Loading…' : 'Reload'}
        </button>
      </header>

      <div className="adm-tabs reveal" role="tablist" aria-label="Admin sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`adm-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`adm-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={tab === t.id ? 'on' : ''}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              const i = TABS.findIndex((x) => x.id === tab);
              const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
              setTab(next.id);
              document.getElementById(`adm-tab-${next.id}`)?.focus();
            }}
          >
            {t.label}
            {t.id === 'review' && queue.length > 0 && (
              <span className="adm-count" aria-label={`${queue.length} waiting`}>
                {queue.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {loadError && (
        <div className="alert adm-load-error" role="alert">
          <span>Couldn’t load admin data: {loadError}</span>
          <button type="button" className="btn-link" onClick={() => void loadAll()}>
            Try again
          </button>
        </div>
      )}

      <section
        className="adm-panel"
        role="tabpanel"
        id={`adm-panel-${tab}`}
        aria-labelledby={`adm-tab-${tab}`}
        tabIndex={-1}
      >
        {loading ? (
          <div className="card adm-empty">
            <p className="muted">Loading…</p>
          </div>
        ) : tab === 'review' ? (
          <ReviewTab
            queue={queue}
            urls={urls}
            ensureUrls={ensureUrls}
            partnersOf={partnersOf}
            busyId={busyId}
            {...cardHandlers}
          />
        ) : tab === 'runs' ? (
          <RunsTab
            runs={runs ?? []}
            urls={urls}
            ensureUrls={ensureUrls}
            partnersOf={partnersOf}
            busyId={busyId}
            {...cardHandlers}
          />
        ) : tab === 'users' ? (
          <UsersTab
            users={users}
            groups={groups}
            onTeam={(user, team) => setDialog({ kind: 'team', user, team })}
            onGroup={(user, groupId) => setDialog({ kind: 'group', user, groupId })}
          />
        ) : tab === 'settings' ? (
          <SettingsTab settings={settings} onReveal={(value) => setDialog({ kind: 'reveal', value })} />
        ) : (
          <AuditTab
            audit={audit}
            error={auditError}
            onRetry={() => void loadAudit()}
            userById={userById}
            runById={runById}
            groupById={groupById}
          />
        )}
      </section>

      {dialog && (
        <DialogHost
          dialog={dialog}
          urls={urls}
          ensureUrls={ensureUrls}
          groupById={groupById}
          onClose={() => setDialog(null)}
          afterSave={afterSave}
        />
      )}

      {toast && (
        <div
          key={toast.id}
          className={`adm-toast adm-${toast.kind}`}
          role={toast.kind === 'error' ? 'alert' : 'status'}
        >
          <Icon name={toast.kind === 'error' ? 'alert' : 'check'} size={18} />
          <span>{toast.text}</span>
          <button type="button" aria-label="Dismiss message" onClick={() => setToast(null)}>
            <Icon name="x" size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

// ───────── run cards ─────────

type CardHandlers = {
  onPhoto: (run: AdminRun) => void;
  onApprove: (run: AdminRun) => void;
  onReject: (run: AdminRun) => void;
  onEdit: (run: AdminRun) => void;
  onVoid: (run: AdminRun, other: AdminRun) => void;
  onDelete: (run: AdminRun) => void;
};

type ListProps = CardHandlers & {
  urls: Record<string, string>;
  ensureUrls: (paths: (string | null)[]) => void;
  partnersOf: (r: AdminRun) => AdminRun[];
  busyId: string | null;
};

function Photo({ run, url, onOpen, className }: { run: AdminRun; url?: string; onOpen: () => void; className: string }) {
  if (!run.image_path) {
    return (
      <div className={`${className} adm-photo-none`}>
        <span>No photo</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      className={className}
      onClick={onOpen}
      aria-label={`View photo of ${run.display_name}’s run on ${formatShort(run.ran_on)}`}
    >
      {url ? <img src={url} alt="" loading="lazy" /> : <span className="adm-photo-wait">Loading…</span>}
    </button>
  );
}

function RunCard({
  run,
  mode,
  urls,
  partners,
  busy,
  onPhoto,
  onApprove,
  onReject,
  onEdit,
  onVoid,
  onDelete,
}: CardHandlers & {
  run: AdminRun;
  mode: 'review' | 'list';
  urls: Record<string, string>;
  partners: AdminRun[];
  busy: boolean;
}) {
  const url = run.image_path ? urls[run.image_path] : undefined;
  const why = reasons(run);
  const dupPartners = isDuplicate(run) ? partners : partners.filter(isDuplicate);
  return (
    <article className={`adm-run card ${mode === 'list' ? 'compact' : ''}`} aria-busy={busy}>
      <Photo run={run} url={url} onOpen={() => onPhoto(run)} className="adm-photo" />
      <div className="adm-run-body">
        <div className="adm-run-head">
          <div className="adm-who">
            <strong>{run.display_name}</strong>
            {run.team && <span className="team-tag">{run.team}</span>}
          </div>
          <StatusChip status={run.status} />
        </div>
        {mode === 'review' && run.email && <p className="muted small adm-email">{run.email}</p>}

        <dl className="adm-stats">
          <div>
            <dt>Distance</dt>
            <dd>{km2(run.distance_km)} km</dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd>{run.duration_sec != null ? fmtHms(run.duration_sec) : '–'}</dd>
          </div>
          <div>
            <dt>Pace</dt>
            <dd>{run.pace_sec_per_km != null ? `${fmtPaceSec(run.pace_sec_per_km)} /km` : '–'}</dd>
          </div>
          {mode === 'review' && (
            <div>
              <dt>Steps</dt>
              <dd>{fmtSteps(kmToSteps(run.distance_km))}</dd>
            </div>
          )}
        </dl>

        <p className="adm-meta small muted">
          Ran {formatShort(run.ran_on)} · submitted {fmtDateTime(run.created_at)}
          {run.reviewed_at && <> · reviewed {fmtDateTime(run.reviewed_at)}</>}
        </p>

        {why.length > 0 && (
          <ul className="adm-reasons" aria-label="Review reasons">
            {why.map((w) => (
              <li key={w.text} className={`adm-chip adm-${w.tone}`}>
                <Icon name="flag" size={13} />
                {w.text}
              </li>
            ))}
          </ul>
        )}

        {run.review_note && (
          <p className="adm-note small">
            <span className="muted">Note:</span> {run.review_note}
          </p>
        )}
      </div>

      <div className="adm-run-foot">
        {dupPartners.map((p) => (
          <div key={p.run_id} className="adm-dup">
            <Photo run={p} url={p.image_path ? urls[p.image_path] : undefined} onOpen={() => onPhoto(p)} className="adm-dup-photo" />
            <div className="adm-dup-info">
              <span className="small muted">Same photo as</span>
              <span className="adm-dup-who">
                <strong>{p.display_name}</strong>
                {p.team && <span className="team-tag">{p.team}</span>}
                <StatusChip status={p.status} />
              </span>
              <span className="small muted">
                {formatShort(p.ran_on)} · {km2(p.distance_km)} km
                {p.duration_sec != null && <> · {fmtHms(p.duration_sec)}</>}
              </span>
            </div>
            {(run.status !== 'rejected' || p.status !== 'rejected') && (
              <button type="button" className="btn-ghost adm-btn adm-danger" onClick={() => onVoid(run, p)} disabled={busy}>
                Void both
              </button>
            )}
          </div>
        ))}
        {isDuplicate(run) && dupPartners.length === 0 && (
          <p className="small muted">Flagged as duplicate, but the other run is no longer listed (it may have been deleted).</p>
        )}
        <div className="adm-actions">
          {run.status !== 'counted' || inQueue(run) ? (
            <button type="button" className="btn-accent adm-btn" onClick={() => onApprove(run)} disabled={busy}>
              <Icon name="check" size={18} />
              {busy ? 'Saving…' : 'Approve'}
            </button>
          ) : null}
          {run.status !== 'rejected' && (
            <button type="button" className="btn-ghost adm-btn adm-danger" onClick={() => onReject(run)} disabled={busy}>
              <Icon name="x" size={18} />
              Reject
            </button>
          )}
          <button type="button" className="btn-ghost adm-btn" onClick={() => onEdit(run)} disabled={busy}>
            <Icon name="edit" size={16} />
            Edit
          </button>
          {mode === 'list' && (
            <button
              type="button"
              className="btn-ghost adm-btn adm-icon-btn"
              onClick={() => onDelete(run)}
              disabled={busy}
              aria-label={`Delete ${run.display_name}’s run on ${formatShort(run.ran_on)}`}
              title="Delete run"
            >
              <Icon name="trash" size={16} />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function ReviewTab({ queue, urls, ensureUrls, partnersOf, busyId, ...handlers }: ListProps & { queue: AdminRun[] }) {
  useEffect(() => {
    ensureUrls(queue.flatMap((r) => [r.image_path, ...partnersOf(r).map((p) => p.image_path)]));
  }, [queue, partnersOf, ensureUrls]);

  if (queue.length === 0) {
    return (
      <div className="card adm-empty">
        <span className="adm-empty-icon">
          <Icon name="check" size={26} />
        </span>
        <h2>All caught up</h2>
        <p className="muted">No runs are waiting for review.</p>
      </div>
    );
  }
  const pending = queue.filter((r) => r.status === 'pending').length;
  const flagged = queue.length - pending;
  return (
    <div className="adm-list">
      <p className="muted small">
        {queue.length} to review · {pending} pending · {flagged} flagged (counted, not yet checked). Oldest first.
      </p>
      {queue.map((r) => (
        <RunCard
          key={r.run_id}
          run={r}
          mode="review"
          urls={urls}
          partners={partnersOf(r)}
          busy={busyId === r.run_id}
          {...handlers}
        />
      ))}
    </div>
  );
}

type RunFilter = 'all' | RunStatus | 'flagged';
const RUN_FILTERS: { id: RunFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'counted', label: 'Counted' },
  { id: 'pending', label: 'Pending' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'flagged', label: 'Flagged' },
];
const PAGE = 30;

function RunsTab({ runs, urls, ensureUrls, partnersOf, busyId, ...handlers }: ListProps & { runs: AdminRun[] }) {
  const [filter, setFilter] = useState<RunFilter>('all');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);

  const counts = useMemo(() => {
    const c: Record<RunFilter, number> = { all: runs.length, counted: 0, pending: 0, rejected: 0, flagged: 0 };
    for (const r of runs) {
      c[r.status] += 1;
      if (r.flags.length > 0) c.flagged += 1;
    }
    return c;
  }, [runs]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return runs.filter(
      (r) =>
        (filter === 'all' || (filter === 'flagged' ? r.flags.length > 0 : r.status === filter)) &&
        (!needle ||
          r.display_name.toLowerCase().includes(needle) ||
          (r.email ?? '').toLowerCase().includes(needle) ||
          (r.team ?? '').toLowerCase() === needle),
    );
  }, [runs, filter, q]);
  const visible = useMemo(() => filtered.slice(0, limit), [filtered, limit]);

  useEffect(() => {
    ensureUrls(visible.flatMap((r) => [r.image_path, ...partnersOf(r).filter(isDuplicate).map((p) => p.image_path)]));
  }, [visible, partnersOf, ensureUrls]);

  return (
    <div className="adm-list">
      <div className="adm-toolbar">
        <div className="adm-filters" role="group" aria-label="Filter by status">
          {RUN_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              className={filter === f.id ? 'on' : ''}
              onClick={() => {
                setFilter(f.id);
                setLimit(PAGE);
              }}
            >
              {f.label} <span className="adm-filter-n">{counts[f.id]}</span>
            </button>
          ))}
        </div>
        <label className="adm-search">
          <span className="adm-sr">Search runs by name, email or team</span>
          <input
            type="search"
            placeholder="Search name, email or team"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setLimit(PAGE);
            }}
          />
        </label>
      </div>

      <p className="muted small" aria-live="polite">
        Showing {visible.length} of {filtered.length} runs · newest first
      </p>

      {visible.length === 0 ? (
        <div className="card adm-empty">
          <p className="muted">No runs match.</p>
        </div>
      ) : (
        visible.map((r) => (
          <RunCard
            key={r.run_id}
            run={r}
            mode="list"
            urls={urls}
            partners={partnersOf(r)}
            busy={busyId === r.run_id}
            {...handlers}
          />
        ))
      )}

      {filtered.length > visible.length && (
        <button type="button" className="btn-ghost adm-more" onClick={() => setLimit((n) => n + PAGE)}>
          Show {Math.min(PAGE, filtered.length - visible.length)} more
        </button>
      )}
    </div>
  );
}

// ───────── users ─────────

function UsersTab({
  users,
  groups,
  onTeam,
  onGroup,
}: {
  users: AdminUser[] | null;
  groups: Group[];
  onTeam: (u: AdminUser, team: Team) => void;
  onGroup: (u: AdminUser, groupId: string | null) => void;
}) {
  const [q, setQ] = useState('');
  const [team, setTeam] = useState<'all' | 'none' | Team>('all');
  const sortedGroups = useMemo(() => [...groups].sort((a, b) => a.name.localeCompare(b.name)), [groups]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (users ?? []).filter(
      (u) =>
        (team === 'all' || (team === 'none' ? !u.team : u.team === team)) &&
        (!needle ||
          u.display_name.toLowerCase().includes(needle) ||
          (u.email ?? '').toLowerCase().includes(needle) ||
          (u.group_name ?? '').toLowerCase().includes(needle)),
    );
  }, [users, q, team]);

  if (!users) return <div className="card adm-empty"><p className="muted">Loading users…</p></div>;
  const registered = users.filter((u) => u.registered_at).length;

  return (
    <div className="adm-list">
      <div className="adm-toolbar">
        <label className="adm-search">
          <span className="adm-sr">Search users by name, email or group</span>
          <input type="search" placeholder="Search name, email or group" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label className="adm-inline-field">
          <span>Team</span>
          <select className="adm-select" value={team} onChange={(e) => setTeam(e.target.value as typeof team)}>
            <option value="all">All teams</option>
            {TEAMS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
            <option value="none">No team</option>
          </select>
        </label>
      </div>
      <p className="muted small" aria-live="polite">
        {list.length} shown · {users.length} users · {registered} registered. Changes ask for confirmation.
      </p>

      <ul className="adm-users card">
        {list.length === 0 && <li className="muted">No users match.</li>}
        {list.map((u) => {
          const groupKnown = !u.group_id || sortedGroups.some((g) => g.id === u.group_id);
          return (
            <li key={u.user_id} className="adm-user">
              <div className="adm-user-id">
                <div className="adm-who">
                  <strong>{u.display_name}</strong>
                  {u.is_admin && <span className="adm-chip adm-neutral">Admin</span>}
                  {!u.registered_at && <span className="adm-chip adm-warn">Not registered</span>}
                </div>
                {u.email && <span className="muted small adm-email">{u.email}</span>}
                <span className="small adm-user-stats">
                  <span>
                    <strong>{km2(u.counted_km)}</strong> km counted
                  </span>
                  {u.pending_count > 0 && <span className="adm-chip adm-warn">{u.pending_count} pending</span>}
                </span>
              </div>
              <label className="adm-field">
                <span>Team</span>
                <select
                  className="adm-select"
                  value={u.team ?? ''}
                  onChange={(e) => e.target.value && onTeam(u, e.target.value as Team)}
                >
                  {!u.team && <option value="">No team</option>}
                  {TEAMS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="adm-field">
                <span>Group</span>
                <select
                  className="adm-select"
                  value={u.group_id ?? ''}
                  onChange={(e) => onGroup(u, e.target.value || null)}
                >
                  <option value="">No group</option>
                  {!groupKnown && u.group_id && <option value={u.group_id}>{u.group_name ?? 'Current group'}</option>}
                  {sortedGroups.map((g) => (
                    <option key={g.id} value={g.id} disabled={g.id !== u.group_id && g.member_count >= GROUP_MAX}>
                      {g.name} ({g.member_count}/{GROUP_MAX})
                    </option>
                  ))}
                </select>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ───────── settings ─────────

function SettingsTab({ settings, onReveal }: { settings: AppSettings | null; onReveal: (v: boolean) => void }) {
  if (!settings) return <div className="card adm-empty"><p className="muted">Loading settings…</p></div>;
  const locked = Date.now() >= new Date(settings.group_lock_at).getTime();
  const on = settings.reveal_distances;
  return (
    <div className="adm-settings">
      <div className="card">
        <div className="adm-setting">
          <div>
            <h2 id="adm-reveal-label">Reveal distances</h2>
            <p className="muted small" id="adm-reveal-desc">
              {on
                ? 'Everyone can see total km on the leaderboards, and ranks include today’s runs.'
                : 'Leaderboards show ranks only. Ranks use runs up to yesterday, so they update once a day.'}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-labelledby="adm-reveal-label"
            aria-describedby="adm-reveal-desc"
            className={`adm-switch ${on ? 'on' : ''}`}
            onClick={() => onReveal(!on)}
          >
            <span className="adm-switch-knob" />
          </button>
        </div>
        <p className={`adm-chip ${on ? 'adm-ok' : 'adm-neutral'} adm-state`}>{on ? 'Distances visible' : 'Distances hidden'}</p>
      </div>

      <div className="card">
        <h2>Event</h2>
        <dl className="adm-kv">
          <div>
            <dt>Event window</dt>
            <dd>
              {formatShort(settings.event_start)} – {formatShort(settings.event_end)}{' '}
              {settings.event_end.slice(0, 4)}
            </dd>
          </div>
          <div>
            <dt>Group lock</dt>
            <dd>
              {fmtLongDateTime(settings.group_lock_at)} (Bangkok){' '}
              <span className={`adm-chip ${locked ? 'adm-neutral' : 'adm-ok'}`}>
                <Icon name={locked ? 'lock' : 'users'} size={13} />
                {locked ? 'Locked' : 'Open'}
              </span>
            </dd>
          </div>
        </dl>
        <p className="muted small">
          After the lock, members can’t create, join or leave groups. Admins can still move people from the Users tab.
          Dates are changed in the database (app_settings).
        </p>
      </div>
    </div>
  );
}

// ───────── audit log ─────────

const ACTION_LABEL: Record<string, string> = {
  'run.set_status': 'Run status changed',
  'run.edit': 'Run edited',
  'run.void_duplicate_pair': 'Duplicate pair voided',
  'run.delete': 'Run deleted',
  'settings.reveal_distances': 'Reveal distances',
  'profile.set_team': 'Team changed',
  'profile.set_group': 'Group changed',
};
const SKIP_KEYS = new Set(['reviewed_by', 'reviewed_at', 'updated_at']);

type Change = { key: string; from: string; to: string };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function AuditTab({
  audit,
  error,
  onRetry,
  userById,
  runById,
  groupById,
}: {
  audit: AuditEntry[] | null;
  error: string;
  onRetry: () => void;
  userById: Map<string, AdminUser>;
  runById: Map<string, AdminRun>;
  groupById: Map<string, Group>;
}) {
  if (error) {
    return (
      <div className="alert adm-load-error" role="alert">
        <span>Couldn’t load the audit log: {error}</span>
        <button type="button" className="btn-link" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }
  if (!audit) return <div className="card adm-empty"><p className="muted">Loading audit log…</p></div>;
  if (audit.length === 0) return <div className="card adm-empty"><p className="muted">No admin actions yet.</p></div>;

  const fmtVal = (key: string, v: unknown): string => {
    if (v === null || v === undefined) return key === 'group_id' ? 'no group' : '–';
    if (key === 'group_id' && typeof v === 'string') return groupById.get(v)?.name ?? `group ${v.slice(0, 8)}`;
    if (key === 'user_id' && typeof v === 'string') return userById.get(v)?.display_name ?? v.slice(0, 8);
    if (key === 'duration_sec' && typeof v === 'number') return fmtHms(v);
    if (typeof v === 'string') return v.length > 40 ? `${v.slice(0, 37)}…` : v;
    const s = JSON.stringify(v);
    return s.length > 40 ? `${s.slice(0, 37)}…` : s;
  };

  const diff = (before: unknown, after: unknown, prefix = ''): Change[] => {
    if (Array.isArray(before) || Array.isArray(after)) {
      const b = (Array.isArray(before) ? before : []).filter(isObj);
      const a = (Array.isArray(after) ? after : []).filter(isObj);
      return a.flatMap((row) => {
        const prev = b.find((x) => x.id === row.id);
        const r = typeof row.id === 'string' ? runById.get(row.id) : undefined;
        const label = r ? `${r.display_name} ` : typeof row.id === 'string' ? `${row.id.slice(0, 8)} ` : '';
        return diff(prev, row, label);
      });
    }
    if (!isObj(after)) return [];
    const b = isObj(before) ? before : {};
    return Object.keys(after)
      .filter((k) => !SKIP_KEYS.has(k) && JSON.stringify(b[k]) !== JSON.stringify(after[k]))
      .map((k) => ({ key: prefix + k, from: fmtVal(k, b[k]), to: fmtVal(k, after[k]) }));
  };

  const targetLabel = (e: AuditEntry): string => {
    if (!e.target) return e.action.startsWith('settings') ? 'App settings' : '';
    return e.target
      .split(',')
      .map((raw) => {
        const id = raw.replace(/^[a-z]+:/i, '');
        const u = userById.get(id);
        if (u) return u.display_name;
        const r = runById.get(id);
        if (r) return `${r.display_name}’s run, ${formatShort(r.ran_on)} (${km2(r.distance_km)} km)`;
        if (e.action === 'run.delete' && isObj(e.before)) {
          const b = e.before;
          const owner = typeof b.user_id === 'string' ? userById.get(b.user_id)?.display_name : undefined;
          const day = typeof b.ran_on === 'string' ? formatShort(b.ran_on) : '';
          return `${owner ? `${owner}’s run` : 'Run'}${day ? `, ${day}` : ''}${b.distance_km != null ? ` (${km2(Number(b.distance_km))} km)` : ''}`;
        }
        return `#${shortId(raw)}`;
      })
      .join(' + ');
  };

  return (
    <div className="adm-list">
      <p className="muted small">Latest {audit.length} admin actions, newest first. Times in Bangkok.</p>
      <ol className="adm-audit card">
        {audit.map((e) => {
          const changes = diff(e.before, e.after);
          const actor = e.actor ? userById.get(e.actor)?.display_name ?? `#${shortId(e.actor)}` : 'System';
          return (
            <li key={e.id}>
              <div className="adm-audit-head">
                <strong>{ACTION_LABEL[e.action] ?? e.action}</strong>
                <time dateTime={e.at} className="muted small">
                  {fmtLongDateTime(e.at)}
                </time>
              </div>
              <p className="small muted">
                by <span className="adm-ink">{actor}</span>
                {targetLabel(e) && (
                  <>
                    {' '}· <span className="adm-ink">{targetLabel(e)}</span>
                  </>
                )}
              </p>
              {changes.length > 0 && (
                <ul className="adm-diff">
                  {changes.map((c) => (
                    <li key={c.key}>
                      <code>{c.key}</code> <span className="muted">{c.from}</span> → <span>{c.to}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ───────── dialogs ─────────

function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useRef(`adm-dlg-${Math.random().toString(36).slice(2, 8)}`).current;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('[data-autofocus]') ?? el?.querySelector<HTMLElement>('input, textarea, select, button');
    first?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
      } else if (e.key === 'Tab' && el) {
        const items = Array.from(
          el.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, textarea, select'),
        );
        if (items.length === 0) return;
        const firstEl = items[0];
        const lastEl = items[items.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeRef.current()}>
      <div ref={ref} className={`modal adm-modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="adm-modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="adm-close" aria-label="Close" onClick={() => closeRef.current()}>
            <Icon name="x" size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ConfirmDialog({
  title,
  children,
  confirmLabel,
  danger,
  note,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  note?: { label: string; required?: boolean; placeholder?: string };
  onConfirm: (note: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (note?.required && !text.trim()) {
      setErr('Please add a note.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await onConfirm(text.trim() || null);
    } catch (x) {
      setErr(msg(x));
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={() => !busy && onClose()}>
      <form className="adm-form" onSubmit={submit}>
        <div className="adm-confirm-body">{children}</div>
        {note && (
          <label className="adm-field">
            <span>
              {note.label}
              {!note.required && <span className="muted"> (optional)</span>}
            </span>
            <textarea
              rows={3}
              maxLength={300}
              value={text}
              placeholder={note.placeholder}
              onChange={(e) => setText(e.target.value)}
              required={note.required}
              data-autofocus
            />
          </label>
        )}
        {err && (
          <p className="alert" role="alert">
            {err}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy} data-autofocus={note ? undefined : true}>
            Cancel
          </button>
          <button type="submit" className={danger ? 'btn-ghost adm-danger-solid' : 'btn-accent'} disabled={busy}>
            {busy ? 'Saving…' : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RunSummary({ run }: { run: AdminRun }) {
  return (
    <p className="adm-run-sum">
      <strong>{run.display_name}</strong>
      {run.team && <span className="team-tag">{run.team}</span>}
      <span className="muted small">
        {formatShort(run.ran_on)} · {km2(run.distance_km)} km
        {run.duration_sec != null && <> · {fmtHms(run.duration_sec)}</>}
      </span>
    </p>
  );
}

const digits = (v: string) => v.replace(/\D/g, '').slice(0, 3);

function EditRunDialog({
  run,
  onSave,
  onClose,
}: {
  run: AdminRun;
  onSave: (km: number, sec: number, note: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const d = run.duration_sec ?? 0;
  const [km, setKm] = useState(String(run.distance_km));
  const [h, setH] = useState(d ? String(Math.floor(d / 3600)) : '');
  const [m, setM] = useState(d ? String(Math.floor((d % 3600) / 60)).padStart(2, '0') : '');
  const [s, setS] = useState(d ? String(d % 60).padStart(2, '0') : '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const kmNum = Number(km.replace(',', '.'));
  const hh = Number(h || 0);
  const mm = Number(m || 0);
  const ss = Number(s || 0);
  const sec = hh * 3600 + mm * 60 + ss;
  const kmOk = Number.isFinite(kmNum) && kmNum > 0;
  const timeOk = sec > 0 && mm < 60 && ss < 60;
  const changed = kmOk && timeOk && (Math.abs(kmNum - run.distance_km) > 1e-9 || sec !== run.duration_sec);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!kmOk) return setErr('Enter a distance above 0 km.');
    if (!timeOk) return setErr('Enter a moving time above 0 (minutes and seconds under 60).');
    setBusy(true);
    setErr('');
    try {
      await onSave(Math.round(kmNum * 1000) / 1000, sec, note.trim() || null);
    } catch (x) {
      setErr(msg(x));
      setBusy(false);
    }
  }

  return (
    <Modal title="Edit run" onClose={() => !busy && onClose()}>
      <form className="adm-form" onSubmit={submit}>
        <RunSummary run={run} />
        <label className="adm-field">
          <span>Distance (km)</span>
          <input
            inputMode="decimal"
            autoComplete="off"
            value={km}
            onChange={(e) => setKm(e.target.value.replace(/[^\d.,]/g, ''))}
            data-autofocus
          />
        </label>
        <fieldset className="adm-time">
          <legend>Moving time (h : mm : ss)</legend>
          <div className="adm-time-row">
            <input aria-label="Hours" inputMode="numeric" value={h} onChange={(e) => setH(digits(e.target.value))} placeholder="h" />
            <span aria-hidden="true">:</span>
            <input aria-label="Minutes" inputMode="numeric" value={m} onChange={(e) => setM(digits(e.target.value))} placeholder="mm" />
            <span aria-hidden="true">:</span>
            <input aria-label="Seconds" inputMode="numeric" value={s} onChange={(e) => setS(digits(e.target.value))} placeholder="ss" />
          </div>
        </fieldset>
        <p className="small muted" aria-live="polite">
          {kmOk && timeOk ? (
            <>
              New pace <strong className="adm-ink">{fmtPaceSec(sec / kmNum)} /km</strong> · {fmtSteps(kmToSteps(kmNum))} steps
            </>
          ) : (
            'Enter distance and time to see the pace.'
          )}
        </p>
        <label className="adm-field">
          <span>
            Note to runner <span className="muted">(optional)</span>
          </span>
          <textarea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Corrected to match the screenshot" />
        </label>
        <p className="small muted">
          Editing doesn’t change the status (now <strong className="adm-ink">{STATUS_LABEL[run.status]}</strong>).
          {run.status === 'pending' && ' Approve it separately.'}
        </p>
        {err && (
          <p className="alert" role="alert">
            {err}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn-accent" disabled={busy || !changed}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PhotoDialog({
  run,
  url,
  ensureUrls,
  onClose,
}: {
  run: AdminRun;
  url?: string;
  ensureUrls: (p: (string | null)[]) => void;
  onClose: () => void;
}) {
  useEffect(() => ensureUrls([run.image_path]), [run.image_path, ensureUrls]);
  return (
    <Modal title="Run photo" onClose={onClose} wide>
      <RunSummary run={run} />
      <div className="adm-viewer">
        {url ? <img src={url} alt={`Proof screenshot for ${run.display_name}’s run on ${formatShort(run.ran_on)}`} /> : <p className="muted">Loading…</p>}
      </div>
      {url && (
        <a className="btn-link adm-open-full" href={url} target="_blank" rel="noreferrer">
          Open full size in a new tab
        </a>
      )}
    </Modal>
  );
}

function DialogHost({
  dialog,
  urls,
  ensureUrls,
  groupById,
  onClose,
  afterSave,
}: {
  dialog: Dialog;
  urls: Record<string, string>;
  ensureUrls: (p: (string | null)[]) => void;
  groupById: Map<string, Group>;
  onClose: () => void;
  afterSave: (text: string) => void;
}) {
  switch (dialog.kind) {
    case 'photo':
      return (
        <PhotoDialog
          run={dialog.run}
          url={dialog.run.image_path ? urls[dialog.run.image_path] : undefined}
          ensureUrls={ensureUrls}
          onClose={onClose}
        />
      );
    case 'edit': {
      const run = dialog.run;
      return (
        <EditRunDialog
          run={run}
          onClose={onClose}
          onSave={async (km, sec, note) => {
            await adminEditRun(run.run_id, km, sec, note);
            afterSave(`Updated ${run.display_name}’s run to ${km2(km)} km`);
          }}
        />
      );
    }
    case 'reject': {
      const run = dialog.run;
      return (
        <ConfirmDialog
          title="Reject run?"
          confirmLabel="Reject run"
          danger
          note={{ label: 'Reason (shown to the runner)', required: true, placeholder: 'e.g. Screenshot doesn’t match the distance' }}
          onClose={onClose}
          onConfirm={async (note) => {
            await adminSetRunStatus(run.run_id, 'rejected', note);
            afterSave(`Rejected ${run.display_name}’s run`);
          }}
        >
          <RunSummary run={run} />
          <p className="muted small">It won’t count toward any total. You can approve it again later from All runs.</p>
        </ConfirmDialog>
      );
    }
    case 'void': {
      const { run, other } = dialog;
      return (
        <ConfirmDialog
          title="Void both runs?"
          confirmLabel="Void both"
          danger
          note={{ label: 'Note to both runners', placeholder: 'Defaults to “Duplicate image”' }}
          onClose={onClose}
          onConfirm={async (note) => {
            await adminVoidDuplicatePair(run.run_id, other.run_id, note);
            afterSave('Both runs rejected as duplicates');
          }}
        >
          <p className="muted small">These two runs use the same photo. Both will be rejected.</p>
          <RunSummary run={run} />
          <RunSummary run={other} />
        </ConfirmDialog>
      );
    }
    case 'delete': {
      const run = dialog.run;
      return (
        <ConfirmDialog
          title="Delete run permanently?"
          confirmLabel="Delete"
          danger
          note={{ label: 'Reason for the audit log' }}
          onClose={onClose}
          onConfirm={async (note) => {
            await adminDeleteRun(run.run_id, note);
            afterSave(`Deleted ${run.display_name}’s run`);
          }}
        >
          <RunSummary run={run} />
          <p className="muted small">This can’t be undone. To keep a record, reject the run instead.</p>
        </ConfirmDialog>
      );
    }
    case 'team': {
      const { user, team } = dialog;
      return (
        <ConfirmDialog
          title="Change team?"
          confirmLabel={`Move to ${team}`}
          onClose={onClose}
          onConfirm={async () => {
            await adminSetTeam(user.user_id, team);
            afterSave(`${user.display_name} is now in ${team}`);
          }}
        >
          <p>
            Move <strong>{user.display_name}</strong> from <strong>{user.team ?? 'no team'}</strong> to{' '}
            <strong>{team}</strong>?
          </p>
          <p className="muted small">Their distance moves with them in the team ranking. Runners can’t change this themselves.</p>
        </ConfirmDialog>
      );
    }
    case 'group': {
      const { user, groupId } = dialog;
      const from = user.group_name ?? (user.group_id ? 'their group' : null);
      const to = groupId ? groupById.get(groupId)?.name ?? 'the selected group' : null;
      return (
        <ConfirmDialog
          title={to ? 'Move to group?' : 'Remove from group?'}
          confirmLabel={to ? 'Move' : 'Remove'}
          danger={!to}
          onClose={onClose}
          onConfirm={async () => {
            await adminSetUserGroup(user.user_id, groupId);
            afterSave(to ? `${user.display_name} moved to ${to}` : `${user.display_name} removed from ${from ?? 'group'}`);
          }}
        >
          <p>
            {to ? (
              <>
                Move <strong>{user.display_name}</strong>
                {from && (
                  <>
                    {' '}from <strong>{from}</strong>
                  </>
                )}{' '}
                to <strong>{to}</strong>?
              </>
            ) : (
              <>
                Remove <strong>{user.display_name}</strong> from <strong>{from}</strong>?
              </>
            )}
          </p>
          <p className="muted small">
            Works even after the group lock. A group leader must hand over leadership first, and a group left empty is
            disbanded.
          </p>
        </ConfirmDialog>
      );
    }
    case 'reveal': {
      const value = dialog.value;
      return (
        <ConfirmDialog
          title={value ? 'Reveal distances?' : 'Hide distances?'}
          confirmLabel={value ? 'Reveal to everyone' : 'Hide distances'}
          onClose={onClose}
          onConfirm={async () => {
            await adminSetReveal(value);
            afterSave(value ? 'Distances are now visible to everyone' : 'Distances are hidden again');
          }}
        >
          {value ? (
            <p>
              Every participant will see total km on all leaderboards right away, and ranks will include today’s runs.
              Usually done after the event ends.
            </p>
          ) : (
            <p>Leaderboards will show ranks only again, updated once a day.</p>
          )}
        </ConfirmDialog>
      );
    }
  }
}
