import test from 'node:test';
import assert from 'node:assert/strict';
import {tollIdentity,prepareTollMemory,invalidateTolls,storeToll,restoreToll,snapshotTolls,restoreExactToll} from './src/lib/toll-memory.mjs';

const date='2026-09-25T09:00:00.000Z';
function state(){return {
 origin:'Saint-Étienne',destination:'Valence',selectedRoute:'highway',
 locations:{origin:{code:'42218',name:'Saint-Étienne',lon:4.3873,lat:45.4402},destination:{code:'26362',name:'Valence',lon:4.8921,lat:44.9333}},
 vehicle:{id:'personal-mg3',energy:'hybrid'},
 routing:{status:'ready',tollsKnown:{highway:false,road:false},tollDetails:{}},tollMemory:[],
 routes:{highway:{distance:120,minutes:90,tolls:0,fingerprint:'geo-v1:aaa'},road:{distance:100,minutes:110,tolls:0,fingerprint:'geo-v1:bbb'}}
};}

test('A saved amount is restored only for the exact itinerary and keeps its original date',()=>{
 const s=state();assert.equal(storeToll(s,'highway',8.9,{now:date}),true);
 assert.equal(s.routing.tollDetails.highway.source,'manual');
 invalidateTolls(s);assert.equal(restoreToll(s,'highway'),true);
 assert.equal(s.routes.highway.tolls,8.9);assert.equal(s.routing.tollsKnown.highway,true);
 assert.equal(s.routing.tollDetails.highway.source,'remembered');assert.equal(s.routing.tollDetails.highway.savedAt,date);
 assert.equal(s.routing.tollsKnown.road,false);
});

test('Changes to either town, direction, coordinates, vehicle or geometry cannot inherit an old toll',()=>{
 const changes=[
  s=>{s.origin='Lyon';},s=>{s.destination='Annecy';},s=>{s.locations.origin.code='69123';},
  s=>{s.locations.destination.lon+=.01;},s=>{[s.locations.origin,s.locations.destination]=[s.locations.destination,s.locations.origin];},
  s=>{s.vehicle.id='other-car';},s=>{s.vehicle.energy='electric';},s=>{s.routes.highway.fingerprint='geo-v1:other';},
  s=>{s.routes.highway.fingerprint=null;},s=>{s.routing.status='unresolved';s.locations.origin=null;}
 ];
 for(const change of changes){const s=state();storeToll(s,'highway',8.9,{now:date});invalidateTolls(s);change(s);assert.equal(restoreToll(s,'highway'),false,change.toString());assert.equal(s.routing.tollsKnown.highway,false);}
});

test('Changing the selected comparison does not remove independent highway and road tolls',()=>{
 const s=state();storeToll(s,'highway',8,{now:date});storeToll(s,'road',1.2,{now:date});
 s.selectedRoute='road';prepareTollMemory(s);
 assert.equal(s.routes.highway.tolls,8);assert.equal(s.routes.road.tolls,1.2);assert.equal(s.routing.tollsKnown.highway,true);assert.equal(s.routing.tollsKnown.road,true);
});

test('Clearing a field forgets only that precise toll; a confirmed zero remains a known amount',()=>{
 const s=state();storeToll(s,'highway',8,{now:date});storeToll(s,'road',0,{now:date});
 storeToll(s,'highway',null,{now:date});
 assert.equal(s.tollMemory.length,1);assert.equal(restoreToll(s,'highway'),false);assert.equal(s.routing.tollsKnown.highway,false);
 invalidateTolls(s,['road']);assert.equal(restoreToll(s,'road'),true);assert.equal(s.routing.tollsKnown.road,true);assert.equal(s.routes.road.tolls,0);
});

test('Manual routes bind the toll to entered towns, distance and duration, independently from an IGN route',()=>{
 const s=state();s.routing.status='manual';s.locations={origin:null,destination:null};s.routes.highway.fingerprint=null;
 storeToll(s,'highway',3.5,{now:date});const identity=tollIdentity(s,'highway');
 invalidateTolls(s,['highway'],{clearFingerprint:true});s.routes.highway.distance+=1;
 assert.notEqual(tollIdentity(s,'highway'),identity);assert.equal(restoreToll(s,'highway'),false);
 s.routes.highway.distance-=1;s.routes.highway.minutes+=1;assert.equal(restoreToll(s,'highway'),false);
 s.routes.highway.minutes-=1;assert.equal(restoreToll(s,'highway'),true);
 s.origin='Nouvelle ville';invalidateTolls(s,['highway'],{clearFingerprint:true});assert.equal(restoreToll(s,'highway'),false);
});

test('Editing a route invalidates both its current amount and geometric fingerprint while preserving the other route',()=>{
 const s=state();storeToll(s,'highway',8,{now:date});storeToll(s,'road',0,{now:date});
 invalidateTolls(s,['highway'],{clearFingerprint:true});s.routing.status='manual';
 assert.equal(s.routes.highway.fingerprint,null);assert.equal(s.routing.tollsKnown.highway,false);
 assert.equal(restoreToll(s,'highway'),false);assert.equal(s.routes.road.fingerprint,'geo-v1:bbb');assert.equal(s.routing.tollsKnown.road,true);
});

test('Typing a town then choosing manual mode cannot resurrect tolls from the previous town',()=>{
 const s=state();storeToll(s,'highway',8,{now:date});
 invalidateTolls(s,undefined,{clearFingerprint:true});s.origin='Lyon';s.locations.origin=null;s.routing.status='unresolved';
 assert.equal(tollIdentity(s,'highway'),null);s.routing.status='manual';
 assert.equal(restoreToll(s,'highway'),false);assert.equal(s.routing.tollsKnown.highway,false);
});

test('Legacy user-entered amounts are preserved without inventing a source date or geometric evidence',()=>{
 const s=state();delete s.tollMemory;delete s.routing.tollDetails;delete s.routes.highway.fingerprint;
 s.routing.tollsKnown.highway=true;s.routes.highway.tolls=7.8;
 prepareTollMemory(s);assert.equal(s.routes.highway.tolls,7.8);assert.equal(s.routing.tollDetails.highway.source,'manual');assert.equal(s.routing.tollDetails.highway.savedAt,null);assert.equal(s.tollMemory.length,0);
 const previous=snapshotTolls(s);invalidateTolls(s);s.routes.highway.fingerprint='geo-v1:new';
 assert.equal(restoreExactToll(s,'highway',previous),false);
});

test('A known amount can survive an identical recalculation without inventing a legacy date',()=>{
 const s=state();s.routing.tollsKnown.highway=true;s.routes.highway.tolls=7.8;prepareTollMemory(s);
 const previous=snapshotTolls(s);invalidateTolls(s);
 assert.equal(restoreExactToll(s,'highway',previous),true);assert.equal(s.routes.highway.tolls,7.8);assert.equal(s.routing.tollDetails.highway.savedAt,null);
});

test('Invalid values cannot corrupt the current toll, its known status or its memory',()=>{
 const s=state();storeToll(s,'highway',8,{now:date});const before=JSON.stringify(s);
 for(const value of [-1,Infinity,NaN,10001,'8',undefined]){assert.equal(storeToll(s,'highway',value,{now:date}),false);assert.equal(JSON.stringify(s),before);}
 assert.equal(storeToll(s,'unknown',8,{now:date}),false);assert.equal(JSON.stringify(s),before);
});

test('Memory sanitization drops malformed entries and invalidates a dated amount attached to another identity',()=>{
 const s=state();storeToll(s,'highway',8,{now:date});
 s.tollMemory.push({...s.tollMemory[0]}, {key:'bad',amount:-1,savedAt:date},{key:'date',amount:3,savedAt:'invalid'},null);
 s.vehicle.id='changed';prepareTollMemory(s);
 assert.equal(s.tollMemory.length,1);assert.equal(s.routing.tollsKnown.highway,false);assert.equal(s.routes.highway.tolls,0);
});
