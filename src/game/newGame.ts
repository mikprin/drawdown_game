import { ECON, EXPLORATION, MARKET, OFFSHORE, SHELF } from './balance';
import { msg } from './msg';
import { rand, randLogNormal, randNormal, randRange, type RngHolder } from './rng';
import type { Cell, Exploration, Field, Flows, GameState, Lead, PlatformFlows, Well } from './types';

export const SAVE_VERSION = 3;

export const FIELD_NAMES = [
  'Ash Creek', 'Red Mesa', 'Coyote Draw', 'Iron Flats', 'Sable Ridge', 'Dry Fork',
  'Black Hollow', 'Mule Tank', 'Cinder Butte', 'Hollis Bend', 'Stone Wash', 'Bitter Lake',
  'Gallows Flat', 'Rattler Hill', 'Copper Sink', 'Widow Gulch',
];

export const SHELF_NAMES = [
  'Selkie', 'Grey Skerry', 'Storm Petrel', 'Kelp Bank', 'Black Reef', 'Puffin Deep',
  'Mackerel Rise', 'Shoal Gate', 'Whaleback', 'Saltmarsh Deep', 'Kraken Spur', 'Gull Ledge',
];

export function emptyFlows(): Flows {
  return {
    wells: {}, liquidPotential: 0, liquid: 0, oil: 0, water: 0, gas: 0, choke: 1,
    bottleneck: 'none', liftLimitedWells: 0, sepCap: 0, waterCap: 0, storageCap: 0,
    exportCap: 0, injCap: 0, injected: 0, injFromProduced: 0, swd: 0, waterTrucked: 0,
    sold: 0, soldPipe: 0, gasSold: 0, gasFlared: 0, salePrice: 0, revenue: 0,
    costs: {}, costTotal: 0, profit: 0,
    platforms: {}, total: { oil: 0, water: 0, liquid: 0, profit: 0 },
  };
}

export function emptyPlatformFlows(): PlatformFlows {
  return {
    liquidPotential: 0, liquid: 0, oil: 0, water: 0, gas: 0, choke: 1, bottleneck: 'none',
    liftLimitedWells: 0, sepCap: 0, waterCap: 0, storageCap: 0, loaded: 0,
    injCap: 0, injected: 0, injFromProduced: 0, overboard: 0, waterTreatCap: 0,
    powerDemand: 0, gasFuel: 0, turbineCap: 0, gasInjected: 0, gasInjCap: 0, gasFlared: 0,
    revenue: 0, costs: {}, costTotal: 0, profit: 0,
  };
}

/** Smooth value noise on a coarse lattice, bilinearly interpolated. */
function valueNoise(h: RngHolder, w: number, hgt: number, cells: number): (x: number, y: number) => number {
  const gw = Math.ceil(w / cells) + 2;
  const gh = Math.ceil(hgt / cells) + 2;
  const g = Array.from({ length: gw * gh }, () => rand(h));
  return (x, y) => {
    const fx = x / cells, fy = y / cells;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fx - ix, ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = g[iy * gw + ix], b = g[iy * gw + ix + 1];
    const c = g[(iy + 1) * gw + ix], d = g[(iy + 1) * gw + ix + 1];
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  };
}

interface Play { x: number; y: number; r: number; s: number; size: number }

export function generateMap(h: RngHolder): Exploration {
  const { w, h: hgt, block } = EXPLORATION;
  const hubX = 4, hubY = 8;
  const elev = valueNoise(h, w, hgt, 4);
  const moist = valueNoise(h, w, hgt, 5);

  // Hydrocarbon plays: a modest one near the hub, richer ones further out.
  const plays: Play[] = [
    { x: hubX + randRange(h, 4, 7), y: hubY + randRange(h, -4, 4), r: randRange(h, 2, 3), s: 0.32, size: 1 },
    { x: randRange(h, 10, 14), y: randRange(h, 2, 6), r: randRange(h, 2, 3.5), s: randRange(h, 0.35, 0.5), size: 1.5 },
    { x: randRange(h, 10, 15), y: randRange(h, 10, 14), r: randRange(h, 2, 3.5), s: randRange(h, 0.35, 0.5), size: 1.6 },
    { x: randRange(h, 18, 22), y: randRange(h, 4, 12), r: randRange(h, 2.5, 4), s: randRange(h, 0.45, 0.6), size: 2.6 },
  ];

  const cells: Cell[] = [];
  for (let y = 0; y < hgt; y++) {
    for (let x = 0; x < w; x++) {
      const e = elev(x, y), m = moist(x, y);
      const nearHub = Math.abs(x - hubX) <= 1 && Math.abs(y - hubY) <= 1;
      let terrain = 0;
      if (!nearHub) {
        if (m > 0.74 && e < 0.45) terrain = 3;
        else if (m > 0.64) terrain = 2;
        else if (e > 0.66) terrain = 1;
      }
      let prior = 0, size = 1;
      for (const p of plays) {
        const d2 = (x - p.x) ** 2 + (y - p.y) ** 2;
        const v = p.s * Math.exp(-d2 / (2 * p.r * p.r));
        prior += v;
        if (v > 0.1) size = Math.max(size, p.size);
      }
      prior = Math.min(0.85, prior + 0.02);
      cells.push({ terrain, prior, heatNoise: randNormal(h), lead: null, drilled: 'none', fieldId: -1 });
      const cell = cells[cells.length - 1];
      if (terrain !== 3 && !nearHub && rand(h) < 0.04 + prior * 0.3) {
        cell.lead = makeLead(h, prior, size);
      }
    }
  }

  const blocks = new Array((w / block) * (hgt / block)).fill(0);
  // The company already holds old 2D seismic over its home block.
  blocks[Math.floor(hubY / block) * (w / block) + Math.floor(hubX / block)] = 2;
  return { w, h: hgt, hubX, hubY, cells, blocks, surveys: [], wildcat: null };
}

function makeLead(h: RngHolder, prior: number, size: number): Lead {
  const cos = Math.min(0.7, Math.max(0.03, prior * randRange(h, 0.5, 1.1) + 0.02));
  return {
    cos,
    success: rand(h) < cos,
    ooip: randLogNormal(h, 3_500_000 * size, 0.85),
    rfBase: randRange(h, 0.12, 0.2),
    pi: randLogNormal(h, 380, 0.35),
    gor: randRange(h, 300, 1400),
    detect2d: rand(h) < 0.7,
    noise2d: randNormal(h),
    noise3d: randNormal(h),
    sizeBias: randNormal(h),
    costMult: 1 + size * randRange(h, 0.3, 0.8),
  };
}

/**
 * The shelf: coast and shore base on the west, water deepening eastward to
 * the slope, which a jack-up cannot reach. Fewer, bigger leads than onshore.
 */
export function generateShelf(h: RngHolder): Exploration {
  const { w, h: hgt, block } = SHELF;
  const depthNoise = valueNoise(h, w, hgt, 5);
  const coastNoise = valueNoise(h, 1, hgt, 4);
  const coast = (y: number) => 2 + Math.round(coastNoise(0, y) * 2);
  const hubY = 6 + Math.floor(rand(h) * 4);
  const hubX = coast(hubY) - 1;

  const plays: Play[] = [
    { x: randRange(h, 6, 9), y: randRange(h, 3, 12), r: randRange(h, 2, 3), s: randRange(h, 0.3, 0.4), size: 1 },
    { x: randRange(h, 11, 15), y: randRange(h, 2, 13), r: randRange(h, 2.5, 3.5), s: randRange(h, 0.38, 0.5), size: 1.5 },
    { x: randRange(h, 17, 21), y: randRange(h, 3, 12), r: randRange(h, 2.5, 4), s: randRange(h, 0.45, 0.6), size: 2.3 },
  ];

  const cells: Cell[] = [];
  for (let y = 0; y < hgt; y++) {
    const cx = coast(y);
    for (let x = 0; x < w; x++) {
      let terrain = 4;
      if (x >= cx) {
        const d = (x - cx) / (w - cx) + (depthNoise(x, y) - 0.5) * 0.35;
        terrain = d < 0.25 ? 5 : d < 0.52 ? 6 : d < 0.8 ? 7 : 8;
      }
      let prior = 0, size = 1;
      for (const p of plays) {
        const d2 = (x - p.x) ** 2 + (y - p.y) ** 2;
        const v = p.s * Math.exp(-d2 / (2 * p.r * p.r));
        prior += v;
        if (v > 0.1) size = Math.max(size, p.size);
      }
      prior = terrain === 4 ? 0.01 : Math.min(0.85, prior + 0.02);
      cells.push({ terrain, prior, heatNoise: randNormal(h), lead: null, drilled: 'none', fieldId: -1 });
      const cell = cells[cells.length - 1];
      if (terrain !== 4 && rand(h) < 0.02 + prior * 0.22) cell.lead = makeShelfLead(h, prior, size);
    }
  }
  const blocks = new Array((w / block) * (hgt / block)).fill(0);
  return { w, h: hgt, hubX, hubY, cells, blocks, surveys: [], wildcat: null };
}

function makeShelfLead(h: RngHolder, prior: number, size: number): Lead {
  const cos = Math.min(0.7, Math.max(0.03, prior * randRange(h, 0.5, 1.1) + 0.02));
  return {
    cos,
    success: rand(h) < cos,
    ooip: randLogNormal(h, 22_000_000 * size, 0.8),
    rfBase: randRange(h, 0.2, 0.3),
    pi: randLogNormal(h, 2000, 0.35),
    gor: randRange(h, 500, 2200),
    detect2d: rand(h) < 0.7,
    noise2d: randNormal(h),
    noise3d: randNormal(h),
    sizeBias: randNormal(h),
    costMult: 1 + size * randRange(h, 0.1, 0.3),
  };
}

export function makeFieldFromLead(
  h: RngHolder, id: number, name: string, x: number, y: number, lead: Lead, padIndex: number,
): Field {
  return {
    id, name, cellX: x, cellY: y,
    ooip: lead.ooip, rfBase: lead.rfBase, rfFrac: 0, floodMaturity: 0, flood: 0, np: 0,
    gor: lead.gor, pi: lead.pi,
    declineN: randRange(h, 1.3, 2.0),
    wcX50: randRange(h, 0.35, 0.55),
    wcWidth: randRange(h, 0.09, 0.15),
    wcMax: 0.97,
    sigma0: 0.7,
    estBias: lead.sizeBias,
    developed: false, devJob: null,
    slots: ECON.padSlotsWithPad,
    padIndex,
    costMult: lead.costMult,
  };
}

export function makeWell(h: RngHolder, id: number, f: Field, slot: number, name: string): Well {
  return {
    id, fieldId: f.id, slot, name,
    status: 'active', job: null, lift: 'flowing',
    pi: f.pi * Math.exp(0.3 * randNormal(h)),
    wcBias: 0.05 * randNormal(h),
    stim: 0, fracCount: 0, condition: 1, np: 0, wp: 0,
  };
}

export function newGame(seed = (Math.random() * 2 ** 32) >>> 0): GameState {
  const h: RngHolder = { rng: seed };
  const exploration = generateMap(h);
  const homeX = exploration.hubX + 1, homeY = exploration.hubY;

  const home: Field = {
    id: 1, name: 'Old Barrow', cellX: homeX, cellY: homeY,
    ooip: 6_000_000, rfBase: 0.15, rfFrac: 0, floodMaturity: 0, flood: 0,
    np: 360_000, gor: 600, pi: 260, declineN: 1.5,
    wcX50: 0.42, wcWidth: 0.12, wcMax: 0.97,
    sigma0: 0.5, estBias: randNormal(h),
    developed: true, devJob: null,
    slots: ECON.padSlotsHome, padIndex: 0, costMult: 1,
  };
  const homeCell = exploration.cells[homeY * exploration.w + homeX];
  homeCell.lead = null;
  homeCell.terrain = 0;
  homeCell.drilled = 'discovery';
  homeCell.fieldId = home.id;

  const first: Well = {
    id: 2, fieldId: home.id, slot: 0, name: 'Barrow-1',
    status: 'active', job: null, lift: 'rodpump',
    pi: 260, wcBias: 0, stim: 0, fracCount: 0, condition: 0.8, np: 0, wp: 0,
  };

  return {
    version: SAVE_VERSION,
    rng: h.rng,
    day: 0,
    cash: ECON.startCash,
    nextId: 3,
    fields: [home],
    wells: [first],
    facilities: {
      separator: 0, storage: 0, trucks: 1, pipeline: 0,
      waterTrucks: 1, swd: 0, injection: 0, compressor: 0,
    },
    techs: {
      wellPad: false, exploration: false, seismic3d: false, waterflood: false,
      esp: false, scada: false, maintCrew: false, offshore: false,
    },
    storage: 0,
    market: {
      price: MARKET.startPrice, base: MARKET.startPrice, target: MARKET.startPrice,
      noise: 0, impact: 0, sellMode: 'auto', threshold: 75, sellWhenFull: false,
    },
    exploration,
    shelf: null,
    platforms: [],
    weather: newWeather(),
    history: { day: [], price: [], oil: [], water: [], cash: [], profit: [] },
    log: [{ day: 0, msg: msg('log.start'), kind: 'info' }],
    stats: { oilProduced: 0, oilSold: 0, revenue: 0, wellsDrilled: 0, wildcats: 0, discoveries: 0, cargoes: 0 },
    objectivesDone: [],
    flows: emptyFlows(),
    savedAt: Date.now(),
  };
}

export function newWeather() {
  return { next: OFFSHORE.stormGap[1], storm: 0, warned: false };
}
