import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentFrame, TribeRow, WorldState } from '../lib/types';
import { AGENT_STATES } from '../lib/types';
import { TERRAIN, foodRamp, hexToRgb } from '../lib/palette';

export type Overlay = 'terrain' | 'territory' | 'food';

export interface Camera {
  /** World coordinate at the viewport's top-left corner. */
  x: number;
  y: number;
  /** Screen pixels per tile. */
  scale: number;
}

export interface HoverInfo {
  x: number;
  y: number;
  biome: number;
  owner: number;
  food: number | null;
  cultivated: boolean;
  shelter: boolean;
  blessed: boolean;
  cursed: boolean;
  agents: number;
  states: string[];
}

interface Props {
  world: React.MutableRefObject<WorldState | null>;
  agentHistory: React.MutableRefObject<AgentFrame[]>;
  worldVersion: number;
  tribes: TribeRow[];
  overlay: Overlay;
  showTrails: boolean;
  focusTribeId: number | null;
  selected: { x: number; y: number } | null;
  brushRadius: number;
  camera: Camera;
  onCameraChange: (c: Camera) => void;
  onSelect: (x: number, y: number) => void;
  onHover: (info: HoverInfo | null) => void;
}

export const MIN_SCALE = 1;
export const MAX_SCALE = 40;

/**
 * The zoomable world canvas.
 *
 * Terrain is painted once per frame into an offscreen canvas at one pixel per
 * tile, then blitted with `drawImage` under the camera transform. Panning and
 * zooming therefore cost one scaled blit rather than a re-rasterisation of the
 * grid, and the tiles stay crisp because smoothing is disabled.
 */
export default function MapCanvas({
  world, agentHistory, worldVersion, tribes, overlay, showTrails, focusTribeId,
  selected, brushRadius, camera, onCameraChange, onSelect, onHover,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const terrainRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const drag = useRef<{ x: number; y: number; camX: number; camY: number; moved: boolean } | null>(null);

  // Track the container so the canvas always fills the available space.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const screenToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const el = wrapRef.current;
      const w = world.current;
      if (!el || !w) return null;
      const r = el.getBoundingClientRect();
      const x = Math.floor(camera.x + (clientX - r.left) / camera.scale);
      const y = Math.floor(camera.y + (clientY - r.top) / camera.scale);
      if (x < 0 || y < 0 || x >= w.width || y >= w.height) return null;
      return { x, y };
    },
    [camera, world],
  );

  // ---------------------------------------------------------------- terrain

  useEffect(() => {
    const w = world.current;
    if (!w) return;
    let off = terrainRef.current;
    if (!off) {
      off = document.createElement('canvas');
      terrainRef.current = off;
    }
    if (off.width !== w.width || off.height !== w.height) {
      off.width = w.width;
      off.height = w.height;
    }
    const ctx = off.getContext('2d', { alpha: false });
    if (!ctx) return;

    const colorOf = new Map<number, [number, number, number]>();
    for (const t of tribes) colorOf.set(t.id, hexToRgb(t.color));

    const img = ctx.createImageData(w.width, w.height);
    const px = img.data;

    for (let i = 0; i < w.tiles.length; i++) {
      const byte = w.tiles[i];
      const biome = byte & 0b111;
      let r: number;
      let g: number;
      let b: number;

      if (overlay === 'food' && w.food) {
        // Water tiles have no forage capacity; keep them as terrain so the
        // ramp is not read as "the sea is starving".
        if (biome === 0 || biome === 1) {
          [r, g, b] = TERRAIN[biome];
          r *= 0.55; g *= 0.55; b *= 0.55;
        } else {
          [r, g, b] = foodRamp(w.food[i] / 255);
        }
      } else {
        const base = TERRAIN[biome] ?? TERRAIN[2];
        [r, g, b] = base;
        if (byte & 0b1000) { r += 26; g += 34; b -= 6; }
        if (byte & 0b100000) { r += 24; g += 30; b += 10; }
        if (byte & 0b1000000) { r = r * 0.6 + 40; g *= 0.45; b *= 0.45; }
      }

      const owner = w.owner[i];
      if (owner >= 0 && overlay !== 'food') {
        const c = colorOf.get(owner);
        if (c) {
          const dim = focusTribeId !== null && focusTribeId !== owner;
          const a = overlay === 'territory' ? (dim ? 0.12 : 0.62) : dim ? 0.08 : 0.34;
          r = r * (1 - a) + c[0] * a;
          g = g * (1 - a) + c[1] * a;
          b = b * (1 - a) + c[2] * a;
        }
      }
      if (byte & 0b10000 && overlay !== 'food') {
        r = Math.min(255, r + 55); g = Math.min(255, g + 48); b = Math.min(255, b + 34);
      }

      const o = i * 4;
      px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [worldVersion, tribes, overlay, focusTribeId, world]);

  // ------------------------------------------------------------- main draw

  useEffect(() => {
    const canvas = canvasRef.current;
    const off = terrainRef.current;
    const w = world.current;
    if (!canvas || !off || !w || size.w === 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== size.w * dpr || canvas.height !== size.h * dpr) {
      canvas.width = size.w * dpr;
      canvas.height = size.h * dpr;
    }
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0d0d0c';
    ctx.fillRect(0, 0, size.w, size.h);

    const s = camera.scale;
    const ox = -camera.x * s;
    const oy = -camera.y * s;

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, w.width, w.height, ox, oy, w.width * s, w.height * s);

    // Visible tile bounds, used to skip everything off-screen.
    const x0 = Math.max(0, Math.floor(camera.x));
    const y0 = Math.max(0, Math.floor(camera.y));
    const x1 = Math.min(w.width, Math.ceil(camera.x + size.w / s));
    const y1 = Math.min(w.height, Math.ceil(camera.y + size.h / s));

    // Tile grid — only once tiles are big enough for it to mean something.
    if (s >= 9) {
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = x0; x <= x1; x++) {
        const sx = Math.round(ox + x * s) + 0.5;
        ctx.moveTo(sx, oy + y0 * s);
        ctx.lineTo(sx, oy + y1 * s);
      }
      for (let y = y0; y <= y1; y++) {
        const sy = Math.round(oy + y * s) + 0.5;
        ctx.moveTo(ox + x0 * s, sy);
        ctx.lineTo(ox + x1 * s, sy);
      }
      ctx.stroke();
    }

    const colorOf = new Map<number, string>();
    for (const t of tribes) colorOf.set(t.id, t.color);
    const history = agentHistory.current;
    const latest = history[history.length - 1];

    // ---- movement trails: stitch each agent's recent positions by id -------
    if (showTrails && latest && history.length > 1 && s >= 3) {
      ctx.lineWidth = Math.max(1, s * 0.12);
      ctx.lineCap = 'round';
      for (let f = 1; f < history.length; f++) {
        const prev = history[f - 1];
        const cur = history[f];
        // Older segments fade out, so direction of travel reads at a glance.
        ctx.globalAlpha = 0.10 + 0.5 * (f / history.length);
        for (const [id, curOff] of cur.index) {
          const prevOff = prev.index.get(id);
          if (prevOff === undefined) continue;
          const ax = cur.data[curOff + 1];
          const ay = cur.data[curOff + 2];
          if (ax < x0 - 2 || ax > x1 + 2 || ay < y0 - 2 || ay > y1 + 2) continue;
          const bx = prev.data[prevOff + 1];
          const by = prev.data[prevOff + 2];
          if (ax === bx && ay === by) continue;
          const tribeId = cur.data[curOff + 3];
          if (focusTribeId !== null && focusTribeId !== tribeId) continue;
          ctx.strokeStyle = colorOf.get(tribeId) ?? '#888';
          ctx.beginPath();
          ctx.moveTo(ox + (bx + 0.5) * s, oy + (by + 0.5) * s);
          ctx.lineTo(ox + (ax + 0.5) * s, oy + (ay + 0.5) * s);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }

    // ---- agents -------------------------------------------------------------
    const radius = Math.max(1, s * 0.26);
    if (latest) {
      const d = latest.data;
      for (let o = 0; o < d.length; o += 7) {
        const ax = d[o + 1];
        const ay = d[o + 2];
        if (ax < x0 - 1 || ax > x1 + 1 || ay < y0 - 1 || ay > y1 + 1) continue;
        const tribeId = d[o + 3];
        const dim = focusTribeId !== null && focusTribeId !== tribeId;
        const cx = ox + (ax + 0.5) * s;
        const cy = oy + (ay + 0.5) * s;

        // Heading tick toward the agent's current target.
        if (s >= 8 && !dim) {
          const tx = d[o + 5];
          const ty = d[o + 6];
          if (tx >= 0 && ty >= 0 && (tx !== ax || ty !== ay)) {
            const len = Math.hypot(tx - ax, ty - ay);
            ctx.strokeStyle = 'rgba(255,255,255,0.32)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + ((tx - ax) / len) * s * 0.85, cy + ((ty - ay) / len) * s * 0.85);
            ctx.stroke();
          }
        }

        ctx.globalAlpha = dim ? 0.25 : 1;
        ctx.fillStyle = colorOf.get(tribeId) ?? '#aaa';
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
        // A surface ring keeps overlapping agents countable.
        if (s >= 7) {
          ctx.strokeStyle = 'rgba(13,13,12,0.85)';
          ctx.lineWidth = Math.max(1, s * 0.05);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    } else {
      // No detail stream yet: fall back to the lean position buffer.
      const a = w.agents;
      for (let k = 0; k < a.length; k += 3) {
        const cx = ox + (a[k] + 0.5) * s;
        const cy = oy + (a[k + 1] + 0.5) * s;
        ctx.fillStyle = colorOf.get(a[k + 2]) ?? '#aaa';
        ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
      }
    }

    // ---- camps --------------------------------------------------------------
    for (const t of tribes) {
      const cx = ox + (t.cx + 0.5) * s;
      const cy = oy + (t.cy + 0.5) * s;
      if (cx < -60 || cy < -60 || cx > size.w + 60 || cy > size.h + 60) continue;
      const dim = focusTribeId !== null && focusTribeId !== t.id;
      ctx.globalAlpha = dim ? 0.3 : 1;
      const r = Math.max(5, s * 0.7);
      ctx.strokeStyle = t.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = t.color;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(2, r * 0.32), 0, Math.PI * 2);
      ctx.fill();

      if (s >= 4) {
        const label = `${t.glyph} ${t.name.replace('Tribe of the ', '')}`;
        ctx.font = '600 12px ui-monospace, SFMono-Regular, Menlo, monospace';
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(13,13,12,0.78)';
        ctx.fillRect(cx - tw / 2 - 4, cy + r + 3, tw + 8, 16);
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(label, cx, cy + r + 6);
      }
      ctx.globalAlpha = 1;
    }

    // ---- selection + brush preview -----------------------------------------
    if (selected) {
      const cx = ox + (selected.x + 0.5) * s;
      const cy = oy + (selected.y + 0.5) * s;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.strokeRect(ox + selected.x * s, oy + selected.y * s, s, s);
      if (brushRadius > 0) {
        ctx.setLineDash([6, 4]);
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(cx, cy, brushRadius * s, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
    }
  }, [
    worldVersion, size, camera, tribes, selected, brushRadius, focusTribeId,
    showTrails, world, agentHistory,
  ]);

  // ------------------------------------------------------------ interaction

  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = clientX - r.left;
    const py = clientY - r.top;
    const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, camera.scale * factor));
    if (next === camera.scale) return;
    // Keep the world point under the cursor pinned while the scale changes.
    onCameraChange({
      x: camera.x + px / camera.scale - px / next,
      y: camera.y + py / camera.scale - py / next,
      scale: next,
    });
  };

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full overflow-hidden bg-surface-0"
      style={{ cursor: drag.current ? 'grabbing' : 'crosshair' }}
      onWheel={(e) => zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15)}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, camX: camera.x, camY: camera.y, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d) {
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true;
          onCameraChange({
            x: d.camX - dx / camera.scale,
            y: d.camY - dy / camera.scale,
            scale: camera.scale,
          });
          return;
        }
        const t = screenToWorld(e.clientX, e.clientY);
        const w = world.current;
        if (!t || !w) {
          onHover(null);
          return;
        }
        const i = t.y * w.width + t.x;
        const byte = w.tiles[i];
        const latest = agentHistory.current[agentHistory.current.length - 1];
        const states: string[] = [];
        let count = 0;
        if (latest) {
          const d2 = latest.data;
          for (let o = 0; o < d2.length; o += 7) {
            if (d2[o + 1] === t.x && d2[o + 2] === t.y) {
              count++;
              if (states.length < 6) states.push(AGENT_STATES[d2[o + 4]] ?? 'rest');
            }
          }
        }
        onHover({
          x: t.x,
          y: t.y,
          biome: byte & 0b111,
          owner: w.owner[i],
          food: w.food ? Math.round((w.food[i] / 255) * 100) : null,
          cultivated: !!(byte & 0b1000),
          shelter: !!(byte & 0b10000),
          blessed: !!(byte & 0b100000),
          cursed: !!(byte & 0b1000000),
          agents: count,
          states,
        });
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (d && !d.moved) {
          const t = screenToWorld(e.clientX, e.clientY);
          if (t) onSelect(t.x, t.y);
        }
      }}
      onPointerLeave={() => {
        drag.current = null;
        onHover(null);
      }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
