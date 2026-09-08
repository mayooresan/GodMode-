import { useEffect, useMemo, useState } from 'react';
import { get } from '../lib/api';
import { OCCUPATIONS } from '../lib/types';
import type { FallenTribe, TribeRow, Vitals } from '../lib/types';
import OccupationBar, { OccupationLegend } from './OccupationBar';
import type { ConnectionState } from '../lib/useSimStream';

type Dir = 'asc' | 'desc';

interface Column {
  key: string;
  label: string;
  /** Short explanation shown on hover. */
  hint?: string;
  numeric: boolean;
  value: (t: TribeRow) => number | string;
  /** Rendered cell; falls back to the raw value. */
  render?: (t: TribeRow) => React.ReactNode;
  /** Draw a proportional bar behind the number, scaled across visible rows. */
  bar?: boolean;
}

const int = (n: number) => n.toLocaleString();

/**
 * Every column the engine exposes.
 *
 * Derived per-head figures are first-class rather than left to the reader:
 * comparing tribes of different sizes by absolute food is misleading, and
 * "food per head" is the number that actually predicts a famine.
 */
const COLUMNS: Column[] = [
  {
    key: 'name', label: 'Tribe', numeric: false, value: (t) => t.name,
    render: (t) => (
      <span className="flex items-center gap-2">
        <span className="inline-block h-3 w-3 shrink-0 rounded-sm ring-1 ring-black/40" style={{ background: t.color }} />
        <span aria-hidden>{t.glyph}</span>
        <span className="whitespace-nowrap text-ink-primary">{t.name}</span>
      </span>
    ),
  },
  { key: 'population', label: 'Pop', hint: 'Living members', numeric: true, value: (t) => t.population, bar: true },
  { key: 'infants', label: 'Young', hint: 'Under 14 years', numeric: true, value: (t) => t.infants },
  { key: 'adults', label: 'Adults', hint: '14 to 45 years', numeric: true, value: (t) => t.adults },
  { key: 'elders', label: 'Elders', hint: 'Over 45 years', numeric: true, value: (t) => t.elders },
  { key: 'territory', label: 'Territory', hint: 'Tiles claimed', numeric: true, value: (t) => t.territory, bar: true },
  {
    key: 'landPerHead', label: 'Land/head', hint: 'Tiles claimed per living member', numeric: true,
    value: (t) => (t.population ? t.territory / t.population : 0),
    render: (t) => (t.population ? (t.territory / t.population).toFixed(1) : '—'),
  },
  { key: 'food', label: 'Food', hint: 'Communal store', numeric: true, value: (t) => t.food, bar: true },
  {
    key: 'foodPerHead', label: 'Food/head', hint: 'Store divided by population — the famine predictor', numeric: true,
    value: (t) => (t.population ? t.food / t.population : 0),
    render: (t) => (t.population ? (t.food / t.population).toFixed(1) : '—'),
  },
  { key: 'tools', label: 'Tools', hint: 'Crafted tool stock', numeric: true, value: (t) => t.tools },
  { key: 'techs', label: 'Techs', hint: 'Technologies unlocked, of 5', numeric: true, value: (t) => t.techs.length,
    render: (t) => <span className={t.techs.length === 5 ? 'text-good' : ''}>{t.techs.length}/5</span> },
  { key: 'morale', label: 'Morale', hint: 'Mean member morale, 0-100', numeric: true, value: (t) => t.morale },
  { key: 'aggression', label: 'Aggr.', hint: 'Mean inherited aggression, 0-1', numeric: true, value: (t) => t.aggression,
    render: (t) => t.aggression.toFixed(2) },
  { key: 'stress', label: 'Hardship', hint: 'Accumulated scarcity; high values drive migration', numeric: true,
    value: (t) => t.stress,
    render: (t) => <span className={t.stress > 30 ? 'text-warning' : ''}>{t.stress}</span> },
  { key: 'births', label: 'Births', hint: 'Cumulative', numeric: true, value: (t) => t.births },
  { key: 'deaths', label: 'Deaths', hint: 'Cumulative', numeric: true, value: (t) => t.deaths },
  {
    key: 'net', label: 'Net', hint: 'Births minus deaths over the tribe’s life', numeric: true,
    value: (t) => t.births - t.deaths,
    render: (t) => {
      const n = t.births - t.deaths;
      return <span className={n >= 0 ? 'text-good' : 'text-critical'}>{n >= 0 ? '+' : ''}{n}</span>;
    },
  },
  { key: 'kills', label: 'Kills', hint: 'Enemies slain in war', numeric: true, value: (t) => t.kills },
  {
    key: 'wars', label: 'Wars', hint: 'Tribes currently at war with this one', numeric: true,
    value: (t) => t.relations.filter((r) => r.rel === 'war').length,
    render: (t) => {
      const n = t.relations.filter((r) => r.rel === 'war').length;
      return <span className={n > 0 ? 'text-critical' : 'text-ink-muted'}>{n}</span>;
    },
  },
  {
    key: 'trades', label: 'Trade', hint: 'Active trade partners', numeric: true,
    value: (t) => t.relations.filter((r) => r.rel === 'trade').length,
    render: (t) => {
      const n = t.relations.filter((r) => r.rel === 'trade').length;
      return <span className={n > 0 ? 'text-good' : 'text-ink-muted'}>{n}</span>;
    },
  },
  { key: 'camp', label: 'Camp', hint: 'Settlement coordinates', numeric: false, value: (t) => `${t.cx},${t.cy}` },
];

export default function TribesPage({
  tribes, vitals, connection,
}: {
  tribes: TribeRow[];
  vitals: Vitals | null;
  connection: ConnectionState;
}) {
  const [sortKey, setSortKey] = useState('population');
  const [dir, setDir] = useState<Dir>('desc');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [fallen, setFallen] = useState<FallenTribe[]>([]);
  const [showFallen, setShowFallen] = useState(false);

  // The chronicle changes only when a tribe ends, so it polls rather than
  // riding the per-tick frame.
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      get<{ fallen: FallenTribe[] }>('/api/tribes')
        .then((d) => !cancelled && setFallen(d.fallen ?? []))
        .catch(() => undefined);
    load();
    const id = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const rows = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sortKey) ?? COLUMNS[1];
    const q = query.trim().toLowerCase();
    const filtered = q
      ? tribes.filter((t) => t.name.toLowerCase().includes(q) || t.totem.toLowerCase().includes(q))
      : tribes;
    return [...filtered].sort((a, b) => {
      const av = col.value(a);
      const bv = col.value(b);
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv));
      return dir === 'asc' ? cmp : -cmp;
    });
  }, [tribes, sortKey, dir, query]);

  // Bar scaling is per-column across the visible rows, so a bar always means
  // "share of the current leader" rather than an arbitrary absolute.
  const maxes = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of COLUMNS) {
      if (!c.bar) continue;
      m[c.key] = Math.max(1, ...rows.map((t) => Number(c.value(t)) || 0));
    }
    return m;
  }, [rows]);

  const totals = useMemo(() => ({
    population: rows.reduce((s, t) => s + t.population, 0),
    territory: rows.reduce((s, t) => s + t.territory, 0),
    food: rows.reduce((s, t) => s + t.food, 0),
    births: rows.reduce((s, t) => s + t.births, 0),
    deaths: rows.reduce((s, t) => s + t.deaths, 0),
    kills: rows.reduce((s, t) => s + t.kills, 0),
  }), [rows]);

  const toggleSort = (key: string) => {
    if (key === sortKey) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setDir(COLUMNS.find((c) => c.key === key)?.numeric ? 'desc' : 'asc');
    }
  };

  const exportCsv = () => {
    const header = COLUMNS.map((c) => c.label).join(',');
    const body = rows
      .map((t) => COLUMNS.map((c) => {
        const v = c.value(t);
        return typeof v === 'number' ? (Math.round(v * 100) / 100).toString() : `"${String(v)}"`;
      }).join(','))
      .join('\n');
    const blob = new Blob([`${header}\n${body}\n`], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tribes-tick-${vitals?.tick ?? 0}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const conn = connection === 'live' ? 'bg-good' : connection === 'connecting' ? 'bg-warning animate-pulse' : 'bg-critical';

  return (
    <div className="flex min-h-screen flex-col bg-surface-0 text-ink-primary xl:h-screen xl:overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-edge px-3 py-2">
        <a href="#/" className="rounded border border-edge bg-surface-2 px-2 py-1 text-[11px] text-ink-secondary hover:border-ink-muted hover:text-ink-primary">← Dashboard</a>
        <a href="#/map" className="rounded border border-edge bg-surface-2 px-2 py-1 text-[11px] text-ink-secondary hover:border-ink-muted hover:text-ink-primary">⛶ Map</a>
        <h1 className="text-sm font-semibold">Tribal Statistics</h1>
        {vitals && (
          <span className="font-mono text-[11px] text-ink-muted">
            tick {vitals.tick.toLocaleString()} · year {vitals.year} · {vitals.season}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter tribes…"
            className="w-40 rounded border border-edge bg-surface-1 px-2 py-1 text-[11px] text-ink-primary outline-none placeholder:text-ink-muted focus:border-divine"
          />
          <button onClick={exportCsv} className="rounded border border-edge bg-surface-1 px-2 py-1 text-[11px] text-ink-secondary hover:text-ink-primary">
            ↓ CSV
          </button>
          <button
            onClick={() => setShowFallen((v) => !v)}
            className={`rounded border px-2 py-1 text-[11px] transition-colors ${
              showFallen ? 'border-divine/60 bg-divine/10 text-divine' : 'border-edge bg-surface-1 text-ink-muted hover:text-ink-secondary'
            }`}
          >
            ⚰ Fallen ({fallen.length})
          </button>
          <span className={`h-2 w-2 rounded-full ${conn}`} title={connection} />
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3 p-3 xl:flex-row">
        <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border border-edge bg-surface-1">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-3 py-2">
            <h2 className="text-[12px] font-semibold">
              Living tribes <span className="font-normal text-ink-muted">({rows.length})</span>
            </h2>
            <OccupationLegend />
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full border-collapse text-left text-[12px]">
              <thead className="sticky top-0 z-10 bg-surface-2 text-[10px] uppercase tracking-wider text-ink-muted">
                <tr>
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      title={c.hint}
                      onClick={() => toggleSort(c.key)}
                      className={`cursor-pointer select-none whitespace-nowrap px-2 py-2 font-medium hover:text-ink-primary ${
                        c.numeric ? 'text-right' : 'text-left'
                      } ${sortKey === c.key ? 'text-ink-primary' : ''}`}
                    >
                      {c.label}
                      <span className="ml-1 inline-block w-2">
                        {sortKey === c.key ? (dir === 'asc' ? '▲' : '▼') : ''}
                      </span>
                    </th>
                  ))}
                  <th className="w-40 px-2 py-2 font-medium">Occupation</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={COLUMNS.length + 1} className="px-3 py-8 text-center text-ink-muted">
                    {query ? 'No tribe matches that filter.' : 'No tribes remain. Humanity is extinct.'}
                  </td></tr>
                )}
                {rows.map((t) => (
                  <TribeRowView
                    key={t.id}
                    tribe={t}
                    all={tribes}
                    maxes={maxes}
                    expanded={expanded === t.id}
                    onToggle={() => setExpanded(expanded === t.id ? null : t.id)}
                  />
                ))}
              </tbody>
              {rows.length > 0 && (
                <tfoot className="sticky bottom-0 bg-surface-2 text-[11px]">
                  <tr>
                    <td className="px-2 py-2 font-medium text-ink-secondary">Total ({rows.length})</td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-ink-primary">{int(totals.population)}</td>
                    <td colSpan={3} />
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-ink-primary">{int(totals.territory)}</td>
                    <td />
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-ink-primary">{int(totals.food)}</td>
                    <td colSpan={6} />
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-ink-secondary">{int(totals.births)}</td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-ink-secondary">{int(totals.deaths)}</td>
                    <td />
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-ink-secondary">{int(totals.kills)}</td>
                    <td colSpan={4} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </section>

        {showFallen && (
          <aside className="flex min-h-0 w-full flex-col rounded-lg border border-edge bg-surface-1 xl:w-[360px] xl:shrink-0">
            <div className="border-b border-edge px-3 py-2">
              <h2 className="text-[12px] font-semibold">Fallen tribes</h2>
              <p className="mt-0.5 text-[11px] text-ink-muted">
                Most recent first. The engine keeps the last 80.
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
              {fallen.length === 0 && (
                <p className="py-6 text-center text-[11px] text-ink-muted">
                  No tribe has ended yet.
                </p>
              )}
              <ul className="space-y-2">
                {fallen.map((f) => (
                  <li key={`${f.id}-${f.extinctYear}`} className="rounded border border-edge bg-surface-2 px-2.5 py-2 text-[11px]">
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-sm opacity-60" style={{ background: f.color }} />
                      <span aria-hidden>{f.glyph}</span>
                      <span className="text-ink-secondary">{f.name}</span>
                    </div>
                    <p className="mt-1 text-ink-muted">
                      {f.fate === 'subjugated' && f.conqueror
                        ? <>Subjugated by <span className="text-ink-secondary">{f.conqueror}</span></>
                        : 'Died out'}{' '}
                      in year {f.extinctYear} · founded year {f.foundedYear} · lasted{' '}
                      {f.lifespanYears} {f.lifespanYears === 1 ? 'year' : 'years'}
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] text-ink-muted">
                      {f.births} born · {f.deaths} died · {f.kills} slain · {f.techs.length}/5 techs
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        )}
      </main>
    </div>
  );
}

function TribeRowView({
  tribe, all, maxes, expanded, onToggle,
}: {
  tribe: TribeRow;
  all: TribeRow[];
  maxes: Record<string, number>;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer border-b border-edge/60 transition-colors ${expanded ? 'bg-surface-3' : 'hover:bg-surface-2'}`}
      >
        {COLUMNS.map((c) => {
          const raw = c.value(tribe);
          const content = c.render ? c.render(tribe) : typeof raw === 'number' ? int(Math.round(raw)) : raw;
          const pct = c.bar ? (Number(raw) / (maxes[c.key] || 1)) * 100 : 0;
          return (
            <td
              key={c.key}
              className={`relative px-2 py-1.5 ${c.numeric ? 'text-right font-mono tabular-nums text-ink-secondary' : ''}`}
            >
              {c.bar && (
                // Magnitude bar sits behind the figure; the number stays in
                // text ink so identity never rests on the fill alone.
                <span
                  aria-hidden
                  className="absolute inset-y-1 right-1 rounded-[2px] opacity-25"
                  style={{ width: `${Math.max(2, pct * 0.7)}%`, background: tribe.color }}
                />
              )}
              <span className="relative">{content}</span>
            </td>
          );
        })}
        <td className="px-2 py-1.5">
          <OccupationBar occupations={tribe.occupations} total={tribe.population} />
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-edge/60 bg-surface-2/60">
          <td colSpan={COLUMNS.length + 1} className="px-3 py-3">
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <h3 className="mb-1.5 text-[10px] uppercase tracking-wider text-ink-muted">Research</h3>
                <ul className="space-y-1.5">
                  {tribe.research.map((r) => (
                    <li key={r.id} className="text-[11px]">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className={r.unlocked ? 'text-good' : 'text-ink-secondary'}>
                          {r.unlocked ? '✓ ' : ''}{r.label}
                        </span>
                        <span className="font-mono tabular-nums text-ink-muted">{r.pct}%</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-sm bg-surface-3">
                        <div className="h-full rounded-sm" style={{ width: `${r.pct}%`, background: r.unlocked ? '#25b14f' : tribe.color }} />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="mb-1.5 text-[10px] uppercase tracking-wider text-ink-muted">Occupation detail</h3>
                <OccupationBar occupations={tribe.occupations} total={tribe.population} showLabels />
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                  {OCCUPATIONS.map(({ key }) => (
                    <div key={key} className="flex justify-between gap-2">
                      <dt className="text-ink-muted">{key}</dt>
                      <dd className="font-mono tabular-nums text-ink-secondary">{tribe.occupations[key] ?? 0}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div>
                <h3 className="mb-1.5 text-[10px] uppercase tracking-wider text-ink-muted">Relations</h3>
                {tribe.relations.length === 0 ? (
                  <p className="text-[11px] text-ink-muted">Isolated — no known neighbours.</p>
                ) : (
                  <ul className="space-y-1 text-[11px]">
                    {tribe.relations.map((r) => {
                      const other = all.find((o) => o.id === r.id);
                      return (
                      <li key={r.id} className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-ink-secondary">
                          <span className="inline-block h-2 w-2 rounded-[2px]" style={{ background: other?.color ?? '#666' }} />
                          {other ? `${other.glyph} ${other.name}` : `Tribe ${r.id}`}
                        </span>
                        <span className={`uppercase tracking-wide ${
                          r.rel === 'war' ? 'text-critical' : r.rel === 'trade' ? 'text-good' : 'text-ink-muted'
                        }`}>{r.rel}</span>
                      </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
