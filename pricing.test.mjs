import test from 'node:test';
import assert from 'node:assert/strict';
import {cloneDefault} from './src/lib/calculations.mjs';
import {calculatePricing, normalizePricing, validatePricing} from './src/lib/pricing.mjs';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} should equal ${expected}`);
function scenario() {
  const state = cloneDefault();
  state.routes.highway = {distance: 150, minutes: 120, tolls: 10, consumption: 5.3, electricity: 0};
  state.routing = {status: 'ready', tollsKnown: {highway: true, road: true}};
  state.pricing = {offeredSeats: 3, expectedPassengers: 1, customPrice: null, driverFee: 0};
  return state;
}

test('Tolls are included and full occupancy shares costs with the driver', () => {
  const result = calculatePricing(scenario());
  assert.equal(result.available, true);
  assert.equal(result.reason, null);
  near(result.energy, 14.31);
  near(result.tolls, 10);
  near(result.wear, 0);
  near(result.cost, 24.31);
  near(result.suggestedPrice, 6);
  near(result.price, 6);
  assert.deepEqual(result.rows.map(row => row.passengers), [0, 1, 2, 3]);
  near(result.expected.remaining, 18.31);
  near(result.full.revenue, 18);
  near(result.full.remaining, 6.31);
  near(result.excess, 0);
});

test('No bookings leaves the entire cost with the driver without changing the price', () => {
  const state = scenario();
  const original = calculatePricing(state);
  state.pricing.expectedPassengers = 0;
  const result = calculatePricing(state);
  near(result.expected.revenue, 0);
  near(result.expected.remaining, 24.31);
  assert.equal(result.price, original.price);
  assert.deepEqual(result.rows, original.rows);
  state.pricing.expectedPassengers = 3;
  assert.equal(calculatePricing(state).price, original.price);
});

test('Zero cost and confirmed zero tolls produce a finite zero-price simulation', () => {
  const state = scenario();
  state.routes.highway = {distance: 0, minutes: 0, tolls: 0, consumption: 0, electricity: 0};
  state.pricing.offeredSeats = 2;
  const result = calculatePricing(state);
  assert.equal(result.available, true);
  assert.equal(result.price, 0);
  assert.equal(result.cost, 0);
  assert.equal(result.excess, 0);
  for (const row of result.rows) {
    assert.equal(row.revenue, 0);
    assert.equal(row.remaining, 0);
    assert.equal(Number.isFinite(row.remaining), true);
  }
});

test('Unknown tolls, including a stale zero value, cannot yield a complete quote', () => {
  for (const tolls of [0, 10, null, undefined]) {
    const state = scenario();
    state.routing.tollsKnown.highway = false;
    state.routes.highway.tolls = tolls;
    const result = calculatePricing(state);
    assert.equal(result.available, false);
    assert.match(result.reason, /péages/);
    for (const field of ['cost', 'tolls', 'suggestedPrice', 'price', 'netPerSeat', 'expected', 'full', 'excess']) {
      assert.equal(result[field], null);
    }
    assert.deepEqual(result.rows, []);
  }
  const state = scenario();
  state.routes.highway.tolls = null;
  assert.equal(calculatePricing(state).available, false);
});

test('A custom fare reveals an excess at full occupancy and keeps the reference separate', () => {
  const state = scenario();
  state.routes.highway = {distance: 100, minutes: 90, tolls: 10.9, consumption: 10, electricity: 0};
  state.pricing = {offeredSeats: 4, expectedPassengers: 2, customPrice: 9.5, driverFee: 0};
  const result = calculatePricing(state);
  near(result.cost, 28.9);
  near(result.suggestedPrice, 5.5);
  near(result.price, 9.5);
  near(result.expected.remaining, 9.9);
  near(result.full.revenue, 38);
  near(result.full.remaining, -9.1);
  near(result.excess, 9.1);
});

test('The reference rounds down at a half-euro boundary without a floating-point step', () => {
  const state = scenario();
  state.routes.highway = {distance: 0, minutes: 0, tolls: 27.999999999999996, consumption: 0, electricity: 0};
  near(calculatePricing(state).suggestedPrice, 7);
  state.routes.highway.tolls = 27.99;
  near(calculatePricing(state).suggestedPrice, 6.5);
});

test('Driver fees are deducted per booked seat and do not gross up the reference', () => {
  const state = scenario();
  state.pricing.driverFee = 1.25;
  const result = calculatePricing(state);
  near(result.price, 6);
  near(result.suggestedPrice, 6);
  near(result.netPerSeat, 4.75);
  near(result.full.grossRevenue, 18);
  near(result.full.fees, 3.75);
  near(result.full.revenue, 14.25);
  near(result.full.remaining, 10.06);
  near(result.rows[0].fees, 0);
});

test('Fees above the fare preserve negative receipts and increase the remaining cost', () => {
  const state = scenario();
  state.pricing.driverFee = 8;
  const result = calculatePricing(state);
  near(result.price, 6);
  near(result.netPerSeat, -2);
  near(result.expected.revenue, -2);
  near(result.expected.remaining, 26.31);
  near(result.full.revenue, -6);
  near(result.full.remaining, 30.31);
  near(result.excess, 0);
});

test('EV costs use the current app schema: consumption in kWh and fuelPrice in EUR/kWh', () => {
  const state = scenario();
  state.vehicle.energy = 'electric';
  state.routes.highway = {distance: 200, minutes: 120, tolls: 10, consumption: 18, electricity: 12};
  state.fuelPrice = .3;
  state.electricityPrice = .9;
  const result = calculatePricing(state);
  near(result.energy, 10.8);
  near(result.cost, 20.8);
  near(result.suggestedPrice, 5);
});

test('Both PHEV types add fuel and electrical energy once, with optional wear', () => {
  for (const energy of ['phev', 'diesel_phev']) {
    const state = scenario();
    state.vehicle.energy = energy;
    state.routes.highway = {distance: 200, minutes: 120, tolls: 5, consumption: 4, electricity: 5};
    state.electricityPrice = .3;
    state.wearPerKm = .04;
    const result = calculatePricing(state);
    near(result.energy, 17.4);
    near(result.wear, 8);
    near(result.cost, 30.4);
    near(result.suggestedPrice, 7.5);
  }
});

test('The requested route controls the costs and only its toll status blocks pricing', () => {
  const state = scenario();
  state.routing.tollsKnown.highway = false;
  state.routes.road = {distance: 100, minutes: 110, tolls: 0, consumption: 5, electricity: 0};
  assert.equal(calculatePricing(state).available, false);
  const result = calculatePricing(state, 'road');
  assert.equal(result.available, true);
  near(result.cost, 9);
  near(result.suggestedPrice, 2);
  assert.equal(state.selectedRoute, 'highway');
});

test('Pending, unresolved, failed routing and missing consumption suppress stale results', () => {
  for (const status of ['loading', 'unresolved', 'error', undefined, 'unexpected']) {
    const state = scenario();
    state.routing.status = status;
    const result = calculatePricing(state);
    assert.equal(result.available, false);
    assert.ok(result.reason);
    assert.equal(result.cost, null);
    assert.equal(result.price, null);
  }
  const state = scenario();
  state.vehicle.needsConsumption = true;
  const result = calculatePricing(state);
  assert.equal(result.available, false);
  assert.match(result.reason, /consommation/);
  state.vehicle.needsConsumption = false;
  state.routing.status = 'manual';
  assert.equal(calculatePricing(state).available, true);
});

test('Capacity changes clamp offered and expected seats while preserving source state', () => {
  const state = scenario();
  state.vehicle.seats = 2;
  state.pricing.offeredSeats = 4;
  state.pricing.expectedPassengers = 4;
  const before = structuredClone(state);
  const result = calculatePricing(state);
  assert.equal(result.offeredSeats, 2);
  assert.equal(result.expectedPassengers, 2);
  assert.equal(result.rows.length, 3);
  near(result.suggestedPrice, 8);
  assert.deepEqual(state, before);
  state.vehicle.seats = 8;
  state.pricing.offeredSeats = 8;
  assert.equal(calculatePricing(state).rows.length, 9);
});

test('Normalization merges partial preferences, clamps ranges, and preserves a free custom fare', () => {
  assert.deepEqual(normalizePricing(undefined, 4), {offeredSeats: 3, expectedPassengers: 1, customPrice: null, driverFee: 0, mode: 'share', targetSurplus: 5});
  assert.deepEqual(normalizePricing(null, 1), {offeredSeats: 1, expectedPassengers: 1, customPrice: null, driverFee: 0, mode: 'share', targetSurplus: 5});
  assert.deepEqual(normalizePricing({offeredSeats: 99, expectedPassengers: 20, customPrice: 0, driverFee: -3}, 4), {offeredSeats: 4, expectedPassengers: 4, customPrice: 0, driverFee: 0, mode: 'share', targetSurplus: 5});
  assert.deepEqual(normalizePricing({offeredSeats: -1, expectedPassengers: -1, customPrice: 2000000, driverFee: 20000}, 4), {offeredSeats: 1, expectedPassengers: 0, customPrice: 1000000, driverFee: 10000, mode: 'share', targetSurplus: 5});
  assert.deepEqual(normalizePricing({offeredSeats: 2.9, expectedPassengers: 1.9, customPrice: '5', driverFee: Infinity}, 4), {offeredSeats: 2, expectedPassengers: 1, customPrice: null, driverFee: 0, mode: 'share', targetSurplus: 5});
  assert.deepEqual(normalizePricing({offeredSeats: NaN, expectedPassengers: '2', customPrice: NaN, driverFee: '2'}, 4), {offeredSeats: 3, expectedPassengers: 1, customPrice: null, driverFee: 0, mode: 'share', targetSurplus: 5});
  const state = scenario();
  state.pricing.customPrice = 0;
  const result = calculatePricing(state);
  assert.equal(result.price, 0);
  assert.equal(result.full.revenue, 0);
  near(result.full.remaining, 24.31);
});

test('Strict validation rejects invalid prices, fees, seat counts and capacities explicitly', () => {
  const valid = scenario().pricing;
  assert.equal(validatePricing(valid, 4), valid);
  for (const value of [null, undefined, [], 'x']) {
    assert.throws(() => validatePricing(value, 4), /Réglages/);
  }
  for (const value of [0, -1, 9, 1.5, NaN, Infinity, '4', null]) {
    assert.throws(() => validatePricing({...valid, offeredSeats: value}, 4), /places proposées/);
  }
  assert.throws(() => validatePricing(valid, 2), /places proposées/);
  for (const value of [-1, 4, 1.5, NaN, Infinity, '1', null]) {
    assert.throws(() => validatePricing({...valid, expectedPassengers: value}, 4), /passagers attendus/);
  }
  for (const value of [-1, 1000001, NaN, Infinity, '5', undefined]) {
    assert.throws(() => validatePricing({...valid, customPrice: value}, 4), /Prix par place/);
  }
  for (const value of [-1, 10001, NaN, Infinity, '5', undefined, null]) {
    assert.throws(() => validatePricing({...valid, driverFee: value}, 4), /Frais conducteur/);
  }
  for (const capacity of [0, 9, 1.5, NaN, Infinity, '4', null]) {
    assert.throws(() => validatePricing(valid, capacity), /Capacité/);
  }
  assert.doesNotThrow(() => validatePricing({...valid, customPrice: 0, driverFee: 10000}, 4));
});

test('Invalid route inputs fail explicitly instead of producing NaN or negative costs', () => {
  assert.throws(() => calculatePricing(null), /Itinéraire/);
  assert.throws(() => calculatePricing(scenario(), 'other'), /Itinéraire/);
  for (const key of ['distance', 'consumption', 'tolls']) {
    for (const value of [-1, NaN, Infinity, '5']) {
      const state = scenario();
      state.routes.highway[key] = value;
      assert.throws(() => calculatePricing(state), /Valeur invalide/);
    }
  }
});

test('Cover target includes driver fees and labels the small rounding excess separately',()=>{
 const s=scenario();s.pricing={...s.pricing,mode:'cover',expectedPassengers:2,driverFee:.25};
 const r=calculatePricing(s);near(r.suggestedPrice,12.41);near(r.sharedPrice,6);near(r.expected.revenue,24.32);near(r.expected.remaining,-.01);near(r.roundingDelta,.01);near(r.full.remaining,-12.17);assert.equal(r.targetMet,true);
});
test('Surplus target calculates the per-seat price that reaches the entered net amount',()=>{
 const s=scenario();s.pricing={...s.pricing,mode:'surplus',expectedPassengers:3,targetSurplus:5,driverFee:.3};
 const r=calculatePricing(s);near(r.suggestedPrice,10.07);near(r.expected.revenue,29.31);near(r.expected.remaining,-5);near(r.roundingDelta,0);assert.equal(r.targetMet,true);
 s.pricing.customPrice=9;const lower=calculatePricing(s);assert.equal(lower.targetMet,false);near(lower.suggestedPrice,10.07);near(lower.expected.remaining,-1.79);
});
test('Zero expected bookings keeps costs visible but cannot produce a cover or surplus quote',()=>{
 const s=scenario();s.pricing.expectedPassengers=0;
 for(const mode of ['cover','surplus']){s.pricing.mode=mode;const r=calculatePricing(s);assert.equal(r.available,false);assert.equal(r.costsKnown,true);near(r.cost,24.31);assert.equal(r.suggestedPrice,null);assert.match(r.reason,/au moins un passager/);assert.deepEqual(r.rows,[]);}
 s.pricing.customPrice=8;const custom=calculatePricing(s);assert.equal(custom.available,true);assert.equal(custom.targetMet,false);near(custom.expected.remaining,24.31);assert.equal(custom.suggestedPrice,null);
});
test('Already free travel at zero target works without division by zero; high costs are not silently capped',()=>{
 const s=scenario();s.routes.highway={distance:0,minutes:0,tolls:0,consumption:0,electricity:0};s.pricing={...s.pricing,mode:'cover',expectedPassengers:0};
 const zero=calculatePricing(s);assert.equal(zero.suggestedPrice,0);assert.equal(zero.targetMet,true);
 s.routes.highway.distance=10000;s.routes.highway.consumption=100;s.fuelPrice=10;s.pricing.expectedPassengers=1;
 const high=calculatePricing(s);near(high.suggestedPrice,100000);near(high.expected.remaining,0);s.pricing.customPrice=high.suggestedPrice;assert.doesNotThrow(()=>validatePricing(s.pricing,4));near(calculatePricing(s).price,100000);
});
test('Old price preferences migrate to share and objective values are validated before mutation',()=>{
 const old=scenario().pricing;assert.equal(normalizePricing(old,4).mode,'share');assert.equal(normalizePricing(old,4).targetSurplus,5);
 assert.throws(()=>validatePricing({...old,mode:'invalid'},4),/Objectif/);
 for(const targetSurplus of [-1,NaN,Infinity,'5',10001])assert.throws(()=>validatePricing({...old,mode:'surplus',targetSurplus},4),/Excédent/);
});
