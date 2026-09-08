import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentFrame, TribeRow, Vitals, WorldEvent, WorldState } from './types';

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

const b64ToInt32 = (b64: string): Int32Array => {
  const bytes = b64ToBytes(b64);
  return new Int32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
};

/** Index a detail payload by agent id so consecutive frames can be stitched. */
const toAgentFrame = (tick: number, data: Int32Array): AgentFrame => {
  const index = new Map<number, number>();
  for (let o = 0; o < data.length; o += 7) index.set(data[o], o);
  return { tick, index, data };
};

/** How many frames of positions to retain for movement trails. */
const TRAIL_FRAMES = 10;

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
  /** Recent agent-detail frames, oldest first. Empty unless `detail` was set. */
  agentHistory: React.MutableRefObject<AgentFrame[]>;
  /** Agent-state ids in wire order, as declared by the server's init payload. */
  states: string[];
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
export function useSimStream(detail = false): Stream {
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [vitals, setVitals] = useState<Vitals | null>(null);
  const [tribes, setTribes] = useState<TribeRow[]>([]);
  const [events, setEvents] = useState<WorldEvent[]>([]);
  const [worldVersion, setWorldVersion] = useState(0);
  const [states, setStates] = useState<string[]>([]);
  const world = useRef<WorldState | null>(null);
  const agentHistory = useRef<AgentFrame[]>([]);

  const bump = useCallback(() => setWorldVersion((v) => v + 1), []);

  useEffect(() => {
    let source: EventSource | null = null;
    let retry: number | undefined;
    let closed = false;

    const connect = () => {
      if (closed) return;
      setConnection((c) => (c === 'live' ? c : 'connecting'));
      source = new EventSource(detail ? '/api/stream?detail=1' : '/api/stream');

      source.addEventListener('init', (ev) => {
        const data = JSON.parse((ev as MessageEvent).data);
        world.current = {
          width: data.terrain.width,
          height: data.terrain.height,
          tiles: b64ToBytes(data.terrain.tiles),
          owner: b64ToInt16(data.terrain.owner),
          agents: b64ToInt16(data.agents),
          food: data.food ? b64ToBytes(data.food) : null,
        };
        agentHistory.current = data.agentsDetail
          ? [toAgentFrame(data.vitals.tick, b64ToInt32(data.agentsDetail))]
          : [];
        setVitals(data.vitals);
        setTribes(data.tribes);
        setEvents(data.events.slice(-EVENT_LIMIT));
        if (Array.isArray(data.states)) setStates(data.states);
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
          if (data.food) w.food = b64ToBytes(data.food);
          if (data.agentsDetail) {
            agentHistory.current = [
              ...agentHistory.current,
              toAgentFrame(data.tick, b64ToInt32(data.agentsDetail)),
            ].slice(-TRAIL_FRAMES);
          }
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
        agentHistory.current = [];
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
  }, [bump, detail]);

  return { connection, vitals, tribes, events, world, worldVersion, agentHistory, states };
}
