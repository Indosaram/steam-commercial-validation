const C={bg:'#0e1420',shop:'#2a2034',floor:'#342a3e',cyan:'#69e5ff',gold:'#f3c24e',red:'#ff6b6b',green:'#6be59a',blue:'#6fa8ff',orange:'#ffad5c',white:'#f3f7fa',muted:'#9baab5',dark:'#080b10',path:'#d7c55e'};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const inside=(p,r)=>p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h;
const overlap=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
const rect=o=>({x:o.x,y:o.y,w:o.w,h:o.h});
function rounded(ctx,r,rad=10){const q=Math.min(rad,r.w/2,r.h/2);ctx.beginPath();ctx.moveTo(r.x+q,r.y);ctx.lineTo(r.x+r.w-q,r.y);ctx.quadraticCurveTo(r.x+r.w,r.y,r.x+r.w,r.y+q);ctx.lineTo(r.x+r.w,r.y+r.h-q);ctx.quadraticCurveTo(r.x+r.w,r.y+r.h,r.x+r.w-q,r.y+r.h);ctx.lineTo(r.x+q,r.y+r.h);ctx.quadraticCurveTo(r.x,r.y+r.h,r.x,r.y+r.h-q);ctx.lineTo(r.x,r.y+q);ctx.quadraticCurveTo(r.x,r.y,r.x+q,r.y);ctx.closePath()}
function panel(title,body){const n=document.createElement('section');n.setAttribute('role','dialog');n.setAttribute('aria-modal','false');n.style.cssText='position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(620px,calc(100% - 48px));padding:20px;border:1px solid #69e5ff88;border-radius:14px;background:#091019f7;color:#f3f7fa;font-family:system-ui,sans-serif;pointer-events:auto;z-index:30';const h=document.createElement('h2');h.textContent=title;h.style.cssText='margin:0 0 8px;color:#69e5ff;font-size:21px';const p=document.createElement('p');p.textContent=body;p.style.cssText='margin:0 0 14px;color:#c8d2d9;line-height:1.5';n.append(h,p);return n}
function button(label,color=C.cyan){const b=document.createElement('button');b.type='button';b.textContent=label;b.style.cssText=`border:1px solid ${color};border-radius:8px;background:#ffffff10;color:white;padding:10px 12px;font:700 13px system-ui;cursor:pointer`;return b}
function snapBack(o){o.returning=true;o.tx=o.homeX;o.ty=o.homeY;o.vx=o.vy=0}

export default function createGame({canvas,ctx,overlay,scenario,getState,actions,audio,toCanvasPoint,debug}){
  if(!canvas||!ctx||!overlay||!scenario)throw new Error('theme_park_liquidation requires modular Canvas host');
  canvas.style.touchAction='none';
  const W=canvas.width,H=canvas.height;
  const G={
    guest:{x:W*.46,y:96,w:125,h:H-180},rackBay:{x:W-205,y:105,w:150,h:105},
    resale:{x:W-265,y:H-165,w:82,h:92},salvage:{x:W-173,y:H-165,w:82,h:92},writeoff:{x:W-81,y:H-165,w:68,h:92},
    count:{x:W-285,y:118,w:225,h:160},bin:{x:W-145,y:H-155,w:105,h:92},
    pile:{x:60,y:H-165,w:200,h:105},cart:{x:W-210,y:H-165,w:165,h:105},
    pa:{x:W*.42,y:H*.51,r:48},pb:{x:W*.62,y:H*.51,r:48},tension:{x:W*.74,y:H*.52,w:76,h:58},
    panel:{x:W*.25,y:115,w:W*.50,h:270},show:{x:W-182,y:62,w:145,h:56},turn:{x:W*.51,y:H*.58,r:112}
  };
  const make=(o)=>({...o,homeX:o.x,homeY:o.y,placed:false,returning:false,vx:0,vy:0});
  const plush=[
    make({id:'p1',mark:'RESALE / CLEAN',target:'resale',x:80,y:140,w:72,h:52}),
    make({id:'p2',mark:'RESALE / SEALED',target:'resale',x:165,y:150,w:72,h:52}),
    make({id:'p3',mark:'SALVAGE / FADED',target:'salvage',x:105,y:225,w:72,h:52}),
    make({id:'p4',mark:'WRITE-OFF / TORN',target:'writeoff',x:195,y:235,w:72,h:52}),
  ];
  const crates=[
    make({id:'c041a',mark:'SERIAL 041',slot:0,x:75,y:140,w:94,h:62}),
    make({id:'c041b',mark:'SERIAL 041 DUP',slot:1,x:185,y:140,w:94,h:62}),
    make({id:'c112a',mark:'SERIAL 112',slot:2,x:75,y:225,w:94,h:62}),
    make({id:'c112b',mark:'SERIAL 112 DUP',slot:3,x:185,y:225,w:94,h:62}),
  ];
  const rack=make({id:'rack',x:G.guest.x-60,y:G.guest.y+120,w:230,h:78});
  const debris=[make({id:'d1',x:120,y:180,w:46,h:22}),make({id:'d2',x:250,y:265,w:54,h:20}),make({id:'d3',x:385,y:335,w:50,h:24}),make({id:'d4',x:520,y:215,w:44,h:20})];
  const parts=[make({id:'belt',label:'DRIVE BELT',x:92,y:H-135,w:78,h:36}),make({id:'fuse',label:'15A FUSE',x:180,y:H-130,w:68,h:32})];
  const leads=[make({id:'red',label:'RED △',target:'red',color:C.red,x:200,y:330,w:76,h:32}),make({id:'blue',label:'BLUE ○',target:'blue',color:C.blue,x:200,y:375,w:76,h:32})];
  const sockets={red:{x:W*.61,y:195,w:94,h:52,color:C.red,label:'△ RED'},blue:{x:W*.61,y:270,w:94,h:52,color:C.blue,label:'○ BLUE'}};

  let destroyed=false,raf=0,pointerId=null,drag=null,phaseCache='',feedback='',feedbackUntil=0;
  let beltPoint={x:G.pa.x-125,y:G.pa.y+110},beltRoute=[];
  let showStart=0,showProgress=0,showCompleting=false,selected=null,hookVisible=false;
  const keyCount=Object.create(null);
  const overlayOld={inset:overlay.style.inset,bottom:overlay.style.bottom,display:overlay.style.display,pointerEvents:overlay.style.pointerEvents};
  Object.assign(overlay.style,{inset:'0',bottom:'0',display:'block',pointerEvents:'none'});

  const briefing=panel('LIQUIDATION ORDER // PINEWICK GARDENS','Open Souvenir Shop 4, triage fixed stock, clear the marked guest path, repair the show controls, document the cancelled production run, and record one final mascot show.');
  const openBtn=button('OPEN SHOP / SURVEY (E)');briefing.append(openBtn);overlay.append(briefing);
  const manifest=panel('CANCELLED PRODUCTION MANIFEST','Crates repeat serials 041 and 112. FINAL WAVE: CANCELLED BY FACTORY. The park continued selling duplicate-number stock after the boom failed.');
  const manifestBtn=button('LOG MANIFEST (Q)',C.gold);manifest.append(manifestBtn);manifest.hidden=true;overlay.append(manifest);
  const choice=panel('COLLECTIBLE BATCH DISPOSITION','Choose the actual liquidation record for the failed collectible run.');
  const choiceRow=document.createElement('div');choiceRow.style.cssText='display:grid;grid-template-columns:repeat(3,1fr);gap:10px';
  for(const o of scenario.steps.find(s=>s.id==='batch_disposition')?.options??[]){const b=button(o.label,o.id==='display'?C.gold:C.cyan);b.setAttribute('aria-label',`${o.label}: ${o.outcome}`);b.onclick=e=>{e.stopPropagation();commitChoice(o.id)};choiceRow.append(b)}
  choice.append(choiceRow);choice.hidden=true;overlay.append(choice);

  const state=()=>getState(),pending=()=>state().pending_step?.id??null,done=id=>state().completedSteps?.includes(id)??false;
  function phaseOf(s){const id=s.pending_step?.id;if(!s.startedAt||id==='open_shop')return'briefing';return({triage_plush:'plush',triage_collectibles:'crates',clear_rack:'rack',clear_debris:'debris',recover_parts:'parts',refit_drive:'drive',reseat_fuse:'fuse',manifest_clue:'manifest',batch_disposition:'choice',run_show:'show',next_attraction_hook:'hook'})[id]??(!id&&s.scenario&&s.completedSteps.length===s.scenario.steps.length?(s.finished?'complete':'finish'):'idle')}
  const phase=()=>phaseOf(state());
  function say(text,bad=false){feedback=text;feedbackUntil=performance.now()+1700;audio.tone({frequency:bad?155:640,type:bad?'square':'sine',duration:.11,gain:.035});if(bad)audio.noise({duration:.05,gain:.02,filterFrequency:720});debug.stateChanged('theme_park_feedback',{message:text})}
  function attempt(id,payload={}){const r=actions.attemptStep(id,{...payload,source:payload.source??'theme_park_game'});if(!r.ok)say(r.missing?.length?`${id} BLOCKED // ${r.missing.join(', ')}`:`${id} BLOCKED // ${r.reason}`,true);else if(r.reason==='completed')say(`${id} COMPLETE`);return r}
  function openShop(){if(!state().startedAt)actions.startSession();const r=done('open_shop')?{ok:true}:attempt('open_shop',{source:'liquidation_order'});if(r.ok)briefing.hidden=true;return r.ok}
  openBtn.onclick=e=>{e.stopPropagation();openShop()};
  manifestBtn.onclick=e=>{e.stopPropagation();inspectManifest()};
  function inspectManifest(){if(pending()!=='manifest_clue')return false;const r=attempt('manifest_clue',{source:'manifest_inspect'});if(r.ok){manifest.hidden=true;audio.tone({frequency:780,type:'triangle',duration:.20,gain:.04})}return r.ok}
  function commitChoice(id){if(pending()!=='batch_disposition')return false;const r=attempt('batch_disposition',{option:id,disposition:id,source:'choice_ui'});if(r.ok){selected=id;choice.hidden=true}return r.ok}

  const targetFor=name=>name==='resale'?G.resale:name==='salvage'?G.salvage:G.writeoff;
  const slot=i=>({x:G.count.x+12+(i%2)*100,y:G.count.y+44+Math.floor(i/2)*68,w:90,h:56});
  const valid=(o,t,p)=>overlap(rect(o),t)&&inside(p,t);
  function wrong(o,text){snapBack(o);say(text,true)}
  function items(){const p=phase();if(p==='plush')return plush;if(p==='crates')return crates;if(p==='rack')return[rack];if(p==='debris')return debris;if(p==='parts')return parts;if(p==='fuse')return leads;return[]}
  function drop(kind,o,p){
    if(kind==='plush'){const ts=[['resale',G.resale],['salvage',G.salvage],['writeoff',G.writeoff]],hit=ts.find(([,r])=>valid(o,r,p));if(!hit)return wrong(o,'WRONG DROP // release inside a labeled bag');if(hit[0]!==o.target)return wrong(o,`${o.mark} → ${o.target.toUpperCase()} BAG`);const t=targetFor(o.target);o.placed=true;o.x=t.x+t.w/2-o.w/2;o.y=t.y+t.h/2-o.h/2;if(plush.every(x=>x.placed))attempt('triage_plush',{fixed_items:plush.map(x=>x.id)});return}
    if(kind==='crates'){if(!valid(o,G.count,p))return wrong(o,'CRATE REJECTED // release on COUNT TABLE');const s=slot(o.slot);o.placed=true;o.x=s.x;o.y=s.y;if(crates.every(x=>x.placed))attempt('triage_collectibles',{serials:crates.map(x=>x.mark)});return}
    if(kind==='rack'){if(overlap(rect(rack),G.guest))return wrong(rack,'PATH STILL BLOCKED // rack must clear the entire stripe');if(!valid(rack,G.rackBay,p))return wrong(rack,'RACK REJECTED // release inside RACK BAY');rack.x=G.rackBay.x+8;rack.y=G.rackBay.y+14;attempt('clear_rack',{guest_path_clear:true});return}
    if(kind==='debris'){if(!valid(o,G.bin,p))return wrong(o,'DEBRIS REJECTED // release in TRIM BIN');o.placed=true;o.x=G.bin.x+18;o.y=G.bin.y+48;if(debris.every(x=>x.placed))attempt('clear_debris',{guest_path_clear:true});return}
    if(kind==='parts'){if(!valid(o,G.cart,p))return wrong(o,`${o.label} → TOOL CART`);o.placed=true;o.x=G.cart.x+20+parts.filter(x=>x.placed).length*62;o.y=G.cart.y+50;if(parts.every(x=>x.placed))attempt('recover_parts',{recovered_parts:parts.map(x=>x.id)});return}
    if(kind==='fuse'){const s=sockets[o.target],wrongSocket=Object.entries(sockets).find(([name,r])=>name!==o.target&&valid(o,r,p));if(wrongSocket)return wrong(o,`TERMINAL MISMATCH // ${o.label} must match ${s.label}`);if(!valid(o,s,p))return wrong(o,`MATCH ${o.label} TO ${s.label}`);o.placed=true;o.x=s.x+9;o.y=s.y+10;if(leads.every(x=>x.placed))attempt('reseat_fuse',{matched_terminals:['RED △','BLUE ○']})}
  }

  function beltHit(p){const a=Math.hypot(p.x-G.pa.x,p.y-G.pa.y)<=G.pa.r+18,b=Math.hypot(p.x-G.pb.x,p.y-G.pb.y)<=G.pb.r+18;if(a&&!beltRoute.includes('A'))beltRoute.push('A');if(beltRoute.includes('A')&&b&&!beltRoute.includes('B'))beltRoute.push('B');if(beltRoute.includes('B')&&inside(p,G.tension)&&!beltRoute.includes('T'))beltRoute.push('T')}
  function beltStroke(a,b){const n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/8));for(let i=1;i<=n;i++){const t=i/n;beltHit({x:lerp(a.x,b.x,t),y:lerp(a.y,b.y,t)})}}
  function beltEnd(p){beltHit(p);if(beltRoute.join('>')!=='A>B>T'||!inside(p,G.tension)){beltRoute=[];beltPoint={x:G.pa.x-125,y:G.pa.y+110};say('BELT REJECTED // PULLEY A → PULLEY B → TENSION',true);return}attempt('refit_drive',{belt_route:['pulley_a','pulley_b','tensioner'],tensioned:true})}

  function pointerDown(e){if(destroyed||pointerId!==null)return;const p=toCanvasPoint(e);if(!p.inside)return;pointerId=e.pointerId;try{canvas.setPointerCapture(e.pointerId)}catch{}if(inside(p,G.show)){showCue(true);return}if(phase()==='drive'){drag={kind:'belt'};beltRoute=[];beltPoint={x:p.x,y:p.y};beltHit(p);return}for(const o of items().slice().reverse()){if(o.placed)continue;if(inside(p,rect(o))){drag={kind:phase(),o,dx:p.x-o.x,dy:p.y-o.y};o.returning=false;return}}}
  function pointerMove(e){if(e.pointerId!==pointerId||!drag)return;const p=toCanvasPoint(e);if(drag.kind==='belt'){const a={...beltPoint};beltPoint={x:p.x,y:p.y};beltStroke(a,beltPoint);return}drag.o.x=p.x-drag.dx;drag.o.y=p.y-drag.dy}
  function pointerUp(e){if(e.pointerId!==pointerId)return;const p=toCanvasPoint(e);try{if(canvas.hasPointerCapture?.(e.pointerId))canvas.releasePointerCapture(e.pointerId)}catch{}pointerId=null;if(!drag)return;if(drag.kind==='belt'){beltEnd(p);drag=null;return}const d=drag;drag=null;drop(d.kind,d.o,p)}
  function pointerCancel(e){if(e.pointerId!==pointerId)return;pointerId=null;if(drag?.o)snapBack(drag.o);drag=null}
  canvas.addEventListener('pointerdown',pointerDown);canvas.addEventListener('pointermove',pointerMove);canvas.addEventListener('pointerup',pointerUp);canvas.addEventListener('pointercancel',pointerCancel);

  function space(){
    const id=pending();keyCount[id]=(keyCount[id]??0)+1;
    if(id==='triage_plush'){const o=plush.find(x=>!x.placed);if(o){const t=targetFor(o.target);o.placed=true;o.x=t.x+t.w/2-o.w/2;o.y=t.y+t.h/2-o.h/2}if(plush.every(x=>x.placed))attempt(id,{source:'space_triage'});return true}
    if(id==='triage_collectibles'){const o=crates.find(x=>!x.placed);if(o){const s=slot(o.slot);o.placed=true;o.x=s.x;o.y=s.y}if(crates.every(x=>x.placed))attempt(id,{source:'space_crates'});return true}
    if(id==='clear_rack'){const t=clamp(keyCount[id]/3,0,1);rack.x=lerp(rack.homeX,G.rackBay.x+8,t);rack.y=lerp(rack.homeY,G.rackBay.y+14,t);if(t>=1)attempt(id,{source:'space_rack',guest_path_clear:true});return true}
    if(id==='clear_debris'){const o=debris.find(x=>!x.placed);if(o){o.placed=true;o.x=G.bin.x+18;o.y=G.bin.y+48}if(debris.every(x=>x.placed))attempt(id,{source:'space_debris'});return true}
    if(id==='recover_parts'){const o=parts.find(x=>!x.placed);if(o){o.placed=true;o.x=G.cart.x+20+parts.filter(x=>x.placed).length*60;o.y=G.cart.y+50}if(parts.every(x=>x.placed))attempt(id,{source:'space_parts'});return true}
    if(id==='refit_drive'){const n=keyCount[id];beltRoute=n===1?['A']:n===2?['A','B']:['A','B','T'];if(n>=3)attempt(id,{source:'space_belt',belt_route:['pulley_a','pulley_b','tensioner'],tensioned:true});return true}
    if(id==='reseat_fuse'){const o=leads.find(x=>!x.placed);if(o){const s=sockets[o.target];o.placed=true;o.x=s.x+9;o.y=s.y+10}if(leads.every(x=>x.placed))attempt(id,{source:'space_fuse'});return true}
    if(id==='run_show'){showCue(false);return true}
    return false;
  }

  function showCue(probe){
    if(showStart)return true;
    if(pending()!=='run_show'){
      const r=actions.attemptStep('run_show',{source:'show_cue_probe',probe:true});
      say(!r.ok&&r.missing?.length?`SHOW REFUSED // missing ${r.missing.join(', ')}`:'SHOW REFUSED // show cue is not ready',true);
      return true;
    }
    showStart=performance.now();showProgress=0;showCompleting=false;audio.tone({frequency:330,type:'triangle',duration:.18,gain:.04});debug.stateChanged('theme_park_show_started',{source:probe?'show_button':'space'});
    return true;
  }

  function handleVerb(verb){
    const id=pending();
    if(verb==='reset_profile'){actions.resetProfile();return{handled:true}}
    if(verb==='advance')return false;
    if(verb==='interact'){if(!state().startedAt||id==='open_shop'){openShop();return{handled:true}}if(id==='recover_parts'){space();return{handled:true}}if(id==='next_attraction_hook'){hookVisible=true;attempt('next_attraction_hook',{source:'next_attraction_log'});return{handled:true}}return false}
    if(verb==='inspect'&&id==='manifest_clue'){manifest.hidden=false;inspectManifest();return{handled:true}}
    if(verb==='commit_choice'&&id==='batch_disposition'){choice.hidden=false;debug.stateChanged('theme_park_choice_open',{});return{handled:true}}
    if(verb==='core_action'&&space())return{handled:true};
    return false;
  }

  function sync(){const p=phase();if(p===phaseCache)return;phaseCache=p;briefing.hidden=p!=='briefing';manifest.hidden=p!=='manifest';choice.hidden=p!=='choice';if(p==='hook')hookVisible=true;debug.stateChanged('theme_park_phase',{phase:p,pending_step:pending()})}
  function motion(o,dt){if(!o.returning)return;const k=18;o.vx+=(o.tx-o.x)*k*dt;o.vy+=(o.ty-o.y)*k*dt;o.vx*=Math.pow(.0008,dt);o.vy*=Math.pow(.0008,dt);o.x+=o.vx*dt;o.y+=o.vy*dt;if(Math.hypot(o.tx-o.x,o.ty-o.y)<1.5){o.x=o.tx;o.y=o.ty;o.vx=o.vy=0;o.returning=false}}
  function box(text,r,color=C.cyan){ctx.save();ctx.fillStyle='#0a1018e6';ctx.strokeStyle=color;ctx.lineWidth=2;rounded(ctx,r,8);ctx.fill();ctx.stroke();ctx.fillStyle=C.white;ctx.font='700 11px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,r.x+r.w/2,r.y+r.h/2);ctx.restore()}
  function shopBg(){const q=ctx.createLinearGradient(0,0,0,H);q.addColorStop(0,'#2c2136');q.addColorStop(1,'#15111c');ctx.fillStyle=q;ctx.fillRect(0,0,W,H);ctx.fillStyle='#70435f';ctx.fillRect(30,48,W-60,48);ctx.fillStyle=C.gold;ctx.font='800 18px system-ui';ctx.textAlign='left';ctx.fillText('PINEWICK GARDENS // SOUVENIR SHOP 4',52,79);ctx.fillStyle=C.floor;ctx.fillRect(30,96,W-60,H-132);ctx.fillStyle='#d7c55e18';ctx.fillRect(G.guest.x,G.guest.y,G.guest.w,G.guest.h);ctx.strokeStyle=C.path;ctx.setLineDash([12,10]);ctx.lineWidth=3;ctx.strokeRect(G.guest.x,G.guest.y,G.guest.w,G.guest.h);ctx.setLineDash([]);ctx.fillStyle=C.path;ctx.font='800 11px system-ui';ctx.textAlign='center';ctx.fillText('GUEST PATH',G.guest.x+G.guest.w/2,G.guest.y+18)}
  function showBg(time){const q=ctx.createLinearGradient(0,0,0,H);q.addColorStop(0,'#0d1520');q.addColorStop(1,'#171019');ctx.fillStyle=q;ctx.fillRect(0,0,W,H);ctx.fillStyle='#202c38';ctx.fillRect(28,48,W-56,64);ctx.fillStyle=C.cyan;ctx.font='800 17px system-ui';ctx.textAlign='left';ctx.fillText('FLOAT BAY // SHOW CONTROL',52,86);ctx.fillStyle='#171b22';ctx.fillRect(28,112,W-56,H-142);const t=showStart?clamp((time-showStart)/4200,0,1):0;showProgress=t;ctx.save();ctx.translate(G.turn.x,G.turn.y);ctx.fillStyle='#29313a';ctx.beginPath();ctx.ellipse(0,20,G.turn.r,G.turn.r*.45,0,0,Math.PI*2);ctx.fill();if(t>0){ctx.rotate(t*Math.PI*2);const a=.45+Math.sin(time*.012)*.25;ctx.fillStyle=`rgba(255,207,84,${a})`;ctx.beginPath();ctx.moveTo(-125,-180);ctx.lineTo(-15,15);ctx.lineTo(45,15);ctx.fill();ctx.fillStyle=`rgba(105,229,255,${a})`;ctx.beginPath();ctx.moveTo(125,-180);ctx.lineTo(-45,15);ctx.lineTo(15,15);ctx.fill()}ctx.fillStyle='#a46fda';rounded(ctx,{x:-55,y:-78,w:110,h:120},24);ctx.fill();ctx.fillStyle=C.gold;ctx.beginPath();ctx.arc(0,-64,42,0,Math.PI*2);ctx.fill();ctx.restore();box('SHOW CUE',G.show,t>0?C.green:C.cyan)}

  function draw(time){
    const p=phase(),shopPhases=new Set(['briefing','plush','crates','rack','parts','manifest','choice']);shopPhases.has(p)?shopBg():showBg(time);
    if(p==='plush'){box('RESALE',G.resale,C.green);box('SALVAGE',G.salvage,C.orange);box('WRITE-OFF',G.writeoff,C.red);for(const o of plush)if(!o.placed){ctx.fillStyle=o.target==='resale'?'#d18de8':o.target==='salvage'?C.orange:C.red;rounded(ctx,rect(o),16);ctx.fill();ctx.fillStyle=C.dark;ctx.font='700 8px system-ui';ctx.textAlign='center';ctx.fillText(o.mark,o.x+o.w/2,o.y+o.h-10)}}
    else if(p==='crates'){box('COUNT / INSPECT TABLE',G.count);for(const o of crates)o.placed?box(o.mark,slot(o.slot),o.mark.includes('DUP')?C.red:C.green):box(o.mark,rect(o),'#c89a63')}
    else if(p==='rack'){ctx.fillStyle='#535c67';ctx.fillRect(rack.x,rack.y+18,rack.w,12);ctx.fillRect(rack.x+18,rack.y,12,rack.h);ctx.fillRect(rack.x+rack.w-30,rack.y,12,rack.h);box('RACK BAY',G.rackBay,C.green)}
    else if(p==='debris'){for(const o of debris)if(!o.placed){ctx.fillStyle='#ed756d';ctx.fillRect(o.x,o.y,o.w,o.h)}box('TRIM BIN',G.bin,C.green)}
    else if(p==='parts'){ctx.fillStyle='#332c30';rounded(ctx,G.pile,12);ctx.fill();box('TOOL CART',G.cart);for(const o of parts)if(!o.placed)box(o.label,rect(o),C.gold)}
    else if(p==='drive'){for(const [name,u] of [['A',G.pa],['B',G.pb]]){ctx.fillStyle='#343d47';ctx.beginPath();ctx.arc(u.x,u.y,u.r,0,Math.PI*2);ctx.fill();ctx.strokeStyle=C.cyan;ctx.stroke();ctx.fillStyle=C.white;ctx.font='800 16px system-ui';ctx.textAlign='center';ctx.fillText(`PULLEY ${name}`,u.x,u.y+5)}box('TENSION',G.tension,C.gold);const pts=[{x:G.pa.x-125,y:G.pa.y+110},...(beltRoute.includes('A')?[{x:G.pa.x,y:G.pa.y}]:[]),...(beltRoute.includes('B')?[{x:G.pb.x,y:G.pb.y}]:[]),...(beltRoute.includes('T')?[{x:G.tension.x+G.tension.w/2,y:G.tension.y+G.tension.h/2}]:[]),beltPoint];ctx.strokeStyle=C.gold;ctx.lineWidth=9;ctx.beginPath();pts.forEach((u,i)=>i?ctx.lineTo(u.x,u.y):ctx.moveTo(u.x,u.y));ctx.stroke()}
    else if(p==='fuse'){ctx.fillStyle='#202833';rounded(ctx,G.panel,14);ctx.fill();for(const [name,s] of Object.entries(sockets)){ctx.strokeStyle=s.color;ctx.lineWidth=3;ctx.strokeRect(s.x,s.y,s.w,s.h);ctx.fillStyle=s.color;ctx.font='900 20px system-ui';ctx.textAlign='center';ctx.fillText(s.label,s.x+s.w/2,s.y+32)}for(const o of leads)if(!o.placed){ctx.fillStyle=o.color;rounded(ctx,rect(o),8);ctx.fill();ctx.fillStyle=C.dark;ctx.font='900 11px system-ui';ctx.fillText(o.label,o.x+o.w/2,o.y+20)}}
    else if(p==='manifest'){ctx.fillStyle='#f0ead9';rounded(ctx,{x:W*.27,y:135,w:W*.46,h:240},8);ctx.fill();ctx.fillStyle='#24201b';ctx.font='800 15px ui-monospace';ctx.textAlign='left';ctx.fillText('PACKING MANIFEST // WAVE 5',W*.30,170);ctx.fillText('041  041  112  112',W*.30,205);ctx.fillStyle=C.red;ctx.fillText('FINAL WAVE: CANCELLED',W*.30,245)}
    else if(p==='hook'||p==='finish'||p==='complete'){ctx.fillStyle='#0e1720e8';rounded(ctx,{x:100,y:130,w:W-200,h:240},16);ctx.fill();ctx.strokeStyle=C.cyan;ctx.stroke();ctx.fillStyle=C.cyan;ctx.font='900 22px system-ui';ctx.textAlign='center';ctx.fillText('NEXT SEALED ATTRACTION',W/2,184);ctx.fillStyle=C.white;ctx.font='600 15px system-ui';ctx.fillText('Cue sheet: FLOAT ROUTE → ATTRACTION 6 / SEALED',W/2,232);ctx.fillStyle=C.muted;ctx.fillText('Press E to log it, then Enter to finish.',W/2,290)}
    ctx.fillStyle='#05080dcf';ctx.fillRect(0,H-38,W,38);ctx.fillStyle=C.cyan;ctx.font='800 12px system-ui';ctx.textAlign='left';ctx.fillText(`PHASE: ${p.toUpperCase()}`,16,H-15);if(feedback&&time<feedbackUntil){ctx.textAlign='right';ctx.fillStyle=feedback.includes('BLOCKED')||feedback.includes('REFUSED')||feedback.includes('REJECTED')?C.red:C.green;ctx.fillText(feedback,W-16,H-15)}
  }

  let last=performance.now();
  function frame(time){
    if(destroyed)return;
    const dt=Math.min(.04,Math.max(0,(time-last)/1000));last=time;sync();
    for(const o of [...plush,...crates,rack,...debris,...parts,...leads])motion(o,dt);
    if(showStart&&showProgress>=1&&!showCompleting){
      showCompleting=true;
      const r=actions.attemptStep('run_show',{source:'show_animation_complete',rotation_degrees:360,lighting:true});
      if(r.ok){showStart=0;showCompleting=false;say('MASCOT SHOW COMPLETE // 360° + LIGHTING');audio.tone({frequency:840,type:'triangle',duration:.24,gain:.04});debug.stateChanged('theme_park_show_complete',{rotation_degrees:360,lighting:true})}
      else{showStart=0;showCompleting=false;say(r.missing?.length?`SHOW REFUSED // ${r.missing.join(', ')}`:`SHOW REFUSED // ${r.reason}`,true)}
    }
    ctx.clearRect(0,0,W,H);draw(time);raf=requestAnimationFrame(frame);
  }
  raf=requestAnimationFrame(frame);

  return{
    handleVerb,
    handlePlayerAction(){return false},
    destroy(){if(destroyed)return;destroyed=true;cancelAnimationFrame(raf);canvas.removeEventListener('pointerdown',pointerDown);canvas.removeEventListener('pointermove',pointerMove);canvas.removeEventListener('pointerup',pointerUp);canvas.removeEventListener('pointercancel',pointerCancel);briefing.remove();manifest.remove();choice.remove();Object.assign(overlay.style,overlayOld)},
    getDebugState(){return{phase:phase(),pending_step:pending(),plush_sorted:plush.filter(x=>x.placed).map(x=>x.id),crates_counted:crates.filter(x=>x.placed).map(x=>x.id),rack_clear:done('clear_rack'),debris_binned:debris.filter(x=>x.placed).map(x=>x.id),parts_recovered:parts.filter(x=>x.placed).map(x=>x.id),belt_route:[...beltRoute],fuse_terminals:leads.filter(x=>x.placed).map(x=>x.id),selected_disposition:selected,show_running:Boolean(showStart),show_progress:showProgress,next_hook_visible:hookVisible}}
  };
}
