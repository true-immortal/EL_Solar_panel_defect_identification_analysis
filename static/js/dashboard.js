// SolarGuard Dashboard JS — Full Feature Set

const SEVERITY_COLORS = { Critical:'#FF3B30', High:'#FF6B35', Medium:'#FFCC00', Low:'#34C759', Good:'#34C759' };
const DEFECT_COLORS = {
  'Black Core':'#FF2D55','Crack':'#FF3B30','Finger':'#FF6B35','Fragment':'#FF0000',
  'Horizontal Dislocation':'#FF9500','Printing Error':'#FFCC00','Scratch':'#007AFF',
  'Short Circuit':'#BF5AF2','Star Crack':'#FF375F','Thick Line':'#34C759','Other Defect':'#636366'
};
const SEV_STYLE = {
  Critical:{bg:'rgba(255,59,48,0.15)',color:'#FF3B30',border:'rgba(255,59,48,0.3)'},
  High:{bg:'rgba(255,107,53,0.15)',color:'#FF6B35',border:'rgba(255,107,53,0.3)'},
  Medium:{bg:'rgba(255,204,0,0.15)',color:'#FFCC00',border:'rgba(255,204,0,0.3)'},
  Low:{bg:'rgba(52,199,89,0.15)',color:'#34C759',border:'rgba(52,199,89,0.3)'},
  Good:{bg:'rgba(52,199,89,0.1)',color:'#34C759',border:'rgba(52,199,89,0.2)'}
};
const STATUS_COLORS = {
  Pending:'#636366', Confirmed:'#FF9500', Scheduled:'#007AFF',
  'In Repair':'#BF5AF2', Repaired:'#34C759', Monitoring:'#FFCC00'
};

function healthColor(s){ return s>=80?'#34C759':s>=60?'#FFCC00':s>=40?'#FF9500':'#FF3B30'; }
function getDefectName(id){ return ['Black Core','Crack','Finger','Fragment','Horizontal Dislocation','Printing Error','Scratch','Short Circuit','Star Crack','Thick Line','Other Defect'][id]||`Class ${id}`; }
function fmt(n){ return n>=10000000?`₹${(n/10000000).toFixed(1)}Cr`:n>=100000?`₹${(n/100000).toFixed(1)}L`:n>=1000?`₹${(n/1000).toFixed(1)}K`:`₹${n}`; }

Chart.defaults.color='#555';
Chart.defaults.borderColor='rgba(255,255,255,0.06)';
Chart.defaults.font.family="'DM Mono', monospace";

let sessionData=null, charts={}, currentPanel=null, currentSessionId=null;

// ── INIT ──────────────────────────────────────────────────────────────────────
(async()=>{
  const params=new URLSearchParams(window.location.search);
  const sid=params.get('session');
  if(!sid){window.location.href='/';return;}
  currentSessionId=sid;
  const resp=await fetch(`/api/session/${sid}`);
  if(!resp.ok){window.location.href='/';return;}
  sessionData=await resp.json();
  renderAll();
})();

function renderAll(){
  renderTopbar();
  renderKPIs();
  renderHealthBar();
  renderSeverityDonut();
  renderDefectType();
  renderScatter();
  renderConfidenceChart();
  renderHeatmap();
  renderEfficiency();
  renderTable(sessionData.panels);
  renderInspectorList();
  renderFinancials();
  loadHistory();
  setupNav();
  setupConf();
  setupExports();
}

// ── TOPBAR ────────────────────────────────────────────────────────────────────
function renderTopbar(){
  const {summary,folder_name,conf_threshold}=sessionData;
  document.getElementById('sessionTitle').textContent=`${folder_name} — ${summary.total_panels} panels`;
  document.getElementById('sessionMeta').textContent=new Date().toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'})+` · Threshold: ${conf_threshold}`;
  const hv=document.getElementById('globalHealthValue');
  hv.textContent=summary.avg_health_score+'%';
  hv.style.color=healthColor(summary.avg_health_score);
  document.getElementById('confSlider').value=Math.round(conf_threshold*100);
  document.getElementById('confVal').textContent=conf_threshold;
}

// ── KPIs ──────────────────────────────────────────────────────────────────────
function animNum(id,target,suffix=''){
  const el=document.getElementById(id);
  if(!el)return;
  let v=0; const step=Math.ceil(target/40)||1;
  const t=setInterval(()=>{ v=Math.min(v+step,target); el.textContent=v+suffix; if(v>=target)clearInterval(t); },20);
}
function renderKPIs(){
  const s=sessionData.summary;
  animNum('kpiTotal',s.total_panels);
  animNum('kpiDefects',s.total_defects);
  animNum('kpiCritical',s.critical_panels);
  document.getElementById('kpiPower').textContent=s.total_power_loss_pct+'%';
}

// ── OVERVIEW CHARTS ───────────────────────────────────────────────────────────
function renderHealthBar(){
  const panels=sessionData.panels;
  const labels=panels.map(p=>p.filename.replace(/\.[^.]+$/,''));
  const scores=panels.map(p=>p.health_score);
  const colors=scores.map(healthColor);
  if(charts.hb)charts.hb.destroy();
  charts.hb=new Chart(document.getElementById('healthBarChart'),{
    type:'bar', data:{labels,datasets:[{label:'Health Score',data:scores,
      backgroundColor:colors.map(c=>c+'33'),borderColor:colors,borderWidth:1.5,borderRadius:4}]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>`Health: ${ctx.raw}% | Defects: ${panels[ctx.dataIndex].defect_count}`}}},
      scales:{y:{min:0,max:100,ticks:{callback:v=>v+'%'},grid:{color:'rgba(255,255,255,0.04)'}},
              x:{ticks:{maxRotation:45,font:{size:9}},grid:{display:false}}},
      onClick:(e,els)=>{if(els.length){openInspector(panels[els[0].index]);activateSection('inspector');}}}
  });
}

function renderSeverityDonut(){
  const dist=sessionData.summary.severity_distribution;
  const labels=Object.keys(dist).filter(k=>dist[k]>0);
  const data=labels.map(k=>dist[k]);
  const colors=labels.map(k=>SEVERITY_COLORS[k]||'#888');
  if(charts.sd)charts.sd.destroy();
  charts.sd=new Chart(document.getElementById('severityDonut'),{
    type:'doughnut',data:{labels,datasets:[{data,backgroundColor:colors.map(c=>c+'88'),borderColor:colors,borderWidth:2}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'68%',plugins:{legend:{position:'bottom',labels:{padding:12,boxWidth:10,font:{size:11}}}}}
  });
}

function renderDefectType(){
  const dist=sessionData.summary.defect_type_distribution;
  const entries=Object.entries(dist).sort((a,b)=>b[1]-a[1]);
  const labels=entries.map(e=>e[0]), data=entries.map(e=>e[1]);
  const colors=labels.map(l=>DEFECT_COLORS[l]||'#888');
  if(charts.dt)charts.dt.destroy();
  charts.dt=new Chart(document.getElementById('defectTypeChart'),{
    type:'bar',data:{labels,datasets:[{data,backgroundColor:colors.map(c=>c+'55'),borderColor:colors,borderWidth:1.5,borderRadius:4,borderSkipped:false}]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
      scales:{x:{grid:{color:'rgba(255,255,255,0.04)'},ticks:{stepSize:1}},y:{grid:{display:false},ticks:{font:{size:10}}}}}
  });
}

function renderScatter(){
  const panels=sessionData.panels;
  const colors=panels.map(p=>healthColor(p.health_score));
  if(charts.sc)charts.sc.destroy();
  charts.sc=new Chart(document.getElementById('scatterChart'),{
    type:'scatter',
    data:{datasets:[{label:'Panels',data:panels.map(p=>({x:p.defect_count,y:p.health_score})),
      backgroundColor:colors.map(c=>c+'88'),borderColor:colors,borderWidth:1.5,pointRadius:7,pointHoverRadius:10}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},
      tooltip:{callbacks:{label:ctx=>{const p=panels[ctx.dataIndex];return[`Panel: ${p.filename}`,`Defects: ${ctx.raw.x}`,`Health: ${ctx.raw.y}%`];}}}},
      scales:{x:{title:{display:true,text:'Defect Count',color:'#666',font:{size:11}},grid:{color:'rgba(255,255,255,0.04)'}},
              y:{title:{display:true,text:'Health Score (%)',color:'#666',font:{size:11}},min:0,max:100,grid:{color:'rgba(255,255,255,0.04)'}}},
      onClick:(e,els)=>{if(els.length){openInspector(panels[els[0].index]);activateSection('inspector');}}}
  });
}

// ── ANALYTICS CHARTS ──────────────────────────────────────────────────────────
function renderConfidenceChart(){
  const panels=sessionData.panels;
  const defectConfs={};
  panels.forEach(p=>(p.detections||[]).forEach(d=>{
    const nm=getDefectName(d.class_id);
    if(!defectConfs[nm])defectConfs[nm]=[];
    defectConfs[nm].push(d.confidence*100);
  }));
  const labels=Object.keys(defectConfs);
  if(!labels.length)return;
  const avg=labels.map(l=>(defectConfs[l].reduce((a,b)=>a+b,0)/defectConfs[l].length).toFixed(1));
  const colors=labels.map(l=>DEFECT_COLORS[l]||'#888');
  if(charts.conf)charts.conf.destroy();
  charts.conf=new Chart(document.getElementById('confidenceChart'),{
    type:'bar',data:{labels,datasets:[{label:'Avg Confidence %',data:avg,backgroundColor:colors.map(c=>c+'66'),borderColor:colors,borderWidth:1.5,borderRadius:4}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
      scales:{y:{min:0,max:100,ticks:{callback:v=>v+'%'},grid:{color:'rgba(255,255,255,0.04)'}},x:{grid:{display:false}}}}
  });
}

function renderHeatmap(){
  const panels=sessionData.panels;
  const names=['Black Core','Crack','Finger','Fragment','Horizontal Dislocation','Printing Error','Scratch','Short Circuit','Star Crack','Thick Line','Other Defect'];
  const co={};
  names.forEach(a=>{co[a]={};names.forEach(b=>co[a][b]=0);});
  panels.forEach(p=>{
    const types=new Set((p.detections||[]).map(d=>getDefectName(d.class_id)));
    const arr=Array.from(types);
    arr.forEach(a=>arr.forEach(b=>{if(co[a])co[a][b]=(co[a][b]||0)+1;}));
  });
  const active=names.filter(n=>panels.some(p=>(p.detections||[]).some(d=>getDefectName(d.class_id)===n)));
  if(active.length<2){document.getElementById('heatmapContainer').innerHTML='<p style="color:var(--text-3);font-size:12px;padding:20px">Not enough co-occurrence data</p>';return;}
  const maxV=Math.max(...active.flatMap(a=>active.filter(b=>a!==b).map(b=>co[a][b])),1);
  const sn=n=>n.length>9?n.slice(0,8)+'.':n;
  let html='<table class="heatmap-table"><thead><tr><th></th>';
  active.forEach(n=>html+=`<th title="${n}">${sn(n)}</th>`);
  html+='</tr></thead><tbody>';
  active.forEach(a=>{
    html+=`<tr><th style="text-align:left;padding-right:8px;font-size:9px;color:var(--text-3)">${sn(a)}</th>`;
    active.forEach(b=>{
      const val=co[a][b],alpha=a===b?0.08:val/maxV*0.85;
      const bg=a===b?'#333':`rgba(245,200,66,${alpha})`,tc=alpha>0.5?'#0a0a0a':'#888';
      html+=`<td style="background:${bg};color:${tc}">${val||''}</td>`;
    });
    html+='</tr>';
  });
  html+='</tbody></table>';
  document.getElementById('heatmapContainer').innerHTML=html;
}

function renderEfficiency(){
  const n=sessionData.summary.total_panels, d=sessionData.summary.total_defects;
  const manual=n*8, ai=n*1.5, saved=manual-ai, pct=Math.round(saved/manual*100);
  document.getElementById('efficiencyCard').innerHTML=`
    <div class="eff-row"><span class="eff-label">Manual Inspection</span><div class="eff-bar"><div class="eff-fill" style="width:100%;background:var(--red)"></div></div><span class="eff-value">${manual} min</span></div>
    <div class="eff-row"><span class="eff-label">AI-Assisted</span><div class="eff-bar"><div class="eff-fill" style="width:${(ai/manual*100).toFixed(0)}%;background:var(--green)"></div></div><span class="eff-value">${ai.toFixed(0)} min</span></div>
    <div class="eff-row"><span class="eff-label">Panels Analyzed</span><div class="eff-bar"><div class="eff-fill" style="width:100%;background:var(--blue)"></div></div><span class="eff-value">${n}</span></div>
    <div class="eff-row"><span class="eff-label">Defects Found</span><div class="eff-bar"><div class="eff-fill" style="width:${Math.min(d*5,100)}%;background:var(--orange)"></div></div><span class="eff-value">${d}</span></div>
    <div class="eff-summary">⚡ ${pct}% faster — ~${saved} minutes saved vs. manual inspection</div>`;
}

// ── TABLE ─────────────────────────────────────────────────────────────────────
function renderTable(panels, filter='all'){
  const filtered=filter==='all'?panels:panels.filter(p=>p.worst_severity===filter);
  const tbody=document.getElementById('panelTableBody');
  tbody.innerHTML=filtered.map(p=>{
    const sc=SEV_STYLE[p.worst_severity]||SEV_STYLE.Low;
    const stc=STATUS_COLORS[p.status||'Pending']||'#888';
    const top=Object.entries(p.defect_summary||{}).sort((a,b)=>b[1].count-a[1].count)[0];
    const rk=p.priority_rank<=3?`rank-${p.priority_rank}`:'';
    return `<tr onclick="openInspectorAndSwitch('${p.id}')">
      <td><span class="rank-badge ${rk}">${p.priority_rank}</span></td>
      <td><div class="panel-name" title="${p.filename}">${p.filename}</div></td>
      <td><div class="health-bar-cell"><div class="health-bar-mini"><div class="health-bar-fill" style="width:${p.health_score}%;background:${healthColor(p.health_score)}"></div></div><span class="health-num">${p.health_score}%</span></div></td>
      <td><span class="defect-count-badge" style="color:${p.defect_count>0?'var(--orange)':'var(--green)'}">${p.defect_count}</span></td>
      <td><span class="severity-tag" style="background:${sc.bg};color:${sc.color};border:1px solid ${sc.border}">${p.worst_severity}</span></td>
      <td style="font-family:var(--font-mono);font-size:12px;color:#FF9500">${p.power_loss_pct}%</td>
      <td style="font-family:var(--font-mono);font-size:12px">₹${p.repair_cost.toLocaleString('en-IN')}</td>
      <td><span class="${(p.repair_vs_replace?.verdict==='replace')?'verdict-replace':'verdict-repair'}">${(p.repair_vs_replace?.verdict==='replace')?'🔴 REPLACE':'🟢 REPAIR'}</span></td>
      <td><span class="status-pill" style="background:${stc}22;color:${stc};border:1px solid ${stc}44" onclick="event.stopPropagation();openStatusModal('${p.id}')">${p.status||'Pending'}</span></td>
      <td><button class="btn-inspect" onclick="event.stopPropagation();openInspectorAndSwitch('${p.id}')">Inspect →</button></td>
    </tr>`;
  }).join('');
  if(!filtered.length) tbody.innerHTML='<tr><td colspan="9" style="text-align:center;color:var(--text-3);padding:32px">No panels match this filter</td></tr>';
}

document.addEventListener('DOMContentLoaded',()=>{
  document.querySelectorAll('.filter-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      if(sessionData) renderTable(sessionData.panels, btn.dataset.filter);
    });
  });
});

// ── INSPECTOR ─────────────────────────────────────────────────────────────────
function renderInspectorList(){
  const list=document.getElementById('inspectorList');
  list.innerHTML=sessionData.panels.map(p=>{
    const sc=SEV_STYLE[p.worst_severity]||SEV_STYLE.Low;
    return `<div class="inspector-item" data-id="${p.id}" onclick="openInspector(getPanel('${p.id}'))">
      <div class="inspector-item-name" title="${p.filename}">${p.filename}</div>
      <div class="inspector-item-meta">
        <span class="severity-tag" style="font-size:9px;padding:2px 7px;background:${sc.bg};color:${sc.color};border:1px solid ${sc.border}">${p.worst_severity}</span>
        <span style="font-size:10px;color:var(--text-3);font-family:var(--font-mono)">${p.defect_count} def</span>
        <span style="font-size:10px;color:${healthColor(p.health_score)};font-family:var(--font-mono)">${p.health_score}%</span>
      </div>
    </div>`;
  }).join('');
  document.getElementById('inspectorSearch').addEventListener('input',e=>{
    const q=e.target.value.toLowerCase();
    document.querySelectorAll('.inspector-item').forEach(el=>{
      el.style.display=el.querySelector('.inspector-item-name').textContent.toLowerCase().includes(q)?'':'none';
    });
  });
}

window.getPanel=id=>sessionData.panels.find(p=>p.id===id);
window.openInspector=panel=>{
  if(!panel)return;
  currentPanel=panel;
  document.querySelectorAll('.inspector-item').forEach(el=>el.classList.toggle('active',el.dataset.id===panel.id));
  const sc=SEV_STYLE[panel.worst_severity]||SEV_STYLE.Low;
  const stc=STATUS_COLORS[panel.status||'Pending']||'#888';
  const rvr=panel.repair_vs_replace||{};
  const isReplace=rvr.verdict==='replace';
  const rvrColor=isReplace?'#FF3B30':'#34C759';
  const rvrBg=isReplace?'rgba(255,59,48,0.1)':'rgba(52,199,89,0.1)';
  const rvrBorder=isReplace?'rgba(255,59,48,0.25)':'rgba(52,199,89,0.25)';

  // Defect tags with repair method tooltip
  const tags=Object.entries(panel.defect_summary||{}).sort((a,b)=>b[1].count-a[1].count).map(([nm,inf])=>{
    const col=DEFECT_COLORS[nm]||'#888';
    const method=inf.repair_method||'';
    const costRange=inf.repair_cost_min?`₹${inf.repair_cost_min}–₹${inf.repair_cost_max}`:'';
    return `<span class="defect-tag" style="color:${col};border-color:${col}44;background:${col}11" title="${method}${costRange?' | '+costRange:''}">
      <span class="defect-tag-dot" style="background:${col}"></span>${nm} ×${inf.count} (${Math.round(inf.avg_confidence*100)}%)</span>`;
  }).join('');

  // Repair method list
  const methodsList=Object.entries(panel.defect_summary||{}).map(([nm,inf])=>{
    const col=DEFECT_COLORS[nm]||'#888';
    const costRange=inf.repair_cost_min?` — <span style="font-family:var(--font-mono);color:${col}">₹${inf.repair_cost_min}–₹${inf.repair_cost_max}</span>`:'';
    return `<div class="repair-method-item"><span class="defect-tag-dot" style="background:${col};margin-right:6px;flex-shrink:0"></span>
      <span style="color:var(--text-2);font-size:12px"><b style="color:${col}">${nm}:</b> ${inf.repair_method||'—'}${costRange}</span></div>`;
  }).join('');

  // Repair vs Replace reasons
  const rvrReasons=(rvr.reasons||[]).map(r=>`<li style="font-size:11px;color:var(--text-2);margin-bottom:3px">${r}</li>`).join('');

  document.getElementById('inspectorMain').innerHTML=`
    <div class="inspector-detail">
      <div class="inspector-img-wrap">
        <img id="inspectorImg" class="inspector-img" src="${panel.annotated_image}" alt="Panel">
        <div class="inspector-toggle">
          <button class="toggle-btn active" id="togA" onclick="toggleImg(true)">Annotated</button>
          <button class="toggle-btn" id="togO" onclick="toggleImg(false)">Original</button>
        </div>
      </div>
      <div class="inspector-info">
        <div class="info-block"><span class="info-key">Health Score</span><span class="info-val" style="color:${healthColor(panel.health_score)}">${panel.health_score}%</span></div>
        <div class="info-block"><span class="info-key">Power Loss</span><span class="info-val" style="color:#FF9500">${panel.power_loss_pct}%</span></div>
        <div class="info-block"><span class="info-key">Repair Cost</span><span class="info-val">₹${panel.repair_cost.toLocaleString('en-IN')}</span></div>
        <div class="info-block"><span class="info-key">Priority Rank</span><span class="info-val">#${panel.priority_rank}</span></div>
        <div class="info-block"><span class="info-key">Severity</span><span class="info-val" style="color:${sc.color}">${panel.worst_severity}</span></div>
        <div class="info-block"><span class="info-key">Status</span><span class="info-val status-pill" style="background:${stc}22;color:${stc};border:1px solid ${stc}44;cursor:pointer" onclick="openStatusModal('${panel.id}')">${panel.status||'Pending'}</span></div>

        ${panel.defect_count>0?`
        <!-- Repair vs Replace -->
        <div style="grid-column:span 6;background:${rvrBg};border:1px solid ${rvrBorder};border-radius:var(--r-sm);padding:10px 14px;">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
            <span style="font-size:10px;color:var(--text-3);font-family:var(--font-mono);text-transform:uppercase;letter-spacing:.8px">Recommendation</span>
            <span style="padding:2px 10px;border-radius:999px;font-size:11px;font-weight:700;font-family:var(--font-mono);background:${rvrBg};color:${rvrColor};border:1px solid ${rvrBorder}">${isReplace?'🔴 REPLACE':'🟢 REPAIR'}</span>
          </div>
          <p style="font-size:11px;color:var(--text-2);margin-bottom:4px">${rvr.action||'—'}</p>
          ${rvrReasons?`<ul style="padding-left:14px;margin:0">${rvrReasons}</ul>`:''}
        </div>

        <!-- Repair Method per defect -->
        ${methodsList?`
        <div style="grid-column:span 6;">
          <div style="font-size:9px;color:var(--text-3);font-family:var(--font-mono);text-transform:uppercase;letter-spacing:.8px;margin-bottom:6px">Factory Repair Methods</div>
          <div style="display:flex;flex-direction:column;gap:4px">${methodsList}</div>
        </div>`:''}

        ${tags?`<div class="defect-tags" style="grid-column:span 6">${tags}</div>`:''}
        `:'<div style="grid-column:span 6;color:var(--text-3);font-size:13px;text-align:center;padding:8px">✓ No defects detected on this panel</div>'}

        ${panel.notes?`<div class="info-block" style="grid-column:span 6"><span class="info-key">Notes</span><span style="font-size:12px;color:var(--text-2)">${panel.notes}</span></div>`:''}
      </div>
    </div>`;
};
window.toggleImg=ann=>{
  if(!currentPanel)return;
  document.getElementById('inspectorImg').src=ann?currentPanel.annotated_image:currentPanel.original_image;
  document.getElementById('togA').classList.toggle('active',ann);
  document.getElementById('togO').classList.toggle('active',!ann);
};
window.openInspectorAndSwitch=id=>{openInspector(getPanel(id));activateSection('inspector');};

// ── FINANCIAL SECTION ─────────────────────────────────────────────────────────
function renderFinancials(){
  const s=sessionData.summary, panels=sessionData.panels;
  document.getElementById('finPowerLoss').textContent=s.total_power_loss_pct+'%';
  document.getElementById('finRepairCost').textContent=fmt(s.total_repair_cost);
  document.getElementById('finRevLoss').textContent=fmt(s.total_annual_revenue_loss)+'/yr';
  const roi=s.total_repair_cost>0?((s.total_annual_revenue_loss/s.total_repair_cost)*100).toFixed(0)+'%':'N/A';
  document.getElementById('finRoi').textContent=roi;

  // Repair vs Replace summary card
  const replaceCount=s.replace_recommended||0;
  const repairCount=panels.filter(p=>p.defect_count>0).length-replaceCount;
  const rvrEl=document.getElementById('rvrSummary');
  if(rvrEl){
    const replacePanels=panels.filter(p=>p.repair_vs_replace?.verdict==='replace');
    rvrEl.innerHTML=`
      <div class="rvr-header">
        <div class="rvr-badge rvr-repair">🟢 REPAIR: ${repairCount} panel${repairCount!==1?'s':''}</div>
        <div class="rvr-badge rvr-replace">🔴 REPLACE: ${replaceCount} panel${replaceCount!==1?'s':''}</div>
      </div>
      <div class="rvr-cost-breakdown">
        <div class="rvr-cost-row"><span>Solar Cells</span><span>₹2,000 – ₹3,500</span></div>
        <div class="rvr-cost-row"><span>Glass + Encapsulation</span><span>₹1,200 – ₹2,500</span></div>
        <div class="rvr-cost-row"><span>Frame + Junction Box</span><span>₹800 – ₹1,500</span></div>
        <div class="rvr-cost-row"><span>Manufacturing + Assembly</span><span>₹800 – ₹2,000</span></div>
        <div class="rvr-cost-row rvr-cost-total"><span>Total Panel Replacement</span><span>₹4,800 – ₹9,500</span></div>
      </div>
      ${replacePanels.length?`<div style="margin-top:12px"><div style="font-size:10px;color:var(--text-3);font-family:var(--font-mono);text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px">Panels flagged for replacement</div>
        ${replacePanels.map(p=>`<div class="rvr-panel-row" onclick="openInspectorAndSwitch('${p.id}')">
          <span style="font-family:var(--font-mono);font-size:12px;color:var(--text)">${p.filename}</span>
          <span style="font-size:11px;color:var(--text-3)">Health: <b style="color:#FF3B30">${p.health_score}%</b></span>
          <span style="font-size:11px;color:var(--text-3)">Repair: <b>₹${p.repair_cost.toLocaleString('en-IN')}</b></span>
          <span class="btn-inspect" style="font-size:10px;padding:3px 8px">Inspect →</span>
        </div>`).join('')}
      </div>`:''}`;
  }

  // Power loss per panel
  const labels=panels.map(p=>p.filename.replace(/\.[^.]+$/,''));
  const losses=panels.map(p=>p.power_loss_pct);
  const cols=losses.map(l=>l>15?'#FF3B30':l>8?'#FF9500':l>3?'#FFCC00':'#34C759');
  if(charts.pl)charts.pl.destroy();
  charts.pl=new Chart(document.getElementById('powerLossChart'),{
    type:'bar',data:{labels,datasets:[{label:'Power Loss %',data:losses,backgroundColor:cols.map(c=>c+'55'),borderColor:cols,borderWidth:1.5,borderRadius:4}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
      scales:{y:{min:0,ticks:{callback:v=>v+'%'},grid:{color:'rgba(255,255,255,0.04)'}},x:{ticks:{maxRotation:45,font:{size:9}},grid:{display:false}}}}
  });

  // Repair cost by defect type
  const repairByType={};
  panels.forEach(p=>Object.entries(p.defect_summary||{}).forEach(([nm,inf])=>{
    repairByType[nm]=(repairByType[nm]||0)+inf.repair_cost*inf.count;
  }));
  const re=Object.entries(repairByType).sort((a,b)=>b[1]-a[1]).slice(0,8);
  if(charts.rc)charts.rc.destroy();
  charts.rc=new Chart(document.getElementById('repairCostChart'),{
    type:'doughnut',data:{labels:re.map(e=>e[0]),datasets:[{data:re.map(e=>Math.round(e[1])),
      backgroundColor:re.map(e=>(DEFECT_COLORS[e[0]]||'#888')+'88'),borderColor:re.map(e=>DEFECT_COLORS[e[0]]||'#888'),borderWidth:2}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'55%',plugins:{legend:{position:'bottom',labels:{padding:10,boxWidth:10,font:{size:10}}}}}
  });

  // Bubble: rank vs health, bubble size = repair cost
  if(charts.bb)charts.bb.destroy();
  charts.bb=new Chart(document.getElementById('bubbleChart'),{
    type:'bubble',
    data:{datasets:[{label:'Panels',data:panels.map(p=>({x:p.priority_rank,y:p.health_score,r:Math.max(4,Math.min(p.repair_cost/100,22))})),
      backgroundColor:panels.map(p=>(p.repair_vs_replace?.verdict==='replace'?'#FF3B30':healthColor(p.health_score))+'88'),
      borderColor:panels.map(p=>p.repair_vs_replace?.verdict==='replace'?'#FF3B30':healthColor(p.health_score)),borderWidth:1.5}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},
      tooltip:{callbacks:{label:ctx=>{const p=panels[ctx.dataIndex];const v=p.repair_vs_replace?.verdict||'repair';return[`${p.filename}`,`Health: ${p.health_score}%`,`Repair: ₹${p.repair_cost.toLocaleString('en-IN')}`,`Decision: ${v.toUpperCase()}`];}}}},
      scales:{x:{title:{display:true,text:'Priority Rank',color:'#666',font:{size:10}},grid:{color:'rgba(255,255,255,0.04)'}},
              y:{title:{display:true,text:'Health Score (%)',color:'#666',font:{size:10}},min:0,max:100,grid:{color:'rgba(255,255,255,0.04)'}}}}
  });
}

// ── HISTORY & TRENDS ──────────────────────────────────────────────────────────
async function loadHistory(){
  const resp=await fetch('/api/history');
  const sessions=await resp.json();
  const el=document.getElementById('historySessions');
  if(!sessions.length){el.innerHTML='<div class="loading-text">No previous sessions found</div>';return;}
  el.innerHTML=sessions.map(s=>{
    const d=new Date(s.timestamp).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'2-digit'});
    const hc=healthColor(s.avg_health);
    const active=s.id===currentSessionId?'active':'';
    return `<div class="history-sess-item ${active}" onclick="loadTrend('${s.id}')">
      <div class="hsi-name">${s.folder_name}</div>
      <div class="hsi-meta"><span>${d}</span><span style="color:${hc}">${s.avg_health}%</span><span>${s.total_defects} def</span></div>
    </div>`;
  }).join('');
  if(currentSessionId) loadTrend(currentSessionId);
}

window.loadTrend=async(sid)=>{
  document.querySelectorAll('.history-sess-item').forEach(el=>el.classList.toggle('active',el.onclick?.toString().includes(sid)));
  const resp=await fetch(`/api/history/${sid}/trend`);
  const trend=await resp.json();
  if(!trend.length)return;
  document.getElementById('trendLabel').textContent=`${trend.length} scans for folder: ${trend[0]?.folder_name||''}`;
  const labels=trend.map(t=>new Date(t.timestamp).toLocaleDateString('en-IN',{day:'numeric',month:'short'}));
  const healths=trend.map(t=>t.avg_health);
  if(charts.tr)charts.tr.destroy();
  charts.tr=new Chart(document.getElementById('trendChart'),{
    type:'line',data:{labels,datasets:[{label:'Avg Health %',data:healths,borderColor:'#F5C842',backgroundColor:'rgba(245,200,66,0.1)',
      tension:0.4,fill:true,pointRadius:5,pointBackgroundColor:'#F5C842'}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
      scales:{y:{min:0,max:100,ticks:{callback:v=>v+'%'},grid:{color:'rgba(255,255,255,0.04)'}},x:{grid:{display:false}}}}
  });
  const totalDefs=trend.map(t=>t.panels.reduce((a,p)=>a+p.defect_count,0));
  if(charts.dtr)charts.dtr.destroy();
  charts.dtr=new Chart(document.getElementById('defectTrendChart'),{
    type:'line',data:{labels,datasets:[{label:'Total Defects',data:totalDefs,borderColor:'#FF3B30',backgroundColor:'rgba(255,59,48,0.1)',
      tension:0.4,fill:true,pointRadius:5,pointBackgroundColor:'#FF3B30'}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
      scales:{y:{ticks:{stepSize:1},grid:{color:'rgba(255,255,255,0.04)'}},x:{grid:{display:false}}}}
  });
};

// ── STATUS MODAL ──────────────────────────────────────────────────────────────
let modalPanelId=null;
window.openStatusModal=id=>{
  const panel=getPanel(id);
  if(!panel)return;
  modalPanelId=id;
  document.getElementById('modalPanelName').textContent=panel.filename;
  document.getElementById('modalStatus').value=panel.status||'Pending';
  document.getElementById('modalNotes').value=panel.notes||'';
  document.getElementById('statusModal').style.display='flex';
};
window.closeModal=()=>{document.getElementById('statusModal').style.display='none';};
document.getElementById('statusModal')?.addEventListener('click',e=>{if(e.target===e.currentTarget)closeModal();});
document.getElementById('modalSaveBtn')?.addEventListener('click',async()=>{
  const status=document.getElementById('modalStatus').value;
  const notes=document.getElementById('modalNotes').value;
  await fetch(`/api/panel/${modalPanelId}/status`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status,notes})});
  closeModal();
  const panel=getPanel(modalPanelId);
  if(panel){panel.status=status;panel.notes=notes;}
  renderTable(sessionData.panels,document.querySelector('.filter-btn.active')?.dataset.filter||'all');
  if(currentPanel?.id===modalPanelId)openInspector(panel);
});

// ── CONFIDENCE SLIDER ─────────────────────────────────────────────────────────
function setupConf(){
  const slider=document.getElementById('confSlider');
  const val=document.getElementById('confVal');
  slider.addEventListener('input',()=>{ val.textContent=(slider.value/100).toFixed(2); });
  document.getElementById('rerunBtn').addEventListener('click', async ()=>{
    const newConf=parseFloat(val.textContent);
    if(!confirm(`Re-run analysis at threshold ${newConf}?\nThe same images already on the server will be re-processed.`)) return;
    const btn=document.getElementById('rerunBtn');
    btn.textContent='Running…'; btn.disabled=true;
    try {
      const resp=await fetch(`/api/reanalyze/${currentSessionId}`,{
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({conf_threshold:newConf})
      });
      if(!resp.ok) throw new Error(`Server error ${resp.status}`);
      const data=await resp.json();
      window.location.href=`/dashboard?session=${data.session_id}`;
    } catch(e) {
      alert('Re-run failed: '+e.message);
      btn.textContent='Re-run'; btn.disabled=false;
    }
  });
}

// ── EXPORTS ───────────────────────────────────────────────────────────────────
function setupExports(){
  document.getElementById('exportPdfBtn').addEventListener('click',()=>{
    window.open(`/api/report/${currentSessionId}/pdf`,'_blank');
  });
  document.getElementById('exportCsvBtn').addEventListener('click',()=>{
    window.open(`/api/report/${currentSessionId}/csv`,'_blank');
  });
}

// ── NAV ───────────────────────────────────────────────────────────────────────
function setupNav(){
  document.querySelectorAll('.nav-item').forEach(item=>{
    item.addEventListener('click',e=>{e.preventDefault();activateSection(item.dataset.section);});
  });
}
function activateSection(name){
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(i=>i.classList.remove('active'));
  document.getElementById(`section-${name}`)?.classList.add('active');
  document.querySelector(`[data-section="${name}"]`)?.classList.add('active');
  setTimeout(()=>Object.values(charts).forEach(c=>c.resize&&c.resize()),60);
}