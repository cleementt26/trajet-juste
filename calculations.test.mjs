import test from 'node:test';
import assert from 'node:assert/strict';
import {calculate,cloneDefault,validateState,ceilingCent} from './src/lib/calculations.mjs';

const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,`${actual} should equal ${expected}`);
function scenario({route,road=route,fuel=1.8,wear=0,revenues=[],candidate}){
  const s=cloneDefault();s.routes={highway:route,road};s.fuelPrice=fuel;s.wearPerKm=wear;s.passengers=revenues.map(revenue=>({revenue}));s.candidate=candidate;return calculate(s);
}
test('Example: Saint-Étienne / Valence uses illustrative values consistently',()=>{
  const r=calculate(cloneDefault());near(r.selected.total,19.448);near(r.selected.balance,9.448);near(r.candidate.cost,1.1448);near(r.candidate.margin,3.8552);near(r.candidate.balanceAfter,5.5928);near(r.candidate.hourly,11.5656);near(r.candidate.breakEven,1.15);near(r.comparison.savingOnRoad,9.908);
});
test('Two routes and marginal contribution of one candidate',()=>{
  const r=scenario({route:{distance:160,minutes:110,tolls:12,consumption:5.5},road:{distance:175,minutes:150,tolls:0,consumption:5},revenues:[10,10],candidate:{revenue:8,distance:12,minutes:20,tolls:0}});
  near(r.selected.total,27.84);near(r.selected.balance,7.84);near(r.candidate.cost,1.188);near(r.candidate.margin,6.812);near(r.candidate.balanceAfter,1.028);near(r.candidate.hourly,20.436);near(r.candidate.breakEven,1.19);near(r.comparison.savingOnRoad,12.09);near(r.comparison.extraMinutesOnRoad,40);
});
test('No passenger, no detour, identical routes',()=>{
  const r=scenario({route:{distance:100,minutes:90,tolls:0,consumption:6},fuel:2,candidate:{revenue:0,distance:0,minutes:0,tolls:0}});
  near(r.selected.total,12);near(r.selected.balance,12);near(r.candidate.margin,0);near(r.candidate.balanceAfter,12);assert.equal(r.candidate.hourly,null);near(r.comparison.savingOnRoad,0);near(r.comparison.extraMinutesOnRoad,0);
});
test('A candidate without detour can create an excess',()=>{
  const r=scenario({route:{distance:100,minutes:90,tolls:5,consumption:5},fuel:2,revenues:[5],candidate:{revenue:12,distance:0,minutes:0,tolls:0}});
  near(r.selected.total,15);near(r.candidate.margin,12);near(r.candidate.balanceAfter,-2);assert.equal(r.candidate.hourly,null);
});
test('Wear and additional tolls make a candidate unfavorable',()=>{
  const r=scenario({route:{distance:200,minutes:120,tolls:15,consumption:6},wear:.04,revenues:[10,10],candidate:{revenue:5,distance:30,minutes:30,tolls:2}});
  near(r.selected.cash,36.6);near(r.selected.wear,8);near(r.selected.total,44.6);near(r.candidate.cost,6.44);near(r.candidate.margin,-1.44);near(r.candidate.balanceAfter,26.04);near(r.candidate.hourly,-2.88);
});
test('Contributions already exceed selected costs',()=>{
  const r=scenario({route:{distance:50,minutes:45,tolls:0,consumption:4},fuel:2,revenues:[12],candidate:{revenue:3,distance:5,minutes:10,tolls:0}});
  near(r.selected.total,4);near(r.selected.balance,-8);near(r.candidate.cost,.4);near(r.candidate.margin,2.6);near(r.candidate.balanceAfter,-10.6);near(r.coverage,100);
});
test('Exact arithmetic retained; only minimum price rounded upward',()=>{
  const r=scenario({route:{distance:10,minutes:12,tolls:0,consumption:5.37},fuel:1.839,candidate:{revenue:1,distance:3,minutes:6,tolls:0}});
  near(r.selected.total,.987543);near(r.candidate.cost,.2962629);near(r.candidate.margin,.7037371);near(r.candidate.balanceAfter,.2838059);near(r.candidate.hourly,7.037371);near(r.candidate.breakEven,.3);near(ceilingCent(1.15),1.15);near(ceilingCent(0),0);
});
test('Selected route changes candidate costs and totals',()=>{
  const s=cloneDefault();s.selectedRoute='road';s.routes.road.consumption=7;
  const r=calculate(s);near(r.selected.total,12.6);near(r.candidate.cost,1.512);near(r.candidate.totalDistance,112);near(r.candidate.totalMinutes,130);
});
test('Capacity follows the vehicle and absolute limit is eight passengers',()=>{
  const s=cloneDefault();s.passengers=[{revenue:0},{revenue:0},{revenue:0},{revenue:0}];assert.equal(calculate(s).candidate.available,false);s.vehicle.seats=6;assert.equal(calculate(s).candidate.available,true);s.passengers=Array.from({length:9},()=>({revenue:1}));assert.throws(()=>validateState(s));
});
test('Electric vehicle uses kWh with the selected electricity unit price',()=>{
 const s=cloneDefault();s.vehicle.energy='electric';s.routes.highway={distance:200,minutes:120,tolls:10,consumption:18,electricity:0};s.fuelPrice=.3;
 const r=calculate(s);near(r.selected.fuel,10.8);near(r.selected.total,20.8);
});
test('Plug-in vehicle adds both measured energy costs',()=>{
 const s=cloneDefault();s.vehicle.energy='phev';s.routes.highway={distance:200,minutes:120,tolls:0,consumption:4,electricity:5};s.fuelPrice=1.8;s.electricityPrice=.3;
 const r=calculate(s);near(r.selected.fuel,14.4);near(r.selected.electricity,3);near(r.selected.total,17.4);near(r.candidate.cost,1.044);
});
test('Invalid, negative and nonfinite values are rejected',()=>{
  for(const value of [-1,NaN,Infinity,'',null,'5']){const s=cloneDefault();s.candidate.distance=value;assert.throws(()=>calculate(s));}
  const s=cloneDefault();s.routes.highway.distance=10001;assert.throws(()=>calculate(s));
});
test('Zero-cost and zero-income scenario never yields infinity',()=>{
  const r=scenario({route:{distance:0,minutes:0,tolls:0,consumption:0},fuel:0,candidate:{revenue:0,distance:0,minutes:0,tolls:0}});
  near(r.selected.total,0);near(r.coverage,0);near(r.candidate.breakEven,0);assert.equal(r.candidate.hourly,null);assert.ok(!JSON.stringify(r).includes('null')||r.candidate.hourly===null);
});
