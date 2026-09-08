import type { Vitals } from '../lib/types';
import type { ConnectionState } from '../lib/useSimStream';

const nf = new Intl.NumberFormat('en-US');

function elapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

/**
 * A single figure with its label.
 *
 * A stat tile, not a chart: these are headline magnitudes with no series to
 * plot, so a number set in a large weight communicates faster than any mark.
 */
function Stat({
  label, value, sub, tone = 'default',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'good' | 'critical' | 'divine';
}) {
  const toneClass =
    tone === 'good' ? 'text-good'
      : tone === 'critical' ? 'text-critical'
        : tone === 'divine' ? 'text-divine'
          : 'text-ink-primary';
  return (
    <div className="rounded-lg border border-edge bg-surface-1 px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wider text-ink-muted">{label}</p>
      <p className={`mt-1 font-mono text-xl leading-none tabular-nums ${toneClass}`}>{value}</p>
      {sub && <p className="mt-1 text-[11px] leading-tight text-ink-secondary">{sub}</p>}
    </div>
  );
}

export default function VitalsCard({
  vitals, connection,
}: {
  vitals: Vitals | null;
  connection: ConnectionState;
}) {
  if (!vitals) {
    return (
      <div className="rounded-lg border border-edge bg-surface-1 px-4 py-6 text-sm text-ink-muted">
        {connection === 'offline' ? 'Engine unreachable — retrying…' : 'Waiting for the first tick…'}
      </div>
    );
  }

  const net = vitals.births - vitals.deaths;

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
      <Stat
        label="Living Population"
        value={nf.format(vitals.population)}
        sub={`${nf.format(vitals.infants)} young · ${nf.format(vitals.adults)} adult · ${nf.format(vitals.elders)} elder`}
      />
      <Stat
        label="Active Tribes"
        value={String(vitals.tribes)}
        sub={`${nf.format(vitals.claimedTiles)} tiles claimed`}
      />
      <Stat
        label="Births / Deaths"
        value={`${nf.format(vitals.births)} / ${nf.format(vitals.deaths)}`}
        sub={`${net >= 0 ? '+' : ''}${net} over last 60 ticks`}
        tone={net >= 0 ? 'good' : 'critical'}
      />
      <Stat
        label="Vital Rates"
        value={`${vitals.birthRate.toFixed(2)} / ${vitals.deathRate.toFixed(2)}`}
        sub="births / deaths per tick"
      />
      <Stat
        label="Current Tick"
        value={nf.format(vitals.tick)}
        sub={`year ${vitals.year} · ${vitals.tickMs}ms per tick`}
      />
      <Stat
        label="Season"
        value={vitals.season}
        sub={`${vitals.temperature}° ambient`}
        tone={vitals.temperature < 0 ? 'critical' : 'default'}
      />
      <Stat
        label="Tribal Food"
        value={nf.format(vitals.totalFood)}
        sub="units in communal stores"
      />
      <Stat
        label="Simulation Time"
        value={elapsed(vitals.elapsedMs)}
        sub={vitals.paused ? 'PAUSED' : `${vitals.tps.toFixed(2)} ticks/sec`}
        tone={vitals.paused ? 'divine' : 'default'}
      />
    </div>
  );
}
