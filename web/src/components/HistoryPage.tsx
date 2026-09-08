import { useEffect, useMemo, useState } from 'react';
import { get } from '../lib/api';
import TimeChart from './TimeChart';
import type { Series } from './TimeChart';
import type { Vitals } from '../lib/types';
import type { ConnectionState } from '../lib/useSimStream';

interface HistoryPayload {
  stride: number;
  ticksPerYear: number;
  samples: number;
  tick: number[];
  population: number[];
  young: number[];
  adults: number[];
  elders: number[];
  tribeCount: number[];
  births: number[];
  deaths: number[];
  food: number[];
  claimed: number[];
  temperature: number[];
  techs: number[];
  wars: number[];
  tribes: Array<{ id: number; name: string; glyph: string; color: string; alive: boolean; pops: number[] }>;
}

/** Categorical slots from the validated palette, used for non-tribe series. */
const C = {
  blue: '#3987e5',
  red: '#ff0000',
  green: '#09905a',
  magenta: '#bb1b9b',
  violet: '#7e29ff',
  pink: '#ca7295',
};

const RANGES = [
  { label: 'Last 100', limit: 100 },
  { label: 'Last 400', limit: 400 },
  { label: 'All', limit: 5000 },
];

export default function HistoryPage({
  vitals, connection,
}: {
  vitals: Vitals | null;
  connection: ConnectionState;
}) {
  const [data, setData] = useState<HistoryPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(400);
  const [hover, setHover] = useState<number | null>(null);
  const [showAllTribes, setShowAllTribes] = useState(false);

  // History is a slow-moving aggregate, so it polls rather than riding the
  // per-tick frame. A refresh every few seconds is far finer than the stride.
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      get<HistoryPayload>(`/api/history?limit=${limit}`)
        .then((d) => {
          if (cancelled) return;
          setData(d);
          setError(null);
        })
        .catch((e: Error) => !cancelled && setError(e.message));
    load();
    const id = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [limit]);

  const tribeSeries: Series[] = useMemo(() => {
    if (!data) return [];
    const list = showAllTribes ? data.tribes : data.tribes.slice(0, 8);
    return list.map((t) => ({
      key: String(t.id),
      label: `${t.glyph} ${t.name.replace('Tribe of the ', '')}${t.alive ? '' : ' †'}`,
      color: t.color,
      values: t.pops,
    }));
  }, [data, showAllTribes]);

  const conn = connection === 'live' ? 'bg-good' : connection === 'connecting' ? 'bg-warning animate-pulse' : 'bg-critical';

  const at = (arr: number[] | undefined) =>
    hover !== null && arr && hover < arr.length ? arr[hover] : undefined;

  return (
    <div className="flex min-h-screen flex-col bg-surface-0 text-ink-primary">
      <header className="sticky top-0 z-20 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-edge bg-surface-0 px-3 py-2">
        <a href="#/" className="rounded border border-edge bg-surface-2 px-2 py-1 text-[11px] text-ink-secondary hover:border-ink-muted hover:text-ink-primary">← Dashboard</a>
        <a href="#/map" className="rounded border border-edge bg-surface-2 px-2 py-1 text-[11px] text-ink-secondary hover:border-ink-muted hover:text-ink-primary">⛶ Map</a>
        <a href="#/tribes" className="rounded border border-edge bg-surface-2 px-2 py-1 text-[11px] text-ink-secondary hover:border-ink-muted hover:text-ink-primary">▦ Tribes</a>
        <h1 className="text-sm font-semibold">History</h1>
        {vitals && (
          <span className="font-mono text-[11px] text-ink-muted">
            tick {vitals.tick.toLocaleString()} · year {vitals.year}
          </span>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {data && (
            <span className="font-mono text-[11px] text-ink-muted">
              {data.samples} samples · 1 per {data.stride} ticks
            </span>
          )}
          <div className="flex overflow-hidden rounded border border-edge">
            {RANGES.map((r) => (
              <button
                key={r.limit}
                onClick={() => setLimit(r.limit)}
                className={`px-2 py-1 text-[11px] transition-colors ${
                  limit === r.limit ? 'bg-surface-3 text-ink-primary' : 'bg-surface-1 text-ink-muted hover:text-ink-secondary'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <span className={`h-2 w-2 rounded-full ${conn}`} title={connection} />
        </div>
      </header>

      <main className="flex-1 p-3">
        {error && (
          <p className="rounded-lg border border-critical/40 bg-critical/10 px-3 py-2 text-[12px] text-critical">
            Could not load history: {error}
          </p>
        )}

        {!data && !error && (
          <p className="px-1 py-8 text-center text-[12px] text-ink-muted">Loading history…</p>
        )}

        {data && data.samples < 2 && (
          <p className="rounded-lg border border-edge bg-surface-1 px-3 py-8 text-center text-[12px] text-ink-muted">
            Not enough history yet — the first samples appear after {data.stride * 2} ticks.
          </p>
        )}

        {data && data.samples >= 2 && (
          <>
            {/* Shared readout for the hovered instant, across every chart. */}
            <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border border-edge bg-surface-1 px-3 py-2 text-[11px]">
              {hover === null ? (
                <span className="text-ink-muted">Hover any chart — the crosshair tracks the same moment across all of them.</span>
              ) : (
                <>
                  <span className="font-mono text-ink-primary">
                    tick {data.tick[hover]?.toLocaleString()} · year {Math.floor((data.tick[hover] ?? 0) / data.ticksPerYear)}
                  </span>
                  <Read label="Population" v={at(data.population)} />
                  <Read label="Young" v={at(data.young)} />
                  <Read label="Adults" v={at(data.adults)} />
                  <Read label="Elders" v={at(data.elders)} />
                  <Read label="Tribes" v={at(data.tribeCount)} />
                  <Read label="Births" v={at(data.births)} />
                  <Read label="Deaths" v={at(data.deaths)} />
                  <Read label="Food" v={at(data.food)} />
                  <Read label="Territory" v={at(data.claimed)} />
                  <Read label="Wars" v={at(data.wars)} />
                  <Read label="Temp" v={at(data.temperature)} suffix="°" />
                </>
              )}
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <TimeChart
                title="Population by age"
                note="Stacked — the shape of the age pyramid over time."
                mode="stacked"
                height={190}
                ticks={data.tick}
                ticksPerYear={data.ticksPerYear}
                hover={hover}
                onHover={setHover}
                series={[
                  { key: 'young', label: 'Young', color: C.blue, values: data.young },
                  { key: 'adults', label: 'Adults', color: C.green, values: data.adults },
                  { key: 'elders', label: 'Elders', color: C.magenta, values: data.elders },
                ]}
              />

              <TimeChart
                title="Births and deaths"
                note={`Per sample (${data.stride} ticks). Crossings mark the turn from growth to decline.`}
                height={190}
                ticks={data.tick}
                ticksPerYear={data.ticksPerYear}
                hover={hover}
                onHover={setHover}
                series={[
                  { key: 'births', label: 'Births', color: C.blue, values: data.births },
                  { key: 'deaths', label: 'Deaths', color: C.red, values: data.deaths },
                ]}
              />

              <TimeChart
                title="Tribes alive and wars under way"
                note="Fission raises the count; conquest and extinction lower it."
                height={170}
                ticks={data.tick}
                ticksPerYear={data.ticksPerYear}
                hover={hover}
                onHover={setHover}
                series={[
                  { key: 'tribes', label: 'Tribes', color: C.green, values: data.tribeCount },
                  { key: 'wars', label: 'Wars', color: C.red, values: data.wars },
                ]}
              />

              <TimeChart
                title="Territory claimed"
                note="Tiles under tribal control."
                height={170}
                ticks={data.tick}
                ticksPerYear={data.ticksPerYear}
                hover={hover}
                onHover={setHover}
                series={[{ key: 'claimed', label: 'Tiles', color: C.violet, values: data.claimed }]}
              />

              <TimeChart
                title="Communal food stores"
                note="Total across every tribe. Deep troughs are famines."
                height={170}
                ticks={data.tick}
                ticksPerYear={data.ticksPerYear}
                hover={hover}
                onHover={setHover}
                series={[{ key: 'food', label: 'Food', color: C.green, values: data.food }]}
              />

              <TimeChart
                title="Temperature"
                note="The seasonal cycle; sustained dips are long winters."
                height={170}
                ticks={data.tick}
                ticksPerYear={data.ticksPerYear}
                hover={hover}
                onHover={setHover}
                format={(v) => `${Math.round(v)}°`}
                series={[{ key: 'temp', label: 'Ambient', color: C.pink, values: data.temperature }]}
              />
            </div>

            <div className="mt-3">
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-[11px] text-ink-muted">
                  Each tribe's population over time. † marks a people that no longer exists.
                </p>
                <button
                  onClick={() => setShowAllTribes((v) => !v)}
                  className="rounded border border-edge bg-surface-1 px-2 py-1 text-[11px] text-ink-secondary hover:text-ink-primary"
                >
                  {showAllTribes ? 'Top 8 only' : `Show all ${data.tribes.length}`}
                </button>
              </div>
              <TimeChart
                title="Rise and fall of every tribe"
                height={260}
                ticks={data.tick}
                ticksPerYear={data.ticksPerYear}
                hover={hover}
                onHover={setHover}
                series={tribeSeries}
              />
            </div>

            <TimeChart
              title="Technologies known"
              note="Summed across all living tribes; drops are tribes dying with their knowledge."
              height={150}
              ticks={data.tick}
              ticksPerYear={data.ticksPerYear}
              hover={hover}
              onHover={setHover}
              series={[{ key: 'techs', label: 'Unlocked', color: C.blue, values: data.techs }]}
            />
          </>
        )}
      </main>
    </div>
  );
}

function Read({ label, v, suffix = '' }: { label: string; v: number | undefined; suffix?: string }) {
  if (v === undefined) return null;
  return (
    <span className="text-ink-muted">
      {label} <span className="font-mono tabular-nums text-ink-secondary">{v.toLocaleString()}{suffix}</span>
    </span>
  );
}
