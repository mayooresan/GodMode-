import { useEffect, useState } from 'react';
import { get } from '../lib/api';
import { BIOME_LABEL } from '../lib/types';
import type { TileInfo } from '../lib/types';

/**
 * Inspector for the tile selected on the map.
 *
 * Refetched on selection and on a slow poll — this is a detail view, so it does
 * not need to ride the per-tick frame and stay in every broadcast payload.
 */
export default function TilePanel({
  selected, tick,
}: {
  selected: { x: number; y: number } | null;
  tick: number;
}) {
  const [tile, setTile] = useState<TileInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Coarsen the tick so the fetch runs a few times a minute, not every frame.
  const bucket = Math.floor(tick / 20);

  useEffect(() => {
    if (!selected) {
      setTile(null);
      return;
    }
    let cancelled = false;
    get<TileInfo>(`/api/tile?x=${selected.x}&y=${selected.y}`)
      .then((t) => {
        if (!cancelled) {
          setTile(t);
          setError(null);
        }
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [selected?.x, selected?.y, bucket]);

  if (!selected) {
    return (
      <div className="rounded-lg border border-dashed border-edge px-3 py-4 text-[12px] text-ink-muted">
        Click any tile on the map to inspect it and to target god actions.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-edge bg-surface-1 px-3 py-2.5">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[12px] font-semibold text-ink-primary">
          Tile <span className="font-mono">{selected.x}, {selected.y}</span>
        </h3>
        <span className="text-[11px] text-ink-secondary">
          {tile ? BIOME_LABEL[tile.biome] : '…'}
        </span>
      </div>

      {error && <p className="mt-2 text-[11px] text-critical">{error}</p>}

      {tile && (
        <>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
            <Row label="Food" value={tile.food} />
            <Row label="Water" value={tile.water} />
            <Row label="Wood" value={tile.wood} />
            <Row label="Stone" value={tile.stone} />
            <Row label="Capacity" value={tile.carryingCapacity} />
            <Row label="People here" value={tile.agents} />
          </dl>
          <div className="mt-2 flex flex-wrap gap-1 text-[10px]">
            <Chip label={tile.ownerName ?? 'Unclaimed'} tone={tile.owner >= 0 ? 'own' : 'none'} />
            {tile.cultivated > 0 && <Chip label={`Cultivated ×${tile.cultivated}`} tone="good" />}
            {tile.shelter > 0 && <Chip label={`Shelter ×${tile.shelter}`} tone="good" />}
            {tile.blessed > 0 && <Chip label={`Blessed ${tile.blessed}t`} tone="divine" />}
            {tile.cursed > 0 && <Chip label={`Cursed ${tile.cursed}t`} tone="bad" />}
          </div>
        </>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right font-mono tabular-nums text-ink-secondary">{value}</dd>
    </>
  );
}

function Chip({ label, tone }: { label: string; tone: 'own' | 'none' | 'good' | 'bad' | 'divine' }) {
  const cls = {
    own: 'border-edge text-ink-secondary',
    none: 'border-edge text-ink-muted',
    good: 'border-good/50 text-good',
    bad: 'border-critical/50 text-critical',
    divine: 'border-divine/50 text-divine',
  }[tone];
  return <span className={`rounded border bg-surface-2 px-1.5 py-0.5 ${cls}`}>{label}</span>;
}
