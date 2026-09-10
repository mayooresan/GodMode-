import { BIOME_LABEL, STATE_LABEL } from '../lib/types';
import type { TribeRow } from '../lib/types';
import type { HoverInfo } from './MapCanvas';
import OccupationBar from './OccupationBar';

/**
 * Left-hand detail panel for the tactical map.
 *
 * Shows the tile under the cursor and, when that ground belongs to somebody,
 * who they are — population, holdings and who they are fighting. Hover drives
 * it, but it falls back to the last tile clicked so the panel does not blank
 * the moment the cursor moves away to read it.
 */
export default function TribeInspector({
  info, tribe, allTribes, landTiles, onFocusTribe,
}: {
  info: HoverInfo | null;
  tribe: TribeRow | undefined;
  allTribes: TribeRow[];
  /** Total claimed tiles across all tribes, for the share figure. */
  landTiles: number;
  onFocusTribe: (id: number) => void;
}) {
  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col overflow-y-auto border-r border-edge bg-surface-1">
      {/* ---------------------------------------------------------- tile */}
      <section className="border-b border-edge px-3 py-2.5">
        <h2 className="text-[10px] uppercase tracking-wider text-ink-muted">Tile</h2>
        {!info ? (
          <p className="mt-1 text-[11px] text-ink-muted">
            Move over the map to inspect ground, or click to hold a tile.
          </p>
        ) : (
          <>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="font-mono text-[12px] text-ink-primary">{info.x}, {info.y}</span>
              <span className="text-[11px] text-ink-secondary">{BIOME_LABEL[info.biome]}</span>
            </div>
            <dl className="mt-1.5 space-y-0.5 text-[11px]">
              {info.food !== null && <Row label="Forage" value={`${info.food}% of capacity`} />}
              <Row label="People here" value={info.agents === 0 ? 'none' : String(info.agents)} />
              {info.agents > 0 && info.states.length > 0 && (
                <Row label="Doing" value={[...new Set(info.states)].map((s) => STATE_LABEL[s] ?? s).join(', ')} />
              )}
            </dl>
            <div className="mt-1.5 flex flex-wrap gap-1 text-[10px]">
              {info.cultivated && <Tag tone="good">cultivated</Tag>}
              {info.shelter && <Tag tone="good">shelter</Tag>}
              {info.blessed && <Tag tone="divine">blessed</Tag>}
              {info.cursed && <Tag tone="bad">cursed</Tag>}
            </div>
          </>
        )}
      </section>

      {/* --------------------------------------------------------- tribe */}
      <section className="min-h-0 flex-1 px-3 py-2.5">
        <h2 className="text-[10px] uppercase tracking-wider text-ink-muted">Tribe</h2>

        {!tribe ? (
          <p className="mt-1 text-[11px] text-ink-muted">
            {info && info.owner < 0 ? 'Unclaimed ground.' : 'No tribe under the cursor.'}
          </p>
        ) : (
          <>
            <button
              onClick={() => onFocusTribe(tribe.id)}
              className="mt-1 flex w-full items-center gap-2 text-left"
              title="Highlight this tribe on the map"
            >
              <span className="inline-block h-3 w-3 shrink-0 rounded-sm ring-1 ring-black/40" style={{ background: tribe.color }} />
              <span aria-hidden>{tribe.glyph}</span>
              <span className="text-[12px] font-semibold text-ink-primary">{tribe.name}</span>
            </button>

            <dl className="mt-2 space-y-0.5 text-[11px]">
              <Row label="Population" value={tribe.population.toLocaleString()} />
              <Row label="Young / adult / elder" value={`${tribe.infants} / ${tribe.adults} / ${tribe.elders}`} />
              <Row
                label="Territory"
                value={`${tribe.territory.toLocaleString()} tiles${
                  landTiles > 0 ? ` · ${Math.round((tribe.territory / landTiles) * 100)}%` : ''
                }`}
              />
              <Row label="Settlements" value={String(tribe.camps?.length ?? 1)} />
              <Row
                label="Food store"
                value={`${tribe.food.toLocaleString()}${
                  tribe.population > 0 ? ` · ${(tribe.food / tribe.population).toFixed(1)}/head` : ''
                }`}
              />
              <Row label="Morale" value={String(tribe.morale)} />
              <Row label="Hardship" value={String(tribe.stress)} />
            </dl>

            <h3 className="mt-3 text-[10px] uppercase tracking-wider text-ink-muted">Occupation</h3>
            <div className="mt-1">
              <OccupationBar occupations={tribe.occupations} total={tribe.population} showLabels />
            </div>

            <h3 className="mt-3 text-[10px] uppercase tracking-wider text-ink-muted">Technologies</h3>
            <div className="mt-1 flex flex-wrap gap-1">
              {tribe.techs.length === 0 ? (
                <span className="text-[11px] text-ink-muted">none yet</span>
              ) : (
                tribe.techs.map((t) => (
                  <span key={t} className="rounded border border-edge bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-secondary">
                    {t}
                  </span>
                ))
              )}
            </div>

            <Relations tribe={tribe} allTribes={allTribes} onFocusTribe={onFocusTribe} />
          </>
        )}
      </section>
    </aside>
  );
}

/** Who this tribe fights and who it trades with, named rather than counted. */
function Relations({
  tribe, allTribes, onFocusTribe,
}: {
  tribe: TribeRow;
  allTribes: TribeRow[];
  onFocusTribe: (id: number) => void;
}) {
  const name = (id: number) => {
    const o = allTribes.find((t) => t.id === id);
    return { id, rel: '', name: o?.name, color: o?.color, glyph: o?.glyph };
  };
  const wars = tribe.relations.filter((r) => r.rel === 'war').map((r) => name(r.id));
  const trades = tribe.relations.filter((r) => r.rel === 'trade').map((r) => name(r.id));

  return (
    <>
      <h3 className="mt-3 text-[10px] uppercase tracking-wider text-ink-muted">Relations</h3>
      {wars.length === 0 && trades.length === 0 ? (
        <p className="mt-1 text-[11px] text-ink-muted">At peace with everyone in reach.</p>
      ) : (
        <div className="mt-1 space-y-1.5">
          {wars.length > 0 && (
            <Group label="At war with" tone="text-critical" ids={wars} onFocusTribe={onFocusTribe} />
          )}
          {trades.length > 0 && (
            <Group label="Trading with" tone="text-good" ids={trades} onFocusTribe={onFocusTribe} />
          )}
        </div>
      )}
    </>
  );
}

function Group({
  label, tone, ids, onFocusTribe,
}: {
  label: string;
  tone: string;
  ids: Array<{ id: number; rel: string; name?: string; color?: string; glyph?: string }>;
  onFocusTribe: (id: number) => void;
}) {
  return (
    <div>
      <p className={`text-[10px] uppercase tracking-wide ${tone}`}>{label}</p>
      <ul className="mt-0.5 space-y-0.5">
        {ids.map((r) => (
          <li key={r.id}>
            <button
              onClick={() => onFocusTribe(r.id)}
              className="flex w-full items-center gap-1.5 text-left text-[11px] text-ink-secondary hover:text-ink-primary"
            >
              <span className="inline-block h-2 w-2 shrink-0 rounded-[2px]" style={{ background: r.color ?? '#666' }} />
              <span className="truncate">{r.glyph ? `${r.glyph} ` : ''}{r.name ?? `Tribe ${r.id}`}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="shrink-0 text-ink-muted">{label}</dt>
      <dd className="truncate text-right font-mono tabular-nums text-ink-secondary">{value}</dd>
    </div>
  );
}

function Tag({ children, tone }: { children: React.ReactNode; tone: 'good' | 'bad' | 'divine' }) {
  const cls = {
    good: 'border-good/50 text-good',
    bad: 'border-critical/50 text-critical',
    divine: 'border-divine/50 text-divine',
  }[tone];
  return <span className={`rounded border bg-surface-2 px-1.5 py-0.5 ${cls}`}>{children}</span>;
}
