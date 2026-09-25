export function autocomplete({input,list,search,onSelect,onType,emptyText='Aucun résultat',minLength=0}){
 let items=[],active=-1,timer,serial=0,pointerInList=false,pointerTimer;
 function close(){list.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=-1;}
 function focus(index){active=Math.max(0,Math.min(items.length-1,index));[...list.children].forEach((node,i)=>node.setAttribute('aria-selected',String(i===active)));if(items[active]){input.setAttribute('aria-activedescendant',`${list.id}-${active}`);list.children[active]?.scrollIntoView({block:'nearest'});}}
 function choose(index){const item=items[index];if(!item)return;serial++;close();onSelect(item);}
 async function update(){
  const own=++serial;if(input.value.trim().length<minLength){close();return;}
  let next;try{next=await search(input.value);}catch{next=[];}
  if(own!==serial||document.activeElement!==input)return;
  items=next;active=-1;list.replaceChildren();
  if(!items.length){const message=document.createElement('div');message.className='autocomplete-empty';message.textContent=emptyText;list.append(message);}
  items.forEach((item,index)=>{
   const option=document.createElement('div');option.className='autocomplete-option';option.id=`${list.id}-${index}`;option.role='option';option.setAttribute('aria-selected','false');
   const main=document.createElement('strong');main.textContent=item.title;const sub=document.createElement('small');sub.textContent=item.subtitle??'';option.append(main,sub);
   // A tap produces a click; a touch scroll or cancellation must not select.
   option.addEventListener('click',()=>choose(index));list.append(option);
  });
  list.hidden=false;input.setAttribute('aria-expanded','true');
 }
 list.addEventListener('pointerdown',event=>{clearTimeout(pointerTimer);pointerInList=true;if(event.pointerType==='mouse'&&event.target.closest('.autocomplete-option'))event.preventDefault();});
 const finishPointer=()=>{clearTimeout(pointerTimer);pointerTimer=setTimeout(()=>{pointerInList=false;},0);};
 document.addEventListener('pointerup',finishPointer);document.addEventListener('pointercancel',finishPointer);
 input.addEventListener('input',()=>{onType?.(input.value);clearTimeout(timer);serial++;timer=setTimeout(update,90);});
 input.addEventListener('focus',update);
 input.addEventListener('keydown',event=>{
  if(event.key==='Escape'){close();return;}
  if(event.key==='ArrowDown'){event.preventDefault();if(list.hidden)update();else focus(active+1);}
  if(event.key==='ArrowUp'){event.preventDefault();focus(active<0?items.length-1:active-1);}
  if(event.key==='Enter'&&!list.hidden&&items.length){event.preventDefault();choose(active>=0?active:0);}
 });
 input.addEventListener('blur',event=>{serial++;if(!pointerInList&&!list.contains(event.relatedTarget))setTimeout(close,100);});
 document.addEventListener('pointerdown',event=>{if(!input.parentElement.contains(event.target))close();});
 return {close,update};
}
