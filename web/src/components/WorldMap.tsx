import { useEffect, useRef, useState } from 'react';
import type { TribeRow, WorldState } from '../lib/types';
import { BIOME_LABEL } from '../lib/types';
import { TERRAIN, hexToRgb } from '../lib/palette';

interface Props {
  world: React.MutableRefObject<WorldState | null>;
  worldVersion: number;
  tribes: TribeRow[];
  selected: { x: number; y: number } | null;
  onSelect: (x: number, y: number) => void;
  /** Radius preview ring for the currently armed god action. */
  brushRadius: number;
  focusTribeId: number | null;
}

export default function WorldMap({
  world, worldVersion, tribes, selected, onSelect, brushRadius, focusTribeId,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);

  // Repaint whenever the buffers change. One ImageData write per frame beats
  // any per-tile DOM approach by orders of magnitude.
  useEffect(() => {
    const w = world.current;
    const canvas = canvasRef.current;
    if (!w || !canvas) return;

    if (canvas.width !== w.width || canvas.height !== w.height) {
      canvas.width = w.width;
      canvas.height = w.height;
    }
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const colorOf = new Map<number, [number, number, number]>();
    for (const t of tribes) colorOf.set(t.id, hexToRgb(t.color));

    const img = ctx.createImageData(w.width, w.height);
    const px = img.data;

    for (let i = 0; i < w.tiles.length; i++) {
      const byte = w.tiles[i];
      const base = TERRAIN[byte & 0b111] ?? TERRAIN[2];
      let r = base[0];
      let g = base[1];
      let b = base[2];

      if (byte & 0b1000) {           // cultivated plot
        r += 26; g += 34; b -= 6;
      }
      if (byte & 0b100000) {          // blessed
        r += 24; g += 30; b += 10;
      }
      if (byte & 0b1000000) {         // cursed
        r = r * 0.6 + 40; g = g * 0.45; b = b * 0.45;
      }

      // Territory wash — kept light so terrain stays legible underneath.
      const owner = w.owner[i];
      if (owner >= 0) {
        const c = colorOf.get(owner);
        if (c) {
          const a = focusTribeId === null || focusTribeId === owner ? 0.34 : 0.08;
          r = r * (1 - a) + c[0] * a;
          g = g * (1 - a) + c[1] * a;
          b = b * (1 - a) + c[2] * a;
        }
      }

      if (byte & 0b10000) {           // shelter / hut
        r = Math.min(255, r + 55); g = Math.min(255, g + 48); b = Math.min(255, b + 34);
      }

      const o = i * 4;
      px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255;
    }

    // Agents last, at full tribal colour, so populations read as bright motes.
    const a = w.agents;
    for (let k = 0; k < a.length; k += 3) {
      const x = a[k];
      const y = a[k + 1];
      if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue;
      const c = colorOf.get(a[k + 2]);
      if (!c) continue;
      const dim = focusTribeId !== null && focusTribeId !== a[k + 2];
      const o = (y * w.width + x) * 4;
      const m = dim ? 0.4 : 1;
      px[o] = px[o] * (1 - m) + Math.min(255, c[0] + 70) * m;
      px[o + 1] = px[o + 1] * (1 - m) + Math.min(255, c[1] + 70) * m;
      px[o + 2] = px[o + 2] * (1 - m) + Math.min(255, c[2] + 70) * m;
    }

    ctx.putImageData(img, 0, 0);
  }, [worldVersion, tribes, world, focusTribeId]);

  const dims = world.current;

  const tileFromEvent = (e: React.MouseEvent): { x: number; y: number } | null => {
    const el = wrapRef.current;
    const w = world.current;
    if (!el || !w) return null;
    const r = el.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * w.width);
    const y = Math.floor(((e.clientY - r.top) / r.height) * w.height);
    if (x < 0 || y < 0 || x >= w.width || y >= w.height) return null;
    return { x, y };
  };

  const pct = (v: number, total: number) => `${(((v + 0.5) / total) * 100).toFixed(3)}%`;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-baseline justify-between px-1 pb-2">
        <h2 className="text-sm font-semibold text-ink-primary">World Map</h2>
        <p className="font-mono text-[11px] text-ink-muted">
          {hover ? `${hover.x}, ${hover.y}` : dims ? `${dims.width} x ${dims.height}` : '—'}
        </p>
      </div>

      <div
        ref={wrapRef}
        className="relative aspect-square w-full cursor-crosshair overflow-hidden rounded-lg border border-edge bg-surface-1"
        onMouseMove={(e) => setHover(tileFromEvent(e))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          const t = tileFromEvent(e);
          if (t) onSelect(t.x, t.y);
        }}
      >
        <canvas ref={canvasRef} className="pixelated h-full w-full" />

        {/* Markers live in an SVG overlay so text stays crisp at any scale. */}
        {dims && (
          <svg
            viewBox={`0 0 ${dims.width} ${dims.height}`}
            className="pointer-events-none absolute inset-0 h-full w-full"
          >
            {tribes.map((t) => (
              <g key={t.id} opacity={focusTribeId === null || focusTribeId === t.id ? 1 : 0.3}>
                <circle
                  cx={t.cx + 0.5}
                  cy={t.cy + 0.5}
                  r={2.6}
                  fill="none"
                  stroke={t.color}
                  strokeWidth={1.1}
                />
                {/* 2px surface ring keeps overlapping camp markers separable. */}
                <circle
                  cx={t.cx + 0.5}
                  cy={t.cy + 0.5}
                  r={1.2}
                  fill={t.color}
                  stroke="#1a1a19"
                  strokeWidth={0.7}
                />
              </g>
            ))}

            {selected && (
              <>
                <circle
                  cx={selected.x + 0.5}
                  cy={selected.y + 0.5}
                  r={Math.max(brushRadius, 0.8)}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth={0.6}
                  strokeDasharray="2 1.5"
                  opacity={0.85}
                />
                <rect
                  x={selected.x}
                  y={selected.y}
                  width={1}
                  height={1}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth={0.5}
                />
              </>
            )}
          </svg>
        )}

        {/* Camp labels sit in the DOM so they use real type, not SVG text at 1px. */}
        {dims &&
          tribes.map((t) => (
            <span
              key={t.id}
              className="pointer-events-none absolute -translate-x-1/2 translate-y-1.5 whitespace-nowrap text-[10px] leading-none"
              style={{
                left: pct(t.cx, dims.width),
                top: pct(t.cy, dims.height),
                opacity: focusTribeId === null || focusTribeId === t.id ? 1 : 0.25,
              }}
              title={t.name}
            >
              {t.glyph}
            </span>
          ))}
      </div>

      <Legend />
    </div>
  );
}

function Legend() {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 px-1 text-[11px] text-ink-muted">
      {TERRAIN.map((c, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: `rgb(${c[0]},${c[1]},${c[2]})` }}
          />
          {BIOME_LABEL[i]}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-sm bg-white/70" />
        Huts
      </span>
    </div>
  );
}
