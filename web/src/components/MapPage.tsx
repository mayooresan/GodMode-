import { useEffect, useRef, useState } from 'react';
import MapCanvas, { MAX_SCALE, MIN_SCALE } from './MapCanvas';
import type { Camera, HoverInfo, Overlay } from './MapCanvas';
import GodConsole from './GodConsole';
import { BIOME_LABEL, STATE_LABEL } from '../lib/types';
import type { AgentFrame, TribeRow, Vitals, WorldState } from '../lib/types';
import type { ConnectionState } from '../lib/useSimStream';

const OVERLAYS: Array<{ id: Overlay; label: string; hint: string }> = [
  { id: 'terrain', label: 'Terrain', hint: 'Biomes with a light territorial wash' },
  { id: 'territory', label: 'Territory', hint: 'Tribal claims at full strength' },
  { id: 'food', label: 'Forage', hint: 'Food saturation — find droughts worth blessing' },
];

interface Props {
  world: React.MutableRefObject<WorldState | null>;
  agentHistory: React.MutableRefObject<AgentFrame[]>;
  worldVersion: number;
  tribes: TribeRow[];
  vitals: Vitals | null;
  connection: ConnectionState;
  states: string[];
}

/**
 * Full-screen tactical view.
 *
 * The dashboard answers "how is the world doing"; this answers "what is
 * happening right here" — close enough to watch individual people walk, with
 * god actions targeted by clicking the tile you are looking at.
 */
export default function MapPage({
  world, agentHistory, worldVersion, tribes, vitals, connection, states,
}: Props) {
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, scale: 6 });
  const [overlay, setOverlay] = useState<Overlay>('terrain');
  const [showTrails, setShowTrails] = useState(true);
  const [focusTribeId, setFocusTribeId] = useState<number | null>(null);
  const [selected, setSelected] = useState<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [radius, setRadius] = useState(4);
  const [consoleOpen, setConsoleOpen] = useState(true);
  const viewportRef = useRef<HTMLDivElement>(null);
  /** Set once the viewer pans or zooms; suppresses automatic refitting. */
  const userMoved = useRef(false);
  /** Whether the world has been framed at least once. */
  const hasFramed = useRef(false);
  const [vp, setVp] = useState({ w: 0, h: 0 });

  /**
   * Frame the whole world.
   *
   * Reads the element's size directly rather than from state: on the first
   * paint the flex container has no size yet, and a state value that lags by a
   * render leaves the camera stuck at the minimum zoom. Returns whether it
   * actually managed to fit.
   */
  const fit = (): boolean => {
    const el = viewportRef.current;
    const w = world.current;
    if (!el || !w) return false;
    const vw = el.clientWidth;
    const vh = el.clientHeight;
    if (vw === 0 || vh === 0) return false;
    const scale = Math.max(MIN_SCALE, Math.min(vw / w.width, vh / w.height));
    userMoved.current = false;
    setCamera({
      x: (w.width - vw / scale) / 2,
      y: (w.height - vh / scale) / 2,
      scale,
    });
    return true;
  };

  // Measure the viewport so a window resize can re-frame the world.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setVp({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setVp({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Guarantee one successful framing once terrain and layout are both ready.
  // Retries on every frame until it succeeds, then never again.
  useEffect(() => {
    if (hasFramed.current) return;
    if (fit()) hasFramed.current = true;
  }, [vp.w, vp.h, worldVersion]);

  // Re-frame on resize, but only while the viewer has not taken manual control.
  useEffect(() => {
    if (hasFramed.current && !userMoved.current) fit();
  }, [vp.w, vp.h]);

  /** Camera changes that came from the viewer, which stop automatic refitting. */
  const moveCamera = (c: Camera) => {
    userMoved.current = true;
    setCamera(c);
  };

  const zoom = (factor: number) => {
    const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, camera.scale * factor));
    const cx = vp.w / 2;
    const cy = vp.h / 2;
    userMoved.current = true;
    setCamera({
      x: camera.x + cx / camera.scale - cx / next,
      y: camera.y + cy / camera.scale - cy / next,
      scale: next,
    });
  };

  /** Centre the view on a tribe's camp without changing zoom. */
  const goToTribe = (t: TribeRow) => {
    if (vp.w === 0) return;
    userMoved.current = true;
    setCamera((c) => ({
      ...c,
      x: t.cx - vp.w / c.scale / 2,
      y: t.cy - vp.h / c.scale / 2,
    }));
    setSelected({ x: t.cx, y: t.cy });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === '+' || e.key === '=') zoom(1.25);
      else if (e.key === '-' || e.key === '_') zoom(1 / 1.25);
      else if (e.key === 'f') fit();
      else if (e.key === 't') setShowTrails((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [camera, vp]);

  const readout = hover;
  const conn = connection === 'live' ? 'bg-good' : connection === 'connecting' ? 'bg-warning animate-pulse' : 'bg-critical';

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-surface-0 text-ink-primary">
      {/* ------------------------------------------------------------- top bar */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-edge px-3 py-2">
        <a
          href="#/"
          className="rounded border border-edge bg-surface-2 px-2 py-1 text-[11px] text-ink-secondary hover:border-ink-muted hover:text-ink-primary"
        >
          ← Dashboard
        </a>
        <a href="#/history" className="rounded border border-edge bg-surface-2 px-2 py-1 text-[11px] text-ink-secondary hover:border-ink-muted hover:text-ink-primary">◷ History</a>
        <a
          href="#/tribes"
          className="rounded border border-edge bg-surface-2 px-2 py-1 text-[11px] text-ink-secondary hover:border-ink-muted hover:text-ink-primary"
        >
          ▦ Tribal stats
        </a>
        <h1 className="text-sm font-semibold">Tactical Map</h1>
        {vitals && (
          <span className="font-mono text-[11px] text-ink-muted">
            tick {vitals.tick.toLocaleString()} · {vitals.population} alive · {vitals.tribes} tribes
          </span>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <div className="flex overflow-hidden rounded border border-edge">
            {OVERLAYS.map((o) => (
              <button
                key={o.id}
                title={o.hint}
                onClick={() => setOverlay(o.id)}
                className={`px-2 py-1 text-[11px] transition-colors ${
                  overlay === o.id
                    ? 'bg-surface-3 text-ink-primary'
                    : 'bg-surface-1 text-ink-muted hover:text-ink-secondary'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowTrails((v) => !v)}
            title="Toggle movement trails (t)"
            className={`rounded border px-2 py-1 text-[11px] transition-colors ${
              showTrails
                ? 'border-divine/60 bg-divine/10 text-divine'
                : 'border-edge bg-surface-1 text-ink-muted hover:text-ink-secondary'
            }`}
          >
            ⟿ Trails
          </button>

          <select
            value={focusTribeId ?? ''}
            onChange={(e) => {
              const v = e.target.value === '' ? null : Number(e.target.value);
              setFocusTribeId(v);
              const t = tribes.find((x) => x.id === v);
              if (t) goToTribe(t);
            }}
            className="rounded border border-edge bg-surface-1 px-2 py-1 text-[11px] text-ink-primary outline-none focus:border-divine"
          >
            <option value="">All tribes</option>
            {tribes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.glyph} {t.name.replace('Tribe of the ', '')}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1">
            <button onClick={() => zoom(1 / 1.25)} className="rounded border border-edge bg-surface-1 px-2 py-1 text-[11px] text-ink-secondary hover:text-ink-primary">−</button>
            <span className="w-16 text-center font-mono text-[11px] tabular-nums text-ink-muted">
              {camera.scale.toFixed(1)} px/tile
            </span>
            <button onClick={() => zoom(1.25)} className="rounded border border-edge bg-surface-1 px-2 py-1 text-[11px] text-ink-secondary hover:text-ink-primary">+</button>
            <button onClick={fit} title="Fit world (f)" className="rounded border border-edge bg-surface-1 px-2 py-1 text-[11px] text-ink-secondary hover:text-ink-primary">Fit</button>
          </div>

          <button
            onClick={() => setConsoleOpen((v) => !v)}
            className="rounded border border-divine/60 bg-divine/10 px-2 py-1 text-[11px] text-divine hover:bg-divine/20"
          >
            {consoleOpen ? 'Hide console' : '⚡ God console'}
          </button>

          <span className={`ml-1 h-2 w-2 rounded-full ${conn}`} title={connection} />
        </div>
      </header>

      {/* ---------------------------------------------------------------- body */}
      <div className="flex min-h-0 flex-1">
        <div ref={viewportRef} className="relative min-w-0 flex-1">
          <MapCanvas
            world={world}
            agentHistory={agentHistory}
            worldVersion={worldVersion}
            tribes={tribes}
            overlay={overlay}
            showTrails={showTrails}
            focusTribeId={focusTribeId}
            states={states}
            selected={selected}
            brushRadius={radius}
            camera={camera}
            onCameraChange={moveCamera}
            onSelect={(x, y) => setSelected({ x, y })}
            onHover={setHover}
          />

          {/* Hover / selection readout */}
          <div className="pointer-events-none absolute bottom-3 left-3 max-w-xs rounded-lg border border-edge bg-surface-1/95 px-3 py-2 text-[11px] backdrop-blur">
            {readout ? (
              <>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-ink-primary">{readout.x}, {readout.y}</span>
                  <span className="text-ink-secondary">{BIOME_LABEL[readout.biome]}</span>
                </div>
                <div className="mt-1 space-y-0.5 text-ink-muted">
                  {readout.food !== null && <div>Forage <span className="text-ink-secondary">{readout.food}% of capacity</span></div>}
                  <div>
                    Owner{' '}
                    <span className="text-ink-secondary">
                      {readout.owner >= 0
                        ? tribes.find((t) => t.id === readout.owner)?.name ?? `Tribe ${readout.owner}`
                        : 'unclaimed'}
                    </span>
                  </div>
                  {readout.agents > 0 && (
                    <div>
                      {readout.agents} {readout.agents === 1 ? 'person' : 'people'}{' '}
                      <span className="text-ink-secondary">
                        {[...new Set(readout.states)].map((s) => STATE_LABEL[s] ?? s).join(', ')}
                      </span>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {readout.cultivated && <Tag tone="good">cultivated</Tag>}
                    {readout.shelter && <Tag tone="good">shelter</Tag>}
                    {readout.blessed && <Tag tone="divine">blessed</Tag>}
                    {readout.cursed && <Tag tone="bad">cursed</Tag>}
                  </div>
                </div>
              </>
            ) : (
              <span className="text-ink-muted">
                Drag to pan · scroll to zoom · click a tile to target
              </span>
            )}
          </div>

          {selected && (
            <div className="absolute right-3 top-3 rounded-lg border border-edge bg-surface-1/95 px-3 py-2 font-mono text-[11px] text-ink-secondary backdrop-blur">
              target <span className="text-ink-primary">{selected.x}, {selected.y}</span> · r{radius}
            </div>
          )}
        </div>

        {consoleOpen && (
          <aside className="w-[320px] shrink-0 border-l border-edge">
            <GodConsole
              vitals={vitals}
              tribes={tribes}
              selected={selected}
              radius={radius}
              onRadiusChange={setRadius}
            />
          </aside>
        )}
      </div>
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
