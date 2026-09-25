import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {indexCities,searchCities,indexCars,searchCars,routeUrl,parseRoute} from './src/lib/data-services.mjs';
import {cloneDefault,upgradeState} from './src/lib/calculations.mjs';
const cities=indexCities(JSON.parse(readFileSync(new URL('./data/communes.json',import.meta.url))).communes);
const cars=indexCars(JSON.parse(readFileSync(new URL('./data/cars.json',import.meta.url))).cars);
test('One-letter, accent, Saint abbreviation and postcode city searches',()=>{
 for(const q of ['s','st et','saint etienne','Saint-Étienne','42000','42'])assert.ok(searchCities(cities,q,['42218']).some(c=>c.code==='42218'),q);
 const valences=searchCities(cities,'Valence');assert.equal(valences[0].code,'26362');assert.ok(valences.length>=3);
});
test('Car catalogue resolves brands and versions without inventing missing consumption',()=>{
 assert.ok(searchCars(cars,'Renault Clio').length>0);
 assert.ok(cars.filter(c=>['electric','phev','diesel_phev','lpg'].includes(c.energy)).every(c=>c.consumption===null));
 assert.ok(cars.every(c=>c.label.length<=200));
});
test('Routing URL distinguishes fastest and genuinely banned motorways',()=>{
 const a={code:'42218',name:'Saint-Étienne',lon:4.3873,lat:45.4402},b={code:'26362',name:'Valence',lon:4.8921,lat:44.9333};
 const fast=new URL(routeUrl(a,b,false)),road=new URL(routeUrl(a,b,true));
 assert.equal(fast.searchParams.get('distanceUnit'),'kilometer');assert.equal(fast.searchParams.get('constraints'),null);
 assert.deepEqual(JSON.parse(road.searchParams.get('constraints')),{constraintType:'banned',key:'waytype',operator:'=',value:'autoroute'});
 assert.throws(()=>routeUrl({...a,lon:Infinity},b));
});
test('API distances are validated with units, avoiding meter-kilometer errors',()=>{
 assert.deepEqual(parseRoute({distanceUnit:'kilometer',timeUnit:'minute',distance:120.54,duration:106.7}),{distance:120.5,minutes:107,fingerprint:null,resourceVersion:null});
 assert.throws(()=>parseRoute({distanceUnit:'meter',timeUnit:'second',distance:120500,duration:6420}));
});
test('Saved tolls can distinguish different geometries even when endpoints, distance and duration match',()=>{
 const response={distanceUnit:'kilometer',timeUnit:'minute',distance:120,duration:90,geometry:{type:'LineString',coordinates:[[4.3873,45.4402],[4.6,45.2],[4.8921,44.9333]]}};
 const first=parseRoute(response),same=parseRoute({...response,duration:92,resourceVersion:'new'});
 assert.match(first.fingerprint,/^geo-v1:[a-f0-9]{16}$/);assert.equal(first.fingerprint,same.fingerprint);
 const alternative=parseRoute({...response,geometry:{type:'LineString',coordinates:[[4.3873,45.4402],[4.7,45.3],[4.8921,44.9333]]}});
 assert.notEqual(first.fingerprint,alternative.fingerprint);
 assert.equal(parseRoute({...response,geometry:{type:'LineString',coordinates:[[4.3,NaN],[4.8,44.9]]}}).fingerprint,null);
});
test('Existing saved simulation is preserved when adding vehicle and routing fields',()=>{
 const original=cloneDefault();original.version=1;original.fuelPrice=1.97;original.passengers=[{revenue:11},{revenue:5}];delete original.vehicle;delete original.routing;delete original.locations;
 const updated=upgradeState(original);assert.equal(updated.version,4);assert.equal(updated.fuelPrice,1.97);assert.equal(updated.passengers.length,2);assert.equal(updated.vehicle.label,'MG3 Hybrid+');
});
