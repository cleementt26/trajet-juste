import {cloneDefault,upgradeState,calculate,routeCost,validateState} from './lib/calculations.mjs';
import {calculatePricing,normalizePricing,validatePricing} from './lib/pricing.mjs';
import {autocomplete} from './lib/autocomplete.mjs';
import {normalize,indexCities,searchCities,cityPoint,validPoint,indexCars,searchCars,fetchJson,fetchRoutes,ENERGY_LABELS} from './lib/data-services.mjs';
import {prepareTollMemory,invalidateTolls,applyRoadTollDefault,storeToll,snapshotTolls,restoreExactToll} from './lib/toll-memory.mjs';

const $=id=>document.getElementById(id);
const set=(id,text)=>{$(id).textContent=text;};
const euros=new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'});
const digits=new Intl.NumberFormat('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2});
const numbers=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:1});
const money=n=>euros.format(Math.abs(n)<.000001?0:n);
const duration=n=>n>0?`${Math.floor(n/60)?`${Math.floor(n/60)} h `:''}${n%60?`${Math.round(n%60)} min`:''}`.trim():'';
const routeNames={highway:'Le plus rapide',road:'Sans autoroute'};
const STORAGE_KEY='trajet-juste.v1';
const DEFAULT_CAR={id:'personal-mg3',label:'MG3 Hybrid+',energy:'hybrid',seats:4,source:'personal',highwayConsumption:5.3,roadConsumption:5.3,fuelPrice:1.8,electricityPrice:.25};
let state,restored=false,storageOK=true,cities=[],cars=[],routeController,requestId=0,routeTimer,noticeTimer,vehicleTyping=false,routeMessage='',pendingFocus='origin';
const invalid=new Map();
const isPlugIn=()=>['phev','diesel_phev'].includes(state.vehicle.energy);
const validRoute=key=>['ready','manual'].includes(state.routing.status)&&state.routing.validRoutes?.[key]===true;
function fresh(){const s=cloneDefault();s.selectedRoute='road';s.passengers=[];s.pricing.mode='cover';s.pricing.expectedPassengers=3;s.routing.validRoutes={highway:false,road:false};return s;}
function announce(message){clearTimeout(noticeTimer);set('notice',message);$('notice').hidden=false;noticeTimer=setTimeout(()=>$('notice').hidden=true,4500);}
function restore(){
 state=fresh();
 try{const raw=localStorage.getItem(STORAGE_KEY);if(raw){try{state=upgradeState(JSON.parse(raw));restored=true;}catch{try{localStorage.setItem(`${STORAGE_KEY}.backup`,raw);}catch{}announce('Les anciens réglages étaient incomplets. Une nouvelle simulation a été ouverte.');}}}catch{storageOK=false;}
 state.pricing=normalizePricing(state.pricing,state.vehicle.seats);
 state.routing.validRoutes??={highway:['ready','manual'].includes(state.routing.status),road:['ready','manual'].includes(state.routing.status)};
 if(state.routing.status==='ready'&&['origin','destination'].some(key=>!validPoint(state.locations[key])||normalize(state.locations[key].name)!==normalize(state[key]))){state.routing.status='unresolved';state.routing.validRoutes={highway:false,road:false};invalidateTolls(state,undefined,{clearFingerprint:true});}
 prepareTollMemory(state);applyRoadTollDefault(state);
}
function captureCar(){
 if(state.vehicle.needsConsumption)return;
 const profile={...state.vehicle,highwayConsumption:state.routes.highway.consumption,roadConsumption:state.routes.road.consumption,highwayElectricity:state.routes.highway.electricity??0,roadElectricity:state.routes.road.electricity??0,fuelPrice:state.fuelPrice,electricityPrice:state.electricityPrice};
 state.garage=[profile,...(state.garage??[]).filter(v=>v.id!==profile.id)].slice(0,20);
}
function save(){captureCar();try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));storageOK=true;}catch{storageOK=false;}set('save-status',storageOK?'Enregistré sur cet appareil':'Enregistrement indisponible');}
function cancelRouting(){requestId++;routeController?.abort();clearTimeout(routeTimer);}
function changedTowns(){cancelRouting();state.routing.status='unresolved';state.routing.validRoutes={highway:false,road:false};invalidateTolls(state,undefined,{clearFingerprint:true});state.pricing.customPrice=null;clearRouteErrors();routeMessage='Choisissez les villes dans les suggestions, ou saisissez une distance.';}
function clearRouteErrors(){for(const id of ['distance','minutes','tolls','consumption','electric-consumption'])invalid.delete(id);}
function writeValue(id,value,force=false){const el=$(id);if(force||document.activeElement!==el&&!invalid.has(id))el.value=value??'';}
function syncForm(force=false){
 const route=state.routes[state.selectedRoute],ready=validRoute(state.selectedRoute);
 writeValue('origin',state.origin,force);writeValue('destination',state.destination,force);
 if(!vehicleTyping)writeValue('vehicle-search',state.vehicle.label,force);
 writeValue('vehicle-energy',state.vehicle.energy,force);writeValue('vehicle-seats',state.vehicle.seats,force);
 writeValue('distance',ready?route.distance:'',force);writeValue('minutes',ready?route.minutes:'',force);
 writeValue('tolls',state.routing.tollsKnown[state.selectedRoute]?route.tolls:'',force);
 writeValue('consumption',state.vehicle.needsConsumption?'':route.consumption,force);
 writeValue('electric-consumption',route.electricity??0,force);
 for(const [id,key] of [['energy-price','fuelPrice'],['electric-price','electricityPrice'],['wear','wearPerKm']])writeValue(id,state[key],force);
 for(const [id,key] of [['target-surplus','targetSurplus'],['driver-fee','driverFee'],['custom-price','customPrice']])writeValue(id,state.pricing[key],force);
 for(const key of ['revenue','distance','minutes','tolls'])writeValue(`candidate-${key}`,state.candidate[key],force);
 document.querySelectorAll('input[name=mode]').forEach(input=>input.checked=input.value===state.pricing.mode);
 document.querySelectorAll('[data-number]').forEach(input=>input.setAttribute('aria-invalid',String(invalid.has(input.id))));
}
function issue(){
 if(!state.origin.trim()||!state.destination.trim())return {title:'Où allez-vous ?',text:'Indiquez votre ville de départ et votre arrivée.',focus:!state.origin.trim()?'origin':'destination'};
 if(state.routing.status==='loading')return {title:'Calcul du trajet…',text:'Les kilomètres et la durée arrivent. Vous pouvez déjà régler votre voiture et votre objectif.',focus:'distance',action:'Saisir les kilomètres'};
 if(!validRoute(state.selectedRoute))return {title:state.routing.status==='error'?'Saisissez les kilomètres.':'Choisissez votre trajet.',text:state.routing.status==='error'?'Le calcul automatique est indisponible. Entrez la distance pour continuer.':'Sélectionnez les villes proposées ou indiquez directement la distance.',focus:state.routing.status==='error'?'distance':!validPoint(state.locations.origin)?'origin':!validPoint(state.locations.destination)?'destination':'distance'};
 for(const [id,message] of invalid){if(id.startsWith('candidate-')||id.startsWith('passenger-')||id==='target-surplus'&&state.pricing.mode!=='surplus'||['electric-consumption','electric-price'].includes(id)&&!isPlugIn())continue;return {title:'Une valeur à corriger.',text:message,focus:id};}
 if(state.vehicle.needsConsumption)return {title:'Quelle consommation ?',text:'Renseignez la consommation de cette voiture pour calculer ses frais.',focus:'consumption'};
 if(!state.routing.tollsKnown[state.selectedRoute])return {title:'Combien de péages ?',text:'Ajoutez le montant total des péages. Si le trajet est gratuit, indiquez 0 €.',focus:'tolls',action:'Renseigner les péages'};
 return null;
}
function render(){
 state.pricing=normalizePricing(state.pricing,state.vehicle.seats);applyRoadTollDefault(state);syncForm();
 const route=state.routes[state.selectedRoute],p=state.pricing,electric=state.vehicle.energy==='electric';
 $('plugin-fields').hidden=!isPlugIn();set('consumption-unit',electric?'kWh/100 km':'L/100 km');set('energy-price-label',electric?'Prix de l’électricité':'Prix du carburant');set('energy-price-unit',electric?'€/kWh':'€/L');
 set('vehicle-note',state.vehicle.needsConsumption?'Votre voiture est ajoutée. Renseignez sa consommation.':state.vehicle.source==='ademe'?'Consommation ADEME préremplie : ajustez-la à votre consommation réelle.':isPlugIn()?'Indiquez le carburant et l’électricité consommés sur le même trajet.':'Votre consommation, ajustable pour cet itinéraire.');
 for(const key of ['highway','road']){
  const button=document.querySelector(`[data-route="${key}"]`),active=key===state.selectedRoute;button.classList.toggle('selected',active);button.setAttribute('aria-pressed',String(active));
  let caption=state.routing.status==='loading'?'Calcul en cours…':validRoute(key)?`${numbers.format(state.routes[key].distance)} km${state.routes[key].minutes?` · ${duration(state.routes[key].minutes)}`:''}`:'Distance à renseigner';
  if(validRoute(key)&&state.routing.tollsKnown[key]&&!state.vehicle.needsConsumption){const c=routeCost(state.routes[key],state.fuelPrice,state.wearPerKm,isPlugIn()?state.electricityPrice:0);caption+=` · ${money(c.total)}`;}
  else if(key==='road')caption+=' · péages 0 €';
  set(`${key}-summary`,caption);
 }
 set('route-status',routeMessage||(state.routing.status==='manual'?'Distance saisie manuellement.':state.routing.status==='ready'?'Itinéraires de centre-ville à centre-ville, hors trafic en direct.':'Choisissez vos villes ou saisissez directement les kilomètres.'));
 $('refresh-routes').disabled=state.routing.status==='loading';
 const tollDetail=state.routing.tollDetails?.[state.selectedRoute];
 const date=tollDetail?.savedAt&&!Number.isNaN(Date.parse(tollDetail.savedAt))?new Intl.DateTimeFormat('fr-FR').format(new Date(tollDetail.savedAt)):null;
 set('toll-note',!state.routing.tollsKnown[state.selectedRoute]?'Le prix du péage est à renseigner.':tollDetail?.source==='default'?'0 € par défaut sans autoroute, modifiable.':tollDetail?.source==='remembered'?`Tarif mémorisé${date?` le ${date}`:''}, à vérifier.`:route.tolls===0?'Trajet sans péage confirmé.':'Montant inclus dans les frais du trajet.');
 set('offered-count',p.offeredSeats);set('expected-count',p.expectedPassengers);
 document.querySelectorAll('[data-step]').forEach(button=>{const field=button.dataset.step,value=p[field],min=field==='offeredSeats'?1:0,max=field==='offeredSeats'?state.vehicle.seats:p.offeredSeats;button.disabled=Number(button.dataset.delta)<0?value<=min:value>=max;});
 document.querySelectorAll('.goal-options label').forEach(label=>label.classList.toggle('selected',label.querySelector('input').checked));
 $('surplus-field').hidden=p.mode!=='surplus';$('objective-context').hidden=p.mode==='share';set('expected-help',p.mode==='share'?'Pour estimer votre reste à payer':'Pour atteindre votre objectif');
 set('ticket-origin',state.origin||'Départ');set('ticket-destination',state.destination||'Arrivée');set('ticket-route-detail',validRoute(state.selectedRoute)?`${routeNames[state.selectedRoute]} / ${numbers.format(route.distance)} km${route.minutes?` / ${duration(route.minutes)}`:''}`:routeNames[state.selectedRoute]);
 const block=issue();let pricing=null;
 if(!block)pricing=calculatePricing(state);
 const goalIssue=!block&&!pricing.available?{title:'Combien de passagers ?',text:pricing.reason,focus:'expected-count',action:'Prévoir un passager'}:null;
 const pending=block||goalIssue,ready=pricing?.available&&!block;
 $('quote-ready').hidden=!ready;$('quote-pending').hidden=!!ready;$('expected-result').hidden=!ready;$('expected-result').classList.toggle('is-covered',!!ready&&pricing.expected.remaining<=.005);
 if(pending){set('pending-title',pending.title);set('pending-text',pending.text);set('complete-step',pending.action||'Compléter cette étape');pendingFocus=pending.focus;}
 set('quote-label',p.customPrice!==null?'VOTRE TARIF PAR PLACE':p.mode==='share'?'PRIX POUR PARTAGER LES FRAIS':p.mode==='cover'?'PRIX POUR NE RIEN PAYER':'PRIX POUR ATTEINDRE VOTRE OBJECTIF');
 if(ready){
  set('quote-amount',digits.format(pricing.price));document.querySelector('.quote-number').classList.toggle('compact',digits.format(pricing.price).length>6);
  const explain=p.customPrice!==null?`Votre tarif. Prix calculé pour l’objectif : ${pricing.suggestedPrice===null?'aucun avec 0 passager':money(pricing.suggestedPrice)}.`:p.mode==='share'?`${money(pricing.cost)} partagés entre vous et ${p.offeredSeats} passager${p.offeredSeats>1?'s':''}.`:`Avec ${p.expectedPassengers} passager${p.expectedPassengers>1?'s':''}, pour couvrir ${money(pricing.cost)}${p.mode==='surplus'?` et dégager ${money(p.targetSurplus)} d’excédent`:''}.`;
  set('quote-explanation',explain);set('expected-scenario',`Avec ${p.expectedPassengers} passager${p.expectedPassengers>1?'s':''} attendu${p.expectedPassengers>1?'s':''}`);set('expected-revenue',money(pricing.expected.revenue));
  const roundingOnly=p.mode==='cover'&&p.customPrice===null&&pricing.expected.remaining<-.005&&-pricing.expected.remaining<=p.expectedPassengers*.01+1e-8;
  set('remaining-label',roundingOnly?'Arrondi en votre faveur':pricing.expected.remaining<-.005?'Votre excédent':'Vous payez');set('expected-remaining',money(Math.abs(pricing.expected.remaining)));
  $('goal-message').hidden=p.mode==='share';
  if(p.mode!=='share')set('goal-message',pricing.targetMet?`Objectif couvert${p.customPrice===null&&pricing.roundingDelta>.004?` · ${money(pricing.roundingDelta)} d’écart d’arrondi`:''}.`:`Il manque ${money(pricing.cost+pricing.targetSurplus-pricing.expected.revenue)} pour atteindre l’objectif.`);
 }
 const partialAllowed=validRoute(state.selectedRoute)&&!state.vehicle.needsConsumption&&![...invalid.keys()].some(id=>['distance','consumption','energy-price','electric-consumption','electric-price','wear'].includes(id));
 const costs=partialAllowed?routeCost(route,state.fuelPrice,state.wearPerKm,isPlugIn()?state.electricityPrice:0):null;
 set('cost-energy',costs?money(costs.fuel+costs.electricity):'À calculer');set('cost-tolls',invalid.has('tolls')?'À corriger':state.routing.tollsKnown[state.selectedRoute]?money(route.tolls):'À compléter');set('cost-wear',costs?money(costs.wear):'—');$('wear-line').hidden=state.wearPerKm===0;set('cost-total',costs&&state.routing.tollsKnown[state.selectedRoute]&&!invalid.has('tolls')?money(costs.total):'À compléter');
 $('custom-price').disabled=!costs||!state.routing.tollsKnown[state.selectedRoute];$('custom-price').placeholder=pricing?.suggestedPrice!==null&&pricing?.suggestedPrice!==undefined?digits.format(pricing.suggestedPrice):'Votre tarif';$('reset-price').disabled=p.customPrice===null&&!invalid.has('custom-price');
 const body=$('occupancy-body');body.replaceChildren();set('occupancy-price',ready?`${money(pricing.price)} / place`:'');
 if(ready){for(const row of pricing.rows){const tr=document.createElement('tr');if(row.passengers===p.expectedPassengers){tr.className='expected';tr.setAttribute('aria-current','true');}for(const [i,text] of [`${row.passengers}${row.passengers===p.expectedPassengers?' · prévu':''}`,money(row.revenue),money(row.remaining)].entries()){const cell=document.createElement(i===0?'th':'td');if(i===0)cell.scope='row';cell.textContent=text;tr.append(cell);}body.append(tr);}}
 else {const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=3;td.className='table-empty';td.textContent='Les scénarios apparaissent dès que le prix est calculé.';tr.append(td);body.append(tr);}
 set('occupancy-note',ready&&pricing.full.remaining<-.005?`Un montant négatif dans « Vous payez » correspond à un excédent sur les frais saisis.${p.expectedPassengers<p.offeredSeats?` Avec toutes les places, cet excédent atteint ${money(-pricing.full.remaining)}.`:''}`:'Le même tarif est conservé dans chaque scénario.');
 renderBookings(!block&&costs&&state.routing.tollsKnown[state.selectedRoute]);
 set('mobile-result-label',ready?`Avec ${p.expectedPassengers} passager${p.expectedPassengers>1?'s':''}`:'Votre simulation');set('mobile-result-value',ready?`${money(pricing.price)} / place`:pending?.title??'À compléter');set('mobile-result-action',ready?'Voir le détail':'Compléter');$('mobile-result-link').dataset.ready=String(!!ready);updateClearButtons();
 $('boot-status').hidden=true;
 return pricing;
}
function renderPassengers(){
 const box=$('passenger-list');box.replaceChildren();
 state.passengers.forEach((passenger,index)=>{const row=document.createElement('div');row.className='passenger-row';const label=document.createElement('label');label.htmlFor=`passenger-${index}`;label.textContent=`Passager ${index+1}`;const unit=document.createElement('div');unit.className='unit-input';const input=document.createElement('input');Object.assign(input,{id:`passenger-${index}`,type:'text',min:'0',max:'10000',step:'0.5',value:passenger.revenue});input.dataset.passenger=index;input.dataset.number='true';input.maxLength=14;input.autocomplete='off';input.inputMode='decimal';const suffix=document.createElement('span');suffix.textContent='€ net';unit.append(input,suffix);const button=document.createElement('button');button.type='button';button.dataset.removePassenger=index;button.className='remove-passenger';button.textContent='×';button.setAttribute('aria-label',`Retirer le passager ${index+1}`);row.append(label,unit,button);box.append(row);});
 if(!state.passengers.length){const p=document.createElement('p');p.className='field-note';p.textContent='Aucune réservation renseignée.';box.append(p);}
 $('add-passenger').disabled=state.passengers.length>=state.vehicle.seats;
}
function renderBookings(ready){
 if(!ready||[...invalid.keys()].some(id=>id.startsWith('candidate-')||id.startsWith('passenger-'))){set('booking-balance','—');set('detour-verdict','Complétez les frais du trajet et les montants de réservation.');set('detour-detail','');return;}
 const result=calculate(state);set('booking-balance',money(result.selected.balance));
 if(!result.candidate.available){set('detour-verdict',`Aucune place libre sur les ${state.vehicle.seats} places disponibles.`);set('detour-detail','Retirez une réservation pour tester un passager supplémentaire.');return;}
 const c=result.candidate;set('detour-verdict',c.margin>=0?`Ce passager réduit vos frais de ${money(c.margin)}.`:`Ce passager vous coûte ${money(-c.margin)} en plus.`);set('detour-detail',`${money(c.cost)} de frais de détour. Participation minimale : ${money(c.breakEven)}.${c.hourly!==null?` ${money(c.hourly)} économisés par heure de détour.`:''}`);
}
async function computeRoutes(){
 cancelRouting();if(!validPoint(state.locations.origin)||!validPoint(state.locations.destination)){routeMessage='Choisissez deux villes dans les suggestions. Vous pouvez aussi saisir directement une distance.';render();return;}
 if(state.locations.origin.code===state.locations.destination.code){state.routing.status='error';state.routing.validRoutes={highway:false,road:false};routeMessage='Même commune : indiquez la distance de votre déplacement.';render();return;}
 const token=requestId,previous=snapshotTolls(state);routeController=new AbortController();state.routing.status='loading';state.routing.validRoutes={highway:false,road:false};invalidateTolls(state);routeMessage='Calcul des deux itinéraires…';render();
 try{const routes=await fetchRoutes(state.locations.origin,state.locations.destination,routeController.signal);if(token!==requestId)return;
  for(const key of ['highway','road'])Object.assign(state.routes[key],routes[key]);
  state.routing={status:'ready',validRoutes:{highway:true,road:true},tollsKnown:{highway:false,road:false},tollDetails:{},updatedAt:new Date().toISOString()};
  for(const key of ['highway','road'])restoreExactToll(state,key,previous);applyRoadTollDefault(state);routeMessage='Itinéraires actualisés, de centre-ville à centre-ville.';clearRouteErrors();render();save();
 }catch(error){if(token!==requestId)return;state.routing.status='error';state.routing.validRoutes={highway:false,road:false};routeMessage='Calcul automatique indisponible. Saisissez les kilomètres pour continuer.';render();save();}
}
function selectCity(field,city){changedTowns();state[field]=city.name;state.locations[field]=cityPoint(city);$(field).value=city.name;render();save();if(validPoint(state.locations.origin)&&validPoint(state.locations.destination))routeTimer=setTimeout(computeRoutes,200);}
function selectVehicle(profile){
 captureCar();vehicleTyping=false;const previousEnergy=state.vehicle.energy;invalidateTolls(state);
 state.vehicle={id:profile.id,label:profile.label,energy:profile.energy,seats:profile.seats??4,source:profile.source??'custom',needsConsumption:false};
 state.fuelPrice=profile.fuelPrice??(profile.energy==='electric'?.25:previousEnergy==='electric'?1.8:state.fuelPrice);state.electricityPrice=profile.electricityPrice??state.electricityPrice;
 const high=profile.highwayConsumption??profile.consumption,road=profile.roadConsumption??profile.consumption;
 if(Number.isFinite(high)&&Number.isFinite(road)){state.routes.highway.consumption=high;state.routes.road.consumption=road;}else{state.vehicle.needsConsumption=true;state.routes.highway.consumption=0;state.routes.road.consumption=0;}
 state.routes.highway.electricity=profile.highwayElectricity??0;state.routes.road.electricity=profile.roadElectricity??0;
 state.pricing.customPrice=null;clearRouteErrors();renderPassengers();syncForm(true);render();save();if(state.vehicle.needsConsumption){$('consumption').focus();$('vehicle-details').open=true;}
}
function setToll(value){storeToll(state,state.selectedRoute,value);applyRoadTollDefault(state);invalid.delete('tolls');render();save();}
function handleNumber(input){
 const text=input.value.trim().replace(/[\s\u00a0\u202f]/g,'').replace(',','.'),value=Number(text),optional=input.id==='tolls'||input.id==='custom-price';
 const valid=text===''&&optional||text!==''&&/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)&&Number.isFinite(value)&&value>=Number(input.min)&&value<=Number(input.max);
 if(!valid){invalid.set(input.id,`Renseignez « ${input.closest('label')?.childNodes[0]?.textContent?.trim()||'ce champ'} » avec une valeur entre ${input.min} et ${input.max}.`);if(input.dataset.routeField==='distance'){cancelRouting();state.routing.status='manual';state.routing.validRoutes[state.selectedRoute]=false;invalidateTolls(state,[state.selectedRoute],{clearFingerprint:true});}render();return;}
 invalid.delete(input.id);
 if(input.dataset.routeField){const field=input.dataset.routeField;
  if(field==='tolls'){setToll(text===''?null:value);return;}
  if(field==='distance'||field==='minutes'){cancelRouting();state.routing.status='manual';if(field==='distance')state.routing.validRoutes[state.selectedRoute]=true;invalidateTolls(state,[state.selectedRoute],{clearFingerprint:true});routeMessage='Distance et durée ajustables. Recalculer rétablira les itinéraires automatiques.';}
  if(field==='consumption'&&state.vehicle.needsConsumption){for(const key of ['highway','road'])state.routes[key].consumption=value;state.vehicle.needsConsumption=false;}
  state.routes[state.selectedRoute][field]=value;
 }else if(input.dataset.stateField)state[input.dataset.stateField]=value;
 else if(input.dataset.pricingField)state.pricing[input.dataset.pricingField]=text===''?null:value;
 else if(input.dataset.candidateField)state.candidate[input.dataset.candidateField]=value;
 else if(input.dataset.passenger!==undefined)state.passengers[Number(input.dataset.passenger)].revenue=value;
 render();save();
}
function registerTools(){
 if(!document.modelContext?.registerTool)return;
 const register=tool=>{try{Promise.resolve(document.modelContext.registerTool(tool)).catch(()=>{});}catch{}};
 register({name:'read_carpool_simulation',title:'Lire la simulation',description:'Lire le trajet, les réglages, le prix par place et le résultat selon les réservations.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute(input){if(input&&Object.keys(input).length)throw new Error('Aucun paramètre attendu.');const pending=issue();return {state:JSON.parse(JSON.stringify(state)),pending:pending?.text??null,pricing:pending?null:calculatePricing(state),results:pending?null:calculate(state)};}});
 register({name:'configure_carpool_price',title:'Régler le prix du covoiturage',description:'Modifier les places, le nombre attendu de passagers et l’objectif. Ne publie aucune annonce.',inputSchema:{type:'object',properties:{offeredSeats:{type:'integer',minimum:1,maximum:8},expectedPassengers:{type:'integer',minimum:0,maximum:8},mode:{type:'string',enum:['share','cover','surplus']},targetSurplus:{type:'number',minimum:0,maximum:10000},customPrice:{type:['number','null'],minimum:0,maximum:1000000},driverFee:{type:'number',minimum:0,maximum:10000}},additionalProperties:false},annotations:{readOnlyHint:false},execute(input){if(!input||Object.keys(input).some(k=>!['offeredSeats','expectedPassengers','mode','targetSurplus','customPrice','driverFee'].includes(k)))throw new Error('Paramètres invalides.');const next={...state.pricing,...input};validatePricing(next,state.vehicle.seats);state.pricing=next;for(const id of ['custom-price','target-surplus','driver-fee'])invalid.delete(id);syncForm(true);const r=render();save();return r;}});
 register({name:'configure_carpool_candidate',title:'Tester une réservation supplémentaire',description:'Tester une participation nette et son détour. Ne réserve aucun trajet.',inputSchema:{type:'object',properties:{route:{type:'string',enum:['highway','road']},revenue:{type:'number',minimum:0,maximum:10000},distance:{type:'number',minimum:0,maximum:10000},minutes:{type:'number',minimum:0,maximum:100000},tolls:{type:'number',minimum:0,maximum:10000}},required:['route','revenue','distance','minutes','tolls'],additionalProperties:false},annotations:{readOnlyHint:false},execute(input){if(!input||!validRoute(input.route)||Object.keys(input).some(k=>!['route','revenue','distance','minutes','tolls'].includes(k)))throw new Error('Trajet ou paramètres invalides.');if(state.passengers.length>=state.vehicle.seats)throw new Error('Aucune place libre.');const next={...state,selectedRoute:input.route,candidate:{revenue:input.revenue,distance:input.distance,minutes:input.minutes,tolls:input.tolls}};validateState(next);state=next;for(const key of ['revenue','distance','minutes','tolls'])invalid.delete(`candidate-${key}`);syncForm(true);render();save();return calculate(state).candidate;}});
}
async function startSearch(){
 const cityPromise=fetchJson('./communes.json').then(data=>cities=indexCities(data.communes));
 const carPromise=fetchJson('./cars.json').then(data=>cars=indexCars(data.cars)).catch(()=>[]);
 cityPromise.catch(()=>{routeMessage='Suggestions indisponibles : saisissez vos villes et la distance.';render();});
 for(const field of ['origin','destination']){
  autocomplete({input:$(field),list:$(`${field}-options`),emptyText:'Aucune commune trouvée. Essayez le nom ou le code postal.',async search(query){await cityPromise;return searchCities(cities,query,[state.locations.origin?.code,state.locations.destination?.code,'42218','26362']).map(city=>({title:city.name,subtitle:city.postcodes.join(' · '),city}));},onType(value){changedTowns();state[field]=value;state.locations[field]=null;render();save();},onSelect(item){selectCity(field,item.city);}});
  $(field).addEventListener('blur',()=>{if(!state.locations[field]&&cities.length){const matches=cities.filter(city=>city.search===normalize($(field).value)).sort((a,b)=>b.population-a.population);if(matches.length)selectCity(field,matches[0]);}});
 }
 autocomplete({input:$('vehicle-search'),list:$('vehicle-options'),async search(query){await carPromise;const list=searchCars(cars,query,[...(state.garage??[]),DEFAULT_CAR]).map(car=>({title:car.label,subtitle:`${ENERGY_LABELS[car.energy]} · ${car.saved||car.source==='personal'?'Vos réglages':'Catalogue ADEME'}`,car}));if(query.trim())list.push({title:`Ajouter « ${query.trim().slice(0,150)} »`,subtitle:'Votre voiture, avec votre consommation',custom:query.trim().slice(0,150)});return list;},onType(){vehicleTyping=true;},onSelect(item){selectVehicle(item.custom?{id:`custom-${normalize(item.custom)}`,label:item.custom,energy:state.vehicle.energy,seats:4,source:'custom'}:item.car);}});
 $('vehicle-search').addEventListener('blur',()=>setTimeout(()=>{vehicleTyping=false;writeValue('vehicle-search',state.vehicle.label);},120));
 try{await cityPromise;for(const field of ['origin','destination']){if(!validPoint(state.locations[field])){const exact=cities.filter(c=>c.search===normalize(state[field])).sort((a,b)=>b.population-a.population)[0];if(exact)state.locations[field]=cityPoint(exact);}}
  if(!restored||!['ready','manual'].includes(state.routing.status)){if(validPoint(state.locations.origin)&&validPoint(state.locations.destination))computeRoutes();else render();}else{routeMessage=state.routing.status==='manual'?'Votre trajet saisi a été retrouvé.':'Votre trajet a été retrouvé. Recalculez pour l’actualiser.';render();}
 }catch{}
}
function updateClearButtons(){document.querySelectorAll('[data-clear]').forEach(button=>{button.hidden=!$(button.dataset.clear).value;});}
function completePending(){
 if(pendingFocus==='expected-count'){state.pricing.expectedPassengers=Math.max(1,state.pricing.expectedPassengers);render();save();$('objective').scrollIntoView?.({behavior:'smooth',block:'start'});return;}
 const input=$(pendingFocus),details=input?.closest('details');if(details)details.open=true;
 input?.focus({preventScroll:true});input?.scrollIntoView?.({behavior:'smooth',block:'center'});
}
function initializeMobileNavigation(){
 const links=[...document.querySelectorAll('.mobile-nav a')];let queued=false,fullHeight=window.visualViewport?.height??window.innerHeight;
 const markSection=()=>{queued=false;let current='trip';for(const id of ['trip','vehicle','objective','ticket'])if($(id).getBoundingClientRect().top<=Math.min(window.innerHeight*.32,220))current=id;for(const link of links){const active=link.hash===`#${current}`;link.classList.toggle('active',active);if(active)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');}};
 const onScroll=()=>{if(!queued){queued=true;requestAnimationFrame(markSection);}};
 const keyboard=()=>{const el=document.activeElement,editing=(el instanceof HTMLInputElement&&el.type!=='radio')||el instanceof HTMLTextAreaElement,vv=window.visualViewport;if(vv){fullHeight=Math.max(fullHeight,vv.height);if(!editing)fullHeight=vv.height;document.documentElement.style.setProperty('--visible-height',`${vv.height}px`);}document.body.classList.toggle('keyboard-open',editing&&(!vv||fullHeight-vv.height>100));};
 window.addEventListener('scroll',onScroll,{passive:true});window.addEventListener('resize',onScroll,{passive:true});
 document.addEventListener('focusin',keyboard);document.addEventListener('focusout',()=>requestAnimationFrame(keyboard));window.visualViewport?.addEventListener('resize',keyboard,{passive:true});
 links.forEach(link=>link.addEventListener('click',()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();}));
 keyboard();onScroll();
}
function initialize(){
 restore();renderPassengers();syncForm(true);render();registerTools();
 document.addEventListener('input',event=>{if(event.target.matches('[data-number]'))handleNumber(event.target);updateClearButtons();});
 document.addEventListener('click',event=>{
  const clear=event.target.closest('[data-clear]');if(clear){const input=$(clear.dataset.clear);input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();return;}
  const route=event.target.closest('[data-route]');if(route){state.selectedRoute=route.dataset.route;state.pricing.customPrice=null;clearRouteErrors();syncForm(true);render();save();return;}
  const step=event.target.closest('[data-step]');if(step){const key=step.dataset.step,delta=Number(step.dataset.delta);state.pricing[key]+=delta;state.pricing=normalizePricing(state.pricing,state.vehicle.seats);render();save();return;}
  const remove=event.target.closest('[data-remove-passenger]');if(remove){state.passengers.splice(Number(remove.dataset.removePassenger),1);for(const key of [...invalid.keys()])if(key.startsWith('passenger-'))invalid.delete(key);renderPassengers();render();save();}
 });
 document.querySelectorAll('input[name=mode]').forEach(input=>input.addEventListener('change',()=>{state.pricing.mode=input.value;state.pricing.customPrice=null;invalid.delete('custom-price');render();save();}));
 $('vehicle-energy').addEventListener('change',()=>selectVehicle({...state.vehicle,energy:$('vehicle-energy').value,source:'custom'}));
 $('vehicle-seats').addEventListener('change',()=>{state.vehicle.seats=Number($('vehicle-seats').value);state.pricing=normalizePricing(state.pricing,state.vehicle.seats);renderPassengers();render();save();});
 $('refresh-routes').addEventListener('click',computeRoutes);
 $('swap-cities').addEventListener('click',()=>{const origin=state.origin,from=state.locations.origin;changedTowns();state.origin=state.destination;state.destination=origin;state.locations.origin=state.locations.destination;state.locations.destination=from;syncForm(true);render();save();computeRoutes();});
 $('zero-tolls').addEventListener('click',()=>{setToll(0);writeValue('tolls',0,true);});
 $('reset-price').addEventListener('click',()=>{state.pricing.customPrice=null;invalid.delete('custom-price');writeValue('custom-price','',true);render();save();});
 $('complete-step').addEventListener('click',completePending);
 $('mobile-result-link').addEventListener('click',event=>{if(event.currentTarget.dataset.ready!=='true'){event.preventDefault();completePending();}else if(document.activeElement instanceof HTMLElement)document.activeElement.blur();});
 initializeMobileNavigation();
 $('add-passenger').addEventListener('click',()=>{if(state.passengers.length>=state.vehicle.seats)return;state.passengers.push({revenue:0});renderPassengers();render();save();$(`passenger-${state.passengers.length-1}`).focus();});
 $('reset').addEventListener('click',()=>{$('reset-dialog').returnValue='';$('reset-dialog').showModal();});
 $('reset-dialog').addEventListener('close',()=>{if($('reset-dialog').returnValue!=='confirm')return;cancelRouting();const {garage,tollMemory}=state;state=fresh();state.garage=garage;state.tollMemory=tollMemory;invalid.clear();vehicleTyping=false;restored=false;routeMessage='';renderPassengers();syncForm(true);render();save();for(const field of ['origin','destination']){const city=cities.find(c=>c.search===normalize(state[field]));if(city)state.locations[field]=cityPoint(city);}computeRoutes();});
 startSearch();
}
try{initialize();}catch(error){$('boot-status').hidden=false;$('boot-status').textContent='Le simulateur n’a pas pu démarrer. Rechargez cette page pour réessayer.';console.error('Simulator initialization failed',error);}
