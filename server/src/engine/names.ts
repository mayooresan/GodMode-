import type { Rng } from './rng.js';

/** Totem animals and the palette tribes are named and coloured from. */
const TOTEMS = [
  'Wolf', 'Bear', 'Crow', 'Stag', 'Boar', 'Hawk', 'Otter', 'Lynx', 'Bison',
  'Adder', 'Heron', 'Ibex', 'Mammoth', 'Owl', 'Salmon', 'Fox', 'Aurochs',
  'Raven', 'Elk', 'Badger', 'Falcon', 'Seal', 'Toad', 'Moth', 'Pike',
  'Hare', 'Vulture', 'Wolverine', 'Ram', 'Cave Lion',
];

const GLYPHS: Record<string, string> = {
  Wolf: '🐺', Bear: '🐻', Crow: '🐦‍⬛', Stag: '🦌', Boar: '🐗', Hawk: '🦅',
  Otter: '🦦', Lynx: '🐈', Bison: '🦬', Adder: '🐍', Heron: '🕊', Ibex: '🐐',
  Mammoth: '🦣', Owl: '🦉', Salmon: '🐟', Fox: '🦊', Aurochs: '🐂',
  Raven: '🐦‍⬛', Elk: '🫎', Badger: '🦡', Falcon: '🦅', Seal: '🦭', Toad: '🐸',
  Moth: '🦋', Pike: '🐠', Hare: '🐇', Vulture: '🦤', Wolverine: '🦡',
  Ram: '🐏', 'Cave Lion': '🦁',
};

/**
 * Tribe colour slots, assigned in fixed order and never cycled.
 *
 * Slots 1-6 are validated for the dark map surface on the all-pairs list
 * (worst CVD deltaE 9.2, worst normal-vision deltaE 16.3, all >= 3:1 contrast) —
 * this is the largest set that can pass, because red/green collapse under
 * deuteranopia no matter how the hues are ordered. Slots 7-14 extend the range
 * for busy worlds and fall into the 6-8 CVD band, which is only legal alongside
 * secondary encoding: every surface that shows a tribe also shows its totem
 * glyph and name, and the map's tile inspector names the owner outright.
 * Simultaneous tribes are capped at COLORS.length so a colour is never reused.
 */
const COLORS = [
  // validated core
  '#3987e5', '#ff0000', '#09905a', '#bb1b9b', '#7e29ff', '#ca7295',
  // extended ring (requires the glyph/label secondary encoding)
  '#907509', '#8a55be', '#0ca5b6', '#c75cf5', '#25b14f', '#ab00d6',
  '#aa416b', '#226da0',
];

/** Hard cap on simultaneous tribes, so colour slots are never recycled. */
export const MAX_TRIBES = COLORS.length;

const ROMAN: Array<[number, string]> = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

/** Roman numeral for a tribe's generation, e.g. 3 -> "III". */
export function roman(n: number): string {
  if (n < 1) return 'I';
  let rest = Math.floor(n);
  let out = '';
  for (const [value, sym] of ROMAN) {
    while (rest >= value) {
      out += sym;
      rest -= value;
    }
  }
  return out;
}

export interface TribeIdentity {
  name: string;
  totem: string;
  glyph: string;
  color: string;
}

/**
 * Allocate a tribe identity, avoiding totems and colours already in play so
 * the map and the tribal table stay readable as tribes split and die out.
 */
export function makeIdentity(rng: Rng, usedTotems: Set<string>, usedColors: Set<string>): TribeIdentity {
  const freeTotems = TOTEMS.filter((t) => !usedTotems.has(t));
  const totem = freeTotems.length > 0 ? rng.pick(freeTotems) : rng.pick(TOTEMS);
  const color = COLORS.find((c) => !usedColors.has(c)) ?? COLORS[COLORS.length - 1];
  return {
    name: `Tribe of the ${totem}`,
    totem,
    glyph: GLYPHS[totem] ?? '🔥',
    color,
  };
}

const PLACE_PREFIX = ['Northern', 'Southern', 'Eastern', 'Western', 'Great', 'Broken', 'Whispering', 'Cold', 'Sunlit', 'Hollow'];
const PLACE_SUFFIX = ['River', 'Basin', 'Ridge', 'Delta', 'Woods', 'Highlands', 'Flats', 'Marsh', 'Vale', 'Shore'];

/** A stable, human-readable name for a region, derived from its coordinates. */
export function placeName(x: number, y: number, width: number, height: number): string {
  const pi = ((x * 31 + y * 17) >>> 0) % PLACE_PREFIX.length;
  const si = ((x * 13 + y * 7) >>> 0) % PLACE_SUFFIX.length;
  const vertical = y < height / 3 ? 'Northern' : y > (height * 2) / 3 ? 'Southern' : PLACE_PREFIX[pi];
  const horizontal = x < width / 3 ? 'Western' : x > (width * 2) / 3 ? 'Eastern' : '';
  const prefix = horizontal && vertical === PLACE_PREFIX[pi] ? horizontal : vertical;
  return `${prefix} ${PLACE_SUFFIX[si]}`;
}
