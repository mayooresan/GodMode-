import { useEffect, useRef, useState } from 'react';
import type { TribeRow, WorldEvent } from '../lib/types';

const SEVERITY: Record<string, { dot: string; text: string }> = {
  info: { dot: 'bg-ink-muted', text: 'text-ink-secondary' },
  warn: { dot: 'bg-warning', text: 'text-ink-secondary' },
  critical: { dot: 'bg-critical', text: 'text-ink-primary' },
  divine: { dot: 'bg-divine', text: 'text-divine' },
};

interface Filter {
  id: string;
  label: string;
  kinds?: readonly string[];
}

const FILTERS: readonly Filter[] = [
  { id: 'all', label: 'All' },
  { id: 'conflict', label: 'Conflict', kinds: ['war', 'battle', 'peace', 'extinction'] },
  { id: 'culture', label: 'Culture', kinds: ['discovery', 'settlement', 'migration', 'trade'] },
  { id: 'calamity', label: 'Calamity', kinds: ['disaster', 'death'] },
  { id: 'divine', label: 'Divine', kinds: ['divine', 'birth_wave'] },
];

/**
 * Real-time world ticker.
 *
 * Auto-scroll sticks to the newest entry only while the reader is already at
 * the bottom; scrolling up to read history is never yanked away by the stream.
 */
export default function EventLog({
  events, tribes, onLocate,
}: {
  events: WorldEvent[];
  tribes: TribeRow[];
  onLocate: (x: number, y: number) => void;
}) {
  const [filter, setFilter] = useState<string>('all');
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const active = FILTERS.find((f) => f.id === filter);
  const shown = events.filter(
    (e) => filter === 'all' || active?.kinds?.includes(e.kind) === true,
  );

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [shown.length]);

  const colorOf = (id?: number) => tribes.find((t) => t.id === id)?.color;

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col rounded-lg border border-edge bg-surface-1">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-3 py-2.5">
        <h2 className="text-sm font-semibold text-ink-primary">World Event Log</h2>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded px-2 py-1 text-[10px] uppercase tracking-wide transition-colors ${
                filter === f.id
                  ? 'bg-surface-3 text-ink-primary'
                  : 'text-ink-muted hover:bg-surface-2 hover:text-ink-secondary'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </header>

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="min-h-0 flex-1 overflow-auto px-3 py-2"
      >
        {shown.length === 0 && (
          <p className="py-6 text-center text-[12px] text-ink-muted">
            Nothing has happened yet under this filter.
          </p>
        )}
        <ul className="space-y-1">
          {shown.map((e, i) => {
            const tone = SEVERITY[e.severity] ?? SEVERITY.info;
            const locatable = e.x !== undefined && e.y !== undefined;
            return (
              <li
                key={`${e.tick}-${i}-${e.at}`}
                className="event-enter flex items-start gap-2 rounded px-1 py-1 text-[12px] leading-snug hover:bg-surface-2"
              >
                <span className={`mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} />
                <span className="mt-px w-12 shrink-0 font-mono text-[10px] tabular-nums text-ink-muted">
                  {e.tick}
                </span>
                {e.tribeId !== undefined && colorOf(e.tribeId) && (
                  <span
                    className="mt-[5px] h-2 w-2 shrink-0 rounded-[2px]"
                    style={{ background: colorOf(e.tribeId) }}
                  />
                )}
                <span className={tone.text}>
                  {e.text}
                  {locatable && (
                    <button
                      onClick={() => onLocate(e.x!, e.y!)}
                      className="ml-1.5 font-mono text-[10px] text-ink-muted underline decoration-dotted underline-offset-2 hover:text-ink-primary"
                    >
                      {e.x},{e.y}
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
