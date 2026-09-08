import { useState } from 'react';
import { getToken, god, setToken } from '../lib/api';
import type { TribeRow, Vitals } from '../lib/types';

const SPEEDS = [
  { label: '20×', ms: 50 },
  { label: '5×', ms: 200 },
  { label: '1×', ms: 1000 },
  { label: '⅕×', ms: 5000 },
];

const TERRAIN_ACTIONS = [
  { id: 'river', label: 'Carve river' },
  { id: 'plains', label: 'Raise plains' },
  { id: 'forest', label: 'Grow forest' },
  { id: 'hills', label: 'Raise hills' },
  { id: 'mountain', label: 'Raise mountains' },
  { id: 'desert', label: 'Salt the earth' },
  { id: 'deep_water', label: 'Sink to ocean' },
];

const DISASTERS = [
  { id: 'flood', label: 'Flash flood', regional: true },
  { id: 'pestilence', label: 'Pestilence', regional: true },
  { id: 'megafauna', label: 'Megafauna attack', regional: true },
  { id: 'long_winter', label: 'Long winter', regional: false },
  { id: 'famine', label: 'Famine', regional: false },
];

type Status = { tone: 'ok' | 'err'; text: string } | null;

/**
 * The intervention console.
 *
 * Everything regional reads its coordinates from the map selection rather than
 * from typed input — clicking the map is the targeting mechanism, and the
 * radius set here is previewed as a ring on the map before anything fires.
 */
export default function GodConsole({
  vitals, tribes, selected, radius, onRadiusChange,
}: {
  vitals: Vitals | null;
  tribes: TribeRow[];
  selected: { x: number; y: number } | null;
  radius: number;
  onRadiusChange: (r: number) => void;
}) {
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [token, setTokenState] = useState(getToken());
  const [tribeA, setTribeA] = useState<number | ''>('');
  const [tribeB, setTribeB] = useState<number | ''>('');
  const [rel, setRel] = useState('war');
  const [cullPct, setCullPct] = useState(10);
  const [duration, setDuration] = useState(120);

  const run = async (label: string, fn: () => Promise<{ message?: string }>) => {
    setBusy(true);
    try {
      const res = await fn();
      setStatus({ tone: 'ok', text: res?.message ? `${label}: ${res.message}` : `${label} — done` });
    } catch (e) {
      setStatus({ tone: 'err', text: `${label} failed: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  const needTarget = (label: string, fn: () => Promise<{ message?: string }>) => {
    if (!selected) {
      setStatus({ tone: 'err', text: `${label} needs a target — click a tile on the map first.` });
      return;
    }
    void run(label, fn);
  };

  const x = selected?.x ?? 0;
  const y = selected?.y ?? 0;

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col rounded-lg border border-edge bg-surface-1">
      <header className="flex items-center justify-between border-b border-edge px-3 py-2.5">
        <h2 className="text-sm font-semibold text-ink-primary">God Action Console</h2>
        <span className="font-mono text-[11px] text-ink-muted">
          {selected ? `target ${x},${y} · r${radius}` : 'no target'}
        </span>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto px-3 py-3">
        {/* ------------------------------------------------ simulation controls */}
        <Group title="Simulation">
          <div className="flex flex-wrap gap-1.5">
            <Btn
              tone="primary"
              disabled={busy}
              onClick={() => run(vitals?.paused ? 'Resume' : 'Pause', () => god.pause())}
            >
              {vitals?.paused ? '▶ Resume' : '⏸ Pause'}
            </Btn>
            {SPEEDS.map((s) => (
              <Btn
                key={s.ms}
                disabled={busy}
                active={vitals?.tickMs === s.ms}
                onClick={() => run(`Speed ${s.label}`, () => god.speed(s.ms))}
              >
                {s.label}
              </Btn>
            ))}
            <Btn
              tone="danger"
              disabled={busy}
              onClick={() => {
                if (confirm('Destroy this world and generate a new one from a fresh seed?')) {
                  void run('Reset world', () => god.reset());
                }
              }}
            >
              ↺ New world
            </Btn>
          </div>
        </Group>

        {/* ------------------------------------------------------- targeting */}
        <Group title="Target radius">
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={24}
              value={radius}
              onChange={(e) => onRadiusChange(Number(e.target.value))}
              className="h-1 flex-1 cursor-pointer appearance-none rounded bg-surface-3 accent-divine"
            />
            <span className="w-10 text-right font-mono text-[11px] tabular-nums text-ink-secondary">
              {radius}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <label className="text-[11px] text-ink-muted">Duration</label>
            <input
              type="range"
              min={20}
              max={600}
              step={20}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="h-1 flex-1 cursor-pointer appearance-none rounded bg-surface-3 accent-divine"
            />
            <span className="w-14 text-right font-mono text-[11px] tabular-nums text-ink-secondary">
              {duration}t
            </span>
          </div>
        </Group>

        {/* ----------------------------------------------------- terraforming */}
        <Group title="Terraforming">
          <div className="flex flex-wrap gap-1.5">
            {TERRAIN_ACTIONS.map((a) => (
              <Btn
                key={a.id}
                disabled={busy}
                onClick={() => needTarget(a.label, () => god.terraform(x, y, radius, a.id))}
              >
                {a.label}
              </Btn>
            ))}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Btn
              tone="good"
              disabled={busy}
              onClick={() => needTarget('Bless', () => god.bless(x, y, radius, duration))}
            >
              ✦ Bless tiles
            </Btn>
            <Btn
              tone="danger"
              disabled={busy}
              onClick={() => needTarget('Curse', () => god.curse(x, y, radius, duration))}
            >
              ☠ Curse tiles
            </Btn>
          </div>
        </Group>

        {/* -------------------------------------------------------- disasters */}
        <Group title="Climate & calamity">
          <div className="flex flex-wrap gap-1.5">
            {DISASTERS.map((d) => (
              <Btn
                key={d.id}
                tone="danger"
                disabled={busy}
                onClick={() => {
                  const opts = d.regional
                    ? { x, y, radius: Math.max(radius, 2), ticks: duration }
                    : { ticks: duration };
                  const fire = () => god.disaster(d.id, opts);
                  if (d.regional) needTarget(d.label, fire);
                  else void run(d.label, fire);
                }}
              >
                {d.label}
              </Btn>
            ))}
          </div>
        </Group>

        {/* ------------------------------------------------------------ boons */}
        <Group title="Divine boons">
          <div className="flex flex-wrap gap-1.5">
            <Btn
              tone="good"
              disabled={busy}
              onClick={() =>
                needTarget('Food cache', () =>
                  god.food({ x, y, radius: Math.max(radius, 2), amount: 400 }))
              }
            >
              🍖 Food cache
            </Btn>
            <Btn
              tone="good"
              disabled={busy}
              onClick={() =>
                needTarget('Found tribe', () => god.spawnTribe(x, y, 12))
              }
            >
              ⛺ Found a tribe
            </Btn>
          </div>

          <TribePicker
            tribes={tribes}
            label="Bless a tribe"
            disabled={busy}
            actions={[
              { label: '💡 Inspire', run: (id) => run('Divine inspiration', () => god.inspire(id)) },
              { label: '👶 Birth wave', run: (id) => run('Birth wave', () => god.births(8, id)) },
              { label: '🍖 +500 food', run: (id) => run('Food grant', () => god.food({ tribeId: id, amount: 500 })) },
            ]}
          />
        </Group>

        {/* ------------------------------------------------------------ wrath */}
        <Group title="Wrath">
          <div className="flex flex-wrap items-center gap-1.5">
            <Btn
              tone="danger"
              disabled={busy}
              onClick={() =>
                needTarget('Smite', () => god.smite({ x, y, radius: Math.max(radius, 1) }))
              }
            >
              ⚡ Smite target
            </Btn>
            <span className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                max={100}
                value={cullPct}
                onChange={(e) => setCullPct(Number(e.target.value))}
                className="w-16 rounded border border-edge bg-surface-2 px-2 py-1 font-mono text-[11px] tabular-nums text-ink-primary outline-none focus:border-divine"
              />
              <Btn
                tone="danger"
                disabled={busy}
                onClick={() => {
                  if (confirm(`Cull ${cullPct}% of every living human?`)) {
                    void run('Global cull', () => god.smite({ percent: cullPct }));
                  }
                }}
              >
                % global cull
              </Btn>
            </span>
          </div>

          <TribePicker
            tribes={tribes}
            label="Strike a tribe"
            disabled={busy}
            actions={[
              {
                label: '⚡ Smite half',
                run: (id) => run('Tribal smite', () => god.smite({ tribeId: id, percent: 50 })),
              },
              {
                label: '☠ Annihilate',
                run: (id) => {
                  const t = tribes.find((x2) => x2.id === id);
                  if (confirm(`Wipe out ${t?.name ?? 'this tribe'} entirely?`)) {
                    return run('Annihilation', () => god.smite({ tribeId: id }));
                  }
                  return Promise.resolve();
                },
              },
            ]}
          />
        </Group>

        {/* -------------------------------------------------------- diplomacy */}
        <Group title="Decree relations">
          <div className="flex flex-wrap items-center gap-1.5">
            <Select value={tribeA} onChange={setTribeA} tribes={tribes} placeholder="Tribe A" />
            <select
              value={rel}
              onChange={(e) => setRel(e.target.value)}
              className="rounded border border-edge bg-surface-2 px-2 py-1 text-[11px] text-ink-primary outline-none focus:border-divine"
            >
              <option value="war">at war</option>
              <option value="trade">trading</option>
              <option value="neutral">neutral</option>
            </select>
            <Select value={tribeB} onChange={setTribeB} tribes={tribes} placeholder="Tribe B" />
            <Btn
              disabled={busy || tribeA === '' || tribeB === '' || tribeA === tribeB}
              onClick={() => run('Decree', () => god.decree(Number(tribeA), Number(tribeB), rel))}
            >
              Decree
            </Btn>
          </div>
        </Group>

        {/* ------------------------------------------------------------- auth */}
        <Group title="Admin token">
          <div className="flex gap-1.5">
            <input
              type="password"
              value={token}
              placeholder="only if ADMIN_TOKEN is set"
              onChange={(e) => setTokenState(e.target.value)}
              className="flex-1 rounded border border-edge bg-surface-2 px-2 py-1 text-[11px] text-ink-primary outline-none placeholder:text-ink-muted focus:border-divine"
            />
            <Btn
              onClick={() => {
                setToken(token);
                setStatus({ tone: 'ok', text: 'Admin token saved to this browser.' });
                return Promise.resolve();
              }}
            >
              Save
            </Btn>
          </div>
        </Group>
      </div>

      {status && (
        <footer
          className={`border-t border-edge px-3 py-2 text-[11px] ${
            status.tone === 'ok' ? 'text-good' : 'text-critical'
          }`}
        >
          {status.text}
        </footer>
      )}
    </section>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-[10px] uppercase tracking-wider text-ink-muted">{title}</h3>
      {children}
    </div>
  );
}

function Btn({
  children, onClick, disabled, tone = 'default', active,
}: {
  children: React.ReactNode;
  onClick?: () => void | Promise<unknown>;
  disabled?: boolean;
  tone?: 'default' | 'primary' | 'danger' | 'good';
  active?: boolean;
}) {
  const tones = {
    default: 'border-edge bg-surface-2 text-ink-secondary hover:border-ink-muted hover:text-ink-primary',
    primary: 'border-divine/60 bg-divine/10 text-divine hover:bg-divine/20',
    danger: 'border-critical/40 bg-critical/10 text-critical hover:bg-critical/20',
    good: 'border-good/40 bg-good/10 text-good hover:bg-good/20',
  }[tone];
  return (
    <button
      onClick={() => void onClick?.()}
      disabled={disabled}
      className={`rounded border px-2 py-1 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${tones} ${
        active ? 'ring-1 ring-divine' : ''
      }`}
    >
      {children}
    </button>
  );
}

function Select({
  value, onChange, tribes, placeholder,
}: {
  value: number | '';
  onChange: (v: number | '') => void;
  tribes: TribeRow[];
  placeholder: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      className="rounded border border-edge bg-surface-2 px-2 py-1 text-[11px] text-ink-primary outline-none focus:border-divine"
    >
      <option value="">{placeholder}</option>
      {tribes.map((t) => (
        <option key={t.id} value={t.id}>
          {t.glyph} {t.name}
        </option>
      ))}
    </select>
  );
}

/** A tribe selector paired with the actions that apply to the chosen tribe. */
function TribePicker({
  tribes, label, actions, disabled,
}: {
  tribes: TribeRow[];
  label: string;
  disabled?: boolean;
  actions: Array<{ label: string; run: (id: number) => Promise<unknown> }>;
}) {
  const [id, setId] = useState<number | ''>('');
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <Select value={id} onChange={setId} tribes={tribes} placeholder={label} />
      {actions.map((a) => (
        <Btn key={a.label} disabled={disabled || id === ''} onClick={() => a.run(Number(id))}>
          {a.label}
        </Btn>
      ))}
    </div>
  );
}
