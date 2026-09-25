const ROUTES=['highway','road'];
const MAX_ENTRIES=50;
const validRoute=key=>ROUTES.includes(key);
const validAmount=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=10000;
const validDate=value=>typeof value==='string'&&value.length<40&&Number.isFinite(Date.parse(value));

// A stable, non-cryptographic 64-bit fingerprint keeps route geometry out of localStorage.
export function fingerprint(value){
 let hash=14695981039346656037n;
 for(const char of String(value)){hash^=BigInt(char.codePointAt(0));hash=BigInt.asUintN(64,hash*1099511628211n);}
 return hash.toString(16).padStart(16,'0');
}

function placeIdentity(state,field){
 const point=state.locations?.[field],label=String(state[field]??'').trim();
 if(!label)return null;
 if(point&&typeof point.code==='string'&&Number.isFinite(point.lon)&&Number.isFinite(point.lat))return ['commune',point.code,point.lon,point.lat,label];
 return state.routing?.status==='manual'?['manual',label]:null;
}

export function tollIdentity(state,routeKey){
 if(!validRoute(routeKey))return null;
 const route=state.routes?.[routeKey],origin=placeIdentity(state,'origin'),destination=placeIdentity(state,'destination');
 const vehicle=state.vehicle;
 if(!origin||!destination||!route||typeof vehicle?.id!=='string'||typeof vehicle?.energy!=='string')return null;
 let routeIdentity=typeof route.fingerprint==='string'&&route.fingerprint.startsWith('geo-v1:')?route.fingerprint:null;
 if(!routeIdentity&&state.routing?.status==='manual'&&Number.isFinite(route.distance)&&route.distance>=0&&Number.isFinite(route.minutes)&&route.minutes>=0)routeIdentity=`manual-v1:${fingerprint(JSON.stringify([route.distance,route.minutes]))}`;
 if(!routeIdentity)return null;
 return JSON.stringify(['toll-v1',origin,destination,routeKey,vehicle.id,vehicle.energy,routeIdentity]);
}

// User-selected convention: a non-motorway itinerary starts at EUR 0, editable.
// It is an assumption, kept separate from manually entered or remembered tariffs.
export function applyRoadTollDefault(state){
 if(!['ready','manual'].includes(state.routing?.status)||state.routing.tollsKnown?.road===true)return false;
 state.routing.tollsKnown??={};state.routing.tollDetails??={};
 state.routes.road.tolls=0;state.routing.tollsKnown.road=true;
 state.routing.tollDetails.road={source:'default',savedAt:null,key:tollIdentity(state,'road')};
 return true;
}

export function prepareTollMemory(state){
 state.routing??={status:'unresolved'};
 state.routing.tollsKnown??={highway:false,road:false};
 state.routing.tollDetails??={};
 const entries=Array.isArray(state.tollMemory)?state.tollMemory:[];
 const seen=new Set();
 state.tollMemory=entries.filter(entry=>{
  if(!entry||typeof entry.key!=='string'||entry.key.length>2000||!validAmount(entry.amount)||!validDate(entry.savedAt)||seen.has(entry.key))return false;
  seen.add(entry.key);return true;
 }).slice(0,MAX_ENTRIES).map(({key,amount,savedAt})=>({key,amount,savedAt}));
 for(const key of ROUTES){
  const detail=state.routing.tollDetails[key],identity=tollIdentity(state,key);
  if(!state.routing.tollsKnown[key]||!validAmount(state.routes?.[key]?.tolls)||(detail?.key&&detail.key!==identity)){
   state.routing.tollsKnown[key]=false;state.routing.tollDetails[key]=null;
   if(state.routes?.[key])state.routes[key].tolls=0;
  }else{
   // Earlier versions did not record a date. Preserve the user's amount without inventing one.
   state.routing.tollDetails[key]={source:['remembered','default'].includes(detail?.source)?detail.source:'manual',savedAt:validDate(detail?.savedAt)?detail.savedAt:null,key:identity};
  }
 }
 return state;
}

export function invalidateTolls(state,routeKeys=ROUTES,{clearFingerprint=false}={}){
 state.routing.tollsKnown??={};state.routing.tollDetails??={};
 for(const key of routeKeys){
  if(!validRoute(key))continue;
  state.routes[key].tolls=0;state.routing.tollsKnown[key]=false;state.routing.tollDetails[key]=null;
  if(clearFingerprint)state.routes[key].fingerprint=null;
 }
}

export function storeToll(state,routeKey,value,{now=new Date().toISOString()}={}){
 if(!validRoute(routeKey)||(value!==null&&!validAmount(value))||!validDate(now))return false;
 state.tollMemory=Array.isArray(state.tollMemory)?state.tollMemory:[];
 state.routing.tollsKnown??={};state.routing.tollDetails??={};
 const key=tollIdentity(state,routeKey);
 if(key)state.tollMemory=state.tollMemory.filter(entry=>entry.key!==key);
 if(value===null){invalidateTolls(state,[routeKey]);return true;}
 state.routes[routeKey].tolls=value;state.routing.tollsKnown[routeKey]=true;
 state.routing.tollDetails[routeKey]={source:'manual',savedAt:now,key};
 if(key)state.tollMemory=[{key,amount:value,savedAt:now},...state.tollMemory].slice(0,MAX_ENTRIES);
 return true;
}

export function restoreToll(state,routeKey){
 const key=tollIdentity(state,routeKey);
 if(!key)return false;
 const entry=(state.tollMemory??[]).find(item=>item.key===key&&validAmount(item.amount)&&validDate(item.savedAt));
 if(!entry)return false;
 state.routes[routeKey].tolls=entry.amount;state.routing.tollsKnown[routeKey]=true;
 state.routing.tollDetails[routeKey]={source:'remembered',savedAt:entry.savedAt,key};
 return true;
}

export function snapshotTolls(state){
 return Object.fromEntries(ROUTES.map(key=>[key,{identity:tollIdentity(state,key),known:!!state.routing.tollsKnown[key],amount:state.routes[key].tolls,detail:state.routing.tollDetails?.[key]??null}]));
}

export function restoreExactToll(state,routeKey,snapshot){
 if(restoreToll(state,routeKey))return true;
 const previous=snapshot?.[routeKey],key=tollIdentity(state,routeKey);
 if(previous?.detail?.source==='default')return false;
 if(!previous?.known||!key||key!==previous.identity||!validAmount(previous.amount))return false;
 state.routes[routeKey].tolls=previous.amount;state.routing.tollsKnown[routeKey]=true;
 state.routing.tollDetails[routeKey]={source:'remembered',savedAt:validDate(previous.detail?.savedAt)?previous.detail.savedAt:null,key};
 return true;
}
