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
