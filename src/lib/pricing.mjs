import {routeCost, requireNumber,ceilingCent} from './calculations.mjs';

const DEFAULT_PRICING = Object.freeze({
  offeredSeats: 3,
  expectedPassengers: 1,
  customPrice: null,
  driverFee: 0,
  mode: 'share',
  targetSurplus: 5
});
const MAX_SEATS = 8;
const MAX_AMOUNT = 10000;
const MAX_FARE=1000000;
const isNumber = value => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const normalizedCapacity = capacity => isNumber(capacity)
  ? clamp(Math.floor(capacity), 1, MAX_SEATS)
  : 4;

/**
 * Restore partial saved preferences and fit them to the current vehicle.
 * No input is mutated. Strings are not interpreted as monetary amounts.
 */
export function normalizePricing(pricing, capacity = 4) {
  const source = pricing && typeof pricing === 'object' && !Array.isArray(pricing)
    ? pricing
    : {};
  const seats = normalizedCapacity(capacity);
  const offeredSeats = clamp(
    Math.floor(isNumber(source.offeredSeats) ? source.offeredSeats : DEFAULT_PRICING.offeredSeats),
    1,
    seats
  );
  const expectedPassengers = clamp(
    Math.floor(isNumber(source.expectedPassengers) ? source.expectedPassengers : DEFAULT_PRICING.expectedPassengers),
    0,
    offeredSeats
  );
  return {
    offeredSeats,
    expectedPassengers,
    customPrice: isNumber(source.customPrice) ? clamp(source.customPrice, 0, MAX_FARE) : null,
    driverFee: isNumber(source.driverFee) ? clamp(source.driverFee, 0, MAX_AMOUNT) : 0,
    mode:['share','cover','surplus'].includes(source.mode)?source.mode:'share',
    targetSurplus:isNumber(source.targetSurplus)?clamp(source.targetSurplus,0,MAX_AMOUNT):DEFAULT_PRICING.targetSurplus
  };
}

/** Validate user-entered preferences before saving them. Returns the same object. */
export function validatePricing(pricing, capacity = 4) {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_SEATS) {
    throw new Error('Capacité du véhicule invalide : de 1 à 8 places passagers.');
  }
  if (!pricing || typeof pricing !== 'object' || Array.isArray(pricing)) {
    throw new Error('Réglages du prix par place invalides.');
  }
  if (!Number.isInteger(pricing.offeredSeats) || pricing.offeredSeats < 1 || pricing.offeredSeats > capacity) {
    throw new Error(`Nombre de places proposées invalide : de 1 à ${capacity}.`);
  }
  if (!Number.isInteger(pricing.expectedPassengers) || pricing.expectedPassengers < 0 || pricing.expectedPassengers > pricing.offeredSeats) {
    throw new Error(`Nombre de passagers attendus invalide : de 0 à ${pricing.offeredSeats}.`);
  }
  if (pricing.customPrice !== null && (!isNumber(pricing.customPrice) || pricing.customPrice < 0 || pricing.customPrice > MAX_FARE)) {
    throw new Error('Prix par place invalide : de 0 à 1 000 000 €, ou aucun prix personnalisé.');
  }
  if (!isNumber(pricing.driverFee) || pricing.driverFee < 0 || pricing.driverFee > MAX_AMOUNT) {
    throw new Error('Frais conducteur par place invalides : de 0 à 10 000 €.');
  }
  if(pricing.mode!==undefined&&!['share','cover','surplus'].includes(pricing.mode))throw new Error('Objectif de prix invalide.');
  if(pricing.targetSurplus!==undefined&&(!isNumber(pricing.targetSurplus)||pricing.targetSurplus<0||pricing.targetSurplus>MAX_AMOUNT))throw new Error('Excédent souhaité invalide : de 0 à 10 000 €.');
  return pricing;
}

/**
 * Share mode uses all offered seats. Cover/surplus modes use expected passengers.
 * Every occupancy row uses one fixed price. Driver fees are deducted from receipts,
 * and included in the price required to reach a cover/surplus target.
 *
 * The existing vehicle schema stores EV kWh/100 km in route.consumption and
 * EUR/kWh in state.fuelPrice. PHEVs have an additional electricity consumption.
 */
export function calculatePricing(state, routeKey = state?.selectedRoute) {
  if (!state || typeof state !== 'object' || !['highway', 'road'].includes(routeKey)) {
    throw new Error('Itinéraire invalide pour le calcul du prix par place.');
  }
  const pricing = normalizePricing(state.pricing, state.vehicle?.seats);
  validatePricing(pricing, normalizedCapacity(state.vehicle?.seats));
  const base = {
    available: false,
    reason: null,
    costsKnown:false,
    mode:pricing.mode,
    targetSurplus:pricing.mode==='surplus'?pricing.targetSurplus:0,
    targetMet:null,
    goalReason:null,
    roundingDelta:null,
    sharedPrice:null,
    offeredSeats: pricing.offeredSeats,
    expectedPassengers: pricing.expectedPassengers,
    cost: null,
    energy: null,
    wear: null,
    tolls: null,
    suggestedPrice: null,
    price: null,
    driverFee: pricing.driverFee,
    netPerSeat: null,
    rows: [],
    expected: null,
    full: null,
    excess: null
  };
  const unavailable = reason => ({...base, reason});
  const status = state.routing?.status;
  if (status === 'loading') return unavailable('Calcul des itinéraires en cours…');
  if (status === 'error') return unavailable('Le calcul du trajet a échoué. Réessayez ou renseignez le trajet manuellement.');
  if (!['ready', 'manual'].includes(status)) {
    return unavailable('Choisissez les villes proposées ou renseignez le trajet manuellement.');
  }
  if (state.vehicle?.needsConsumption) {
    return unavailable('Renseignez la consommation de votre véhicule.');
  }
  const route = state.routes?.[routeKey];
  // A numeric zero left in route state must not turn an unknown toll into free travel.
  if (state.routing?.tollsKnown?.[routeKey] !== true || route?.tolls == null) {
    return unavailable('Renseignez ou vérifiez les péages pour calculer le prix complet.');
  }
  if (!route || typeof route !== 'object') {
    throw new Error('Données du trajet incomplètes pour le calcul du prix par place.');
  }
  const isPlugIn = ['phev', 'diesel_phev'].includes(state.vehicle?.energy);
  const electricityPrice = isPlugIn ? (state.electricityPrice ?? 0) : 0;
  const wearPerKm = state.wearPerKm ?? 0;
  for (const key of ['distance', 'consumption', 'tolls']) requireNumber(route[key], key);
  if (route.electricity !== undefined) requireNumber(route.electricity, 'electricity');
  requireNumber(state.fuelPrice, 'fuelPrice');
  requireNumber(wearPerKm, 'wearPerKm');
  requireNumber(electricityPrice, 'electricityPrice');

  const costs = routeCost(route, state.fuelPrice, wearPerKm, electricityPrice);
  const sharedPrice = Math.floor(costs.total / (pricing.offeredSeats + 1) * 2 + 1e-9) / 2;
  const targetRevenue=costs.total+base.targetSurplus;
  const goalReason=pricing.mode!=='share'&&pricing.expectedPassengers===0&&targetRevenue>1e-9?'Choisissez au moins un passager attendu pour calculer le prix qui atteint cet objectif.':null;
  const suggestedPrice = pricing.mode==='share'?sharedPrice:goalReason?null:pricing.expectedPassengers>0?ceilingCent(targetRevenue/pricing.expectedPassengers+pricing.driverFee):0;
  const price = pricing.customPrice ?? suggestedPrice;
  const rows = price===null?[]:Array.from({length: pricing.offeredSeats + 1}, (_, passengers) => {
    const grossRevenue = passengers * price;
    const fees = passengers * pricing.driverFee;
    const revenue = grossRevenue - fees;
    return {passengers, revenue, grossRevenue, fees, remaining: costs.total - revenue};
  });
  const full = rows[pricing.offeredSeats]??null;
  const expected=rows[pricing.expectedPassengers]??null;
  return {
    ...base,
    available:price!==null,
    reason:price===null?goalReason:null,
    goalReason,
    costsKnown:true,
    cost: costs.total,
    energy: costs.fuel + costs.electricity,
    wear: costs.wear,
    tolls: costs.tolls,
    suggestedPrice,
    sharedPrice,
    price,
    netPerSeat:price===null?null:price-pricing.driverFee,
    rows,
    expected,
    full,
    excess:full?Math.max(0,full.revenue-costs.total):null,
    targetMet:pricing.mode==='share'||!expected?null:expected.revenue+1e-9>=targetRevenue,
    roundingDelta:pricing.mode==='share'||suggestedPrice===null?null:Math.max(0,(suggestedPrice-pricing.driverFee)*pricing.expectedPassengers-targetRevenue)
  };
}
