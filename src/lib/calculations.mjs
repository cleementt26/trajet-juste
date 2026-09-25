export const MAX_PASSENGERS = 8;
export const passengerCapacity = state => state.vehicle?.seats ?? 4;
export const DEFAULT_STATE = Object.freeze({
  version: 4, origin: 'Saint-Étienne', destination: 'Valence', selectedRoute: 'highway',
  fuelPrice: 1.8, wearPerKm: 0, electricityPrice: .25,
  vehicle: {id:'personal-mg3',label:'MG3 Hybrid+',energy:'hybrid',seats:4,source:'personal'}, garage:[],
  locations: {origin:null,destination:null}, routing:{status:'unresolved',tollsKnown:{highway:false,road:false}},
  pricing:{offeredSeats:3,expectedPassengers:1,customPrice:null,driverFee:0,mode:'share',targetSurplus:5},tollMemory:[],
  routes: {
    highway: {distance:120, minutes:90, tolls:8, consumption:5.3,electricity:0},
    road: {distance:100, minutes:110, tolls:0, consumption:5.3,electricity:0}
  },
  passengers: [{revenue:10}],
  candidate: {revenue:5, distance:12, minutes:20, tolls:0}
});
export const cloneDefault = () => JSON.parse(JSON.stringify(DEFAULT_STATE));
export const LIMITS = Object.freeze({distance:10000, minutes:100000, tolls:10000, consumption:100, electricity:100, electricityPrice:10, fuelPrice:10, wearPerKm:5, revenue:10000,customPrice:1000000});
export function upgradeState(old) {
  if(!old || ![1,2,3,4].includes(old.version))throw new Error('Version de sauvegarde inconnue.');
  const base=cloneDefault();
  const result={...base,...old,version:4,vehicle:{...base.vehicle,...old.vehicle},locations:{...base.locations,...old.locations},routing:{...base.routing,...old.routing,tollsKnown:{...base.routing.tollsKnown,...old.routing?.tollsKnown}},pricing:{...base.pricing,...old.pricing},tollMemory:Array.isArray(old.tollMemory)?old.tollMemory.slice(0,60):[],garage:Array.isArray(old.garage)?old.garage.slice(0,20):[]};
  result.pricing.offeredSeats=Math.min(result.pricing.offeredSeats,result.vehicle.seats);
  result.pricing.expectedPassengers=Math.min(result.pricing.expectedPassengers,result.pricing.offeredSeats);
  result.routes={highway:{...base.routes.highway,...old.routes?.highway},road:{...base.routes.road,...old.routes?.road}};
  return validateState(result);
}
export function requireNumber(value, key) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > LIMITS[key]) throw new Error(`Valeur invalide : ${key}.`);
  return value;
}
export function validateState(value) {
  if (!value || typeof value !== 'object' || !['highway','road'].includes(value.selectedRoute)) throw new Error('Itinéraire invalide.');
  if (typeof value.origin !== 'string' || typeof value.destination !== 'string' || value.origin.length > 80 || value.destination.length > 80) throw new Error('Nom de ville invalide.');
  requireNumber(value.fuelPrice,'fuelPrice'); requireNumber(value.wearPerKm,'wearPerKm');
  if(value.electricityPrice!==undefined)requireNumber(value.electricityPrice,'electricityPrice');
  if(value.vehicle && (!Number.isInteger(value.vehicle.seats)||value.vehicle.seats<1||value.vehicle.seats>8||typeof value.vehicle.label!=='string'||value.vehicle.label.length>200||!['petrol','diesel','hybrid','diesel_hybrid','electric','phev','diesel_phev','lpg','e85'].includes(value.vehicle.energy)))throw new Error('Véhicule invalide.');
  if(value.pricing){const p=value.pricing;if(!Number.isInteger(p.offeredSeats)||p.offeredSeats<1||p.offeredSeats>8||!Number.isInteger(p.expectedPassengers)||p.expectedPassengers<0||p.expectedPassengers>p.offeredSeats)throw new Error('Nombre de places proposé invalide.');if(p.customPrice!==null)requireNumber(p.customPrice,'customPrice');requireNumber(p.driverFee,'revenue');if(p.mode!==undefined&&!['share','cover','surplus'].includes(p.mode))throw new Error('Objectif invalide.');if(p.targetSurplus!==undefined)requireNumber(p.targetSurplus,'revenue');}
  for (const name of ['highway','road']) {
    if (!value.routes?.[name]) throw new Error('Itinéraire incomplet.');
    for (const key of ['distance','minutes','tolls','consumption']) requireNumber(value.routes[name][key],key);
    if(value.routes[name].electricity!==undefined)requireNumber(value.routes[name].electricity,'electricity');
  }
  if (!Array.isArray(value.passengers) || value.passengers.length > MAX_PASSENGERS) throw new Error('Nombre de passagers invalide.');
  for (const passenger of value.passengers) requireNumber(passenger?.revenue,'revenue');
  for (const key of ['revenue','distance','minutes','tolls']) requireNumber(value.candidate?.[key],key);
  return value;
}
export function routeCost(route, fuelPrice, wearPerKm = 0, electricityPrice = 0) {
  const fuel = route.distance * route.consumption / 100 * fuelPrice;
  const electricity=route.distance*(route.electricity??0)/100*electricityPrice;
  const wear = route.distance * wearPerKm;
  return {fuel, electricity, wear, tolls:route.tolls, cash:fuel+electricity+route.tolls, total:fuel+electricity+route.tolls+wear};
}
export function ceilingCent(value) { return Math.ceil(value * 100 - 1e-9) / 100; }
export function calculate(state) {
  validateState(state);
  const revenue = state.passengers.reduce((sum,p) => sum+p.revenue,0);
  const routes = {};
  for (const name of ['highway','road']) {
    const cost = routeCost(state.routes[name],state.fuelPrice,state.wearPerKm,['phev','diesel_phev'].includes(state.vehicle?.energy)?state.electricityPrice:0);
    routes[name] = {...cost, balance:cost.total-revenue, distance:state.routes[name].distance, minutes:state.routes[name].minutes};
  }
  const selected = routes[state.selectedRoute];
  const candidateRoute = {...state.candidate, consumption:state.routes[state.selectedRoute].consumption,electricity:state.routes[state.selectedRoute].electricity};
  const extra = routeCost(candidateRoute,state.fuelPrice,state.wearPerKm,['phev','diesel_phev'].includes(state.vehicle?.energy)?state.electricityPrice:0);
  const margin = state.candidate.revenue-extra.total;
  return {
    revenue, routes, selected,
    coverage: selected.total > 0 ? Math.min(100,revenue/selected.total*100) : revenue > 0 ? 100 : 0,
    candidate: {
      available: state.passengers.length < passengerCapacity(state),
      cost:extra.total, fuel:extra.fuel, wear:extra.wear, tolls:extra.tolls, margin,
      hourly:state.candidate.minutes>0 ? margin*60/state.candidate.minutes : null,
      balanceAfter:selected.balance-margin,
      breakEven:ceilingCent(extra.total),
      totalCost:selected.total+extra.total,
      totalRevenue:revenue+state.candidate.revenue,
      totalDistance:selected.distance+state.candidate.distance,
      totalMinutes:selected.minutes+state.candidate.minutes
    },
    comparison:{savingOnRoad:routes.highway.total-routes.road.total, extraMinutesOnRoad:routes.road.minutes-routes.highway.minutes}
  };
}
