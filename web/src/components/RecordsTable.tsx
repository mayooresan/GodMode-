import { useMemo, useState } from 'react';
import type { RecordRow } from '../lib/types';

type Dir = 'asc' | 'desc';

interface Col {
  key: string;
  label: string;
  hint?: string;
  numeric: boolean;
  value: (r: RecordRow) => number | string;
  render?: (r: RecordRow) => React.ReactNode;
  bar?: boolean;
}

const int = (n: number) => Math.round(n).toLocaleString();

/**
 * A zero peak means "not recorded", not "never held any".
 *
 * Tribes that ended before high-water marks were tracked have their territory
 * cleared on retirement, so defaulting from present state yields 0 — printing
 * that as a figure would assert something false about them.
 */
const unknown = <span className="text-ink-muted">—</span>;
const peak = (v: number) => (v > 0 ? int(v) : unknown);
const peakYear = (v: number, year: number) =>
  v > 0 ? <span className="text-ink-muted">y{year}</span> : unknown;

const STATUS_TONE: Record<string, string> = {
  alive: 'text-good',
  'died out': 'text-ink-muted',
  subjugated: 'text-critical',
};

/**
 * All-time records for every tribe that has ever existed.
 *
 * Peaks are high-water marks kept on the tribe, not derived from the history
 * buffer — a record that can age out of a ring buffer is not a record. The
 * "year" beside each peak is when it was reached, which is what turns a number
 * into a story: a tribe whose peak was three centuries ago has been in decline
 * ever since.
 */
const COLUMNS: Col[] = [
  {
    key: 'name', label: 'Tribe', numeric: false, value: (r) => r.name,
    render: (r) => (
      <span className="flex items-center gap-2">
        <span
          className="inline-block h-3 w-3 shrink-0 rounded-sm ring-1 ring-black/40"
          style={{ background: r.color, opacity: r.status === 'alive' ? 1 : 0.5 }}
        />
        <span aria-hidden>{r.glyph}</span>
        <span className={`whitespace-nowrap ${r.status === 'alive' ? 'text-ink-primary' : 'text-ink-secondary'}`}>
          {r.name}
        </span>
      </span>
    ),
  },
  {
    key: 'status', label: 'Fate', numeric: false, value: (r) => r.status,
    render: (r) => (
      <span className={`whitespace-nowrap ${STATUS_TONE[r.status] ?? ''}`}>
        {r.status === 'subjugated' && r.conqueror
          ? `subjugated by ${r.conqueror.replace('Tribe of the ', '')}`
          : r.status}
      </span>
    ),
  },
  { key: 'foundedYear', label: 'Founded', hint: 'Year the tribe came into being', numeric: true, value: (r) => r.foundedYear, render: (r) => `y${r.foundedYear}` },
  {
    key: 'endedYear', label: 'Ended', hint: 'Year it ceased to exist', numeric: true,
    value: (r) => r.endedYear ?? Number.MAX_SAFE_INTEGER,
    render: (r) => (r.endedYear === null ? <span className="text-good">—</span> : `y${r.endedYear}`),
  },
  { key: 'lifespanYears', label: 'Lifespan', hint: 'Years from founding to its end, or to now', numeric: true, value: (r) => r.lifespanYears, render: (r) => `${r.lifespanYears}y`, bar: true },
  { key: 'population', label: 'Now', hint: 'Living members today', numeric: true, value: (r) => r.population, render: (r) => (r.status === 'alive' ? int(r.population) : <span className="text-ink-muted">0</span>) },
  { key: 'peakPopulation', label: 'Peak pop', hint: 'Largest the tribe ever grew', numeric: true, value: (r) => r.peakPopulation, bar: true, render: (r) => peak(r.peakPopulation) },
  { key: 'peakPopulationYear', label: 'in', hint: 'Year that peak was reached', numeric: true, value: (r) => r.peakPopulationYear, render: (r) => peakYear(r.peakPopulation, r.peakPopulationYear) },
  { key: 'peakTerritory', label: 'Peak land', hint: 'Most tiles ever controlled. Recorded from when tracking began.', numeric: true, value: (r) => r.peakTerritory, bar: true, render: (r) => peak(r.peakTerritory) },
  { key: 'peakTerritoryYear', label: 'in', hint: 'Year that peak was reached', numeric: true, value: (r) => r.peakTerritoryYear, render: (r) => peakYear(r.peakTerritory, r.peakTerritoryYear) },
  { key: 'peakFood', label: 'Peak store', hint: 'Largest communal food store ever held', numeric: true, value: (r) => r.peakFood, render: (r) => peak(r.peakFood) },
  { key: 'peakTechs', label: 'Techs', hint: 'Most technologies ever known, of 5', numeric: true, value: (r) => r.peakTechs, render: (r) => <span className={r.peakTechs === 5 ? 'text-good' : ''}>{r.peakTechs}/5</span> },
  { key: 'births', label: 'Born', hint: 'Everyone ever born into this tribe', numeric: true, value: (r) => r.births },
  { key: 'deaths', label: 'Died', hint: 'Everyone who ever died in it', numeric: true, value: (r) => r.deaths },
  { key: 'kills', label: 'Slain', hint: 'Enemies killed in war', numeric: true, value: (r) => r.kills },
];

export default function RecordsTable({ rows: input }: { rows: RecordRow[] }) {
  const [sortKey, setSortKey] = useState('peakPopulation');
  const [dir, setDir] = useState<Dir>('desc');

  const rows = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sortKey) ?? COLUMNS[6];
    return [...input].sort((a, b) => {
      const av = col.value(a);
      const bv = col.value(b);
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv));
      return dir === 'asc' ? cmp : -cmp;
    });
  }, [input, sortKey, dir]);

  const maxes = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of COLUMNS) {
      if (!c.bar) continue;
      m[c.key] = Math.max(1, ...rows.map((r) => Number(c.value(r)) || 0));
    }
    return m;
  }, [rows]);

  const toggle = (key: string) => {
    if (key === sortKey) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setDir(COLUMNS.find((c) => c.key === key)?.numeric ? 'desc' : 'asc');
    }
  };

  const alive = rows.filter((r) => r.status === 'alive').length;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col rounded-lg border border-edge bg-surface-1">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-edge px-3 py-2">
        <h2 className="text-[12px] font-semibold">
          All-time records{' '}
          <span className="font-normal text-ink-muted">
            ({rows.length} tribes ever · {alive} alive · {rows.length - alive} ended)
          </span>
        </h2>
        <p className="text-[10px] text-ink-muted">
          Peaks are high-water marks, kept permanently. The engine remembers the last 80 ended tribes.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-left text-[12px]">
          <thead className="sticky top-0 z-10 bg-surface-2 text-[10px] uppercase tracking-wider text-ink-muted">
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  title={c.hint}
                  onClick={() => toggle(c.key)}
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
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-8 text-center text-ink-muted">
                  No tribes on record yet.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={`${r.id}-${r.foundedYear}`}
                className={`border-b border-edge/60 hover:bg-surface-2 ${r.status !== 'alive' ? 'opacity-75' : ''}`}
              >
                {COLUMNS.map((c) => {
                  const raw = c.value(r);
                  const content = c.render ? c.render(r) : typeof raw === 'number' ? int(raw) : raw;
                  const pct = c.bar ? (Number(raw) / (maxes[c.key] || 1)) * 100 : 0;
                  return (
                    <td
                      key={c.key}
                      className={`relative px-2 py-1.5 ${c.numeric ? 'text-right font-mono tabular-nums text-ink-secondary' : ''}`}
                    >
                      {c.bar && (
                        <span
                          aria-hidden
                          className="absolute inset-y-1 right-1 rounded-[2px] opacity-25"
                          style={{ width: `${Math.max(2, pct * 0.7)}%`, background: r.color }}
                        />
                      )}
                      <span className="relative">{content}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
