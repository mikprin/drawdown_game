/** Site layout in world tiles. Hub in the middle, well pads around it. */

export const WORLD = 60;

export const HUB = { x0: 22, y0: 21, x1: 34, y1: 33 };

export interface PadRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Pad 0 is the home field; 1..4 are satellite fields. */
export const PADS: PadRect[] = [
  { x: 37, y: 12, w: 9.5, h: 7.6 },
  { x: 10, y: 21, w: 9.5, h: 7.6 },
  { x: 22, y: 7, w: 9.5, h: 7.6 },
  { x: 10, y: 37, w: 9.5, h: 7.6 },
  { x: 40, y: 37, w: 9.5, h: 7.6 },
];

/** Wellhead position of a slot (2 columns × 4 rows; pumpjacks extend toward -x). */
export function slotPos(pad: number, slot: number): [number, number] {
  const p = PADS[pad];
  const col = Math.floor(slot / 4), row = slot % 4;
  return [p.x + 4.2 + col * 4.4, p.y + 1.0 + row * 1.85];
}

/** Where a pad's flowline leaves the pad. */
export function padOutlet(pad: number): [number, number] {
  const p = PADS[pad];
  return [p.x + p.w / 2, p.y + p.h / 2];
}

export const MANIFOLD: [number, number] = [25.5, 24.5];

export const SPOTS = {
  separators: [[24, 22.4], [24, 24.0], [24, 25.6], [24, 27.2]] as [number, number][],
  tanks: [[29, 31], [31.6, 31], [29, 28.4], [31.6, 28.4], [26.4, 31], [26.4, 28.4]] as [number, number][],
  waterTanks: [[30, 23.2], [31.8, 23.2], [33.5, 23.2]] as [number, number][],
  compressor: [22.6, 29.8] as [number, number],
  injection: [[22.6, 26.6], [22.6, 24.6], [22.6, 33.2], [25.2, 33.2]] as [number, number][],
  cabin: [29.5, 21.6] as [number, number],
  loading: [33, 26.5] as [number, number],
  flare: [36.2, 33.2] as [number, number],
  swd: [35.8, 22.4] as [number, number],
};

/** Truck road leaves the hub east along +x; export pipeline leaves south along +y. */
export const ROAD = { y: 26.5, x0: 33.2, x1: WORLD };
export const PIPELINE = { x: 28, y0: 33, y1: WORLD };
