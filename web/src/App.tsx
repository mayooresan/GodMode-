import { useEffect, useState } from 'react';
import EventLog from './components/EventLog';
import GodConsole from './components/GodConsole';
import TilePanel from './components/TilePanel';
import TribeTable from './components/TribeTable';
import MapPage from './components/MapPage';
import WorldMap from './components/WorldMap';
import VitalsCard from './components/VitalsCard';
import { useSimStream } from './lib/useSimStream';

const CONNECTION_TONE = {
  live: { dot: 'bg-good', label: 'live' },
  connecting: { dot: 'bg-warning animate-pulse', label: 'connecting' },
  offline: { dot: 'bg-critical', label: 'offline' },
} as const;

/**
 * Hash routing rather than a router dependency: two views, and the hash keeps
 * deep links working against the server's SPA fallback with no extra config.
 */
function useHashRoute(): string {
  const [route, setRoute] = useState(() => window.location.hash.replace(/^#\/?/, ''));
  useEffect(() => {
    const onHash = () => setRoute(window.location.hash.replace(/^#\/?/, ''));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}

export default function App() {
  const route = useHashRoute();
  const isMap = route === 'map';
  // The map view opts into the heavier stream: agent ids, states, targets and
  // the forage overlay. The dashboard never pays for them.
  const { connection, vitals, tribes, events, world, worldVersion, agentHistory } =
    useSimStream(isMap);
  const [selected, setSelected] = useState<{ x: number; y: number } | null>(null);
  const [radius, setRadius] = useState(4);
  const [focusTribeId, setFocusTribeId] = useState<number | null>(null);

  const conn = CONNECTION_TONE[connection];

  if (isMap) {
    return (
      <MapPage
        world={world}
        agentHistory={agentHistory}
        worldVersion={worldVersion}
        tribes={tribes}
        vitals={vitals}
        connection={connection}
      />
    );
  }

  return (
    /*
     * Dashboard shell: on wide screens the page never scrolls — the three
     * columns fill the viewport and each pane scrolls internally, so the map,
     * the tribal table, the ticker and the console are all on screen at once.
     * Below xl it degrades to ordinary document flow and stacks.
     */
    <div className="flex min-h-screen flex-col bg-surface-0 text-ink-primary xl:h-screen xl:overflow-hidden">
      <header className="shrink-0 border-b border-edge bg-surface-0">
        <div className="mx-auto flex max-w-[2100px] flex-wrap items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex items-baseline gap-3">
            <h1 className="text-base font-semibold tracking-tight">
              God Mode <span className="text-ink-muted">/ Civilisation Telemetry</span>
            </h1>
            {vitals && (
              <span className="font-mono text-[11px] text-ink-muted">
                tick {vitals.tick.toLocaleString()} · year {vitals.year} · {vitals.season}
              </span>
            )}
          </div>
          <span className="flex items-center gap-3 text-[11px] text-ink-secondary">
            <a
              href="#/map"
              className="rounded border border-divine/60 bg-divine/10 px-2 py-1 text-divine transition-colors hover:bg-divine/20"
            >
              ⛶ Tactical map
            </a>
            <span className={`h-2 w-2 rounded-full ${conn.dot}`} />
            {conn.label}
            {vitals?.paused && <span className="ml-2 text-divine">— time halted</span>}
          </span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[2100px] flex-1 flex-col gap-3 px-4 py-3 xl:min-h-0">
        <div className="shrink-0">
          <VitalsCard vitals={vitals} connection={connection} />
        </div>

        <div className="grid min-w-0 gap-3 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(340px,30%)_minmax(0,1fr)_minmax(300px,21%)]">
          {/* Map + tile inspector */}
          <div className="flex min-w-0 flex-col gap-3 xl:min-h-0 xl:overflow-auto">
            <div className="shrink-0 rounded-lg border border-edge bg-surface-1 p-3">
              <WorldMap
                world={world}
                worldVersion={worldVersion}
                tribes={tribes}
                selected={selected}
                onSelect={(x, y) => setSelected({ x, y })}
                brushRadius={radius}
                focusTribeId={focusTribeId}
              />
            </div>
            <TilePanel selected={selected} tick={vitals?.tick ?? 0} />
          </div>

          {/* Tribes + events */}
          <div className="grid min-w-0 gap-3 xl:min-h-0 xl:grid-rows-[1.15fr_1fr]">
            <div className="min-w-0 xl:min-h-0 min-h-[300px]">
              <TribeTable tribes={tribes} focusTribeId={focusTribeId} onFocus={setFocusTribeId} />
            </div>
            <div className="min-w-0 xl:min-h-0 min-h-[260px]">
              <EventLog
                events={events}
                tribes={tribes}
                onLocate={(x, y) => setSelected({ x, y })}
              />
            </div>
          </div>

          {/* God console */}
          <div className="min-w-0 xl:min-h-0 min-h-[400px]">
            <GodConsole
              vitals={vitals}
              tribes={tribes}
              selected={selected}
              radius={radius}
              onRadiusChange={setRadius}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
