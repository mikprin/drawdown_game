import { fieldById, isProducing, liftCapacity, reservoirLiquid, waterCut } from './reservoir';
import type { Bottleneck, GameState, Well, WellFlow } from './types';

/** Shared by the onshore hub and the platforms: well potentials and choking them to fit the plant. */

export interface Pot {
  w: Well;
  fl: WellFlow;
  gor: number;
}

export function wellPotentials(s: GameState, wells: Well[]): { pots: Pot[]; potential: number; liftLimited: number } {
  const pots: Pot[] = [];
  let potential = 0, liftLimited = 0;
  for (const w of wells) {
    if (!isProducing(w)) continue;
    const f = fieldById(s, w.fieldId);
    const reservoir = reservoirLiquid(f, w);
    const liftCap = liftCapacity(f, w);
    const liquid = Math.min(reservoir, liftCap);
    const wc = waterCut(f, w);
    if (reservoir > liftCap * 1.02) liftLimited++;
    pots.push({ w, gor: f.gor, fl: { reservoir, liftCap, wc, liquid, oil: liquid * (1 - wc), water: liquid * wc, gas: 0, inj: 0 } });
    potential += liquid;
  }
  return { pots, potential, liftLimited };
}

function ratio(rem: number, need: number): number {
  return need > 1e-9 ? rem / need : Infinity;
}

/**
 * Choke wells to fit separator, water and oil room (all per day). SCADA chokes
 * the wettest wells first; otherwise every well is choked by the same factor.
 * Returns the stage that bound first.
 */
export function chokeWells(pots: Pot[], sepCap: number, waterCap: number, oilRoom: number, scada: boolean): Bottleneck {
  let bottleneck: Bottleneck = 'none';
  const limit = (sep: number, water: number, oil: number): number => {
    const m = Math.max(0, Math.min(1, sep, water, oil));
    if (m < 1 && bottleneck === 'none') bottleneck = m === sep ? 'separator' : m === water ? 'water' : 'storage';
    return m;
  };
  if (scada) {
    pots.sort((a, b) => a.fl.wc - b.fl.wc);
    let remSep = sepCap, remWater = waterCap, remOil = oilRoom;
    for (const p of pots) {
      const k = limit(ratio(remSep, p.fl.liquid), ratio(remWater, p.fl.water), ratio(remOil, p.fl.oil));
      p.fl.liquid *= k; p.fl.oil *= k; p.fl.water *= k;
      remSep -= p.fl.liquid; remWater -= p.fl.water; remOil -= p.fl.oil;
    }
  } else {
    let L = 0, W = 0, O = 0;
    for (const p of pots) { L += p.fl.liquid; W += p.fl.water; O += p.fl.oil; }
    const k = limit(ratio(sepCap, L), ratio(waterCap, W), ratio(oilRoom, O));
    for (const p of pots) { p.fl.liquid *= k; p.fl.oil *= k; p.fl.water *= k; }
  }
  return bottleneck;
}
