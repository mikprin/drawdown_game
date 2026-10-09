import type { FacilityId, LiftType, ModuleId, TechId } from './types';

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
    capacity: 700,
    cost: 0,
    installDays: 0,
    opexDay: 20,
    powerPerBbl: 0,
    wearPerDay: 0.0008,
  },
  rodpump: {
    capacity: 260,
    cost: 60_000,
    installDays: 3,
    opexDay: 60,
    powerPerBbl: 0.35,
    wearPerDay: 0.0022,
  },
  gaslift: {
    capacity: 1200,
    cost: 150_000,
    installDays: 4,
    opexDay: 140,
    powerPerBbl: 0.15,
    wearPerDay: 0.0012,
    requiresFacility: 'compressor',
  },
  esp: {
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
  /** 'levels': discrete tiers. 'count': buy N units of `per.value` each. */
  kind: 'levels' | 'count';
  levels?: FacilityLevel[];
  per?: { value: number; baseCost: number; growth: number; opexDay: number; max: number };
  requiresTech?: TechId;
}

export const FACILITIES: Record<FacilityId, FacilityDef> = {
  separator: {
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
    kind: 'count',
    per: { value: 150, baseCost: 18_000, growth: 1.14, opexDay: 0, max: 40 },
  },
  pipeline: {
    kind: 'levels',
    levels: [
      { value: 0, cost: 0, opexDay: 0 },
      { value: 6000, cost: 1_400_000, opexDay: 400 },
      { value: 20_000, cost: 4_000_000, opexDay: 900 },
    ],
  },
  waterTrucks: {
    kind: 'count',
    per: { value: 250, baseCost: 15_000, growth: 1.14, opexDay: 0, max: 40 },
  },
  swd: {
    kind: 'levels',
    levels: [
      { value: 0, cost: 0, opexDay: 0 },
      { value: 2500, cost: 200_000, opexDay: 150 },
      { value: 8000, cost: 650_000, opexDay: 350 },
      { value: 20_000, cost: 1_900_000, opexDay: 800 },
    ],
  },
  injection: {
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
  cost: number;
  requires?: TechId[];
  comingSoon?: boolean;
}

export const TECHS: Record<TechId, TechDef> = {
  wellPad: {
    cost: 120_000,
  },
  exploration: {
    cost: 400_000,
    requires: ['wellPad'],
  },
  waterflood: {
    cost: 250_000,
    requires: ['wellPad'],
  },
  esp: {
    cost: 180_000,
    requires: ['wellPad'],
  },
  maintCrew: {
    cost: 150_000,
    requires: ['wellPad'],
  },
  seismic3d: {
    cost: 600_000,
    requires: ['exploration'],
  },
  scada: {
    cost: 400_000,
    requires: ['wellPad'],
  },
  offshore: {
    cost: 15_000_000,
    requires: ['exploration', 'waterflood'],
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

/** Layer 2: the continental shelf. Everything costs several times more than onshore. */
export const OFFSHORE = {
  maxPlatforms: 3,
  installBase: 20_000_000,
  installPerCell: 350_000,
  installDays: 60,
  /** Taller legs for deeper water, by shelf terrain (5 shallow, 6 mid, 7 outer). */
  depthMult: { 5: 1, 6: 1.25, 7: 1.6 } as Record<number, number>,
  decomBase: 5_000_000,
  decomPerWell: 1_200_000,
  decomDays: 40,
  /** Crew rotation, helicopters and supply boats, $/d per platform. */
  logisticsDay: 35_000,

  drillCost: 4_000_000,
  drillDays: 30,
  /** Bigger completions: every lift moves this many times more liquid offshore. */
  liftCapMult: 4,
  liftCostMult: 4,
  wellOpexMult: 4,
  fracCostMult: 6,
  serviceMult: 4,
  repairMult: 5,
  convertCost: 900_000,
  plugCost: 1_500_000,
  shutinOpexDay: 150,
  injectorOpexDay: 400,

  /** Hotel and process load, $/d of diesel. Lift power uses the onshore $/bbl times powerMult. */
  basePowerDay: 12_000,
  powerMult: 1.5,
  injPowerPerBbl: 0.1,
  /** Diesel displaced by burning one mcf of associated gas in the turbines. */
  fuelValuePerMcf: 7,
  flarePerMcf: 4,
  gasInjPerMcf: 0.25,
  overboardPerBbl: 0.6,
  injectionPerBbl: 0.3,
  seawaterPerBbl: 0.05,
  injectivity: 6000,

  tankerCargo: 60_000,
  tankerCharterDay: 14_000,
  tankerMobilise: 1_500_000,
  tankerMax: 4,
  loadRate: 40_000,
  /** One-way sailing time to the export port: base + per shelf cell from the shore base. */
  legBase: 4,
  legPerCell: 0.35,
  /** A tanker leaves part-loaded after this long at the buoy. */
  maxMooredDays: 12,
  marketDepth: 3_000_000,
  revenueEmaDays: 30,

  stormGap: [50, 140] as [number, number],
  stormDays: [3, 8] as [number, number],
  stormWarnDays: 5,
};

export interface ModuleLevel {
  /** Capacity: slots, bbl/d, bbl or mcf/d depending on the module. */
  value: number;
  /** Deck area this level occupies in total. */
  area: number;
  cost: number;
  opexDay: number;
}

export const DECK: { area: number; cost: number; opexDay: number }[] = [
  { area: 14, cost: 0, opexDay: 0 },
  { area: 20, cost: 9_000_000, opexDay: 2000 },
  { area: 28, cost: 24_000_000, opexDay: 4500 },
];

export const MODULES: Record<ModuleId, { levels: ModuleLevel[]; requiresTech?: TechId }> = {
  wellbay: {
    levels: [
      { value: 3, area: 3, cost: 0, opexDay: 0 },
      { value: 6, area: 6, cost: 5_000_000, opexDay: 500 },
      { value: 9, area: 9, cost: 9_000_000, opexDay: 1000 },
      { value: 12, area: 12, cost: 14_000_000, opexDay: 1500 },
    ],
  },
  separator: {
    levels: [
      { value: 8000, area: 2, cost: 0, opexDay: 2000 },
      { value: 18_000, area: 3, cost: 6_000_000, opexDay: 4000 },
      { value: 35_000, area: 5, cost: 15_000_000, opexDay: 7000 },
    ],
  },
  storage: {
    levels: [
      { value: 20_000, area: 2, cost: 0, opexDay: 500 },
      { value: 50_000, area: 4, cost: 5_000_000, opexDay: 1200 },
      { value: 110_000, area: 6, cost: 13_000_000, opexDay: 2500 },
    ],
  },
  waterTreat: {
    levels: [
      { value: 4000, area: 1, cost: 0, opexDay: 800 },
      { value: 12_000, area: 2, cost: 4_000_000, opexDay: 1800 },
      { value: 30_000, area: 3, cost: 10_000_000, opexDay: 3500 },
    ],
  },
  injection: {
    requiresTech: 'waterflood',
    levels: [
      { value: 0, area: 0, cost: 0, opexDay: 0 },
      { value: 10_000, area: 2, cost: 6_000_000, opexDay: 2500 },
      { value: 25_000, area: 3, cost: 14_000_000, opexDay: 5000 },
    ],
  },
  turbine: {
    levels: [
      { value: 0, area: 0, cost: 0, opexDay: 0 },
      { value: 2500, area: 2, cost: 5_000_000, opexDay: 1500 },
      { value: 7000, area: 3, cost: 12_000_000, opexDay: 3000 },
    ],
  },
  gasInj: {
    levels: [
      { value: 0, area: 0, cost: 0, opexDay: 0 },
      { value: 4000, area: 2, cost: 7_000_000, opexDay: 2000 },
      { value: 12_000, area: 3, cost: 16_000_000, opexDay: 4000 },
    ],
  },
};

export const SHELF = {
  w: 24,
  h: 16,
  block: 4,
  survey2dCost: 1_200_000,
  survey2dDays: 20,
  survey3dCost: 3_500_000,
  survey3dDays: 35,
  wildcatCost: 9_000_000,
  wildcatDays: 40,
  /** Indexed by terrain code; land codes are unused here. */
  terrainCostMult: [1, 1, 1, Infinity, Infinity, 1, 1.25, 1.6, Infinity],
};
