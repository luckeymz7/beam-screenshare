import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import type { LiveRoom } from '../../lib/livekit';
import type { EventType, Series } from '../../lib/events';
import { Avatar } from '../Account';
import { Icon } from '../Icon';

type Payment = {
  id: string;
  amount: number;
  fee: number;
  method: string | null;
  event: string;
  at: string;
  name: string | null;
  email: string | null;
};
type Overview = {
  live: LiveRoom[] | null;
  series: Series;
  users: number;
  paying: number;
  mrr: number;
  revenue30: number;
  fees30: number;
  recentPayments: Payment[];
  billing: boolean;
};
type UserRow = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  createdAt: string;
  status: string | null;
  premiumUntil: string | null;
};

const RANGES = [7, 30, 90, 365];
const METRICS: { key: EventType; label: string; per: string }[] = [
  { key: 'room', label: 'Rooms created', per: 'rooms' },
  { key: 'join', label: 'Joins', per: 'joins' },
  { key: 'share', label: 'Shares started', per: 'shares' },
  { key: 'signup', label: 'Sign-ups', per: 'sign-ups' },
  { key: 'premium', label: 'New premium', per: 'subscribers' },
];

const nf = new Intl.NumberFormat('en-US');
const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dayLabel = (d: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
const date = (v: string | number) => new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
const ago = (ms: number) => {
  const m = Math.max(0, Math.floor((Date.now() - ms) / 60_000));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.status === 204 ? (undefined as T) : res.json();
}

export default function AdminApp() {
  const [tab, setTab] = useState<'overview' | 'users' | 'payments'>('overview');
  const [range, setRange] = useState(30);
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');

  const load = () =>
    api<Overview>(`/api/admin/overview?range=${range}`).then(
      (d) => {
        setData(d);
        setError('');
      },
      (e) => setError(e.message),
    );
  // Live numbers: refresh every 10 seconds while the tab is open
  useEffect(() => {
    load();
    const id = setInterval(() => !document.hidden && load(), 10_000);
    return () => clearInterval(id);
  }, [range]);

  const live = data?.live ?? [];
  const people = live.reduce((n, r) => n + r.participants.length, 0);
  const sharing = live.flatMap((r) => r.participants.filter((p) => p.sharing).map((p) => ({ room: r, p })));

  return (
    <div className="admin">
      <header className="adm-head">
        <div>
          <p className="eyebrow">beam</p>
          <h1 className="adm-title">Admin</h1>
        </div>
        <div className="seg" role="tablist">
          {(['overview', 'users', 'payments'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} aria-pressed={tab === t} onClick={() => setTab(t)}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </header>

      {error && <p className="error">Could not load: {error}</p>}
      {!data ? (
        <p className="hint">Loading…</p>
      ) : tab === 'overview' ? (
        <>
          <div className="stats-grid">
            <Stat label="Live rooms" value={data.live ? nf.format(live.length) : '—'} hint={data.live ? undefined : 'LiveKit unreachable'} />
            <Stat label="People in rooms" value={nf.format(people)} />
            <Stat label="Sharing now" value={nf.format(sharing.length)} />
            <Stat label="Accounts" value={nf.format(data.users)} />
            <Stat label="Paying" value={nf.format(data.paying)} hint={data.billing ? undefined : 'AbacatePay not set up'} />
            <Stat label="MRR" value={brl(data.mrr)} />
            <Stat label="Revenue, 30 days" value={brl(data.revenue30)} hint={`${brl(data.fees30)} in fees`} />
          </div>

          <LiveRooms rooms={live} onChange={load} onError={setError} />

          <Activity series={data.series} range={range} onRange={setRange} />
        </>
      ) : tab === 'users' ? (
        <Users onError={setError} />
      ) : (
        <Payments payments={data.recentPayments} />
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

function LiveRooms({ rooms, onChange, onError }: { rooms: LiveRoom[]; onChange: () => void; onError: (m: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const act = (id: string, body: object) =>
    api(`/api/admin/rooms/${id}`, { method: 'POST', body: JSON.stringify(body) }).then(onChange, (e) => onError(e.message));

  return (
    <section className="card">
      <header className="card-head">
        <div>
          <h2 className="card-title">Live now</h2>
          <p className="hint">Every room, public and private. Refreshes every 10 seconds.</p>
        </div>
      </header>
      {rooms.length === 0 ? (
        <p className="hint card-empty">Nobody is live.</p>
      ) : (
        <ul className="live-list">
          {[...rooms]
            .sort((a, b) => b.participants.length - a.participants.length)
            .map((r) => {
              const sharer = r.participants.find((p) => p.sharing);
              return (
                <li key={r.id}>
                  <div className="live-row">
                    <button className="live-main" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                      <span className="live-title">
                        <Icon name={r.visibility === 'public' ? 'globe' : 'lock'} size={12} /> {r.title}
                        {r.approval && <span className="chip">asks first</span>}
                        {r.theme && <span className="swatch-dot" style={{ background: r.theme.accent }} title="themed" />}
                      </span>
                      <span className="live-sub mono">
                        {r.host} · {ago(r.createdAt)} · {r.participants.length} in room
                      </span>
                    </button>
                    <span className={`live-share mono ${sharer ? 'on' : ''}`}>
                      {sharer ? (
                        <>
                          <span className="live-dot" /> {sharer.name} · {sharer.sharing!.width}×{sharer.sharing!.height}
                          {sharer.sharing!.sound ? ' · sound' : ''}
                        </>
                      ) : (
                        'not sharing'
                      )}
                    </span>
                    <a className="btn ghost" href={`/r/${r.id}`} target="_blank" rel="noopener">
                      Open
                    </a>
                    <button
                      className={`btn ${armed === r.id ? 'danger' : 'ghost'}`}
                      onClick={() => (armed === r.id ? act(r.id, { action: 'end' }) : setArmed(r.id))}
                      onBlur={() => setArmed(null)}
                    >
                      {armed === r.id ? 'End for everyone?' : 'End'}
                    </button>
                  </div>
                  {open === r.id && (
                    <ul className="people">
                      {r.participants.map((p) => (
                        <li key={p.identity}>
                          <span>
                            {p.name}
                            {p.role === 'host' && <span className="chip">host</span>}
                            {p.premium && <span className="chip accent">premium</span>}
                            {p.userId ? <span className="chip">account</span> : null}
                          </span>
                          <span className="mono hint">
                            {p.sharing ? `sharing ${p.sharing.width}×${p.sharing.height} · ` : ''}joined {ago(p.joinedAt)} ago
                          </span>
                          <button className="btn ghost" onClick={() => act(r.id, { action: 'remove', identity: p.identity })}>
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
        </ul>
      )}
    </section>
  );
}

function niceMax(max: number) {
  if (max <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s * 4 >= max) ?? pow * 10;
  return step * 4;
}

function Activity({ series, range, onRange }: { series: Series; range: number; onRange: (r: number) => void }) {
  const [metric, setMetric] = useState<EventType>('join');
  const [table, setTable] = useState(false);
  const total = (k: EventType) => series.reduce((n, s) => n + s.counts[k], 0);
  const m = METRICS.find((x) => x.key === metric)!;

  return (
    <section className="card">
      <header className="card-head">
        <div>
          <h2 className="card-title">{m.label} per day</h2>
          <p className="hint">Pick a metric below.</p>
        </div>
        <div className="head-actions">
          <div className="seg" role="group" aria-label="Date range">
            {RANGES.map((d) => (
              <button key={d} aria-pressed={range === d} onClick={() => onRange(d)}>
                {d === 365 ? '12m' : `${d}d`}
              </button>
            ))}
          </div>
          <button className="btn ghost" onClick={() => setTable(!table)}>
            {table ? 'Chart' : 'Table'}
          </button>
        </div>
      </header>
      <div className="metric-tabs">
        {METRICS.map((x) => (
          <button key={x.key} className={`metric ${metric === x.key ? 'active' : ''}`} onClick={() => setMetric(x.key)}>
            <span className="stat-label">{x.label}</span>
            <span className="metric-value">{nf.format(total(x.key))}</span>
          </button>
        ))}
      </div>
      <div className="card-body">
        {table ? <SeriesTable series={series} /> : <AreaChart series={series} metric={metric} per={m.per} />}
      </div>
    </section>
  );
}

function AreaChart({ series, metric, per }: { series: Series; metric: EventType; per: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = 220;
  const pad = { l: 36, r: 8, t: 10, b: 24 };
  const values = series.map((s) => s.counts[metric]);
  const max = niceMax(Math.max(...values, 0));
  const iw = Math.max(1, width - pad.l - pad.r);
  const ih = H - pad.t - pad.b;
  const x = (i: number) => pad.l + (series.length === 1 ? iw / 2 : (i / (series.length - 1)) * iw);
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const area = `${line}L${x(values.length - 1)},${y(0)}L${x(0)},${y(0)}Z`;
  const ticks = [0, 1, 2, 3, 4].map((i) => (max / 4) * i);
  const labelEvery = Math.ceil(series.length / Math.max(2, Math.floor(iw / 80)));

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - r.left - pad.l) / iw;
    setHover(Math.max(0, Math.min(series.length - 1, Math.round(rel * (series.length - 1)))));
  }

  const h = hover !== null ? series[hover] : null;
  return (
    <div className="chart" ref={wrap}>
      <svg width={width} height={H} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={`${per} per day`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} className="grid-line" />
            <text x={pad.l - 8} y={y(t)} className="axis" textAnchor="end" dominantBaseline="middle">
              {nf.format(t)}
            </text>
          </g>
        ))}
        {series.map((s, i) =>
          i % labelEvery === 0 ? (
            <text key={s.day} x={x(i)} y={H - 6} className="axis" textAnchor="middle">
              {dayLabel(s.day)}
            </text>
          ) : null,
        )}
        <path d={area} className="area" />
        <path d={line} className="line" />
        {h && hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} className="crosshair" />
            <circle cx={x(hover)} cy={y(h.counts[metric])} r={4} className="dot" />
          </>
        )}
        <rect x={pad.l} y={pad.t} width={iw} height={ih} fill="transparent" />
      </svg>
      {h && hover !== null && (
        <div className="tooltip" style={{ left: Math.min(width - 160, Math.max(0, x(hover) + 12)), top: 8 }}>
          <span className="tooltip-date">{dayLabel(h.day, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
          {METRICS.map((x) => (
            <span key={x.key} className={x.key === metric ? 'current' : ''}>
              <strong>{nf.format(h.counts[x.key])}</strong> {x.per}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function SeriesTable({ series }: { series: Series }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Day</th>
            {METRICS.map((m) => (
              <th key={m.key} className="num">
                {m.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...series].reverse().map((s) => (
            <tr key={s.day}>
              <td>{dayLabel(s.day, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}</td>
              {METRICS.map((m) => (
                <td key={m.key} className="num">
                  {nf.format(s.counts[m.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Users({ onError }: { onError: (m: string) => void }) {
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const search = (e?: FormEvent) => {
    e?.preventDefault();
    api<{ users: UserRow[] }>(`/api/admin/users?q=${encodeURIComponent(q)}`).then((d) => setUsers(d.users), (err) => onError(err.message));
  };
  useEffect(() => search(), []);
  const grant = (userId: string, days: number) =>
    api('/api/admin/users', { method: 'POST', body: JSON.stringify({ userId, days }) }).then(() => search(), (e) => onError(e.message));

  return (
    <section className="card">
      <header className="card-head">
        <div>
          <h2 className="card-title">Accounts</h2>
          <p className="hint">Newest first. Giving premium by hand is for support, gifts and tests.</p>
        </div>
        <form className="head-actions" onSubmit={search}>
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or email" />
          <button className="btn">Search</button>
        </form>
      </header>
      {!users ? (
        <p className="hint card-empty">Loading…</p>
      ) : users.length === 0 ? (
        <p className="hint card-empty">No accounts yet.</p>
      ) : (
        <div className="table-wrap tall">
          <table className="data-table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Joined</th>
                <th>Plan</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const premium = !!u.premiumUntil && new Date(u.premiumUntil).getTime() > Date.now();
                return (
                  <tr key={u.id}>
                    <td>
                      <span className="person">
                        <Avatar name={u.name} image={u.image} size={24} />
                        <span>
                          {u.name}
                          <span className="hint block">{u.email}</span>
                        </span>
                      </span>
                    </td>
                    <td className="mono">{date(u.createdAt)}</td>
                    <td>
                      {premium ? (
                        <span className="chip accent">
                          {u.status} · until {date(u.premiumUntil!)}
                        </span>
                      ) : (
                        <span className="hint">{u.status === 'pending' ? 'checkout opened' : 'free'}</span>
                      )}
                    </td>
                    <td className="num">
                      {premium && u.status === 'granted' ? (
                        <button className="btn ghost" onClick={() => grant(u.id, 0)}>
                          Remove premium
                        </button>
                      ) : !premium ? (
                        <button className="btn ghost" onClick={() => grant(u.id, 30)}>
                          Give 30 days
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Payments({ payments }: { payments: Payment[] }) {
  return (
    <section className="card">
      <header className="card-head">
        <div>
          <h2 className="card-title">Payments</h2>
          <p className="hint">The last 20, from AbacatePay's webhooks. Refunds show as negative.</p>
        </div>
      </header>
      {payments.length === 0 ? (
        <p className="hint card-empty">No payments yet.</p>
      ) : (
        <div className="table-wrap tall">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Person</th>
                <th>Method</th>
                <th className="num">Amount</th>
                <th className="num">Fee</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{date(p.at)}</td>
                  <td>{p.name ?? p.email ?? '—'}</td>
                  <td>{p.method ?? '—'}</td>
                  <td className={`num ${p.amount < 0 ? 'neg' : ''}`}>{brl(p.amount)}</td>
                  <td className="num">{brl(p.fee)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
