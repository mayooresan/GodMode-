/**
 * Shared map colours.
 *
 * Terrain is deliberately low-chroma: it is the ground layer, and the tribal
 * colours painted on top are the data. A saturated basemap would compete with
 * them.
 */
export const TERRAIN: Array<[number, number, number]> = [
  [16, 32, 56],    // deep water
  [38, 78, 112],   // river / shallow
  [72, 84, 52],    // plains
  [42, 68, 44],    // forest
  [88, 82, 66],    // hills
  [116, 112, 106], // mountain
  [122, 106, 74],  // barren / desert
];

export const hexToRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/**
 * Sequential ramp for the food overlay: a single hue, dark (empty) to light
 * (full), monotonic in lightness so any two tiles can be ordered by eye.
 *
 * The top end is deliberately muted rather than maximally bright. Most of the
 * map sits at full capacity, so a ramp that peaks at full brightness turns the
 * whole world into a glare and buries the agent dots drawn on top of it. This
 * is a ground layer; the people are the data.
 */
export function foodRamp(t: number): [number, number, number] {
  const k = Math.max(0, Math.min(1, t));
  return [
    Math.round(14 + k * 104),
    Math.round(20 + k * 128),
    Math.round(18 + k * 58),
  ];
}
