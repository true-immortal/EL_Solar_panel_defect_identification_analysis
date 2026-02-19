// SolarGuard — Dashboard JS

const SEVERITY_COLORS = {
  Critical: '#FF3B30', High: '#FF6B35', Medium: '#FFCC00', Low: '#34C759', Good: '#34C759'
};

const DEFECT_COLORS = {
  'Black Core':              '#FF2D55',
  'Crack':                   '#FF3B30',
  'Finger':                  '#FF6B35',
  'Fragment':                '#FF0000',
  'Horizontal Dislocation':  '#FF9500',
  'Printing Error':          '#FFCC00',
  'Scratch':                 '#007AFF',
  'Short Circuit':           '#BF5AF2',
  'Star Crack':              '#FF375F',
  'Thick Line':              '#34C759',
  'Other Defect':            '#636366',
};

const SEVERITY_LABEL_COLORS = {
  Critical: { bg: 'rgba(255,59,48,0.15)', color: '#FF3B30', border: 'rgba(255,59,48,0.3)' },
  High: { bg: 'rgba(255,107,53,0.15)', color: '#FF6B35', border: 'rgba(255,107,53,0.3)' },
  Medium: { bg: 'rgba(255,204,0,0.15)', color: '#FFCC00', border: 'rgba(255,204,0,0.3)' },
  Low: { bg: 'rgba(52,199,89,0.15)', color: '#34C759', border: 'rgba(52,199,89,0.3)' },
  Good: { bg: 'rgba(52,199,89,0.12)', color: '#34C759', border: 'rgba(52,199,89,0.25)' }
};

function healthColor(score) {
  if (score >= 80) return '#34C759';
  if (score >= 60) return '#FFCC00';
  if (score >= 40) return '#FF9500';
  return '#FF3B30';
}

Chart.defaults.color = '#666';
Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
Chart.defaults.font.family = "'DM Mono', monospace";

let sessionData = null;
let charts = {};
let currentInspectorPanel = null;

// ---- INIT ----
(async () => {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session');
  if (!sessionId) { window.location.href = '/'; return; }

  const resp = await fetch(`/api/session/${sessionId}`);
  if (!resp.ok) { window.location.href = '/'; return; }
  sessionData = await resp.json();
  renderDashboard();
})();

function renderDashboard() {
  const { panels, summary } = sessionData;

  // Topbar
  document.getElementById('sessionTitle').textContent =
    `Analysis — ${summary.total_panels} panels scanned`;
  document.getElementById('sessionMeta').textContent =
    new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

  const h = summary.avg_health_score;
  const hv = document.getElementById('globalHealthValue');
  hv.textContent = h + '%';
  hv.style.color = healthColor(h);

  // KPIs
  animNum('kpiTotal', summary.total_panels);
  animNum('kpiDefects', summary.total_defects);
  animNum('kpiCritical', summary.critical_panels);
  animNum('kpiHealthy', summary.healthy_panels);

  // Charts
  renderHealthBar(panels);
  renderSeverityDonut(summary.severity_distribution);
  renderDefectType(summary.defect_type_distribution);
  renderScatter(panels);
  renderConfidenceChart(panels);
  renderHeatmap(panels);
  renderEfficiency(summary);

  // Table
  renderTable(panels);
  setupFilters(panels);

  // Inspector
  renderInspectorList(panels);

  // Navigation
  setupNav();

  // Export
  document.getElementById('exportBtn').addEventListener('click', () => exportReport());
}

function animNum(id, target) {
  const el = document.getElementById(id);
  let start = 0;
  const step = Math.ceil(target / 40);
  const timer = setInterval(() => {
    start = Math.min(start + step, target);
    el.textContent = start;
    if (start >= target) clearInterval(timer);
  }, 20);
}

// ---- CHARTS ----
function renderHealthBar(panels) {
  const labels = panels.map(p => p.filename.replace(/\.[^.]+$/, ''));
  const scores = panels.map(p => p.health_score);
  const colors = scores.map(s => healthColor(s));

  if (charts.healthBar) charts.healthBar.destroy();
  charts.healthBar = new Chart(document.getElementById('healthBarChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Health Score',
        data: scores,
        backgroundColor: colors.map(c => c + '33'),
        borderColor: colors,
        borderWidth: 1.5,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` Health: ${ctx.raw}% | Defects: ${panels[ctx.dataIndex].defect_count}`
          }
        }
      },
      scales: {
        y: {
          min: 0, max: 100,
          ticks: { callback: v => v + '%', stepSize: 20 },
          grid: { color: 'rgba(255,255,255,0.04)' }
        },
        x: {
          ticks: { maxRotation: 45, font: { size: 10 } },
          grid: { display: false }
        }
      },
      onClick: (e, els) => {
        if (els.length) {
          const panel = panels[els[0].index];
          openInspector(panel);
          activateSection('inspector');
        }
      }
    }
  });
}

function renderSeverityDonut(dist) {
  const labels = Object.keys(dist).filter(k => dist[k] > 0);
  const data = labels.map(k => dist[k]);
  const colors = labels.map(k => SEVERITY_COLORS[k] || '#888');

  if (charts.severityDonut) charts.severityDonut.destroy();
  charts.severityDonut = new Chart(document.getElementById('severityDonut'), {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors.map(c => c + '88'),
        borderColor: colors,
        borderWidth: 2,
        hoverBorderWidth: 3
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '68%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { padding: 12, boxWidth: 10, font: { size: 11 } }
        }
      }
    }
  });
}

function renderDefectType(dist) {
  const entries = Object.entries(dist).sort((a, b) => b[1] - a[1]);
  const labels = entries.map(e => e[0]);
  const data = entries.map(e => e[1]);
  const colors = labels.map(l => DEFECT_COLORS[l] || '#888');

  if (charts.defectType) charts.defectType.destroy();
  charts.defectType = new Chart(document.getElementById('defectTypeChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors.map(c => c + '55'),
        borderColor: colors,
        borderWidth: 1.5,
        borderRadius: 4,
        borderSkipped: false
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { stepSize: 1 } },
        y: { grid: { display: false }, ticks: { font: { size: 10 } } }
      }
    }
  });
}

function renderScatter(panels) {
  const data = panels.map(p => ({ x: p.defect_count, y: p.health_score, panel: p }));
  const colors = data.map(d => healthColor(d.y));

  if (charts.scatter) charts.scatter.destroy();
  charts.scatter = new Chart(document.getElementById('scatterChart'), {
    type: 'scatter',
    data: {
      datasets: [{
        label: 'Panels',
        data: data.map(d => ({ x: d.x, y: d.y })),
        backgroundColor: colors.map(c => c + '88'),
        borderColor: colors,
        borderWidth: 1.5,
        pointRadius: 7,
        pointHoverRadius: 10
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const p = panels[ctx.dataIndex];
              return [`Panel: ${p.filename}`, `Defects: ${ctx.raw.x}`, `Health: ${ctx.raw.y}%`];
            }
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: 'Defect Count', color: '#666', font: { size: 11 } },
          grid: { color: 'rgba(255,255,255,0.04)' }
        },
        y: {
          title: { display: true, text: 'Health Score (%)', color: '#666', font: { size: 11 } },
          min: 0, max: 100,
          grid: { color: 'rgba(255,255,255,0.04)' }
        }
      }
    }
  });
}

function renderConfidenceChart(panels) {
  const defectConfs = {};
  panels.forEach(p => {
    (p.detections || []).forEach(d => {
      const name = getDefectName(d.class_id);
      if (!defectConfs[name]) defectConfs[name] = [];
      defectConfs[name].push(d.confidence * 100);
    });
  });

  const labels = Object.keys(defectConfs);
  const avgConfs = labels.map(l => (defectConfs[l].reduce((a,b) => a+b, 0) / defectConfs[l].length).toFixed(1));
  const minConfs = labels.map(l => Math.min(...defectConfs[l]).toFixed(1));
  const maxConfs = labels.map(l => Math.max(...defectConfs[l]).toFixed(1));
  const colors = labels.map(l => DEFECT_COLORS[l] || '#888');

  if (charts.confidence) charts.confidence.destroy();
  charts.confidence = new Chart(document.getElementById('confidenceChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Avg Confidence',
          data: avgConfs,
          backgroundColor: colors.map(c => c + '66'),
          borderColor: colors,
          borderWidth: 1.5,
          borderRadius: 4
        },
        {
          label: 'Min',
          data: minConfs,
          backgroundColor: 'transparent',
          borderColor: colors.map(c => c + '44'),
          borderWidth: 1,
          type: 'line',
          pointRadius: 3
        },
        {
          label: 'Max',
          data: maxConfs,
          backgroundColor: 'transparent',
          borderColor: colors,
          borderWidth: 1,
          type: 'line',
          pointRadius: 3
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top', labels: { font: { size: 11 }, boxWidth: 10 } } },
      scales: {
        y: {
          min: 0, max: 100,
          ticks: { callback: v => v + '%' },
          grid: { color: 'rgba(255,255,255,0.04)' }
        },
        x: { grid: { display: false } }
      }
    }
  });
}

function getDefectName(id) {
  const names = [
    'Black Core', 'Crack', 'Finger', 'Fragment', 'Horizontal Dislocation',
    'Printing Error', 'Scratch', 'Short Circuit', 'Star Crack', 'Thick Line', 'Other Defect'
  ];
  return names[id] !== undefined ? names[id] : `Class ${id}`;
}

function renderHeatmap(panels) {
  const defectNames = ['Crack','Hotspot','Delamination','Bypass Diode','Cell Defect','Micro-crack','Soiling','Corrosion'];
  const coOccurrence = {};
  defectNames.forEach(a => {
    coOccurrence[a] = {};
    defectNames.forEach(b => coOccurrence[a][b] = 0);
  });

  panels.forEach(p => {
    const types = new Set((p.detections || []).map(d => getDefectName(d.class_id)));
    const arr = Array.from(types);
    arr.forEach(a => arr.forEach(b => {
      if (coOccurrence[a]) coOccurrence[a][b] = (coOccurrence[a][b] || 0) + 1;
    }));
  });

  // Only show defects that appear in data
  const activeDefects = defectNames.filter(name =>
    panels.some(p => (p.detections || []).some(d => getDefectName(d.class_id) === name))
  );

  if (activeDefects.length < 2) {
    document.getElementById('heatmapContainer').innerHTML =
      '<p style="color:var(--text-3);font-size:12px;padding:20px">Not enough co-occurrence data</p>';
    return;
  }

  const maxVal = Math.max(...activeDefects.flatMap(a =>
    activeDefects.filter(b => a !== b).map(b => coOccurrence[a][b])
  ), 1);

  const shortName = n => n.length > 8 ? n.slice(0,7) + '.' : n;

  let html = '<table class="heatmap-table"><thead><tr><th></th>';
  activeDefects.forEach(n => html += `<th title="${n}">${shortName(n)}</th>`);
  html += '</tr></thead><tbody>';
  activeDefects.forEach(a => {
    html += `<tr><th style="text-align:left;padding-right:8px;font-size:9px;color:var(--text-3)">${shortName(a)}</th>`;
    activeDefects.forEach(b => {
      const val = coOccurrence[a][b];
      const intensity = val / maxVal;
      const alpha = a === b ? 0.08 : intensity * 0.85;
      const color = a === b ? '#444' : `rgba(245,200,66,${alpha})`;
      const textColor = alpha > 0.5 ? '#0a0a0a' : '#888';
      html += `<td style="background:${color};color:${textColor}">${val || ''}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  document.getElementById('heatmapContainer').innerHTML = html;
}

function renderEfficiency(summary) {
  const n = summary.total_panels;
  const d = summary.total_defects;
  const manualTime = n * 8; // 8 min per panel manual
  const aiTime = n * 1.5; // 1.5 min per panel with AI
  const savedTime = manualTime - aiTime;
  const savedPct = Math.round((savedTime / manualTime) * 100);

  const container = document.getElementById('efficiencyCard');
  container.innerHTML = `
    <div class="eff-row">
      <span class="eff-label">Manual Inspection</span>
      <div class="eff-bar"><div class="eff-fill" style="width:100%;background:var(--red);"></div></div>
      <span class="eff-value">${manualTime} min</span>
    </div>
    <div class="eff-row">
      <span class="eff-label">AI-Assisted</span>
      <div class="eff-bar"><div class="eff-fill" style="width:${(aiTime/manualTime*100).toFixed(0)}%;background:var(--green);"></div></div>
      <span class="eff-value">${aiTime.toFixed(0)} min</span>
    </div>
    <div class="eff-row">
      <span class="eff-label">Panels Analyzed</span>
      <div class="eff-bar"><div class="eff-fill" style="width:100%;background:var(--blue);"></div></div>
      <span class="eff-value">${n}</span>
    </div>
    <div class="eff-row">
      <span class="eff-label">Defects Found</span>
      <div class="eff-bar"><div class="eff-fill" style="width:${Math.min(d * 5, 100)}%;background:var(--orange);"></div></div>
      <span class="eff-value">${d}</span>
    </div>
    <div class="eff-summary">
      ⚡ ${savedPct}% faster — ~${savedTime} minutes saved vs. manual inspection
    </div>
  `;
}

// ---- TABLE ----
function renderTable(panels, filter = 'all') {
  const tbody = document.getElementById('panelTableBody');
  const filtered = filter === 'all' ? panels : panels.filter(p => p.worst_severity === filter);

  tbody.innerHTML = filtered.map(p => {
    const sc = SEVERITY_LABEL_COLORS[p.worst_severity] || SEVERITY_LABEL_COLORS.Low;
    const topDefect = Object.entries(p.defect_summary).sort((a,b) => b[1].count - a[1].count)[0];
    const rankClass = p.priority_rank <= 3 ? `rank-${p.priority_rank}` : '';
    return `
    <tr onclick="openInspectorAndSwitch('${p.id}')" data-severity="${p.worst_severity}">
      <td><span class="rank-badge ${rankClass}">${p.priority_rank}</span></td>
      <td><div class="panel-name" title="${p.filename}">${p.filename}</div></td>
      <td>
        <div class="health-bar-cell">
          <div class="health-bar-mini">
            <div class="health-bar-fill" style="width:${p.health_score}%;background:${healthColor(p.health_score)}"></div>
          </div>
          <span class="health-num">${p.health_score}%</span>
        </div>
      </td>
      <td><span class="defect-count-badge" style="color:${p.defect_count > 0 ? 'var(--orange)' : 'var(--green)'}">${p.defect_count}</span></td>
      <td><span class="severity-tag" style="background:${sc.bg};color:${sc.color};border:1px solid ${sc.border}">${p.worst_severity}</span></td>
      <td style="color:var(--text-2);font-size:12px;font-family:var(--font-mono)">${topDefect ? topDefect[0] : '—'}</td>
      <td><button class="btn-inspect" onclick="event.stopPropagation();openInspectorAndSwitch('${p.id}')">Inspect →</button></td>
    </tr>`;
  }).join('');

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-3);padding:32px">No panels match this filter</td></tr>';
  }
}

function setupFilters(panels) {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderTable(panels, btn.dataset.filter);
    });
  });
}

// ---- INSPECTOR ----
function renderInspectorList(panels) {
  const list = document.getElementById('inspectorList');
  list.innerHTML = panels.map(p => {
    const sc = SEVERITY_LABEL_COLORS[p.worst_severity] || SEVERITY_LABEL_COLORS.Low;
    return `
    <div class="inspector-item" data-id="${p.id}" onclick="openInspector(getPanel('${p.id}'))">
      <div class="inspector-item-name" title="${p.filename}">${p.filename}</div>
      <div class="inspector-item-meta">
        <span class="severity-tag" style="font-size:9px;padding:2px 7px;background:${sc.bg};color:${sc.color};border:1px solid ${sc.border}">${p.worst_severity}</span>
        <span style="font-size:10px;color:var(--text-3);font-family:var(--font-mono)">${p.defect_count} def</span>
        <span style="font-size:10px;color:${healthColor(p.health_score)};font-family:var(--font-mono)">${p.health_score}%</span>
      </div>
    </div>`;
  }).join('');

  document.getElementById('inspectorSearch').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('.inspector-item').forEach(el => {
      el.style.display = el.querySelector('.inspector-item-name').textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });
}

window.getPanel = (id) => sessionData.panels.find(p => p.id === id);

window.openInspector = (panel) => {
  if (!panel) return;
  currentInspectorPanel = panel;

  document.querySelectorAll('.inspector-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === panel.id);
  });

  let showAnnotated = true;
  const topDefects = Object.entries(panel.defect_summary)
    .sort((a,b) => b[1].count - a[1].count)
    .map(([name, info]) => {
      const col = DEFECT_COLORS[name] || '#888';
      return `<span class="defect-tag" style="color:${col};border-color:${col}44;background:${col}11">
        <span class="defect-tag-dot" style="background:${col}"></span>
        ${name} ×${info.count} (${Math.round(info.avg_confidence*100)}%)
      </span>`;
    }).join('');

  const main = document.getElementById('inspectorMain');
  main.innerHTML = `
    <div class="inspector-detail">
      <div class="inspector-img-wrap">
        <img id="inspectorImg" class="inspector-img" src="${panel.annotated_image}" alt="Panel" loading="lazy">
        <div class="inspector-toggle">
          <button class="toggle-btn active" id="toggleAnnotated" onclick="toggleImg(true)">Annotated</button>
          <button class="toggle-btn" id="toggleOriginal" onclick="toggleImg(false)">Original</button>
        </div>
      </div>
      <div class="inspector-info">
        <div class="info-block">
          <span class="info-key">Health Score</span>
          <span class="info-val" style="color:${healthColor(panel.health_score)}">${panel.health_score}%</span>
        </div>
        <div class="info-block">
          <span class="info-key">Defect Count</span>
          <span class="info-val">${panel.defect_count}</span>
        </div>
        <div class="info-block">
          <span class="info-key">Severity</span>
          <span class="info-val" style="color:${SEVERITY_COLORS[panel.worst_severity] || '#888'}">${panel.worst_severity}</span>
        </div>
        <div class="info-block">
          <span class="info-key">Priority Rank</span>
          <span class="info-val">#${panel.priority_rank}</span>
        </div>
        <div class="info-block">
          <span class="info-key">Resolution</span>
          <span class="info-val" style="font-size:12px">${panel.image_size.width}×${panel.image_size.height}</span>
        </div>
        <div class="info-block">
          <span class="info-key">Filename</span>
          <span class="info-val" style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${panel.filename}</span>
        </div>
        ${panel.defect_count > 0 ? `<div class="defect-tags">${topDefects}</div>` : ''}
      </div>
    </div>
  `;
};

window.toggleImg = (annotated) => {
  if (!currentInspectorPanel) return;
  document.getElementById('inspectorImg').src = annotated
    ? currentInspectorPanel.annotated_image
    : currentInspectorPanel.original_image;
  document.getElementById('toggleAnnotated').classList.toggle('active', annotated);
  document.getElementById('toggleOriginal').classList.toggle('active', !annotated);
};

window.openInspectorAndSwitch = (id) => {
  const panel = sessionData.panels.find(p => p.id === id);
  openInspector(panel);
  activateSection('inspector');
};

// ---- NAV ----
function setupNav() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      activateSection(item.dataset.section);
    });
  });
}

function activateSection(name) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  const sec = document.getElementById(`section-${name}`);
  if (sec) sec.classList.add('active');
  document.querySelector(`[data-section="${name}"]`)?.classList.add('active');

  // Resize charts on tab switch
  setTimeout(() => Object.values(charts).forEach(c => c.resize && c.resize()), 50);
}

// ---- EXPORT ----
function exportReport() {
  if (!sessionData) return;
  const { panels, summary } = sessionData;
  const lines = [
    'SOLARGUARD AI — DEFECT ANALYSIS REPORT',
    '=========================================',
    `Date: ${new Date().toLocaleString()}`,
    `Total Panels: ${summary.total_panels}`,
    `Total Defects: ${summary.total_defects}`,
    `Average Health Score: ${summary.avg_health_score}%`,
    `Critical Panels: ${summary.critical_panels}`,
    '',
    'PRIORITY INSPECTION QUEUE',
    '-------------------------',
    ...panels.map(p =>
      `[#${p.priority_rank}] ${p.filename} | Health: ${p.health_score}% | Defects: ${p.defect_count} | Severity: ${p.worst_severity}`
    ),
    '',
    'DEFECT TYPE DISTRIBUTION',
    '------------------------',
    ...Object.entries(summary.defect_type_distribution).map(([k,v]) => `  ${k}: ${v}`)
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `solarguard_report_${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}