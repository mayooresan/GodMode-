import { useCallback, useEffect, useRef, useState } from 'react';
import type { TribeRow, Vitals, WorldEvent, WorldState } from './types';

const b64ToBytes = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const b64ToInt16 = (b64: string): Int16Array => {
  const bytes = b64ToBytes(b64);
  return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
};

export type ConnectionState = 'connecting' | 'live' | 'offline';

interface Stream {
  connection: ConnectionState;
  vitals: Vitals | null;
  tribes: TribeRow[];
  events: WorldEvent[];
  /** Mutated in place and versioned — the canvas reads it without re-rendering. */
  world: React.MutableRefObject<WorldState | null>;
  /** Bumps whenever the world buffers change, so the map knows to repaint. */
  worldVersion: number;
}

const EVENT_LIMIT = 300;

/**
 * Subscribes to the engine's SSE stream.
 *
 * The terrain arrives once as base64 typed arrays and is then patched by
 * per-tick diffs; agent positions are re-sent packed each frame. Keeping those
 * buffers in a ref (rather than React state) means a 128x128 world repaints
 * through one canvas draw instead of a reconciliation pass.
 */
export function useSimStream(): Stream {
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [vitals, setVitals] = useState<Vitals | null>(null);
  const [tribes, setTribes] = useState<TribeRow[]>([]);
  const [events, setEvents] = useState<WorldEvent[]>([]);
  const [worldVersion, setWorldVersion] = useState(0);
  const world = useRef<WorldState | null>(null);

  const bump = useCallback(() => setWorldVersion((v) => v + 1), []);

  useEffect(() => {
    let source: EventSource | null = null;
    let retry: number | undefined;
    let closed = false;

    const connect = () => {
      if (closed) return;
      setConnection((c) => (c === 'live' ? c : 'connecting'));
      source = new EventSource('/api/stream');

      source.addEventListener('init', (ev) => {
        const data = JSON.parse((ev as MessageEvent).data);
        world.current = {
          width: data.terrain.width,
          height: data.terrain.height,
          tiles: b64ToBytes(data.terrain.tiles),
          owner: b64ToInt16(data.terrain.owner),
          agents: b64ToInt16(data.agents),
        };
        setVitals(data.vitals);
        setTribes(data.tribes);
        setEvents(data.events.slice(-EVENT_LIMIT));
        setConnection('live');
        bump();
      });

      source.addEventListener('frame', (ev) => {
        const data = JSON.parse((ev as MessageEvent).data);
        const w = world.current;
        if (w) {
          // Diffs arrive as flat [index, renderByte, owner] triples.
          const d: number[] = data.tiles ?? [];
          for (let k = 0; k < d.length; k += 3) {
            w.tiles[d[k]] = d[k + 1];
            w.owner[d[k]] = d[k + 2];
          }
          w.agents = b64ToInt16(data.agents);
          bump();
        }
        setVitals(data.vitals);
        setTribes(data.tribes);
        if (data.events?.length) {
          setEvents((prev) => [...prev, ...data.events].slice(-EVENT_LIMIT));
        }
      });

      // The engine was reset: drop local buffers and re-handshake.
      source.addEventListener('reset', () => {
        source?.close();
        world.current = null;
        connect();
      });

      source.onerror = () => {
        source?.close();
        setConnection('offline');
        // EventSource retries on its own, but only for transport errors; an
        // explicit backoff also covers a server that restarted mid-stream.
        retry = window.setTimeout(connect, 2000);
      };
    };

    connect();
    return () => {
      closed = true;
      if (retry) window.clearTimeout(retry);
      source?.close();
    };
  }, [bump]);

  return { connection, vitals, tribes, events, world, worldVersion };
}
