import type { FacilityId, LiftType, TechId } from './types';

/** All tunable numbers live here. Rates are per game day. */

export const TIME = {
  /** Game days per real second at 1x speed. */
  daysPerSecond: 1,
  /** Simulation step while playing. */
  tickDays: 0.1,
  /** Simulation step for offline catch-up. */
  offlineStepDays: 0.5,
  maxOfflineDays: 365,
  historyDays: 720,
  autosaveSeconds: 15,
  startYear: 1985,
};

export interface LiftDef {
  name: string;
  short: string;
  desc: string;
  /** Max liquid, bbl/d. Natural flow is scaled by pressure². */
  capacity: number;
  cost: number;
  installDays: number;
  opexDay: number;
  powerPerBbl: number;
  wearPerDay: number;
  requiresTech?: TechId;
  requiresFacility?: FacilityId;
}

export const LIFTS: Record<LiftType, LiftDef> = {
  flowing: {
    name: 'Natural flow',
    short: 'FLOW',
    desc: 'Reservoir pressure pushes fluid up. Free, but dies as pressure falls.',
    capacity: 700,
    cost: 0,
    installDays: 0,
    opexDay: 20,
    powerPerBbl: 0,
    wearPerDay: 0.0008,
  },
  rodpump: {
    name: 'Rod pump',
    short: 'ROD',
    desc: 'Classic pumpjack. Cheap and robust, low capacity.',
    capacity: 260,
    cost: 60_000,
    installDays: 3,
    opexDay: 60,
    powerPerBbl: 0.35,
    wearPerDay: 0.0022,
  },
  gaslift: {
    name: 'Gas lift',
    short: 'GL',
    desc: 'Injects compressed gas to lighten the fluid column. Needs a compressor.',
    capacity: 1200,
    cost: 150_000,
    installDays: 4,
    opexDay: 140,
    powerPerBbl: 0.15,
    wearPerDay: 0.0012,
    requiresFacility: 'compressor',
  },
  esp: {
    name: 'ESP',
    short: 'ESP',
    desc: 'Electric submersible pump. Huge capacity, power-hungry, wears fast.',
    capacity: 3500,
    cost: 280_000,
    installDays: 5,
    opexDay: 260,
    powerPerBbl: 0.55,
    wearPerDay: 0.0045,
    requiresTech: 'esp',
  },
};

export interface FacilityLevel {
  value: number;
  cost: number;
  opexDay: number;
}

export interface FacilityDef {
  name: string;
  desc: string;
  unit: string;
  /** 'levels': discrete tiers. 'count': buy N units of `per.value` each. */
  kind: 'levels' | 'count';
  levels?: FacilityLevel[];
  per?: { value: number; baseCost: number; growth: number; opexDay: number; max: number };
  requiresTech?: TechId;
}

export const FACILITIES: Record<FacilityId, FacilityDef> = {
  separator: {
    name: 'Separator',
    desc: 'Splits well fluid into oil, gas and water. Caps total liquid.',
    unit: 'bbl/d liquid',
    kind: 'levels',
    levels: [
      { value: 600, cost: 0, opexDay: 50 },
      { value: 1500, cost: 70_000, opexDay: 120 },
      { value: 4000, cost: 260_000, opexDay: 300 },
      { value: 10_000, cost: 900_000, opexDay: 700 },
      { value: 25_000, cost: 2_800_000, opexDay: 1500 },
    ],
  },
  storage: {
    name: 'Tank farm',
    desc: 'Buffers oil between production and export. Full tanks choke the wells.',
    unit: 'bbl',
    kind: 'levels',
    levels: [
      { value: 1500, cost: 0, opexDay: 10 },
      { value: 5000, cost: 45_000, opexDay: 30 },
      { value: 15_000, cost: 160_000, opexDay: 80 },
      { value: 40_000, cost: 520_000, opexDay: 200 },
      { value: 100_000, cost: 1_600_000, opexDay: 500 },
    ],
  },
  trucks: {
    name: 'Oil trucks',
    desc: 'Haul crude to the local refinery. $3.50/bbl.',
    unit: 'bbl/d',
    kind: 'count',
    per: { value: 150, baseCost: 18_000, growth: 1.14, opexDay: 0, max: 40 },
  },
  pipeline: {
    name: 'Export pipeline',
    desc: 'Cheap bulk export ($0.70/bbl) into a deeper market — sales move price less.',
    unit: 'bbl/d',
    kind: 'levels',
    levels: [
      { value: 0, cost: 0, opexDay: 0 },
      { value: 6000, cost: 1_400_000, opexDay: 400 },
      { value: 20_000, cost: 4_000_000, opexDay: 900 },
    ],
  },
  waterTrucks: {
    name: 'Water trucks',
    desc: 'Haul produced water away. Expensive: $1.80/bbl.',
    unit: 'bbl/d',
    kind: 'count',
    per: { value: 250, baseCost: 15_000, growth: 1.14, opexDay: 0, max: 40 },
  },
  swd: {
    name: 'Disposal well',
    desc: 'Salt-water disposal well. $0.35/bbl.',
    unit: 'bbl/d',
    kind: 'levels',
    levels: [
      { value: 0, cost: 0, opexDay: 0 },
      { value: 2500, cost: 200_000, opexDay: 150 },
      { value: 8000, cost: 650_000, opexDay: 350 },
      { value: 20_000, cost: 1_900_000, opexDay: 800 },
    ],
  },
  injection: {
    name: 'Injection pumps',
    desc: 'Waterflood: re-inject water to hold pressure and sweep more oil. Uses produced water first.',
    unit: 'bbl/d',
    kind: 'levels',
    requiresTech: 'waterflood',
    levels: [
      { value: 0, cost: 0, opexDay: 0 },
      { value: 1500, cost: 160_000, opexDay: 120 },
      { value: 5000, cost: 480_000, opexDay: 300 },
      { value: 12_000, cost: 1_300_000, opexDay: 700 },
      { value: 30_000, cost: 3_200_000, opexDay: 1500 },
    ],
  },
  compressor: {
    name: 'Gas compressor',
    desc: 'Compresses associated gas for sale ($2.80/mcf) instead of flaring. Enables gas lift.',
    unit: 'mcf/d',
    kind: 'levels',
    levels: [
      { value: 0, cost: 0, opexDay: 0 },
      { value: 800, cost: 220_000, opexDay: 150 },
      { value: 3000, cost: 650_000, opexDay: 350 },
      { value: 10_000, cost: 1_700_000, opexDay: 800 },
    ],
  },
};

export interface TechDef {
  name: string;
  desc: string;
  cost: number;
  requires?: TechId[];
  comingSoon?: boolean;
}

export const TECHS: Record<TechId, TechDef> = {
  wellPad: {
    name: 'Well pad',
    desc: 'Grow the lone pumpjack into a multi-well pad: 4 well slots on the home field.',
    cost: 120_000,
  },
  exploration: {
    name: 'Exploration license',
    desc: 'Unlocks the regional map: 2D seismic and wildcat drilling.',
    cost: 400_000,
    requires: ['wellPad'],
  },
  waterflood: {
    name: 'Waterflood',
    desc: 'Convert wells to injectors and build injection pumps. Raises recovery factor.',
    cost: 250_000,
    requires: ['wellPad'],
  },
  esp: {
    name: 'ESP technology',
    desc: 'Electric submersible pumps: lift thousands of barrels of liquid per day.',
    cost: 180_000,
    requires: ['wellPad'],
  },
  maintCrew: {
    name: 'Maintenance crew',
    desc: 'Auto-services worn equipment and repairs failures. $400/day wages.',
    cost: 150_000,
    requires: ['wellPad'],
  },
  seismic3d: {
    name: '3D seismic',
    desc: 'Sharper chance estimates, detects every lead and estimates its size.',
    cost: 600_000,
    requires: ['exploration'],
  },
  scada: {
    name: 'SCADA optimizer',
    desc: 'When the plant is constrained, choke the wettest wells first.',
    cost: 400_000,
    requires: ['wellPad'],
  },
  offshore: {
    name: 'Shallow-water license',
    desc: 'Jack-up rigs on the continental shelf. Next tier — coming soon.',
    cost: 60_000_000,
    requires: ['exploration', 'waterflood'],
    comingSoon: true,
  },
};

export const ECON = {
  startCash: 60_000,
  hubBaseOpexDay: 200,
  shutinOpexDay: 8,
  injectorOpexDay: 30,
  truckPerBbl: 3.5,
  pipePerBbl: 0.7,
  waterTruckPerBbl: 1.8,
  swdPerBbl: 0.35,
  injectionPerBbl: 0.25,
  sourceWaterPerBbl: 0.15,
  flarePerMcf: 0.3,
  gasPricePerMcf: 2.8,

  drillCost: 350_000,
  drillDays: 12,
  plugCost: 40_000,
  padSlotsHome: 1,
  padSlotsWithPad: 4,
  padMaxSlots: 8,
  padExpandCost: [180_000, 420_000],

  convertCost: 90_000,
  convertDays: 5,
  injectivity: 1500,

  fracBaseCost: 220_000,
  fracGrowth: 1.35,
  fracDays: 6,
  fracBoost: 1.4,
  fracBoostDecayPerFrac: 0.7,
  fracDecayDays: 300,
  fracMax: 3,
  fracRfBonus: 0.005,

  maintWageDay: 400,
  maintThreshold: 0.5,
  serviceBase: 3000,
  serviceFactor: 0.15,
  repairFactor: 0.35,
  repairMin: 20_000,
  repairDays: 4,
  failThreshold: 0.35,
  failRate: 0.5,
};

export const RESERVOIR = {
  floodRelaxDays: 60,
  floodMatureDays: 365,
  floodRfGain: 0.18,
  floodPressureRelief: 0.6,
  floodWcShift: 0.25,
  /** Natural-flow lift capacity scales with pressure to this power. */
  flowingPressureExp: 2,
};

export const MARKET = {
  startPrice: 72,
  minTarget: 42,
  maxTarget: 115,
  regimeChancePerDay: 1 / 260,
  baseRelaxDays: 90,
  noiseRelaxDays: 15,
  noiseVol: 0.03,
  impactDecayDays: 6,
  depthLocal: 300_000,
  depthPipeline: [0, 900_000, 2_500_000],
  maxImpact: 0.4,
};

export const EXPLORATION = {
  w: 24,
  h: 16,
  block: 4,
  survey2dCost: 150_000,
  survey2dDays: 15,
  survey3dCost: 380_000,
  survey3dDays: 30,
  wildcatCost: 700_000,
  wildcatDays: 20,
  terrainCostMult: [1, 1.3, 1.6, Infinity],
  developBase: 450_000,
  developPerCell: 60_000,
  developDays: 25,
  developGrowth: 1.8,
  maxFields: 5,
  noise2d: 0.18,
  noise3d: 0.06,
};
