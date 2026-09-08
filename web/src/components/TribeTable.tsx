import { Fragment, useState } from 'react';
import type { TribeRow } from '../lib/types';
import OccupationBar, { OccupationLegend } from './OccupationBar';

const relTone: Record<string, string> = {
  war: 'text-critical',
  trade: 'text-good',
  neutral: 'text-ink-muted',
  vassal: 'text-divine',
};

/**
 * Tribal breakdown.
 *
 * The table *is* the accessible view of the map's colour encoding: every row
 * carries the swatch, the totem glyph and the tribe's name together, so nothing
 * on this dashboard identifies a tribe by colour alone.
 */
export default function TribeTable({
  tribes, focusTribeId, onFocus,
}: {
  tribes: TribeRow[];
  focusTribeId: number | null;
  onFocus: (id: number | null) => void;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col rounded-lg border border-edge bg-surface-1">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-3 py-2.5">
        <h2 className="text-sm font-semibold text-ink-primary">
          Tribal Breakdown{' '}
          <span className="font-normal text-ink-muted">({tribes.length})</span>
        </h2>
        <OccupationLegend />
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-left text-[12px]">
          <thead className="sticky top-0 z-10 bg-surface-2 text-[10px] uppercase tracking-wider text-ink-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Tribe</th>
              <th className="px-2 py-2 text-right font-medium">Pop</th>
              <th className="px-2 py-2 text-right font-medium">Y / A / E</th>
              <th className="px-2 py-2 text-right font-medium">Food</th>
              <th className="px-2 py-2 text-right font-medium">Land</th>
              <th className="w-[22%] px-2 py-2 font-medium">Occupation</th>
              <th className="px-3 py-2 font-medium">Technologies</th>
            </tr>
          </thead>
          <tbody>
            {tribes.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-ink-muted">
                  No tribes remain. Humanity is extinct.
                </td>
              </tr>
            )}
            {tribes.map((t) => {
              const isOpen = expanded === t.id;
              const isFocus = focusTribeId === t.id;
              return (
                <Fragment key={t.id}>
                  <tr
                    onClick={() => {
                      setExpanded(isOpen ? null : t.id);
                      onFocus(isFocus ? null : t.id);
                    }}
                    className={`cursor-pointer border-b border-edge/60 align-middle transition-colors ${
                      isFocus ? 'bg-surface-3' : 'hover:bg-surface-2'
                    }`}
                  >
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block h-3 w-3 shrink-0 rounded-sm ring-1 ring-black/40"
                          style={{ background: t.color }}
                        />
                        <span aria-hidden>{t.glyph}</span>
                        <span className="whitespace-nowrap text-ink-primary">{t.name}</span>
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-ink-primary">
                      {t.population}
                    </td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-ink-secondary">
                      {t.infants}/{t.adults}/{t.elders}
                    </td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-ink-secondary">
                      {t.food}
                    </td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-ink-secondary">
                      {t.territory}
                    </td>
                    <td className="px-2 py-2">
                      <OccupationBar occupations={t.occupations} total={t.population} />
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex flex-wrap gap-1">
                        {t.techs.length === 0 && <span className="text-ink-muted">none</span>}
                        {t.techs.map((tech) => (
                          <span
                            key={tech}
                            className="rounded border border-edge bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-secondary"
                          >
                            {tech}
                          </span>
                        ))}
                      </span>
                    </td>
                  </tr>

                  {isOpen && (
                    <tr className="border-b border-edge/60 bg-surface-2/60">
                      <td colSpan={7} className="px-3 py-3">
                        <div className="grid gap-4 md:grid-cols-3">
                          <div className="space-y-2">
                            <h3 className="text-[10px] uppercase tracking-wider text-ink-muted">
                              Occupation distribution
                            </h3>
                            <OccupationBar
                              occupations={t.occupations}
                              total={t.population}
                              showLabels
                            />
                            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 pt-1 text-[11px]">
                              <Field label="Camp" value={`${t.cx}, ${t.cy}`} />
                              <Field label="Morale" value={`${t.morale}`} />
                              <Field label="Aggression" value={t.aggression.toFixed(2)} />
                              <Field label="Hardship" value={`${t.stress}`} />
                              <Field label="Tools" value={`${t.tools}`} />
                              <Field label="War kills" value={`${t.kills}`} />
                            </dl>
                          </div>

                          <div className="space-y-2">
                            <h3 className="text-[10px] uppercase tracking-wider text-ink-muted">
                              Research
                            </h3>
                            <ul className="space-y-1.5">
                              {t.research.map((r) => (
                                <li key={r.id} className="text-[11px]">
                                  <div className="flex items-baseline justify-between gap-2">
                                    <span className={r.unlocked ? 'text-good' : 'text-ink-secondary'}>
                                      {r.unlocked ? '✓ ' : ''}
                                      {r.label}
                                    </span>
                                    <span className="font-mono tabular-nums text-ink-muted">
                                      {r.pct}%
                                    </span>
                                  </div>
                                  <div className="mt-1 h-1.5 overflow-hidden rounded-sm bg-surface-3">
                                    <div
                                      className="h-full rounded-sm"
                                      style={{
                                        width: `${r.pct}%`,
                                        background: r.unlocked ? '#25b14f' : t.color,
                                      }}
                                    />
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>

                          <div className="space-y-2">
                            <h3 className="text-[10px] uppercase tracking-wider text-ink-muted">
                              Relations
                            </h3>
                            {t.relations.length === 0 ? (
                              <p className="text-[11px] text-ink-muted">Isolated — no known neighbours.</p>
                            ) : (
                              <ul className="space-y-1 text-[11px]">
                                {t.relations.map((r) => {
                                  const other = tribes.find((o) => o.id === r.id);
                                  return (
                                    <li key={r.id} className="flex items-center justify-between gap-2">
                                      <span className="flex items-center gap-1.5 text-ink-secondary">
                                        <span
                                          className="inline-block h-2 w-2 rounded-[2px]"
                                          style={{ background: other?.color ?? '#666' }}
                                        />
                                        {other?.glyph} {other?.name ?? `Tribe ${r.id}`}
                                      </span>
                                      <span className={`uppercase tracking-wide ${relTone[r.rel] ?? ''}`}>
                                        {r.rel}
                                      </span>
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
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right font-mono tabular-nums text-ink-secondary">{value}</dd>
    </>
  );
}
