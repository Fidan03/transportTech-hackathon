
(function(){
"use strict";
const D = window.__CROWDCAST_DATA__;
const M = D.meta, HOURS = Array.from({length:18},(_,i)=>i+6);
const R = {}; D.routes.forEach((r,i)=>{ r.idx=i; R[r.id]=r; });
const DEP = {}; D.depots.forEach(d=>DEP[d.id]=d);
const S = { tab:'plan', route:'all', cap:M.cap, thr:M.thr, win:'am', maxkm:M.max_km, cross:true,
  rejected:new Set(), approved:new Set(), t:510, scen:'base', layer:'load', view:'3d', dir:0,
  recDec:new Map(), log:[], liveUsed:{}, playing:false };
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const hhmm = m => { m=Math.max(0,Math.round(m)); return String(Math.floor(m/60)%24).padStart(2,'0')+':'+String(m%60).padStart(2,'0'); };
const fmt = (x,d=0)=> x==null||isNaN(x) ? '–' : Number(x).toLocaleString('az-AZ',{minimumFractionDigits:d,maximumFractionDigits:d});
const pct = x => fmt(100*x)+'%';
const esc = s => String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const hav=(a,b)=>{ const t=Math.PI/180, dl=(b[0]-a[0])*t, dn=(b[1]-a[1])*t; const h=Math.sin(dl/2)**2+Math.cos(a[0]*t)*Math.cos(b[0]*t)*Math.sin(dn/2)**2; return 2*6371*Math.asin(Math.sqrt(h)); };
const WIN = {}; M.windows.forEach(w=>WIN[w.id]=w);
const shortName = r => r.name.split('·')[1].trim();
const sel = () => S.route==='all' ? D.routes : [R[S.route]];
function normCdf(x){ const t=1/(1+0.2316419*Math.abs(x)); const d=0.3989423*Math.exp(-x*x/2); const p=d*t*(0.3193815+t*(-0.3565638+t*(1.781478+t*(-1.821256+t*1.330274)))); return x>0?1-p:p; }
let SIG=0.5;
const overShare = rho => rho<=0 ? 0 : 1-normCdf(Math.log(S.thr/rho)/SIG);

/* =========================================================
   PLAN (pipeline-dakı make_plan ilə eyni məntiq)
   ========================================================= */
function planStatus(){
  const st={};
  M.windows.forEach(w=>D.routes.forEach(r=>{ let need=0,have=0,rho=0;
    for(let h=w.h0;h<w.h1;h++){ const k=h-6;
      const dpl=[0,1].map(d=>r.fc.q50[d][k]+0.5*(r.fc.q90[d][k]-r.fc.q50[d][k]));
      const maxhw = w.id!=='mid'?M.max_hw_peak:M.max_hw_off;
      const hwReq=Math.min(maxhw,Math.max(M.min_hw,60*S.cap*S.thr/Math.max(Math.max(...dpl),1)));
      const cyc=r.cycle_fc[k]; need=Math.max(need,Math.ceil(cyc/hwReq-0.15)); have=Math.max(have,r.baseN[k]);
      const hwEff=Math.max(r.hw_sched[k],cyc/r.baseN[k]); rho=Math.max(rho,Math.max(...dpl)/(60/hwEff*S.cap)); }
    st[w.id+'|'+r.id]={need,have,bal:have-need,rho}; }));
  return st;
}
const safetyOf=have=>Math.max(M.safety,Math.round(M.safety_share*have));
function makePlan(){
  const st=planStatus(), transfers=[], unmet=[];
  M.windows.forEach(w=>{
    const depLeft={}; D.depots.forEach(d=>depLeft[d.id]=d.reserve);
    const donorLeft={}; D.routes.forEach(r=>donorLeft[r.id]=Math.max(0,st[w.id+'|'+r.id].bal-safetyOf(st[w.id+'|'+r.id].have)));
    const deficits=D.routes.filter(r=>st[w.id+'|'+r.id].bal<0).sort((a,b)=>st[w.id+'|'+b.id].rho-st[w.id+'|'+a.id].rho);
    deficits.forEach(r=>{ let want=-st[w.id+'|'+r.id].bal; const dest=r.term[r.peak_term[w.id]];
      const cands=D.depots.map(dp=>({km:hav([dp.lat,dp.lon],dest)*1.3,typ:'depot',src:dp.id}));
      if(S.cross) D.routes.forEach(o=>{ if(o.id===r.id||donorLeft[o.id]<=0) return; cands.push({km:Math.min(...o.term.map(t=>hav(t,dest)))*1.3,typ:'route',src:o.id}); });
      cands.sort((a,b)=>a.km-b.km||a.typ.localeCompare(b.typ)||a.src.localeCompare(b.src));
      for(const c of cands){ if(want<=0) break; if(c.km>S.maxkm) continue;
        const key=`${w.id}|${c.src}|${r.id}`; if(S.rejected.has(key)) continue;
        const avail=c.typ==='depot'?depLeft[c.src]:donorLeft[c.src]; const n=Math.min(want,avail); if(n<=0) continue;
        if(c.typ==='depot') depLeft[c.src]-=n; else donorLeft[c.src]-=n; want-=n;
        const mins=c.km/M.dead_kmh*60;
        transfers.push({key,w:w.id,typ:c.typ,src:c.src,dst:r.id,n,km:+c.km.toFixed(1),min:Math.round(mins),leave:w.h0*60-Math.round(mins)-5}); }
      if(want>0) unmet.push({w:w.id,route:r.id,n:want}); });
  });
  return {st,transfers,unmet};
}
let PLAN=makePlan();
function deltaAt(rid,k){ const h=k+6; let d=0;
  PLAN.transfers.forEach(t=>{ const w=WIN[t.w]; if(h<w.h0||h>=w.h1) return; if(t.dst===rid) d+=t.n; if(t.typ==='route'&&t.src===rid) d-=t.n; }); return d; }
function hwFor(r,k,delta){ const cyc=r.cycle_fc[k], hs=r.hw_sched[k], N0=r.baseN[k];
  if(delta===0) return Math.max(hs,cyc/N0);
  if(delta>0) return Math.max(M.min_hw,cyc/(N0+delta));
  return Math.max(hs,cyc/Math.max(1,N0+delta)); }
function hourMetrics(r,k,withPlan,q='q50'){
  const delta=withPlan?deltaAt(r.id,k):0, hw=hwFor(r,k,delta), cap=60/hw*S.cap;
  const cong=Math.max(0,r.cycle_fc[k]/r.cycle_free[k]-1), cv=0.3+0.3*cong;
  return [0,1].map(d=>{ const Dm=r.fc[q][d][k]; const rho=Dm/cap;
    return {rho,over:overShare(rho),wait:hw/2*(1+cv*cv),trips:60/hw,unmet:Math.max(0,Dm-cap),cap:cap*S.thr,D:Dm}; });
}
function aggregate(routes,h0,h1,withPlan){ let tr=0,ov=0,wt=0,wb=0,un=0;
  routes.forEach(r=>{ for(let h=h0;h<h1;h++){ hourMetrics(r,h-6,withPlan).forEach(m=>{ tr+=m.trips; ov+=m.over*m.trips; wt+=m.wait*m.D; wb+=m.D; un+=m.unmet; }); } });
  return {over:ov/tr,wait:wt/wb,unmet:un}; }

/* ---------- Tab 1 render ---------- */
function renderWinSeg(){ const b=document.getElementById('winseg');
  b.innerHTML=M.windows.map(w=>`<button data-w="${w.id}" aria-pressed="${w.id===S.win}">${w.name} ${String(w.h0).padStart(2,'0')}–${String(w.h1).padStart(2,'0')}</button>`).join('');
  b.querySelectorAll('button').forEach(x=>x.addEventListener('click',()=>{ S.win=x.dataset.w; renderPlan(); })); }

function renderPlanStrip(){
  const w=WIN[S.win], routes=sel(), ids=new Set(routes.map(r=>r.id));
  const st=PLAN.st;
  const prob=routes.filter(r=>st[w.id+'|'+r.id].bal<0);
  const short=prob.reduce((a,r)=>a-st[w.id+'|'+r.id].bal,0);
  const tr=PLAN.transfers.filter(t=>t.w===w.id&&ids.has(t.dst));
  const fromDep=tr.filter(t=>t.typ==='depot').reduce((a,t)=>a+t.n,0), fromRoute=tr.filter(t=>t.typ==='route').reduce((a,t)=>a+t.n,0);
  const un=PLAN.unmet.filter(u=>u.w===w.id&&ids.has(u.route)).reduce((a,u)=>a+u.n,0);
  const B=aggregate(routes,w.h0,w.h1,false), P=aggregate(routes,w.h0,w.h1,true);
  const worst=prob.slice().sort((a,b)=>st[w.id+'|'+a.id].bal-st[w.id+'|'+b.id].bal)[0];
  const items = S.route==='all' ? [
    ['Sabah problemli xətt', `${prob.length} <small>/ ${routes.length}</small>`, prob.length?`${w.name}: ən kəskini <b>xətt ${worst.id}</b> (${-st[w.id+'|'+worst.id].bal} avtobus çatmır)`:'Bu pəncərədə bütün xətlər balansdadır', prob.length?'crit':'ok'],
    ['Çatışmayan avtobus', `${short}`, short?`Plan bağlayır: <b>${fromDep+fromRoute}</b> (depodan ${fromDep}, başqa xətlərdən ${fromRoute}) · çatmır: <b>${un}</b>`:'Çatışmazlıq yoxdur', un?'warn':'ok'],
    ['Dolu reyslər (gözlənilən)', `${pct(B.over)}<span class="arrow">→</span>${pct(P.over)}`, `Plan ilə · orta gözləmə <b>${fmt(B.wait,1)} → ${fmt(P.wait,1)} dəq</b>`, P.over<B.over?'ok':''],
  ] : (()=>{ const r=routes[0], s=st[w.id+'|'+r.id];
    const inn=tr.reduce((a,t)=>a+t.n,0), out=PLAN.transfers.filter(t=>t.w===w.id&&t.typ==='route'&&t.src===r.id).reduce((a,t)=>a+t.n,0);
    return [
      [`Xətt ${r.id}: avtobus balansı`, s.bal<0?`${-s.bal} <small>çatmır</small>`:s.bal>0?`+${s.bal} <small>artıq</small>`:'0', `${w.name}: lazım ${s.need}, var ${s.have}`, s.bal<0?'crit':'ok'],
      ['Plan', inn?`+${inn} <small>gəlir</small>`:out?`−${out} <small>verir</small>`:'—', inn?`depodan ${fromDep}, başqa xətlərdən ${fromRoute}${un?` · çatmır ${un}`:''}`:out?'artıq avtobuslar çatışmayan xətlərə gedir':'dəyişiklik lazım deyil', un?'warn':'ok'],
      ['Dolu reyslər (gözlənilən)', `${pct(B.over)}<span class="arrow">→</span>${pct(P.over)}`, `orta gözləmə <b>${fmt(B.wait,1)} → ${fmt(P.wait,1)} dəq</b>`, P.over<=B.over?'ok':'warn'],
    ]; })();
  document.getElementById('planstrip').innerHTML=items.map(([l,v,d,c])=>`<div class="stat ${c}"><span class="label">${l}</span><span class="v">${v}</span><span class="d">${d}</span></div>`).join('');
}

function renderBoard(){
  const w=WIN[S.win], st=PLAN.st;
  document.getElementById('boardq').textContent=`${w.name} (${String(w.h0).padStart(2,'0')}:00–${String(w.h1).padStart(2,'0')}:00), ${D.meta.demo_label}. Ən çox çatışmazlığı olan xətlər yuxarıdadır.`;
  const rows=D.routes.slice().sort((a,b)=>st[w.id+'|'+a.id].bal-st[w.id+'|'+b.id].bal);
  const head='<thead><tr><th>Xətt</th><th>Tələb dəyişimi (yaz → sabah)</th><th>Lazım / var</th><th>Balans</th><th>Plan</th><th>Dolu reyslər</th></tr></thead>';
  const body=rows.map(r=>{ const s=st[w.id+'|'+r.id];
    const inn=PLAN.transfers.filter(t=>t.w===w.id&&t.dst===r.id), out=PLAN.transfers.filter(t=>t.w===w.id&&t.typ==='route'&&t.src===r.id);
    const un=PLAN.unmet.find(u=>u.w===w.id&&u.route===r.id);
    const grow=r.daily.q50/r.daily.h1-1;
    const plan = inn.length ? `<span class="delta" style="color:var(--ok)">+${inn.reduce((a,t)=>a+t.n,0)}</span> <span class="sub">${inn.map(t=>(t.typ==='depot'?'depo':'x.'+t.src)+' '+t.n).join(', ')}${un?` · çatmır ${un.n}`:''}</span>`
      : out.length ? `<span class="delta">−${out.reduce((a,t)=>a+t.n,0)}</span> <span class="sub">→ ${out.map(t=>'x.'+t.dst).join(', ')}</span>` : (un?`<span class="sub" style="color:var(--crit)">çatmır ${un.n}</span>`:'<span class="sub">—</span>');
    const B=aggregate([r],w.h0,w.h1,false), P=aggregate([r],w.h0,w.h1,true);
    const bal = s.bal<0?`<span class="bal crit">−${-s.bal} çatmır</span>`:s.bal>0?`<span class="bal ok">+${s.bal} artıq</span>`:'<span class="bal zero">balansda</span>';
    return `<tr data-r="${r.id}" class="${S.route===r.id?'sel':''}"><td><span class="rnum">${r.id}</span> <span class="sub">${esc(shortName(r))}</span></td>
      <td class="num">${grow>=0?'+':''}${fmt(grow*100)}%</td><td class="num">${s.need} / ${s.have}</td><td>${bal}</td><td>${plan}</td>
      <td class="num">${pct(B.over)} → <b>${pct(P.over)}</b></td></tr>`; }).join('');
  const t=document.getElementById('board'); t.innerHTML=head+'<tbody>'+body+'</tbody>';
  t.querySelectorAll('tr[data-r]').forEach(tr=>tr.addEventListener('click',()=>setRoute(tr.dataset.r)));
}

function srcName(t){ return t.typ==='depot' ? DEP[t.src].name : `Xətt ${t.src}`; }
function renderOrders(){
  const w=WIN[S.win], st=PLAN.st, box=document.getElementById('orders');
  const ids=new Set(sel().map(r=>r.id));
  const tr=PLAN.transfers.filter(t=>t.w===w.id&&(S.route==='all'||ids.has(t.dst)||(t.typ==='route'&&ids.has(t.src))));
  const un=PLAN.unmet.filter(u=>u.w===w.id&&(S.route==='all'||ids.has(u.route)));
  const rej=[...S.rejected].filter(k=>k.startsWith(w.id+'|'));
  document.getElementById('ordercount').textContent=`${tr.filter(t=>!S.approved.has(t.key)).length} gözləyir`;
  let html='';
  if(!tr.length&&!un.length) html='<div class="empty">Bu pəncərədə köçürmə lazım deyil — bütün xətlərdə avtobus kifayətdir.</div>';
  html+=tr.map(t=>{ const d=st[w.id+'|'+t.dst], r=R[t.dst]; const ok=S.approved.has(t.key);
    let srcWhy = t.typ==='depot' ? `${esc(DEP[t.src].name)}-da ehtiyat avtobus var.` : `Xətt ${t.src}-də bu saatlarda ${st[w.id+'|'+t.src].bal} avtobus artıqdır (doluluq ${pct(st[w.id+'|'+t.src].rho)}). ${safetyOf(st[w.id+'|'+t.src].have)} avtobus proqnoz xətasına qarşı ehtiyatda saxlanılır.`;
    return `<article class="item ${t.typ==='depot'?'':'ok'} ${ok?'decided':''}">
      <div class="meta"><span class="rnum">${t.typ==='depot'?'DEPO':t.src}</span><span>→</span><span class="rnum">${t.dst}</span><span class="pill info">${w.name}</span><span class="pill ${t.typ==='depot'?'warn':'ok'}">${t.typ==='depot'?'Depo ehtiyatı':'Xətlər arası'}</span></div>
      <h3>${esc(srcName(t))} → xətt ${t.dst}: ${t.n} avtobus, ${hhmm(t.leave)}-də yola salın</h3>
      <div class="why"><b>Niyə:</b> xətt ${t.dst}-də ${-d.bal} avtobus çatmır (doluluq ${pct(d.rho)}). ${srcWhy}</div>
      <div class="why"><b>Xərc:</b> boş yürüş ${fmt(t.km,1)} km ≈ ${t.min} dəq · cəmi ${fmt(t.km*t.n*2,1)} km (gediş-qayıdış)</div>
      ${ok?`<div class="meta"><span class="pill ok">Təsdiqləndi</span><button class="small" data-undo="${esc(t.key)}">Geri al</button></div>`:
      `<div class="act"><button class="primary" data-ok="${esc(t.key)}">Təsdiqlə</button><button data-no="${esc(t.key)}">Rədd et → alternativ</button><button data-r="${t.dst}">Xəttə bax</button></div>`}
    </article>`; }).join('');
  html+=un.map(u=>`<article class="item crit"><div class="meta"><span class="rnum">${u.route}</span><span class="pill crit">Çatmır</span><span class="pill info">${w.name}</span></div>
      <h3>Xətt ${u.route}: ${u.n} avtobus üçün mənbə tapılmadı</h3>
      <div class="why"><b>Variantlar:</b> maksimum boş yürüş məsafəsini artırın (indi ${S.maxkm} km) · tabloda və tətbiqdə sərnişinə məlumat verin · bu xətt üçün fleet artımını büdcə planına salın — bu, "çatışmayan infrastruktur" siqnalıdır.</div></article>`).join('');
  if(rej.length) html+=`<div class="empty">Rədd edilmiş ${rej.length} əmr: ${rej.map(k=>{ const [,s,d]=k.split('|'); return (DEP[s]?'depo':'x.'+s)+'→'+d; }).join(', ')}. <button class="small" id="clearrej">Bərpa et</button></div>`;
  box.innerHTML=html;
  box.querySelectorAll('[data-ok]').forEach(b=>b.addEventListener('click',()=>{ S.approved.add(b.dataset.ok); logPlan(b.dataset.ok,true); renderPlan(); }));
  box.querySelectorAll('[data-no]').forEach(b=>b.addEventListener('click',()=>{ S.rejected.add(b.dataset.no); S.approved.delete(b.dataset.no); logPlan(b.dataset.no,false); PLAN=makePlan(); renderPlan(); }));
  box.querySelectorAll('[data-undo]').forEach(b=>b.addEventListener('click',()=>{ S.approved.delete(b.dataset.undo); renderPlan(); }));
  box.querySelectorAll('[data-r]').forEach(b=>b.addEventListener('click',()=>setRoute(b.dataset.r)));
  const cr=document.getElementById('clearrej'); if(cr) cr.addEventListener('click',()=>{ S.rejected=new Set([...S.rejected].filter(k=>!k.startsWith(w.id+'|'))); PLAN=makePlan(); renderPlan(); });
}
function logPlan(key,ok){ const [w,s,d]=key.split('|'); S.log.unshift({t:null,title:`Plan · ${WIN[w].name}: ${DEP[s]?DEP[s].name:'xətt '+s} → xətt ${d}`,ok}); }

/* ---------- flow map (SVG) ---------- */
const SVGNS='http://www.w3.org/2000/svg';
const el=(tag,a,p)=>{ const n=document.createElementNS(SVGNS,tag); for(const k in a) n.setAttribute(k,a[k]); p&&p.appendChild(n); return n; };
const fproj=(()=>{ const pts=[]; D.routes.forEach(r=>r.shape.forEach(s=>s.forEach(p=>pts.push(p)))); D.depots.forEach(d=>pts.push([d.lat,d.lon]));
  const la0=Math.min(...pts.map(p=>p[0])),la1=Math.max(...pts.map(p=>p[0])),lo0=Math.min(...pts.map(p=>p[1])),lo1=Math.max(...pts.map(p=>p[1]));
  const k=Math.cos(40.4*Math.PI/180), W=1000-80, H=640-60, s=Math.min(W/((lo1-lo0)*k),H/(la1-la0)); const ox=(1000-(lo1-lo0)*k*s)/2, oy=(640-(la1-la0)*s)/2;
  return (la,lo)=>[ox+(lo-lo0)*k*s, oy+(la1-la)*s]; })();
function renderFlow(){
  const svg=document.getElementById('flow'); svg.innerHTML='';
  const w=WIN[S.win], st=PLAN.st, ink=css('--ink'), panel=css('--panel'), faint=css('--map-net');
  el('defs',{},svg).innerHTML=`<marker id="fa" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${css('--accent')}"/></marker>`;
  const tr=PLAN.transfers.filter(t=>t.w===w.id), givers=new Set(tr.filter(t=>t.typ==='route').map(t=>t.src));
  D.routes.forEach(r=>{ const s=st[w.id+'|'+r.id]; const col = s.bal<0?css('--crit'):givers.has(r.id)?css('--ok'):faint;
    const dim = S.route!=='all'&&S.route!==r.id;
    const pts=r.shape[0].filter((_,i)=>i%3===0).concat([r.shape[0].at(-1)]).map(p=>fproj(p[0],p[1]));
    const pl=el('polyline',{points:pts.map(p=>p.join(',')).join(' '),fill:'none',stroke:col,'stroke-width':S.route===r.id?5:(s.bal<0||givers.has(r.id)?3.2:2),'stroke-linejoin':'round','stroke-linecap':'round',opacity:dim?.25:.9},svg);
    pl.style.cursor='pointer'; pl.addEventListener('click',()=>setRoute(r.id)); el('title',{},pl).textContent=`Xətt ${r.id}: ${s.bal<0?(-s.bal)+' avtobus çatmır':s.bal>0?s.bal+' artıq':'balansda'}`;
    const [x,y]=fproj(r.term[1][0],r.term[1][1]); const g=el('g',{transform:`translate(${x},${y})`},svg); g.style.cursor='pointer'; g.addEventListener('click',()=>setRoute(r.id));
    el('rect',{x:-14,y:-10,width:28,height:19,rx:5,fill:s.bal<0?css('--crit'):ink,opacity:dim?.35:1},g);
    const t=el('text',{y:4,'text-anchor':'middle','font-size':12,'font-weight':600,'font-family':css('--f-mono'),fill:panel},g); t.textContent=r.id; });
  D.depots.forEach(dp=>{ const [x,y]=fproj(dp.lat,dp.lon); const g=el('g',{transform:`translate(${x},${y})`},svg);
    el('rect',{x:-9,y:-9,width:18,height:18,rx:4,fill:css('--accent')},g);
    const t=el('text',{x:13,y:4,'font-size':11.5,'font-weight':600,fill:ink,'paint-order':'stroke',stroke:panel,'stroke-width':3.5},g); t.textContent=dp.name.split(' (')[0]; });
  tr.forEach(t=>{ if(S.route!=='all'&&S.route!==t.dst&&S.route!==t.src) return;
    const dst=R[t.dst].term[R[t.dst].peak_term[t.w]];
    let src; if(t.typ==='depot') src=[DEP[t.src].lat,DEP[t.src].lon]; else { const o=R[t.src]; src=o.term.reduce((a,b)=>hav(a,dst)<hav(b,dst)?a:b); }
    const a=fproj(src[0],src[1]), b=fproj(dst[0],dst[1]); let dx=b[0]-a[0], dy=b[1]-a[1]; const L=Math.hypot(dx,dy);
    const mx=(a[0]+b[0])/2-dy*0.25-(L<8?24:0), my=(a[1]+b[1])/2+dx*0.25-(L<8?24:0);
    el('path',{d:`M${a[0]} ${a[1]} Q${mx} ${my} ${b[0]} ${b[1]}`,fill:'none',stroke:css('--accent'),'stroke-width':1.5+t.n*0.8,opacity:.85,'marker-end':'url(#fa)'},svg);
    const lx=0.25*a[0]+0.5*mx+0.25*b[0], ly=0.25*a[1]+0.5*my+0.25*b[1]; const g=el('g',{transform:`translate(${lx},${ly})`},svg);
    el('circle',{r:10,fill:panel,stroke:css('--accent'),'stroke-width':1.5},g); const tx=el('text',{y:4,'text-anchor':'middle','font-size':11.5,'font-weight':700,'font-family':css('--f-mono'),fill:ink},g); tx.textContent=t.n; });
  document.getElementById('flowq').textContent=`${w.name}: ${tr.length} köçürmə əmri. Xəttə və ya nişana klikləyin — filtr həmin xəttə keçir.`;
}

/* ---------- route detail ---------- */
let hourChart, histChart;
Chart.defaults.font.family=getComputedStyle(document.body).fontFamily;
function baseOpts(yTitle){ const g=css('--line'), m=css('--muted');
  return {responsive:true,maintainAspectRatio:false,animation:false,interaction:{mode:'index',intersect:false},
    plugins:{legend:{labels:{color:m,boxWidth:14,boxHeight:3,font:{size:11.5},filter:i=>!i.text.startsWith('_')}},tooltip:{filter:i=>!i.dataset.label.startsWith('_'),callbacks:{}}},
    scales:{x:{ticks:{color:m,font:{size:11}},grid:{display:false},border:{color:g}},y:{beginAtZero:true,ticks:{color:m,font:{size:11}},grid:{color:g},border:{display:false},title:{display:!!yTitle,text:yTitle,color:m,font:{size:11}}}}}; }
const tint=(v,a)=>`color-mix(in srgb, ${v} ${Math.round(a*100)}%, transparent)`;
function detailRoute(){ if(S.route!=='all') return R[S.route]; const w=WIN[S.win]; return D.routes.slice().sort((a,b)=>PLAN.st[w.id+'|'+a.id].bal-PLAN.st[w.id+'|'+b.id].bal)[0]; }
function renderDetail(){
  const r=detailRoute(), w=WIN[S.win], s=PLAN.st[w.id+'|'+r.id];
  document.getElementById('dtitle').innerHTML=`<span class="rnum">${r.id}</span> ${esc(shortName(r))}${S.route==='all'?' <span class="sub">(ən kəskin xətt — filtr ilə dəyişin)</span>':''}`;
  const grow=r.daily.q50/r.daily.h1-1, ks=[...Array(w.h1-w.h0).keys()].map(i=>w.h0-6+i);
  const cyc=Math.max(...ks.map(k=>r.cycle_fc[k])), cycT=Math.max(...ks.map(k=>r.cycle_typ[k]));
  const inn=PLAN.transfers.filter(t=>t.w===w.id&&t.dst===r.id), out=PLAN.transfers.filter(t=>t.w===w.id&&t.typ==='route'&&t.src===r.id), un=PLAN.unmet.find(u=>u.w===w.id&&u.route===r.id);
  const B=aggregate([r],w.h0,w.h1,false), P=aggregate([r],w.h0,w.h1,true);
  let v=`<b>${w.name}:</b> `;
  if(s.bal<0) v+=`<b>${-s.bal} avtobus çatmır</b> (lazım ${s.need}, var ${s.have}). Səbəb: sabahkı tələb yaz aylarından <b>${grow>=0?'+':''}${fmt(grow*100)}%</b> fərqlidir, cədvəl isə yazın tələbinə qurulub; tıxacla dövrə vaxtı ${fmt(cyc)} dəq (adi ${fmt(cycT)}). `;
  else if(s.bal>0) v+=`<b>${s.bal} avtobus artıqdır</b> (lazım ${s.need}, var ${s.have}) — tələb yazdan ${grow>=0?'+':''}${fmt(grow*100)}%. `;
  else v+='avtobus sayı tələbə uyğundur. ';
  if(inn.length) v+=`Plan: ${inn.map(t=>`${t.typ==='depot'?DEP[t.src].name:'xətt '+t.src} → ${t.n} avtobus`).join('; ')}${un?`; <b>${un.n} hələ də çatmır</b>`:''}. `;
  else if(out.length) v+=`Plan: ${out.map(t=>`xətt ${t.dst}-ə ${t.n}`).join(', ')} avtobus verir. `;
  else if(un) v+=`<b>Mənbə tapılmadı: ${un.n} avtobus çatmır.</b> `;
  v+=`Gözlənilən nəticə: dolu reyslər ${pct(B.over)} → ${pct(P.over)}, orta gözləmə ${fmt(B.wait,1)} → ${fmt(P.wait,1)} dəq.`;
  if(D.dq[r.id]&&D.dq[r.id].days) v+=` <span class="pill warn">Data keyfiyyəti: son 2 həftədə ${D.dq[r.id].days} gün anomal düşüş (−${fmt(D.dq[r.id].drop*100)}%) — proqnozda təmizləndi</span>`;
  document.getElementById('dverdict').innerHTML=v;
  // hourly chart: critical direction per hour
  const labels=HOURS.map(h=>String(h).padStart(2,'0'));
  const crit=HOURS.map((_,k)=>r.fc.q50[0][k]>=r.fc.q50[1][k]?0:1);
  const pick=q=>HOURS.map((_,k)=>r.fc[q][crit[k]][k]);
  const capB=HOURS.map((_,k)=>60/hwFor(r,k,0)*S.cap*S.thr), capP=HOURS.map((_,k)=>60/hwFor(r,k,deltaAt(r.id,k))*S.cap*S.thr);
  const ds=[
    {label:'_q90',data:pick('q90'),borderWidth:0,pointRadius:0,fill:false},
    {label:'Proqnoz intervalı (80%)',data:pick('q10'),borderWidth:0,pointRadius:0,backgroundColor:tint(css('--s1'),.15),fill:'-1'},
    {label:'İndiki cədvəl daşıya bilər',data:capB,borderColor:css('--faint'),borderDash:[5,4],borderWidth:2,pointRadius:0,stepped:'middle'},
    {label:'_eff',data:capP,borderWidth:0,pointRadius:0,stepped:'middle'},
    {label:'Planla daşıya bilər',data:capP.map((v,k)=>Math.abs(v-capB[k])>1||(k>0&&Math.abs(capP[k-1]-capB[k-1])>1)||(k<17&&Math.abs(capP[k+1]-capB[k+1])>1)?v:null),borderColor:css('--s3'),borderWidth:2.6,pointRadius:0,stepped:'middle'},
    {label:'Sabah gözlənilən sərnişin',data:pick('q50'),borderColor:css('--s1'),backgroundColor:css('--s1'),borderWidth:2.2,pointRadius:2.5,tension:.3,fill:{target:3,above:tint(css('--crit'),.22),below:'transparent'}},
    {label:'Faktiki (real gündəlik × saat profili)',data:pick('act'),borderColor:css('--s2'),backgroundColor:css('--s2'),showLine:false,pointRadius:3.2,pointStyle:'rectRot'},
  ];
  const o=baseOpts('sərnişin / saat (ən yüklü hissə)'); o.plugins.tooltip.callbacks.label=c=>`${c.dataset.label}: ${fmt(c.parsed.y)}`;
  if(!hourChart) hourChart=new Chart(document.getElementById('hourChart'),{type:'line',data:{labels,datasets:ds},options:o}); else { hourChart.data={labels,datasets:ds}; hourChart.options=o; hourChart.update(); }
  // real history
  const hl=r.hist.d, hv=r.hist.v; const h1=hl.map(()=>Math.round(r.daily.h1));
  const ds2=[{label:'Real gündəlik gediş',data:hv,borderColor:css('--s1'),backgroundColor:css('--s1'),borderWidth:1.6,pointRadius:hv.map((_,i)=>hl[i]==='09-28'?5:0),pointBackgroundColor:css('--s2'),tension:.2},
    {label:'Yaz ortalaması (cədvəl buna görə qurulub)',data:h1,borderColor:css('--faint'),borderDash:[5,4],borderWidth:1.6,pointRadius:0}];
  const o2=baseOpts('gediş / gün'); o2.scales.x.ticks.maxTicksLimit=8; o2.plugins.tooltip.callbacks.label=c=>`${c.dataset.label}: ${fmt(c.parsed.y)}`;
  if(!histChart) histChart=new Chart(document.getElementById('histChart'),{type:'line',data:{labels:hl,datasets:ds2},options:o2}); else { histChart.data={labels:hl,datasets:ds2}; histChart.options=o2; histChart.update(); }
  document.getElementById('histnote').innerHTML=`28 sentyabr üçün proqnoz <b>${fmt(r.daily.q50)}</b> gediş idi, real faktiki <b>${fmt(r.daily.act)}</b> oldu (${fmt(100*(r.daily.q50/r.daily.act-1))}%). Sentyabr ortalaması yazdan ${fmt(r.growth*100)}% fərqlidir.`;
}
function renderPlan(){ PLAN=makePlan(); renderWinSeg(); renderPlanStrip(); renderBoard(); renderOrders(); renderFlow(); renderDetail(); }

/* =========================================================
   2 · CANLI
   ========================================================= */
// decode compact sim: [dir, busIdx, extra, t0*10, (dArr, dwell, load, lb)*n]
const SC={};
for(const key of ['base','plan']){ SC[key]={};
  D.routes.forEach(r=>{ const pk=D.scen[key][r.id]; const trips=pk.trips.map((a,ti)=>{ const n=(a.length-4)/4; const arr=[],dep=[],load=[],lb=[]; let t=a[3]/10;
      for(let i=0;i<n;i++){ t+=a[4+i*4]/10; arr.push(t); t+=a[5+i*4]/10; dep.push(t); load.push(a[6+i*4]); lb.push(a[7+i*4]); }
      return {r:r.id,d:a[0],bus:pk.buses[a[1]],extra:a[2],arr,dep,load,lb,start:arr[0],end:dep[n-1]}; });
    SC[key][r.id]={trips,byDir:[0,1].map(d=>trips.filter(t=>t.d===d).sort((a,b)=>a.start-b.start))}; }); }
const cur=rid=>SC[S.scen][rid];
function schedHw(r,t){ const h=t/60; if(h>=21.5) return r.hw_late; if((h>=7&&h<10)||(h>=17&&h<20)) return r.hw_peak; return r.hw_mid; }
const lvl=o=>o>=S.thr?'crit':o>=0.6?'warn':'ok';
function busState(routes,t){ const out=[];
  routes.forEach(r=>cur(r.id).trips.forEach(tr=>{ if(t<tr.start||t>tr.end) return; let k=0; while(k+1<tr.arr.length&&tr.arr[k+1]<=t) k++;
    const st=r.stops[tr.d]; let pos=st[k], seg=null;
    if(t>tr.dep[k]&&k<st.length-1){ const f=(t-tr.dep[k])/Math.max(.01,tr.arr[k+1]-tr.dep[k]); pos=[st[k][0]+(st[k+1][0]-st[k][0])*f, st[k][1]+(st[k+1][1]-st[k][1])*f]; seg=k; }
    out.push({r,tr,pos,k,seg,load:k===st.length-1?0:tr.load[k]}); })); return out; }
function windowEv(rid,d,t0,t1){ const res=[]; cur(rid).byDir[d].forEach(tr=>{ if(tr.end<t0||tr.start>t1) return; tr.arr.forEach((ta,i)=>{ if(ta>=t0&&ta<=t1) res.push({tr,i,ta,load:tr.load[i],lb:tr.lb[i]}); }); }); return res; }
function departures(rid,d,i,t0,t1){ return cur(rid).byDir[d].map(tr=>({t:tr.dep[i],tr})).filter(x=>x.t!=null&&x.t>=t0&&x.t<=t1).sort((a,b)=>a.t-b.t); }
function waitAt(rid,d,i,t){ const dep=departures(rid,d,i,t-60,t); if(dep.length<2) return null; const h=[]; for(let k=1;k<dep.length;k++) h.push(dep[k].t-dep[k-1].t);
  const s=h.reduce((a,b)=>a+b,0), s2=h.reduce((a,b)=>a+b*b,0); return {ew:s2/(2*s),h,dep,gap:t-dep.at(-1).t}; }
function segRatios(r,d,t){ const ff=r.ff[d], sum=ff.map(()=>0), cnt=ff.map(()=>0);
  cur(r.id).byDir[d].forEach(tr=>{ if(tr.end<t-25||tr.start>t) return; for(let i=0;i+1<tr.arr.length;i++){ const b=tr.arr[i+1]; if(b>t||b<t-20) continue; sum[i]+=ff[i]/Math.max(.1,b-tr.dep[i]); cnt[i]++; } });
  return ff.map((_,i)=>cnt[i]?sum[i]/cnt[i]:null); }
function depotLeft(id,t){ let used=S.liveUsed[id]||0; if(S.scen==='plan') D.plan_default.transfers.forEach(p=>{ const w=WIN[p.w]; if(p.src_type==='depot'&&p.src===id&&t>=w.h0*60-30&&t<w.h1*60) used+=p.n; }); return Math.max(0,DEP[id].reserve-used); }
function routeNow(r,t){ const b=busState([r],t); const inS=b.length, over=b.filter(x=>x.load/S.cap>=S.thr).length;
  let ew=0,ww=0,lb=0; [0,1].forEach(d=>{ for(let i=0;i<r.stops[d].length-1;i++){ const w=waitAt(r.id,d,i,t); if(w){ ew+=w.ew; ww++; } const dep=departures(r.id,d,i,t-30,t); if(dep.length) lb+=dep.at(-1).tr.lb[i]; } });
  const avgLoad=b.length?b.reduce((a,x)=>a+x.load,0)/b.length/S.cap:0; return {inS,over,wait:ww?ew/ww:NaN,lb,avgLoad}; }

function liveStrip(){
  const routes=sel(); let inS=0,over=0,ew=0,n=0,lb=0,km=0,mins=0,jams=0;
  routes.forEach(r=>{ const s=routeNow(r,S.t); inS+=s.inS; over+=s.over; if(!isNaN(s.wait)){ ew+=s.wait; n++; } lb+=s.lb;
    [0,1].forEach(d=>{ const ratio=segRatios(r,d,S.t); jams+=ratio.filter(x=>x!=null&&x<0.45).length;
      cur(r.id).byDir[d].forEach(tr=>{ for(let i=0;i+1<tr.arr.length;i++){ const b=tr.arr[i+1]; if(b>S.t||b<S.t-20) continue; km+=r.seg_km[d][i]; mins+=b-tr.dep[i]; } }); }); });
  const spd=mins?km/(mins/60):NaN;
  const items=[
    ['Dolu avtobus indi',`${over} <small>/ ${inS}</small>`,`≥ ${Math.round(S.thr*100)}% dolu · xətdə ${inS} avtobus`,over>=Math.max(4,inS*0.15)?'crit':over?'warn':'ok'],
    ['Orta gözləmə',`${fmt(n?ew/n:NaN,1)} <small>dəq</small>`,'dayanacaqda, son 60 dəq',''],
    ['Dayanacaqda qalan',`${fmt(lb)} <small>nəfər</small>`,'son avtobus dolu gəldiyi üçün minə bilməyib',lb>=200?'crit':lb?'warn':'ok'],
    ['Orta sürət',`${fmt(spd,1)} <small>km/s</small>`,`sərbəst axın ${D.meta.service_start?22:22} km/s · tıxacda ${jams} seqment`,jams>=4?'crit':jams?'warn':'ok'],
  ];
  document.getElementById('livestrip').innerHTML=items.map(([l,v,d,c])=>`<div class="stat ${c}"><span class="label">${l}</span><span class="v">${v}</span><span class="d">${d}</span></div>`).join('');
}

// ---------- side panel: departures board or ranking ----------
function renderSide(){
  const box=document.getElementById('sidepanel');
  if(S.route==='all'){
    const rows=D.routes.map(r=>({r,s:routeNow(r,S.t)})).sort((a,b)=>(b.s.over/Math.max(1,b.s.inS))-(a.s.over/Math.max(1,a.s.inS))||b.s.lb-a.s.lb);
    box.innerHTML=`<div class="phead"><div><h2>Xətlər indi</h2><div class="q">Ən problemli xətt yuxarıdadır. Sətrə klikləyin — xəritə və tövsiyələr o xəttə fokuslanır.</div></div></div>
      <div class="tablewrap"><table class="board rank" style="min-width:0"><thead><tr><th>Xətt</th><th>Dolu</th><th>Gözləmə</th><th>Qalan</th></tr></thead><tbody>${rows.map(({r,s})=>`<tr data-r="${r.id}"><td><span class="rnum">${r.id}</span></td>
      <td><span class="bal ${s.over? (s.over/Math.max(1,s.inS)>=0.25?'crit':'zero'):'ok'}">${s.over}/${s.inS}</span></td><td class="num">${fmt(s.wait,1)} dəq</td><td class="num">${fmt(s.lb)}</td></tr>`).join('')}</tbody></table></div>`;
    box.querySelectorAll('tr[data-r]').forEach(tr=>tr.addEventListener('click',()=>setRoute(tr.dataset.r)));
    return;
  }
  const r=R[S.route];
  const board=d=>{ const next=cur(r.id).byDir[d].filter(tr=>tr.start>=S.t-1).slice(0,6);
    return `<div class="dep"><h3>${esc(r.tname[d])} → ${esc(r.tname[1-d])}</h3><table>${next.length?next.map(tr=>{ const mx=Math.max(...tr.load.slice(0,-1))/S.cap; const sh=schedHw(r,tr.start);
      return `<tr><td class="num">${hhmm(tr.start)}</td><td class="num">${esc(tr.bus)}${tr.extra?' <span class="pill ok">+plan</span>':''}</td><td><span class="bal ${lvl(mx)==='crit'?'crit':lvl(mx)==='warn'?'zero':'ok'}">${pct(mx)}</span></td></tr>`; }).join('')
      :'<tr><td>Bu saatdan sonra çıxış yoxdur</td></tr>'}</table></div>`; };
  const s=routeNow(r,S.t);
  box.innerHTML=`<div class="phead"><div><h2>Növbəti çıxışlar · xətt ${r.id}</h2><div class="q">Terminaldan çıxış vaxtı, avtobus və gözlənilən maksimal doluluq. Qırmızı reys üçün əlavə avtobus və ya short-turn düşünün.</div></div></div>
    <div class="deps">${board(0)}${board(1)}</div>
    <p class="note">İndi xətdə ${s.inS} avtobus; ${s.over} dolu; planlı interval ${schedHw(r,S.t)} dəq; depo: ${esc(DEP[r.depot].name)} — ehtiyat ${depotLeft(r.depot,S.t)}.</p>`;
}

// ---------- live recommendations ----------
function recommend(){
  const t=S.t, recs=[], bucket=Math.floor(t/30);
  sel().forEach(r=>[0,1].forEach(d=>{
    const st=r.stops[d], sh=schedHw(r,t), W=windowEv(r.id,d,t-45,t); if(!W.length) return;
    const per=new Map(); W.forEach(e=>{ if(e.i===st.length-1) return; const o=per.get(e.tr)||{max:0,at:0}; if(e.load>o.max){o.max=e.load;o.at=e.i;} per.set(e.tr,o); });
    const over=[...per.values()].filter(o=>o.max/S.cap>=S.thr), lb=W.reduce((a,e)=>a+e.lb,0);
    const ratio=segRatios(r,d,t), jam=ratio.map((x,i)=>x!=null&&x<0.4?i:-1).filter(i=>i>=0);
    if(jam.length>=2){ const after=Math.min(st.length-2,Math.max(...jam)+1), ws=waitAt(r.id,d,after,t);
      if(ws&&Math.max(...ws.h,ws.gap)>1.8*sh){ recs.push({id:`trf|${r.id}|${d}|${bucket}`,type:'trf',sev:'crit',r:r.id,
        title:`Xətt ${r.id} → ${r.tname[1-d]}: tıxac — əks istiqamətdə gedən 1 avtobusu tıxacdan sonrakı hissədə geri döndərin (short-turn)`,
        why:`${jam.length} seqmentdə sürət normalın ${fmt(100*Math.min(...jam.map(i=>ratio[i])))}%-nə düşüb. Tıxacdan sonrakı dayanacaqda son avtobusdan ${fmt(ws.gap)} dəq keçib (planlı ${sh} dəq).`,
        impact:'Depodan çıxan yeni avtobus da həmin tıxaca düşər. Short-turn tıxacdan sonrakı hissəni dərhal xidmətlə təmin edir. Paralel: DYP-yə avtobus zolağına nəzarət sorğusu.'}); return; } }
    if(over.length>=2){ const worst=over.reduce((a,b)=>b.max>a.max?b:a), left=depotLeft(r.depot,t);
      let src=null;
      if(left>0) src={typ:'depot',name:DEP[r.depot].name,km:hav([DEP[r.depot].lat,DEP[r.depot].lon],r.term[d])*1.3};
      else { const cands=D.routes.filter(o=>o.id!==r.id).map(o=>({o,s:routeNow(o,t),km:Math.min(...o.term.map(x=>hav(x,r.term[d])))*1.3})).filter(c=>c.s.inS>=4&&c.s.avgLoad<0.45&&c.km<=S.maxkm).sort((a,b)=>a.km-b.km);
        if(cands.length) src={typ:'route',name:'xətt '+cands[0].o.id,km:cands[0].km,load:cands[0].s.avgLoad}; }
      recs.push({id:`dsp|${r.id}|${d}|${bucket}`,type:src?(src.typ==='depot'?'dsp':'xfer'):'info',sev:(over.length>=3||lb>=30)?'crit':'warn',r:r.id,depot:r.depot,src,
        title: src ? `Xətt ${r.id} → ${r.tname[1-d]}: 1 avtobus göndərin (mənbə: ${src.name})` : `Xətt ${r.id}: ehtiyat yoxdur — sərnişinə məlumat verin`,
        why:`Son 45 dəq: ${over.length}/${per.size} reys ${Math.round(S.thr*100)}% həddini keçib, ən dolu reysdə ${worst.max} nəfər. Dolu avtobusa minə bilməmə halı: ${lb}.`+(src&&src.typ==='route'?` ${src.name}-də avtobuslar indi orta hesabla ${pct(src.load)} doludur.`:''),
        impact: src ? `Boş yürüş ${fmt(src.km,1)} km ≈ ${fmt(src.km/M.dead_kmh*60)} dəq. İnterval ${sh} → ~${fmt(sh*0.85,1)} dəq.` : 'Tabloda və tətbiqdə "növbəti avtobus daha boşdur" məlumatı; sabahkı plan üçün qeyd.'}); return; }
    let best=null; for(let i=1;i<st.length-2;i++){ const ws=waitAt(r.id,d,i,t); if(!ws||ws.h.length<2) continue;
      for(let j=1;j<ws.h.length;j++) if(ws.h[j]<0.35*sh&&ws.h[j-1]>1.6*sh){ const sc=ws.h[j-1]-ws.h[j]; if(!best||sc>best.sc) best={sc,i,bus:ws.dep[j+1].tr.bus,gap:ws.h[j],big:ws.h[j-1]}; } }
    if(best) recs.push({id:`hld|${r.id}|${best.bus}|${bucket}`,type:'hld',sev:'warn',r:r.id,title:`Xətt ${r.id}: ${best.bus} avtobusunu növbəti dayanacaqda ~${Math.min(3,Math.max(1,Math.round((best.big-best.gap)/3)))} dəq saxlayın`,
      why:`İki avtobus ${fmt(best.gap,1)} dəq fərqlə gedir, ondan əvvəlki boşluq ${fmt(best.big,1)} dəq (planlı ${sh} dəq).`,impact:'Avtobus əlavə etmədən intervallar bərabərləşir.'});
  }));
  const o={crit:0,warn:1}; return recs.sort((a,b)=>o[a.sev]-o[b.sev]);
}
function renderRecs(){ const recs=recommend(), box=document.getElementById('recs');
  document.getElementById('reccount').textContent=recs.filter(r=>!S.recDec.has(r.id)).length+' gözləyir';
  const typeTxt={trf:'Tıxac',dsp:'Depo ehtiyatı',xfer:'Xətlər arası',hld:'İnterval',info:'Məlumat'};
  if(!recs.length){ box.innerHTML='<div class="empty">Hazırda tövsiyə yoxdur. "Səhər pik" və ya "Qəza 18:15" düyməsini sınayın.</div>'; return; }
  const more=Math.max(0,recs.length-4);
  box.innerHTML=recs.slice(0,4).map(r=>{ const dec=S.recDec.get(r.id);
    return `<article class="item ${r.sev} ${dec?'decided':''}"><div class="meta"><span class="rnum">${r.r}</span><span class="pill ${r.sev}">${r.sev==='crit'?'Kritik':'Diqqət'}</span><span class="pill info">${typeTxt[r.type]}</span></div>
      <h3>${esc(r.title)}</h3><div class="why"><b>Niyə:</b> ${esc(r.why)}</div><div class="why"><b>Təsir:</b> ${esc(r.impact)}</div>
      ${dec?`<div class="meta"><span class="pill ${dec==='ok'?'ok':'crit'}">${dec==='ok'?'Təsdiqləndi':'Rədd edildi'} · ${hhmm(S.t)}</span></div>`:`<div class="act"><button class="primary" data-ok="${esc(r.id)}">Təsdiqlə</button><button data-no="${esc(r.id)}">Rədd et</button>${S.route==='all'?`<button data-r="${r.r}">Xəttə fokuslan</button>`:''}</div>`}</article>`; }).join('')
    +(more?`<div class="empty">+${more} daha az prioritetli tövsiyə</div>`:'');
  box.querySelectorAll('[data-ok],[data-no]').forEach(b=>b.addEventListener('click',()=>{ const id=b.dataset.ok||b.dataset.no, ok=!!b.dataset.ok, rec=recs.find(x=>x.id===id);
    S.recDec.set(id,ok?'ok':'no'); if(ok&&rec.type==='dsp') S.liveUsed[rec.depot]=(S.liveUsed[rec.depot]||0)+1; S.log.unshift({t:S.t,title:rec.title,ok}); renderLive(); }));
  box.querySelectorAll('[data-r]').forEach(b=>b.addEventListener('click',()=>setRoute(b.dataset.r))); }
function renderLog(){ const t=document.getElementById('log');
  t.innerHTML=S.log.length?'<tbody>'+S.log.slice(0,8).map(l=>`<tr><td class="num">${l.t==null?'gecə':hhmm(l.t)}</td><td>${esc(l.title)}</td><td><span class="pill ${l.ok?'ok':'crit'}">${l.ok?'Təsdiq':'Rədd'}</span></td></tr>`).join('')+'</tbody>'
    :'<tbody><tr><td style="color:var(--muted);border:0">Hələ qərar yoxdur. Planda və canlı rejimdə verilən hər qərar burada vaxtı ilə qalır.</td></tr></tbody>'; }

// ---------- load profile ----------
let loadChart;
function renderLoad(){ const p=document.getElementById('loadpanel'); if(S.route==='all'){ p.hidden=true; return; } p.hidden=false;
  const r=R[S.route], d=S.dir, st=r.stops[d], W=windowEv(r.id,d,S.t-60,S.t);
  const ds=document.getElementById('dirsel'); ds.innerHTML=[0,1].map(x=>`<option value="${x}">${esc(r.tname[x])} → ${esc(r.tname[1-x])}</option>`).join(''); ds.value=d;
  let km=0; const labels=st.map((_,i)=>{ const v=fmt(km,1)+' km'; km+=r.seg_km[d][i]||0; return v; });
  const avg=st.map((_,i)=>{ const x=W.filter(e=>e.i===i).map(e=>e.load); return x.length?Math.round(x.reduce((a,b)=>a+b,0)/x.length):0; });
  const mx=st.map((_,i)=>{ const x=W.filter(e=>e.i===i).map(e=>e.load); return x.length?Math.max(...x):null; });
  const o=baseOpts('nəfər'); o.plugins.tooltip.callbacks.label=c=>`${c.dataset.label}: ${fmt(c.parsed.y)} nəfər`;
  const data={labels,datasets:[{type:'bar',label:'Orta yük',data:avg,backgroundColor:avg.map(v=>css('--'+lvl(v/S.cap))),borderRadius:4,order:2},
    {type:'line',label:'Ən yüksək yük',data:mx,borderColor:css('--ink'),backgroundColor:css('--ink'),pointRadius:2.5,borderWidth:1.5,order:1},
    {type:'line',label:`Hədd (${Math.round(S.thr*100)}% × ${S.cap})`,data:st.map(()=>S.thr*S.cap),borderColor:css('--crit'),borderDash:[5,4],pointRadius:0,borderWidth:1.5,order:0}]};
  if(!loadChart) loadChart=new Chart(document.getElementById('loadChart'),{data,options:o}); else { loadChart.data=data; loadChart.options=o; loadChart.update(); }
  document.getElementById('loadq').textContent=`Xətt ${r.id}, ${hhmm(S.t-60)}–${hhmm(S.t)}. Üfüqi ox terminaldan məsafədir (dayanacaqlar trayektoriya boyunca hər ~1 km — təxmini).`; }

// ---------- deck.gl map ----------
let deckInst=null, deckOK=true;
const rgb=(v,a=255)=>{ const h=v.replace('#',''); const n=h.length===3?h.split('').map(c=>c+c).join(''):h; return [parseInt(n.slice(0,2),16),parseInt(n.slice(2,4),16),parseInt(n.slice(4,6),16),a]; };
function initDeck(){ if(deckInst||!deckOK) return;
  try{ if(!window.deck) throw new Error('deck.gl yüklənmədi');
    deckInst=new deck.DeckGL({container:'deckmap',initialViewState:{longitude:49.875,latitude:40.392,zoom:11.2,pitch:50,bearing:-18},controller:true,
      getTooltip:({object})=>object&&object.tip?{text:object.tip}:null, layers:[]});
  }catch(e){ deckOK=false; document.getElementById('deckmap').innerHTML='<div class="mapfail">Bu brauzerdə WebGL xəritəsi açılmadı. Sağdakı cədvəl və tövsiyələr işləyir.</div>'; } }
function focusMap(){ if(!deckInst) return; const cont=document.getElementById('deckmap'); let v;
  if(S.route==='all') v={longitude:49.875,latitude:40.392,zoom:11.2};
  else { const r=R[S.route], pts=r.stops[0].concat(r.stops[1]); const lo=pts.map(p=>p[1]), la=pts.map(p=>p[0]);
    try{ v=new deck.WebMercatorViewport({width:cont.clientWidth||800,height:cont.clientHeight||560}).fitBounds([[Math.min(...lo),Math.min(...la)],[Math.max(...lo),Math.max(...la)]],{padding:60}); v={longitude:v.longitude,latitude:v.latitude,zoom:Math.min(14,v.zoom)}; }catch(e){ v={longitude:(Math.min(...lo)+Math.max(...lo))/2,latitude:(Math.min(...la)+Math.max(...la))/2,zoom:12.3}; } }
  deckInst.setProps({initialViewState:{...v,pitch:S.view==='3d'?50:0,bearing:S.view==='3d'?-18:0,transitionDuration:600}}); }
function setView(){ if(!deckInst) return; const vs=deckInst.viewState||deckInst.props.initialViewState||{};
  deckInst.setProps({initialViewState:{...(deckInst.props.initialViewState),...vs,pitch:S.view==='3d'?50:0,bearing:S.view==='3d'?-18:0,transitionDuration:400}}); }
function drawDeck(){
  initDeck(); if(!deckInst) return;
  const net=rgb(css('--map-net')), ink=rgb(css('--ink')), routes=sel(), acc=rgb(css('--accent'));
  const L=[];
  L.push(new deck.PathLayer({id:'net',data:D.net,getPath:p=>p.map(x=>[x[1],x[0]]),getColor:net,widthUnits:'pixels',getWidth:1}));
  if(S.layer==='load'){
    L.push(new deck.PathLayer({id:'routes',data:D.routes,getPath:r=>r.shape[0].map(x=>[x[1],x[0]]),widthUnits:'pixels',
      getWidth:r=>S.route===r.id?5:2.5,getColor:r=>S.route==='all'||S.route===r.id?[...acc.slice(0,3),S.route===r.id?230:150]:[...net.slice(0,3),120],updateTriggers:{getWidth:S.route,getColor:[S.route,S.layer]}}));
  } else {
    const segs=[]; routes.forEach(r=>[0,1].forEach(d=>{ const ratio=segRatios(r,d,S.t), st=r.stops[d];
      for(let i=0;i+1<st.length;i++){ const x=ratio[i]; const c=x==null?[...net.slice(0,3),200]:x<0.45?rgb(css('--crit')):x<0.7?rgb(css('--warn')):rgb(css('--ok'));
        const off=(d===0?1:-1)*0.00012; segs.push({p:[[st[i][1]+off,st[i][0]+off],[st[i+1][1]+off,st[i+1][0]+off]],c,tip:`Xətt ${r.id} → ${r.tname[1-d]}: ${x==null?'son 20 dəq-də avtobus keçməyib':'sürət normalın '+Math.round(x*100)+'%-i'}`}); } }));
    L.push(new deck.PathLayer({id:'traffic',data:segs,getPath:s=>s.p,getColor:s=>s.c,widthUnits:'pixels',getWidth:4,pickable:true}));
  }
  const buses=busState(routes,S.t).map(b=>{ const o=b.load/S.cap, c=rgb(css('--'+lvl(o)));
    return {pos:[b.pos[1],b.pos[0]],load:b.load,c:S.layer==='load'?c:[...ink.slice(0,3),220],extra:b.tr.extra,tip:`${b.tr.bus} · xətt ${b.r.id} → ${b.r.tname[1-b.tr.d]}\nXəttə çıxıb: ${hhmm(b.tr.start)}\n${b.load} nəfər (${Math.round(o*100)}%)${b.tr.extra?'\nPlan üzrə əlavə avtobus':''}`}; });
  if(S.view==='3d') L.push(new deck.ColumnLayer({id:'buses3d',data:buses,diskResolution:12,radius:70,extruded:true,pickable:true,elevationScale:1,
    getPosition:b=>b.pos,getElevation:b=>40+b.load*16,getFillColor:b=>b.c,getLineColor:[0,0,0,0]}));
  else L.push(new deck.ScatterplotLayer({id:'buses2d',data:buses,getPosition:b=>b.pos,radiusUnits:'pixels',getRadius:6,getFillColor:b=>b.c,stroked:true,getLineColor:rgb(css('--panel')),lineWidthUnits:'pixels',getLineWidth:1.5,pickable:true}));
  L.push(new deck.ScatterplotLayer({id:'extra',data:buses.filter(b=>b.extra),getPosition:b=>b.pos,radiusUnits:'pixels',getRadius:11,filled:false,stroked:true,getLineColor:rgb(css('--s3')),lineWidthUnits:'pixels',getLineWidth:2}));
  const depots=D.depots.map(d=>({pos:[d.lon,d.lat],name:`${d.name.split(' (')[0]}: ${depotLeft(d.id,S.t)}`,tip:`${d.name}\nEhtiyat: ${depotLeft(d.id,S.t)} avtobus (sürücü ilə)`}));
  L.push(new deck.ScatterplotLayer({id:'depots',data:depots,getPosition:d=>d.pos,radiusUnits:'pixels',getRadius:8,getFillColor:acc,pickable:true}));
  const hubs=D.hubs.filter(h=>h.src!=='approx'||['28 May m/s','Koroğlu m/s'].includes(h.name)).map(h=>({pos:[h.lon,h.lat],name:h.name.replace('Bakı Beynalxalq Avtovağzal Kompleksi','Bakı Beynəlxalq Avtovağzal'),tip:h.name+(h.src==='approx'?'':' (AYNA)')}));
  L.push(new deck.TextLayer({id:'labels',data:depots.concat(hubs),getPosition:d=>d.pos,getText:d=>d.name,getSize:12,getColor:ink,getPixelOffset:[0,-16],characterSet:'auto',fontFamily:'system-ui, sans-serif',fontWeight:600,
    outlineWidth:3,outlineColor:rgb(css('--map-bg')),fontSettings:{sdf:true},billboard:true}));
  L.push(new deck.ScatterplotLayer({id:'hubs',data:hubs,getPosition:d=>d.pos,radiusUnits:'pixels',getRadius:5,getFillColor:[0,0,0,0],stroked:true,getLineColor:ink,lineWidthUnits:'pixels',getLineWidth:2,pickable:true}));
  deckInst.setProps({layers:L});
  document.getElementById('mapq').textContent=S.layer==='load'?'Hər sütun bir avtobusdur: hündürlüyü salondakı sərnişin sayı, rəngi doluluq səviyyəsidir. Sürüşdürün, fırladın, yaxınlaşdırın.':'Xəttin rəngi son 20 dəqiqədə avtobusların faktiki sürətidir (GPS). Tıxac üçün ayrıca sensor lazım deyil.';
  document.getElementById('maplegend').innerHTML=S.layer==='load'?`<span><i style="background:var(--ok)"></i>Normal (&lt; 60%)</span><span><i style="background:var(--warn)"></i>Sıx (60% – hədd)</span><span><i style="background:var(--crit)"></i>Hədd üstü (≥ ${Math.round(S.thr*100)}%)</span><span><i style="border:2px solid var(--s3);background:transparent"></i>Plan üzrə əlavə avtobus</span><span><i style="background:var(--accent)"></i>Depo (rəqəm = ehtiyat)</span><span>○ Hub (Avtovağzal — AYNA datası)</span>`
    :`<span><i class="bar" style="background:var(--ok)"></i>Sərbəst (≥ 70%)</span><span><i class="bar" style="background:var(--warn)"></i>Ləng (45–70%)</span><span><i class="bar" style="background:var(--crit)"></i>Tıxac (&lt; 45%)</span>`;
  document.getElementById('mapnote').textContent='Fon: opendata.az-dakı bütün avtobus trayektoriyaları. Peyk görüntüsü artifact təhlükəsizlik qaydalarına görə yüklənmir; real sistemdə Mapbox/Esri peyk qatı qoşulur.';
}

function renderLive(){ document.getElementById('clock').textContent=hhmm(S.t); drawDeck(); liveStrip(); renderSide(); renderRecs(); renderLog(); renderLoad(); }
function renderLiveFast(){ document.getElementById('clock').textContent=hhmm(S.t); drawDeck(); liveStrip(); }

/* ---------- wiring ---------- */
const rf=document.getElementById('routefilter');
rf.innerHTML=`<option value="all">Bütün xətlər (${D.routes.length})</option>`+D.routes.map(r=>`<option value="${r.id}">Xətt ${esc(r.name)}</option>`).join('');
function setRoute(id){ S.route=id; rf.value=id; S.dir=0; if(S.tab==='plan') renderPlan(); else { renderLive(); focusMap(); } try{ localStorage.setItem('cc-route',id); }catch(e){} }
rf.addEventListener('change',()=>setRoute(rf.value));
document.getElementById('daychip').textContent=`Demo: ${D.meta.demo_label} · plan ${D.meta.plan_made}`;
document.getElementById('maxkm').addEventListener('input',e=>{ S.maxkm=+e.target.value; document.getElementById('maxkmv').textContent=S.maxkm+' km'; renderPlan(); });
document.getElementById('cross').addEventListener('change',e=>{ S.cross=e.target.checked; renderPlan(); });
document.getElementById('approveall').addEventListener('click',()=>{ PLAN.transfers.forEach(t=>{ if(!S.approved.has(t.key)){ S.approved.add(t.key); logPlan(t.key,true); } }); renderPlan(); });
document.getElementById('cap').addEventListener('change',e=>{ S.cap=Math.max(40,Math.min(180,+e.target.value||100)); e.target.value=S.cap; S.approved.clear(); S.tab==='plan'?renderPlan():renderLive(); });
document.getElementById('thr').addEventListener('input',e=>{ S.thr=+e.target.value/100; document.getElementById('thrv').textContent=e.target.value+'%'; clearTimeout(window.__t); window.__t=setTimeout(()=>{ S.approved.clear(); S.tab==='plan'?renderPlan():renderLive(); },120); });
document.getElementById('dirsel').addEventListener('change',e=>{ S.dir=+e.target.value; renderLoad(); });
function setTime(t){ S.t=Math.max(365,Math.min(1405,t)); document.getElementById('tslider').value=Math.round(S.t); renderLive(); }
document.getElementById('tslider').addEventListener('input',e=>{ S.t=+e.target.value; renderLiveFast(); clearTimeout(window.__h); window.__h=setTimeout(renderLive,180); });
document.querySelectorAll('[data-jump]').forEach(b=>b.addEventListener('click',()=>setTime(+b.dataset.jump)));
const segWire=(id,attr,key,fn)=>document.querySelectorAll(`#${id} button`).forEach(b=>b.addEventListener('click',()=>{ S[key]=b.dataset[attr]; document.querySelectorAll(`#${id} button`).forEach(x=>x.setAttribute('aria-pressed',x===b)); fn(); }));
segWire('scenseg','s','scen',renderLive); segWire('layerseg','l','layer',renderLiveFast); segWire('viewseg','v','view',()=>{ setView(); drawDeck(); });
let timer=null,last=0;
document.getElementById('play').addEventListener('click',e=>{ S.playing=!S.playing; e.target.textContent=S.playing?'❚❚ Dayandır':'▶ Oynat';
  if(S.playing) timer=setInterval(()=>{ S.t=S.t>=1405?365:S.t+1; document.getElementById('tslider').value=S.t; renderLiveFast(); if(Math.abs(S.t-last)>=5){ last=S.t; renderSide(); renderRecs(); renderLoad(); } },220); else clearInterval(timer); });
function setTab(t){ S.tab=t; ['plan','live'].forEach(x=>{ document.getElementById('view-'+x).hidden=x!==t; document.getElementById('tab-'+x).setAttribute('aria-selected',x===t); });
  try{ localStorage.setItem('cc-tab',t); }catch(e){} if(t==='plan') renderPlan(); else { renderLive(); focusMap(); } }
document.getElementById('tab-plan').addEventListener('click',()=>setTab('plan'));
document.getElementById('tab-live').addEventListener('click',()=>setTab('live'));
const rerender=()=>S.tab==='plan'?renderPlan():renderLive();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change',rerender);
new MutationObserver(rerender).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
const BT=D.backtest;
document.getElementById('foot').innerHTML=`<b>Data:</b> gündəlik gediş sayları (65 BakuBus xətti, yanvar–sentyabr 2026) və trayektoriyalar opendata.az-dan realdır. Proqnoz xətası (WAPE): 14–27 sentyabr backtest — model ${fmt(BT.model_all,1)}%, sadə "keçən həftə" üsulu ${fmt(BT.naive_all,1)}%; demo günü (bütün şəbəkə) — model ${fmt(BT.demo_all.mape,1)}%, sadə üsul ${fmt(BT.demo_all.naive,1)}%. Saatlıq bölgü, tıxac, avtobus hərəkəti və depolar sintetik/illüstrativdir. Fleet fərziyyəsi: cədvəllər aprel–iyun tələbinə görə qurulub.`;
let start='plan'; try{ const sr=localStorage.getItem('cc-route'); if(sr&&(sr==='all'||R[sr])){ S.route=sr; rf.value=sr; } if(location.hash==='#live'||localStorage.getItem('cc-tab')==='live') start='live'; }catch(e){}
if(location.hash==='#plan') start='plan';
setTab(start);
window.__CC={PLAN:()=>PLAN,S,setSig:v=>{SIG=v;},agg:(ids,h0,h1,p)=>aggregate(ids.map(i=>R[i]),h0,h1,p)};
})();
