import {fingerprint} from './toll-memory.mjs';

export function normalize(value){return String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\bste(?=[\s.-]|$)/g,'sainte').replace(/\bst(?=[\s.-]|$)/g,'saint').replace(/[^a-z0-9]+/g,' ').trim();}
export function indexCities(rows){return rows.map(([code,name,postcodes,lon,lat,population])=>({code,name,postcodes,lon,lat,population,search:normalize(name)}));}
export function searchCities(cities,query,recent=[]){
 const q=normalize(query),words=q.split(' '),numeric=/^\d+$/.test(q);
 const scored=[];
 for(const city of cities){
  let score=0;
  if(!q){if(recent.includes(city.code))score=100;else continue;}
  else if(numeric){if(!city.postcodes.some(p=>p.startsWith(q)))continue;score=20;}
  else {if(!words.every(word=>city.search.includes(word)))continue;score=city.search===q?100:city.search.startsWith(q)?30:10;}
  if(recent.includes(city.code))score+=40;
  scored.push({city,score});
 }
 return scored.sort((a,b)=>b.score-a.score||b.city.population-a.city.population).slice(0,8).map(r=>r.city);
}
export function cityPoint(city){return {code:city.code,name:city.name,postcodes:city.postcodes,lon:city.lon,lat:city.lat};}
export function validPoint(point){return !!point&&typeof point.code==='string'&&typeof point.name==='string'&&Number.isFinite(point.lon)&&Math.abs(point.lon)<=180&&Number.isFinite(point.lat)&&Math.abs(point.lat)<=90;}
export const ENERGY_MAP={'ESSENCE':'petrol','GAZOLE':'diesel','ESS+ELEC HNR':'hybrid','GAZ+ELEC HNR':'diesel_hybrid','ELEC+ESSENC HR':'phev','ELEC+GAZOLE HR':'diesel_phev','ELECTRIC':'electric','SUPERETHANOL':'e85','ESS+G.P.L.':'lpg'};
export const ENERGY_LABELS={petrol:'Essence',diesel:'Diesel',hybrid:'Hybride essence',diesel_hybrid:'Hybride diesel',phev:'Hybride rechargeable',diesel_phev:'Hybride rechargeable diesel',electric:'Électrique',e85:'E85',lpg:'GPL'};
export function indexCars(rows){return rows.map(([id,make,model,description,energy,consumption])=>{
 const type=ENERGY_MAP[energy]??'petrol';
 const label=`${make} ${description||model}`.replace(/\s+/g,' ').trim().slice(0,200);
 return {id:`ademe-${id}`,label,energy:type,seats:4,source:'ademe',consumption:['electric','phev','diesel_phev','lpg'].includes(type)?null:consumption,search:normalize(`${make} ${model} ${description}`)};
});}
export function searchCars(cars,query,garage=[]){
 const q=normalize(query),words=q.split(' '),seen=new Set();
 const local=garage.filter(c=>!q||words.every(w=>normalize(c.label).includes(w))).map(c=>({...c,saved:true}));
 const catalog=q.length>=2?cars.filter(c=>words.every(w=>c.search.includes(w))).sort((a,b)=>(b.search.startsWith(q)?1:0)-(a.search.startsWith(q)?1:0)):[];
 return [...local,...catalog].filter(c=>{if(seen.has(c.id))return false;seen.add(c.id);return true;}).slice(0,8);
}
export async function fetchJson(url,{signal,timeout=25000}={}){
 const controller=new AbortController();const abort=()=>controller.abort();
 if(signal?.aborted)throw new DOMException('Annulé','AbortError');
 signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(abort,timeout);
 try{
  const response=await fetch(url,{signal:controller.signal,headers:{Accept:'application/json'}});
  if(!response.ok)throw new Error(response.status===429?'Le service est très sollicité. Réessayez dans quelques secondes.':`Service indisponible (${response.status}).`);
  return await response.json();
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
export function routeUrl(start,end,avoidMotorways=false){
 if(!validPoint(start)||!validPoint(end))throw new Error('Choisissez deux communes valides.');
 const params=new URLSearchParams({resource:'bdtopo-osrm',start:`${start.lon},${start.lat}`,end:`${end.lon},${end.lat}`,profile:'car',optimization:'fastest',distanceUnit:'kilometer',timeUnit:'minute',getSteps:'false',getBbox:'false',geometryFormat:'geojson'});
 if(avoidMotorways)params.set('constraints',JSON.stringify({constraintType:'banned',key:'waytype',operator:'=',value:'autoroute'}));
 return `https://data.geopf.fr/navigation/itineraire?${params}`;
}
export function parseRoute(data){
 if(data.distanceUnit!=='kilometer'||data.timeUnit!=='minute'||!Number.isFinite(data.distance)||!Number.isFinite(data.duration)||data.distance<0||data.distance>10000||data.duration<0||data.duration>100000)throw new Error('Le service a renvoyé un itinéraire inexploitable.');
 const geometry=data.geometry?.type==='Feature'?data.geometry.geometry:data.geometry;
 const lines=geometry?.type==='LineString'?[geometry.coordinates]:geometry?.type==='MultiLineString'?geometry.coordinates:null;
 const validGeometry=Array.isArray(lines)&&lines.length>0&&lines.every(line=>Array.isArray(line)&&line.length>=2&&line.every(point=>Array.isArray(point)&&point.length>=2&&Number.isFinite(point[0])&&Math.abs(point[0])<=180&&Number.isFinite(point[1])&&Math.abs(point[1])<=90));
 // Identical endpoints or distance do not guarantee identical toll roads: bind saved tolls to the actual geometry.
 const routeFingerprint=validGeometry?`geo-v1:${fingerprint(JSON.stringify([geometry.type,lines.map(line=>line.map(point=>point.slice(0,2)))]))}`:null;
 return {distance:Math.round(data.distance*10)/10,minutes:Math.round(data.duration),fingerprint:routeFingerprint,resourceVersion:data.resourceVersion??null};
}
const cache=new Map();
export async function fetchRoutes(start,end,signal){
 const key=`${start.code}:${start.lon}:${start.lat}-${end.code}:${end.lon}:${end.lat}`;
 const cached=cache.get(key);if(cached&&Date.now()-cached.at<300000)return cached.result;
 const urls=[routeUrl(start,end,false),routeUrl(start,end,true)];
 const results=await Promise.all(urls.map(url=>fetchJson(url,{signal}).then(parseRoute)));
 const result={highway:results[0],road:results[1]};cache.set(key,{at:Date.now(),result});if(cache.size>20)cache.delete(cache.keys().next().value);return result;
}
