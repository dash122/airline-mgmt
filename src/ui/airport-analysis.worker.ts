import { airportTraffic, hubOf, hubOpportunities, hubTransit, viewFromHub } from '../sim/airports';
import { airlinesAt, rivalsAt } from '../sim/competitors';
import { modelledAnnualPax } from '../sim/markets';
import type { NetworkResult, Plan } from '../sim/simulate';

export function analyzeAirport(plan: Plan, result: NetworkResult | null, code: string, transfer: boolean) {
  const hub = hubOf(plan);
  return {
    view: code === hub ? null : viewFromHub(plan, result, hub, code),
    ideas: code === hub && transfer ? hubOpportunities(plan, code) : [],
    hubT: code === hub && transfer ? hubTransit(plan, result, code) : null,
    traffic: airportTraffic(result, code),
    annualPax: modelledAnnualPax(code),
    carriers: airlinesAt(code),
    rivals: rivalsAt(code),
  };
}

