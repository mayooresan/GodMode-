import { OCCUPATIONS } from '../lib/types';

/**
 * Occupation distribution as a single stacked bar.
 *
 * Fixed segment order bound to the occupation (never to its current share), a
 * 2px surface gap between fills so adjacent segments stay separable, and a
 * native tooltip on each segment. The percentages are also written out beneath
 * the bar, so identity never rests on colour alone.
 */
export default function OccupationBar({
  occupations, total, showLabels = false,
}: {
  occupations: Record<string, number>;
  total: number;
  showLabels?: boolean;
}) {
  if (total <= 0) return <span className="text-[11px] text-ink-muted">—</span>;

  const segments = OCCUPATIONS
    .map(({ key, varName }) => ({
      key,
      varName,
      count: occupations[key] ?? 0,
      pct: ((occupations[key] ?? 0) / total) * 100,
    }))
    .filter((s) => s.count > 0);

  return (
    <div className={showLabels ? 'space-y-1.5' : ''}>
      <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-sm bg-surface-3">
        {segments.map((s) => (
          <div
            key={s.key}
            className="h-full first:rounded-l-sm last:rounded-r-sm"
            style={{ width: `${s.pct}%`, background: `var(${s.varName})` }}
            title={`${s.key}: ${s.count} (${s.pct.toFixed(0)}%)`}
          />
        ))}
      </div>
      {showLabels && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-secondary">
          {segments.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-[2px]"
                style={{ background: `var(${s.varName})` }}
              />
              {s.key} <span className="tabular-nums text-ink-muted">{s.pct.toFixed(0)}%</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Standing legend for the distribution column — always present, all slots. */
export function OccupationLegend() {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-muted">
      {OCCUPATIONS.map(({ key, varName }) => (
        <span key={key} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-[2px]"
            style={{ background: `var(${varName})` }}
          />
          {key}
        </span>
      ))}
    </div>
  );
}
