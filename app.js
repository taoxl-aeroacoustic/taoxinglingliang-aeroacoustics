'use strict';
const $ = id => document.getElementById(id);
const fmt = new Intl.NumberFormat('en-US');
const rawBase = 'https://raw.githubusercontent.com/taoxl-aeroacoustic/taoxinglingliang-aeroacoustics/live-data/';
const remote = location.hostname === 'taoxl-aeroacoustic.github.io';
const statusNames = {running:'Running', queued:'Queued', checkpoint:'Saving checkpoint', processing:'Post-processing', complete:'Verified', interrupted:'Interrupted', preparing:'Preparing'};
const qtyInfo = {rise:{key:3,label:'Pressure rise',unit:'Pa'},qin:{key:1,label:'Inlet flow',unit:'m³/s'},qout:{key:2,label:'Outlet flow',unit:'m³/s'}};
const requested = new URLSearchParams(location.search).get('case');
let wall = requested === 'lined' ? 'lined' : 'rigid';
let field = 'speed';
let reviewTurn = 'latest';
let qty = 'rise';
let data = window.HD150_BOOT || null;
let figureBase = './data/figures/';
let feedAvailable = false;
let imageVersion = 0;
let refreshing = false;
let lastCheck = 0;
let currentImage = null;
function label(id,text){ $(id).textContent=text; }
function percent(v){return v.toFixed(1)+'%';}
function utc(date){return new Date(date).toISOString().slice(0,19).replace('T',' ')+' UTC';}
function valid(s){return s?.schema===1 && s.study==='hd150-otr' && s.cases?.rigid && s.cases?.lined && s.scales && Number.isFinite(Date.parse(s.publishedAt));}
function selected(attr,value){document.querySelectorAll('['+attr+']').forEach(b=>b.setAttribute('aria-pressed',String(b.getAttribute(attr)===value)));}
function setupCanvas(c){
    const rect=c.getBoundingClientRect(), dpr=Math.min(window.devicePixelRatio||1,2);
    if(rect.width<1 || rect.height<1)return null;
    c.width=Math.round(rect.width*dpr); c.height=Math.round(rect.height*dpr);
    const ctx=c.getContext('2d');
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.font='10px Consolas, monospace';
    return {ctx,w:rect.width,h:rect.height};
}
function plotField(){
    const s=setupCanvas($('field'));
    if(!s || !currentImage || !data)return;
    const {ctx,w,h}=s,f=data.cases[wall].frame;
    if(!f)return;
    const isVelocity=field==='speed', source=isVelocity?f.field:f.duct;
    if(!source)return;
    const left=41, right=18, top=9, bottom=22, spaceW=w-left-right,spaceH=h-top-bottom;
    if(spaceW<5 || spaceH<5)return;
    const aspect=isVelocity?(source.z[1]-source.z[0])/(source.x[1]-source.x[0]):2.1;
    const width=Math.min(spaceW,spaceH*aspect),height=width/aspect;
    const x=left+(spaceW-width)/2,y=top+(spaceH-height)/2;
    ctx.imageSmoothingEnabled=false;
    ctx.drawImage(currentImage,x,y,width,height);
    ctx.strokeStyle='#82988f';ctx.strokeRect(x-.5,y-.5,width+1,height+1);
    ctx.fillStyle='#c8d7ce';ctx.textBaseline='middle';
    const xTicks=isVelocity?[0,50,100,150,200]:source.z;
    xTicks.forEach((v,i)=>{
        const frac=isVelocity?(v-source.z[0])/(source.z[1]-source.z[0]):(i+.5)/xTicks.length;
        if(frac<0||frac>1)return;
        const p=x+width*frac;
        ctx.fillRect(p,y+height,1,4);ctx.textAlign='center';ctx.fillText(String(v),p,y+height+11);
    });
    const yTicks=isVelocity?[-100,-50,0,50,100]:[0,90,180,270];
    yTicks.forEach(v=>{
        const frac=isVelocity?(v-source.x[0])/(source.x[1]-source.x[0]):(v/360+0.5/source.angles);
        if(frac<0||frac>1)return;
        const p=y+(1-frac)*height;
        ctx.fillRect(x-4,p,4,1);ctx.textAlign='right';ctx.fillText(String(v),x-7,p);
    });
}
function updateField(){
    const c=data.cases[wall], f=c.frame, isVelocity=field==='speed';
    const archived=(c.turnFrames||[]).find(r=>String(r.turn)===reviewTurn);
    const original=isVelocity?f?.field:f?.duct, historic=archived?.[isVelocity?'speed':'pressure'];
    const src=archived?(historic&&original?{...original,...historic,png:figureBase+historic.file}:null):original;
    const version=++imageVersion;
    currentImage=null;
    setupCanvas($('field'));selected('data-field',field);
    label('field-title',isVelocity?'Velocity magnitude':'Circumferential pressure');
    label('field-y',isVelocity?'Transverse x (mm)':'Azimuth (°)');
    label('field-x',isVelocity?'Axial z (mm)':'Axial station z (mm)');
    $('field-empty').hidden=Boolean(src);$('legend').hidden=!src;
    if(!src){
        label('field-empty',!f?(c.status==='queued'?'Acoustic liner queued after the rigid-wall run.':'Waiting for the first archived field.'):'Duct pressure will appear when acoustic acquisition begins.');
        label('field-info','No field archived for this selection.');return;
    }
    const limit=archived?(isVelocity?100:1000):(isVelocity?data.scales.velocity:data.scales.pressure);
    $('scale').style.background='linear-gradient(to right,'+(isVelocity?data.scales.velocityColors:data.scales.pressureColors).join(',')+')';
    label('low',isVelocity?'0':String(-limit));label('high',String(limit));label('units',isVelocity?'m/s':'Pa');
    label('field-info',(isVelocity?'Slice y = '+(src.y>=0?'+':'')+src.y+' mm · '+src.nz+' × '+src.nx+' samples':'r = '+src.radius+' mm · '+src.angles+' azimuths × '+src.z.length+' stations')+(archived?' · root '+fmt.format(archived.step):''));
    $('field').setAttribute('aria-label',isVelocity?'Axial velocity-magnitude slice, from '+src.min.toFixed(2)+' to '+src.max.toFixed(2)+' metres per second.':'Duct pressure fluctuation, from '+src.min.toFixed(1)+' to '+src.max.toFixed(1)+' pascals.');
    const img=new Image();
    img.onload=()=>{if(version===imageVersion){currentImage=img;plotField();}};
    img.onerror=()=>{if(version===imageVersion){$('field-empty').hidden=false;label('field-empty','The archived field image could not be loaded.');}};
    img.src=src.png;
}
function drawTrend(){
    const s=setupCanvas($('trend'));
    if(!s || !data)return;
    const {ctx,w,h}=s, conf=qtyInfo[qty], history=data.cases[wall].history;
    if(!history?.length){ctx.fillStyle='#62736b';ctx.font='13px Segoe UI, sans-serif';ctx.fillText('Waiting for aerodynamic samples.',14,h/2);return;}
    const xx=history.map(a=>a[0]),yy=history.map(a=>a[conf.key]),x0=xx[0],x1=xx.at(-1);
    const low=Math.min(...yy),high=Math.max(...yy), pad=Math.max((high-low)*.09,qty==='rise'?.1:.00005);
    const ymin=low-pad,ymax=high+pad,L=qty==='rise'?43:55,R=12,T=10,B=26;
    const X=v=>L+(w-L-R)*(v-x0)/(x1-x0||1),Y=v=>T+(h-B-T)*(1-(v-ymin)/(ymax-ymin));
    ctx.textBaseline='middle';ctx.textAlign='right';ctx.lineWidth=1;
    for(let k=0;k<=3;k++){const v=ymin+(ymax-ymin)*k/3,y=Y(v);ctx.strokeStyle='#e0e6df';ctx.beginPath();ctx.moveTo(L,y);ctx.lineTo(w-R,y);ctx.stroke();ctx.fillStyle='#5d6b64';ctx.fillText(v.toFixed(qty==='rise'?1:4),L-6,y);}
    ctx.strokeStyle='#2d7665';ctx.lineWidth=1.8;ctx.beginPath();history.forEach((row,i)=>{const x=X(row[0]),y=Y(row[conf.key]);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.stroke();
    ctx.fillStyle='#bd4a30';ctx.beginPath();ctx.arc(X(xx.at(-1)),Y(yy.at(-1)),3.2,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#586960';ctx.textAlign='left';ctx.fillText(x0.toFixed(2),L,h-11);
    ctx.textAlign='center';ctx.fillText('Rotor revolutions',(L+w-R)/2,h-11);
    ctx.textAlign='right';ctx.fillText(x1.toFixed(2),w-R,h-11);
}
function syncStatus(){
    if(!data)return;
    const lag=Date.now()-Date.parse(data.publishedAt),allDone=Object.values(data.cases).every(c=>c.status==='complete');
    const fresh=lag<75*60e3,el=$('connection');
    const name=allDone?'Both runs verified':feedAvailable?(fresh?'Hourly snapshot':'Snapshot delayed'):'Saved snapshot';
    el.className=fresh&&feedAvailable?'fresh':'stale';el.replaceChildren(document.createElement('i'),document.createTextNode(name));
    label('published',utc(data.publishedAt));
}
function renderGallery(){
    const c=data.cases[wall], comparison=data.comparison;
    const scientific=(c.gallery||[]).concat(c.acousticFigures||[],comparison?.figures||[]).map(i=>({...i,group:'sound'}));
    const all=[...(c.media||[]),...scientific,...(data.studyFigures||[]).map(i=>({...i,group:'geometry'}))];
    const filter=$('gallery-filter').value;
    const figures=all.filter(i=>filter==='all'||(filter==='movies'&&i.video)||(filter==='geometry'&&i.group==='geometry')||(filter==='sound'&&(i.group==='sound'||/Broadband|radiated sound|Five-view/.test(i.label))));
    const gallery=$('gallery');gallery.replaceChildren();
    for(const item of figures){
        if(!/^(rigid|lined|shared|comparison)-[a-z0-9-]+-[0-9a-f]{16}\.webp$/.test(item.file))continue;
        const btn=document.createElement('button'),img=new Image(),text=document.createElement('span');
        img.alt=item.label;img.src=figureBase+item.file;img.loading='lazy';text.textContent=(item.video?'▷  ':'')+item.label;
        btn.type='button';btn.append(img,text);btn.onclick=()=>openFigure(item);gallery.append(btn);
    }
    const nMovies=(c.media||[]).filter(i=>i.video).length;
    label('output-status',figures.length+' entries in this view · '+nMovies+' archived films for this wall. '+(!c.acousticFigures?.length?'Five BPF harmonics, FW-H spectra and directivity follow the completed acoustic window. ':'Signed FW-H and duct-mode results are available.')+(data.mediaPending?' Some figures are being retried.':''));
    const comparisonBox=$('comparison');comparisonBox.replaceChildren();
    if(comparison){
        for(const k of ['rigid','lined']){const m=comparison.means[k],p=document.createElement('p');p.textContent=data.cases[k].name+' · window means · inlet '+m.qin.toFixed(4)+' m³/s · outlet '+m.qout.toFixed(4)+' m³/s · pressure rise '+m.rise.toFixed(2)+' Pa';comparisonBox.append(p);}
        const p=document.createElement('p');p.textContent='Rigid minus lined at 1 kHz across the '+comparison.receiverRadiusM+' m receivers: '+comparison.toneDeltaRange[0]+' to '+comparison.toneDeltaRange[1]+' dB.';comparisonBox.append(p);
    }
}
function render(){
    if(!valid(data))return;
    const c=data.cases[wall],f=c.frame,a=f?.aero,done=c.status==='complete',step=done?c.totalSteps:(f?.step??0),pct=100*step/c.totalSteps;
    selected('data-case',wall);selected('data-qty',qty);syncStatus();renderTurns(c);updateField();renderTime(c);drawRings();
    label('case-status',statusNames[c.status]||'Awaiting update');
    $('case-status').parentElement.classList.toggle('active',['running','complete','checkpoint','processing'].includes(c.status));
    label('percent',percent(pct));$('progress').value=pct;label('steps',fmt.format(step)+' / '+fmt.format(c.totalSteps));
    label('turn',f?f.turns.toFixed(2):'—');
    label('capture',(f?f.acTurns.toFixed(2):'0.00')+' / '+c.targetTurns+' turns');
    label('checkpoint',c.checkpoint?fmt.format(c.checkpoint):'—');label('flow-time',f?(1000*f.t).toFixed(2)+' ms':'—');
    label('frame-utc',f?'Field captured '+utc(f.time):'Waiting for the first production frame.');
    for(const k of ['rise','qin','qout'])label('num-'+k,a?a[k].toFixed(k==='rise'?1:4):'—');
    label('chart-caption',qtyInfo[qty].label+' ('+qtyInfo[qty].unit+')'+(a?' · instantaneous samples · latest step '+fmt.format(a.step):''));
    $('download').disabled=!c.history?.length;drawTrend();renderGallery();
    label('grid-stat',data.method.gridLevels+' levels · '+(data.method.nodes/1e6).toFixed(2)+' M nodes');
    label('fwh-stat',fmt.format(data.method.surfacePanels)+' FW-H panels · 5 duct rings');
}
async function poll(){
    if(refreshing)return;refreshing=true;lastCheck=Date.now();$('refresh').disabled=true;
    const sources=[['./data/snapshot.json','./data/figures/']];
    if(remote){
        const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),5500);
        try{
            const ref=await fetch('https://api.github.com/repos/taoxl-aeroacoustic/taoxinglingliang-aeroacoustics/git/ref/heads/live-data?hour='+Math.floor(Date.now()/3600000),{signal:abort.signal,cache:'no-store',credentials:'omit'});
            if(ref.ok){
                const sha=(await ref.json())?.object?.sha;
                if(/^[a-f0-9]{40}$/.test(sha)){
                    const base=rawBase.replace('live-data/',sha+'/');
                    sources.unshift([base+'snapshot.json',base+'figures/']);
                }
            }
        }catch(e){}finally{clearTimeout(timeout);}
    }
    let fetched=false;
    try{
        if(location.protocol!=='file:')for(const [url,assets] of sources){
            const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),9000);
            try{const res=await fetch(url+'?t='+Math.floor(Date.now()/60000),{cache:'no-store',signal:controller.signal,credentials:'omit'});if(!res.ok)continue;
                const next=await res.json();if(!valid(next))continue;
                if(!data || Date.parse(next.publishedAt)>=Date.parse(data.publishedAt)){data=next;figureBase=assets;}
                feedAvailable=true;fetched=true;break;
            }catch(e){}finally{clearTimeout(timer);}
        }
        if(!fetched)feedAvailable=false;
        if(valid(data))render();else label('case-status','Snapshot unavailable');
    }finally{refreshing=false;$('refresh').disabled=false;}
}
document.querySelectorAll('[data-case]').forEach(b=>b.addEventListener('click',()=>{wall=b.dataset.case;reviewTurn='latest';const u=new URL(location.href);u.searchParams.set('case',wall);try{history.replaceState(null,'',u);}catch(e){}render();}));
document.querySelectorAll('[data-field]').forEach(b=>b.addEventListener('click',()=>{field=b.dataset.field;if(data)updateField();}));
document.querySelectorAll('[data-qty]').forEach(b=>b.addEventListener('click',()=>{qty=b.dataset.qty;render();}));
$('refresh').onclick=poll;
$('studies-open').onclick=()=>$('studies').showModal();
document.querySelector('.study-link').onclick=()=>$('studies').close();
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
$('download').onclick=()=>{
    const rows=data.cases[wall].history;
    const csv=['rotor_turns,inlet_flow_m3_s,outlet_flow_m3_s,pressure_rise_Pa',...rows.map(row=>row.join(','))].join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'})),a=document.createElement('a');a.href=url;a.download='hd150-'+wall+'-history.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
let mediaURL=null;
let mediaVersion=0;
function renderTurns(c){
    const sel=$('turn-picker'),list=c.turnFrames||[];
    sel.replaceChildren(new Option('Latest available','latest'));
    for(const r of [...list].reverse())sel.add(new Option('Revolution '+r.turn,' '+r.turn));
    for(const opt of sel.options)opt.value=opt.value.trim();
    if(!list.some(r=>String(r.turn)===reviewTurn))reviewTurn='latest';
    sel.value=reviewTurn;sel.disabled=!list.length;
    const rec=list.find(r=>String(r.turn)===reviewTurn);
    label('turn-note',rec?'Captured at '+rec.turns.toFixed(3)+' rev · '+utc(rec.time):list.length?list.length+' completed turns archived':'Waiting for archived turns');
}
$('turn-picker').onchange=()=>{reviewTurn=$('turn-picker').value;renderTurns(data.cases[wall]);updateField();};
$('gallery-filter').onchange=()=>{if(data)renderGallery();};
function duration(seconds){
    if(seconds==null||!Number.isFinite(seconds))return '—';
    const m=Math.round(seconds/60),h=Math.floor(m/60);
    return h>=48?Math.floor(h/24)+' d '+h%24+' h':h+' h '+m%60+' min';
}
function shortUtc(t){return t?new Date(t).toISOString().slice(5,16).replace('T',' ')+' UTC':'—';}
function renderTime(c){
    const t=c.timing||{},g=data.timing||{};
    label('elapsed',duration(t.elapsedSeconds));label('step-time',t.rate?t.rate.secondsPerStep.toFixed(2)+' s':'—');
    label('remaining',duration(t.marchSecondsLeft));label('lined-eta',shortUtc(g.linedEarliest));label('both-eta',shortUtc(g.bothMarchEnd));
    label('lined-time-label',data.cases.lined.frame?'Lined run · logged start':'Lined run · earliest start');
    const basis=t.rate?'The recent rate covers '+fmt.format(t.rate.steps)+' root steps over '+duration(t.rate.observedSeconds)+'. ':'';
    label('time-note',basis+'Runtime covers sessions logged in this study. The forecast uses up to eight hours per phase, including checkpoint time. Lined estimates use rigid measurements until lined data arrive. Validation, handoff and offline rendering take additional time.');
}
const ringColors=['#195b50','#b04b39','#2d66a3','#82649a','#986127'];
function drawRings(){
    const el=$('rings'),c=data?.cases?.[wall],d=c?.frame?.duct,lines=d?.profiles;
    el.hidden=!lines;$('ring-key').replaceChildren();
    if(!lines){label('sound-label',c?.status==='queued'?'The lined run is queued.':'Awaiting recorded duct pressure.');return;}
    label('sound-label','Latest acquisition · '+(d.sampleTime*1000).toFixed(3)+' ms flow time · r = '+d.radius+' mm · range '+d.min.toFixed(1)+' to '+d.max.toFixed(1)+' Pa.');
    const s=setupCanvas(el);if(!s)return;
    const {ctx,w,h}=s,L=45,R=13,T=10,B=28,mx=data.scales.pressure;
    const X=v=>L+(w-L-R)*v/360,Y=v=>T+(h-B-T)*(mx-v)/(2*mx);
    ctx.textAlign='right';ctx.textBaseline='middle';
    for(const v of [-mx,-mx/2,0,mx/2,mx]){const y=Y(v);ctx.strokeStyle='#dce2db';ctx.beginPath();ctx.moveTo(L,y);ctx.lineTo(w-R,y);ctx.stroke();ctx.fillStyle='#536660';ctx.fillText(String(v),L-6,y);}
    ctx.textAlign='center';for(const a of [0,90,180,270,360])ctx.fillText(a+'°',Math.max(13,Math.min(w-15,X(a))),h-12);
    lines.forEach((row,j)=>{ctx.strokeStyle=ringColors[j];ctx.lineWidth=1.5;ctx.beginPath();[...row,row[0]].forEach((v,i)=>{if(i===0)ctx.moveTo(X(0),Y(v));else ctx.lineTo(X(i*360/row.length),Y(v));});ctx.stroke();
        const key=document.createElement('span');key.style.borderColor=ringColors[j];key.textContent='z = '+d.z[j]+' mm';$('ring-key').append(key);});
}
function releaseVideo(){
    mediaVersion++;const v=$('movie-view');v.pause();v.removeAttribute('src');v.load();v.hidden=true;
    if(mediaURL){URL.revokeObjectURL(mediaURL);mediaURL=null;}
}
$('viewer').addEventListener('close',releaseVideo);
async function openFigure(item){
    releaseVideo();const version=mediaVersion,base=figureBase,img=$('full-view'),v=$('movie-view');
    label('view-title',item.label);img.hidden=false;img.alt=item.label;img.src=base+item.file;
    label('view-status',item.video?'Loading '+(item.frames?fmt.format(item.frames)+' frames':'animation')+'…':'');
    const seq=item.sequence||[],slider=$('sequence-range');
    $('sequence').hidden=!seq.length;
    if(seq.length){
        slider.max=String(seq.length-1);slider.value='0';label('sequence-step','');
        slider.oninput=()=>{const k=Number(slider.value);v.pause();v.hidden=true;img.hidden=false;img.src=base+seq[k];label('sequence-step','Root '+fmt.format(item.firstStep+k*item.stepStride));};
    }
    $('viewer').showModal();
    if(!item.video)return;
    try{
        if(location.protocol==='file:'){v.src=base+item.video;}
        else{
            const res=await fetch(base+item.video,{credentials:'omit'});if(!res.ok)throw Error('Film not available');
            const buffer=await res.arrayBuffer();if(version!==mediaVersion)return;
            mediaURL=URL.createObjectURL(new Blob([buffer],{type:'video/mp4'}));v.src=mediaURL;
        }
        if(version!==mediaVersion)return;
        v.poster=base+item.file;v.hidden=false;img.hidden=true;
        label('view-status',(item.frames?fmt.format(item.frames)+' frames':'Animation')+(item.firstStep!=null&&item.lastStep!=null?' · root steps '+fmt.format(item.firstStep)+'–'+fmt.format(item.lastStep):''));
    }catch(e){if(version===mediaVersion)label('view-status','The film is temporarily unavailable. Please reopen it to retry.');}
}

new ResizeObserver(()=>{plotField();drawTrend();if(data)drawRings();}).observe(document.querySelector('.primary'));
new ResizeObserver(drawTrend).observe(document.querySelector('.chart-box'));
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-lastCheck>=3600000)poll();});
if(valid(data))render();
function checkNextHour(){
    const now=Date.now();
    let next=Math.floor(now/3600000)*3600000+5*60000;
    if(next<=now)next+=3600000;
    setTimeout(()=>{if(!document.hidden)poll();checkNextHour();},next-now);
}
poll();checkNextHour();

