import type { Msg } from './msg';

export type LiftType = 'flowing' | 'rodpump' | 'gaslift' | 'esp';

export type FacilityId =
  | 'separator'
  | 'storage'
  | 'trucks'
  | 'pipeline'
  | 'waterTrucks'
  | 'swd'
  | 'injection'
  | 'compressor';

export type TechId =
  | 'wellPad'
  | 'exploration'
  | 'seismic3d'
  | 'waterflood'
  | 'esp'
  | 'scada'
  | 'maintCrew'
  | 'offshore';

/** Platform deck modules. Each level takes deck area. */
export type ModuleId = 'wellbay' | 'separator' | 'storage' | 'waterTreat' | 'injection' | 'turbine' | 'gasInj';

export type SellMode = 'auto' | 'hold' | 'threshold';

/** active = on production (unless a job is running); injector = water injection well. */
export type WellStatus = 'active' | 'shutin' | 'failed' | 'injector';

export type WellJobKind = 'drill' | 'lift' | 'frac' | 'convert' | 'repair';

export interface WellJob {
  kind: WellJobKind;
  daysLeft: number;
  total: number;
  lift?: LiftType;
}

export interface Well {
  id: number;
  fieldId: number;
  slot: number;
  name: string;
  status: WellStatus;
  job: WellJob | null;
  lift: LiftType;
  /** Liquid deliverability at virgin pressure, bbl/d. */
  pi: number;
  /** Per-well water cut offset (wells near the aquifer water out sooner). */
  wcBias: number;
  /** Extra productivity from fracturing; multiplier is (1 + stim). Decays. */
  stim: number;
  fracCount: number;
  /** Equipment condition 0..1. */
  condition: number;
  np: number;
  wp: number;
}

export interface Field {
  id: number;
  name: string;
  cellX: number;
  cellY: number;
  /** Hidden truth: original oil in place, bbl. */
  ooip: number;
  /** Primary recovery factor. */
  rfBase: number;
  /** Extra recovery factor from fracs. */
  rfFrac: number;
  /** Slowly-maturing waterflood effect 0..1 (drives secondary recovery). */
  floodMaturity: number;
  /** Current pressure support 0..1 (smoothed voidage replacement). */
  flood: number;
  np: number;
  gor: number;
  pi: number;
  declineN: number;
  wcX50: number;
  wcWidth: number;
  wcMax: number;
  /** Initial log-uncertainty of reserve estimate. */
  sigma0: number;
  /** Fixed standard-normal bias of the estimate; shrinks as sigma shrinks. */
  estBias: number;
  developed: boolean;
  devJob: { daysLeft: number; total: number } | null;
  slots: number;
  /** Pad position index in the site scene. */
  padIndex: number;
  /** Depth/complexity multiplier on well costs. */
  costMult: number;
  /** Shelf field: produced through a platform, cells refer to the shelf map. */
  offshore?: boolean;
  /** Platform decommissioned; the field is closed for good. */
  abandoned?: boolean;
}

export interface Lead {
  /** True geological chance of success (hidden). */
  cos: number;
  success: boolean;
  ooip: number;
  rfBase: number;
  pi: number;
  gor: number;
  detect2d: boolean;
  noise2d: number;
  noise3d: number;
  sizeBias: number;
  /** Deeper targets cost more to drill; known once the lead is mapped. */
  costMult: number;
}

export type DrillResult = 'none' | 'dry' | 'discovery';

export type MapId = 'land' | 'shelf';

export interface Cell {
  /**
   * Land map: 0 plain, 1 hills, 2 marsh, 3 lake (undrillable).
   * Shelf map: 4 coast (undrillable), 5 shallow, 6 mid shelf, 7 outer shelf, 8 slope (too deep for a jack-up).
   */
  terrain: number;
  /** Hidden regional hydrocarbon prior 0..1. */
  prior: number;
  /** Fixed noise for display of the chance heatmap. */
  heatNoise: number;
  lead: Lead | null;
  drilled: DrillResult;
  fieldId: number;
}

export interface Survey {
  block: number;
  kind: 2 | 3;
  daysLeft: number;
  total: number;
}

export interface Wildcat {
  x: number;
  y: number;
  daysLeft: number;
  total: number;
}

export interface Exploration {
  w: number;
  h: number;
  hubX: number;
  hubY: number;
  cells: Cell[];
  /** Best survey per block: 0 none, 2 = 2D, 3 = 3D. */
  blocks: number[];
  surveys: Survey[];
  wildcat: Wildcat | null;
}

export type TankerState = 'queued' | 'moored' | 'outbound' | 'port' | 'inbound';

/**
 * Shuttle tanker on charter. Cycle: queued at anchor → moored and loading →
 * outbound to port → port (sells the cargo, or waits for the price) → inbound.
 */
export type TankerDest = 'port' | 'terminal';

export interface Tanker {
  state: TankerState;
  /** Where the current voyage goes; 'port' state means "at the destination". Missing in old saves = port. */
  dest?: TankerDest;
  /** Days left on the current leg (outbound / inbound). */
  daysLeft: number;
  cargo: number;
  /** Days spent moored on this call. */
  moored: number;
}

export interface Platform {
  id: number;
  fieldId: number;
  /** Deck level: total deck area shared by the well bay and the modules. */
  deck: number;
  modules: Record<ModuleId, number>;
  /** Oil in the platform tanks, bbl. */
  storage: number;
  tankers: Tanker[];
  /** Tanker sales smoothed into a per-day figure for the P&L (cargo revenue is lumpy). */
  revenueEma: number;
  /** Decommissioning under way; the platform disappears when it ends. */
  decom: { daysLeft: number; total: number } | null;
}

/** Coastal terminal at the shore base: one for the whole shelf. Levels index TERMINAL.tanks / TERMINAL.jetty. */
export interface Terminal {
  tanks: number;
  jetty: number;
  /** Oil in the terminal tanks, bbl. */
  storage: number;
}

export interface Weather {
  /** Days until the next storm while calm. */
  next: number;
  /** Days left of the current storm; 0 when calm. */
  storm: number;
  warned: boolean;
}

export interface Market {
  price: number;
  base: number;
  target: number;
  noise: number;
  impact: number;
  sellMode: SellMode;
  threshold: number;
  /** Floor mode: when the tanks are full, sell the overflow at any price. */
  sellWhenFull?: boolean;
}

export interface History {
  day: number[];
  price: number[];
  oil: number[];
  water: number[];
  cash: number[];
  profit: number[];
}

export type LogKind = 'info' | 'good' | 'bad' | 'jackpot';

export interface LogEntry {
  day: number;
  msg: Msg;
  kind: LogKind;
}

export type CostId =
  | 'wellOpex' | 'liftPower' | 'facilities' | 'water' | 'transport' | 'flaring' | 'wages'
  | 'logistics' | 'charter' | 'diesel' | 'terminal';

export type Bottleneck = 'none' | 'separator' | 'water' | 'storage';

export interface WellFlow {
  /** Liquid the reservoir could give (before lift cap). */
  reservoir: number;
  liftCap: number;
  wc: number;
  liquid: number;
  oil: number;
  water: number;
  gas: number;
  inj: number;
}

/** Per-day rates of one platform from the last step. */
export interface PlatformFlows {
  liquidPotential: number;
  liquid: number;
  oil: number;
  water: number;
  gas: number;
  choke: number;
  bottleneck: Bottleneck;
  liftLimitedWells: number;
  sepCap: number;
  waterCap: number;
  storageCap: number;
  /** Oil pumped into a moored tanker. */
  loaded: number;
  injCap: number;
  injected: number;
  injFromProduced: number;
  overboard: number;
  waterTreatCap: number;
  /** Power the platform needs, in $/d of diesel. */
  powerDemand: number;
  gasFuel: number;
  turbineCap: number;
  gasInjected: number;
  gasInjCap: number;
  gasFlared: number;
  revenue: number;
  /** Oil produced valued at the realised price: what the platform earns whichever way the oil is sold. */
  value: number;
  costs: Partial<Record<CostId, number>>;
  costTotal: number;
  profit: number;
}

export interface TerminalFlows {
  storageCap: number;
  exportCap: number;
  sold: number;
  /** Oil discharged by tankers in the last step, bbl/d. */
  unloaded: number;
  /** Tankers alongside that cannot discharge because the tanks are full. */
  waiting: number;
  revenue: number;
  costs: Partial<Record<CostId, number>>;
  costTotal: number;
  profit: number;
}

/**
 * Per-day rates from the last simulation step, for UI and rendering. The
 * top-level numbers are the onshore hub; platforms are in `platforms`, and
 * `total` sums everything.
 */
export interface Flows {
  /** Every well, onshore and offshore. */
  wells: Record<number, WellFlow>;
  liquidPotential: number;
  liquid: number;
  oil: number;
  water: number;
  gas: number;
  choke: number;
  bottleneck: Bottleneck;
  liftLimitedWells: number;
  sepCap: number;
  waterCap: number;
  storageCap: number;
  exportCap: number;
  injCap: number;
  injected: number;
  injFromProduced: number;
  swd: number;
  waterTrucked: number;
  sold: number;
  soldPipe: number;
  gasSold: number;
  gasFlared: number;
  salePrice: number;
  revenue: number;
  costs: Partial<Record<CostId, number>>;
  costTotal: number;
  profit: number;
  platforms: Record<number, PlatformFlows>;
  terminal: TerminalFlows | null;
  total: { oil: number; water: number; liquid: number; profit: number };
}

export interface Stats {
  oilProduced: number;
  oilSold: number;
  revenue: number;
  wellsDrilled: number;
  wildcats: number;
  discoveries: number;
  cargoes: number;
}

export interface GameState {
  version: number;
  rng: number;
  day: number;
  cash: number;
  nextId: number;
  fields: Field[];
  wells: Well[];
  facilities: Record<FacilityId, number>;
  techs: Record<TechId, boolean>;
  storage: number;
  market: Market;
  exploration: Exploration;
  /** Shelf exploration map, created with the shelf license. */
  shelf: Exploration | null;
  platforms: Platform[];
  terminal: Terminal | null;
  weather: Weather;
  history: History;
  log: LogEntry[];
  stats: Stats;
  objectivesDone: string[];
  flows: Flows;
  /** Real-time ms of last save, for offline progress. */
  savedAt: number;
}
