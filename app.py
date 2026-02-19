import os, json, uuid, sqlite3, cv2, numpy as np
from flask import Flask, render_template, request, jsonify, send_from_directory, send_file
from werkzeug.utils import secure_filename
from ultralytics import YOLO
from datetime import datetime
from io import BytesIO

app = Flask(__name__)
app.config['SECRET_KEY'] = 'solar-defect-detection-2024'
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['RESULTS_FOLDER'] = 'results'
app.config['DB_PATH'] = 'solarguard.db'
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024

MODEL_PATH = 'best.pt'
model = None

def get_model():
    global model
    if model is None and os.path.exists(MODEL_PATH):
        model = YOLO(MODEL_PATH)
    return model

DEFECT_CLASSES = {
    0:  {'name': 'Black Core',            'severity': 'Critical', 'color': '#FF2D55', 'power_loss_pct': 20, 'repair_cost': 4500},
    1:  {'name': 'Crack',                 'severity': 'Critical', 'color': '#FF3B30', 'power_loss_pct': 12, 'repair_cost': 3000},
    2:  {'name': 'Finger',                'severity': 'High',     'color': '#FF6B35', 'power_loss_pct': 5,  'repair_cost': 1500},
    3:  {'name': 'Fragment',              'severity': 'Critical', 'color': '#FF0000', 'power_loss_pct': 30, 'repair_cost': 6000},
    4:  {'name': 'Horizontal Dislocation','severity': 'High',     'color': '#FF9500', 'power_loss_pct': 8,  'repair_cost': 2000},
    5:  {'name': 'Printing Error',        'severity': 'Medium',   'color': '#FFCC00', 'power_loss_pct': 3,  'repair_cost': 800},
    6:  {'name': 'Scratch',               'severity': 'Low',      'color': '#007AFF', 'power_loss_pct': 2,  'repair_cost': 300},
    7:  {'name': 'Short Circuit',         'severity': 'Critical', 'color': '#BF5AF2', 'power_loss_pct': 25, 'repair_cost': 5000},
    8:  {'name': 'Star Crack',            'severity': 'Critical', 'color': '#FF375F', 'power_loss_pct': 15, 'repair_cost': 3500},
    9:  {'name': 'Thick Line',            'severity': 'Medium',   'color': '#34C759', 'power_loss_pct': 3,  'repair_cost': 700},
    10: {'name': 'Other Defect',          'severity': 'Low',      'color': '#636366', 'power_loss_pct': 2,  'repair_cost': 500},
}

SEVERITY_ORDER = {'Critical': 0, 'High': 1, 'Medium': 2, 'Low': 3, 'Good': 4}
PANEL_WATT = 400
ELECTRICITY_RATE = 7
HOURS_PER_YEAR = 1600

def get_db():
    db = sqlite3.connect(app.config['DB_PATH'])
    db.row_factory = sqlite3.Row
    return db

def init_db():
    db = get_db()
    db.executescript('''
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY, folder_name TEXT, timestamp TEXT,
            total_panels INTEGER, total_defects INTEGER, avg_health REAL, summary_json TEXT
        );
        CREATE TABLE IF NOT EXISTS panels (
            id TEXT PRIMARY KEY, session_id TEXT, filename TEXT,
            health_score REAL, defect_count INTEGER, worst_severity TEXT,
            power_loss_pct REAL, repair_cost REAL,
            status TEXT DEFAULT "Pending", notes TEXT DEFAULT "",
            defect_summary_json TEXT, detections_json TEXT, timestamp TEXT,
            FOREIGN KEY(session_id) REFERENCES sessions(id)
        );
    ''')
    db.commit(); db.close()

def simulate_detection(image_path, conf_threshold=0.25):
    import random
    random.seed(hash(image_path) % 1000)
    img = cv2.imread(image_path)
    if img is None: return [], (0, 0)
    h, w = img.shape[:2]
    detections = []
    for _ in range(random.randint(0, 5)):
        conf = round(random.uniform(0.3, 0.98), 2)
        if conf < conf_threshold: continue
        cls_id = random.randint(0, 10)
        x1 = random.randint(0, max(1, w-100))
        y1 = random.randint(0, max(1, h-100))
        detections.append({'class_id': cls_id, 'confidence': conf,
                           'bbox': [x1, y1, min(x1+random.randint(50,150),w), min(y1+random.randint(50,150),h)]})
    return detections, (h, w)

def run_inference(image_path, conf_threshold=0.25):
    mdl = get_model()
    if mdl is None: return simulate_detection(image_path, conf_threshold)
    results = mdl(image_path, conf=conf_threshold, iou=0.45)
    detections = []
    img = cv2.imread(image_path)
    h, w = img.shape[:2] if img is not None else (0, 0)
    for r in results:
        if r.boxes is not None:
            for box in r.boxes:
                detections.append({'class_id': int(box.cls[0]),
                                   'confidence': round(float(box.conf[0]), 3),
                                   'bbox': list(map(int, box.xyxy[0]))})
    return detections, (h, w)

def draw_annotated_image(image_path, detections, output_path):
    img = cv2.imread(image_path)
    if img is None: return False
    for det in detections:
        info = DEFECT_CLASSES.get(det['class_id'], {'name': 'Unknown', 'color': '#FFFFFF'})
        hx = info['color'].lstrip('#')
        r, g, b = tuple(int(hx[i:i+2], 16) for i in (0, 2, 4))
        color = (b, g, r)
        x1, y1, x2, y2 = det['bbox']
        cv2.rectangle(img, (x1,y1), (x2,y2), color, 2)
        label = f"{info['name']} {det['confidence']:.2f}"
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
        cv2.rectangle(img, (x1, y1-th-8), (x1+tw+4, y1), color, -1)
        cv2.putText(img, label, (x1+2, y1-4), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255,255,255), 1)
    cv2.imwrite(output_path, img)
    return True

def compute_health_score(detections):
    if not detections: return 100.0
    penalties = {'Critical': 20, 'High': 12, 'Medium': 6, 'Low': 3}
    score = 100.0
    for det in detections:
        sev = DEFECT_CLASSES.get(det['class_id'], {}).get('severity', 'Low')
        score -= penalties[sev] * det['confidence']
    return max(0.0, round(score, 1))

def compute_power_loss(detections):
    if not detections: return 0.0
    return round(min(sum(DEFECT_CLASSES.get(d['class_id'],{}).get('power_loss_pct',2)*d['confidence'] for d in detections), 100.0), 1)

def compute_repair_cost(detections):
    if not detections: return 0
    return round(sum(DEFECT_CLASSES.get(d['class_id'],{}).get('repair_cost',500)*d['confidence'] for d in detections))

def compute_annual_revenue_loss(power_loss_pct):
    return round((PANEL_WATT * power_loss_pct / 100) * HOURS_PER_YEAR / 1000 * ELECTRICITY_RATE)

session_cache = {}

@app.route('/')
def index(): return render_template('index.html')

@app.route('/dashboard')
def dashboard(): return render_template('dashboard.html')

@app.route('/history')
def history(): return render_template('history.html')

@app.route('/api/analyze', methods=['POST'])
def analyze():
    conf_threshold = float(request.form.get('conf_threshold', 0.25))
    folder_name = request.form.get('folder_name', 'Unknown Folder')
    session_id = str(uuid.uuid4())
    if 'images' not in request.files:
        return jsonify({'error': 'No images uploaded'}), 400
    files = request.files.getlist('images')
    if not files or all(f.filename == '' for f in files):
        return jsonify({'error': 'No files selected'}), 400

    session_dir = os.path.join(app.config['UPLOAD_FOLDER'], session_id)
    results_dir = os.path.join(app.config['RESULTS_FOLDER'], session_id)
    os.makedirs(session_dir, exist_ok=True)
    os.makedirs(results_dir, exist_ok=True)
    panel_results = []

    for f in files:
        if not f.filename: continue
        filename = secure_filename(f.filename)
        if not filename.lower().endswith(('.png','.jpg','.jpeg','.tif','.tiff','.bmp')): continue
        filepath = os.path.join(session_dir, filename)
        f.save(filepath)
        detections, (h, w) = run_inference(filepath, conf_threshold)
        annotated_path = os.path.join(results_dir, f'annotated_{filename}')
        draw_annotated_image(filepath, detections, annotated_path)

        defect_summary = {}
        for det in detections:
            cls_id = det['class_id']
            info = DEFECT_CLASSES.get(cls_id, {})
            name = info.get('name', f'Class {cls_id}')
            if name not in defect_summary:
                defect_summary[name] = {'count': 0, 'confidences': [], 'severity': info.get('severity','Low'),
                                        'color': info.get('color','#888'), 'power_loss_pct': info.get('power_loss_pct',2),
                                        'repair_cost': info.get('repair_cost',500)}
            defect_summary[name]['count'] += 1
            defect_summary[name]['confidences'].append(det['confidence'])
        for k in defect_summary:
            confs = defect_summary[k]['confidences']
            defect_summary[k]['avg_confidence'] = round(sum(confs)/len(confs), 3)

        health_score  = compute_health_score(detections)
        power_loss    = compute_power_loss(detections)
        repair_cost   = compute_repair_cost(detections)
        revenue_loss  = compute_annual_revenue_loss(power_loss)
        worst_severity = 'Good'
        if detections:
            sevs = [DEFECT_CLASSES.get(d['class_id'],{}).get('severity','Low') for d in detections]
            for s in ['Critical','High','Medium','Low']:
                if s in sevs: worst_severity = s; break

        panel_id = str(uuid.uuid4())
        panel_results.append({
            'id': panel_id, 'filename': filename, 'defect_count': len(detections),
            'defect_summary': defect_summary, 'health_score': health_score,
            'power_loss_pct': power_loss, 'repair_cost': repair_cost,
            'annual_revenue_loss': revenue_loss, 'worst_severity': worst_severity,
            'image_size': {'width': w, 'height': h},
            'annotated_image': f'/results/{session_id}/annotated_{filename}',
            'original_image': f'/uploads/{session_id}/{filename}',
            'detections': detections, 'status': 'Pending', 'notes': '',
            'timestamp': datetime.now().isoformat()
        })

    panel_results.sort(key=lambda x: (SEVERITY_ORDER.get(x['worst_severity'],99), -x['defect_count']))
    for i, p in enumerate(panel_results): p['priority_rank'] = i + 1

    total_defects = sum(p['defect_count'] for p in panel_results)
    total_power   = round(sum(p['power_loss_pct'] for p in panel_results), 1)
    total_repair  = sum(p['repair_cost'] for p in panel_results)
    total_rev     = sum(p['annual_revenue_loss'] for p in panel_results)
    avg_health    = round(sum(p['health_score'] for p in panel_results)/len(panel_results),1) if panel_results else 100
    defect_counts = {}
    for p in panel_results:
        for dtype, info in p['defect_summary'].items():
            defect_counts[dtype] = defect_counts.get(dtype,0) + info['count']
    sev_dist = {'Critical':0,'High':0,'Medium':0,'Low':0,'Good':0}
    for p in panel_results: sev_dist[p['worst_severity']] = sev_dist.get(p['worst_severity'],0)+1

    result_data = {
        'session_id': session_id, 'folder_name': folder_name, 'conf_threshold': conf_threshold,
        'panels': panel_results,
        'summary': {
            'total_panels': len(panel_results), 'total_defects': total_defects,
            'avg_health_score': avg_health, 'total_power_loss_pct': total_power,
            'total_repair_cost': total_repair, 'total_annual_revenue_loss': total_rev,
            'defect_type_distribution': defect_counts, 'severity_distribution': sev_dist,
            'critical_panels': sev_dist.get('Critical',0), 'healthy_panels': sev_dist.get('Good',0)
        }
    }
    session_cache[session_id] = result_data
    with open(os.path.join(results_dir,'results.json'),'w') as fh: json.dump(result_data,fh,indent=2)
    try:
        db = get_db()
        db.execute('INSERT INTO sessions VALUES (?,?,?,?,?,?,?)',
            (session_id, folder_name, datetime.now().isoformat(),
             len(panel_results), total_defects, avg_health, json.dumps(result_data['summary'])))
        for p in panel_results:
            db.execute('INSERT INTO panels VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
                (p['id'],session_id,p['filename'],p['health_score'],p['defect_count'],
                 p['worst_severity'],p['power_loss_pct'],p['repair_cost'],'Pending','',
                 json.dumps(p['defect_summary']),json.dumps(p['detections']),p['timestamp']))
        db.commit(); db.close()
    except Exception as e: print(f'DB error: {e}')
    for p in panel_results:
        print(f"Original Image Path: {p['original_image']}")
        print(f"Annotated Image Path: {p['annotated_image']}")
    return jsonify(result_data)

@app.route('/api/session/<session_id>')
def get_session(session_id):
    if session_id in session_cache:
        data = session_cache[session_id]; _merge_db_status(data, session_id); return jsonify(data)
    results_file = os.path.join(app.config['RESULTS_FOLDER'], session_id, 'results.json')
    if os.path.exists(results_file):
        with open(results_file) as f: data = json.load(f)
        _merge_db_status(data, session_id); session_cache[session_id] = data; return jsonify(data)
    return jsonify({'error': 'Session not found'}), 404

def _merge_db_status(data, session_id):
    try:
        db = get_db()
        rows = db.execute('SELECT id,status,notes FROM panels WHERE session_id=?',(session_id,)).fetchall()
        db.close()
        lookup = {r['id']: r for r in rows}
        for p in data.get('panels',[]):
            if p['id'] in lookup:
                p['status'] = lookup[p['id']]['status']; p['notes'] = lookup[p['id']]['notes']
    except: pass

@app.route('/api/panel/<panel_id>/status', methods=['POST'])
def update_panel_status(panel_id):
    data = request.json or {}
    status = data.get('status','Pending'); notes = data.get('notes','')
    valid = ['Pending','Confirmed','Scheduled','In Repair','Repaired','Monitoring']
    if status not in valid: return jsonify({'error':'Invalid status'}), 400
    try:
        db = get_db()
        db.execute('UPDATE panels SET status=?,notes=? WHERE id=?',(status,notes,panel_id))
        db.commit(); db.close()
        for sess in session_cache.values():
            for p in sess.get('panels',[]):
                if p['id'] == panel_id: p['status']=status; p['notes']=notes
        return jsonify({'ok': True})
    except Exception as e: return jsonify({'error': str(e)}), 500

@app.route('/api/history')
def get_history():
    try:
        db = get_db()
        rows = db.execute('SELECT id,folder_name,timestamp,total_panels,total_defects,avg_health,summary_json FROM sessions ORDER BY timestamp DESC LIMIT 50').fetchall()
        db.close()
        return jsonify([dict(r) for r in rows])
    except Exception as e: return jsonify({'error': str(e)}), 500

@app.route('/api/history/<session_id>/trend')
def get_trend(session_id):
    try:
        db = get_db()
        sess = db.execute('SELECT folder_name FROM sessions WHERE id=?',(session_id,)).fetchone()
        if not sess: return jsonify([])
        sessions = db.execute('SELECT id,timestamp FROM sessions WHERE folder_name=? ORDER BY timestamp ASC',(sess['folder_name'],)).fetchall()
        trend = []
        for s in sessions:
            panels = db.execute('SELECT filename,health_score,defect_count,worst_severity FROM panels WHERE session_id=?',(s['id'],)).fetchall()
            trend.append({'session_id':s['id'],'timestamp':s['timestamp'],'panels':[dict(p) for p in panels],
                          'avg_health':round(sum(p['health_score'] for p in panels)/len(panels),1) if panels else 100})
        db.close(); return jsonify(trend)
    except Exception as e: return jsonify({'error': str(e)}), 500

@app.route('/api/report/<session_id>/pdf')
def generate_pdf(session_id):
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib import colors
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
        from reportlab.lib.units import cm
        from reportlab.lib.enums import TA_CENTER
    except ImportError:
        return jsonify({'error':'Install reportlab: pip install reportlab'}), 500
    resp = get_session(session_id)
    data = resp.get_json()
    if not data or 'error' in data: return jsonify({'error':'Session not found'}), 404
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, rightMargin=2*cm, leftMargin=2*cm, topMargin=2*cm, bottomMargin=2*cm)
    styles = getSampleStyleSheet()
    GOLD=colors.HexColor('#F5C842'); RED=colors.HexColor('#FF3B30'); LIGHT=colors.HexColor('#f5f5f5'); GREY=colors.HexColor('#888888')
    title_style = ParagraphStyle('T', fontSize=22, textColor=colors.black, fontName='Helvetica-Bold', spaceAfter=4, alignment=TA_CENTER)
    h1_style    = ParagraphStyle('H1', fontSize=13, textColor=colors.black, fontName='Helvetica-Bold', spaceAfter=6, spaceBefore=12)
    body_style  = ParagraphStyle('B',  fontSize=9,  textColor=colors.HexColor('#444444'), leading=13)
    meta_style  = ParagraphStyle('M',  fontSize=8,  textColor=GREY, fontName='Helvetica', alignment=TA_CENTER)
    s = data['summary']; panels = data['panels']
    story = []
    story.append(Paragraph('SolarGuard AI', title_style))
    story.append(Paragraph('Solar Panel Defect Inspection Report', ParagraphStyle('s',fontSize=11,textColor=GREY,alignment=TA_CENTER,spaceAfter=4)))
    story.append(Paragraph(f"Generated: {datetime.now().strftime('%d %B %Y, %H:%M')}  ·  Folder: {data.get('folder_name','—')}  ·  Threshold: {data.get('conf_threshold',0.25)}", meta_style))
    story.append(Spacer(1,0.4*cm)); story.append(HRFlowable(width='100%',thickness=2,color=GOLD)); story.append(Spacer(1,0.4*cm))
    story.append(Paragraph('Executive Summary', h1_style))
    kpis = [['Metric','Value'],
            ['Total Panels Scanned', str(s['total_panels'])],
            ['Total Defects Detected', str(s['total_defects'])],
            ['Average Fleet Health Score', f"{s['avg_health_score']}%"],
            ['Critical Panels', str(s['critical_panels'])],
            ['Healthy Panels', str(s['healthy_panels'])],
            ['Est. Total Power Loss', f"{s['total_power_loss_pct']}%"],
            ['Est. Total Repair Cost', f"Rs.{s['total_repair_cost']:,}"],
            ['Est. Annual Revenue Loss', f"Rs.{s['total_annual_revenue_loss']:,}"]]
    t = Table(kpis, colWidths=[9*cm,7*cm])
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#1a1a1a')),('TEXTCOLOR',(0,0),(-1,0),GOLD),
        ('FONTNAME',(0,0),(-1,0),'Helvetica-Bold'),('FONTSIZE',(0,0),(-1,-1),9),
        ('ROWBACKGROUNDS',(0,1),(-1,-1),[LIGHT,colors.white]),('GRID',(0,0),(-1,-1),0.5,colors.HexColor('#dddddd')),('PADDING',(0,0),(-1,-1),7)]))
    story.append(t); story.append(Spacer(1,0.5*cm))
    story.append(Paragraph('Priority Inspection Queue', h1_style))
    rows = [['Rank','Panel','Health','Defects','Severity','Power Loss','Repair Cost','Status']]
    for p in panels:
        rows.append([str(p['priority_rank']), (p['filename'][:26]+'…' if len(p['filename'])>26 else p['filename']),
                     f"{p['health_score']}%", str(p['defect_count']), p['worst_severity'],
                     f"{p['power_loss_pct']}%", f"Rs.{p['repair_cost']:,}", p.get('status','Pending')])
    sev_bg = {'Critical':colors.HexColor('#fff0f0'),'High':colors.HexColor('#fff6ee'),
              'Medium':colors.HexColor('#fffbee'),'Low':colors.HexColor('#f0fff4'),'Good':colors.white}
    pt = Table(rows, colWidths=[1.2*cm,4.5*cm,1.6*cm,1.4*cm,2*cm,2*cm,2.5*cm,2*cm])
    ts = [('BACKGROUND',(0,0),(-1,0),colors.HexColor('#1a1a1a')),('TEXTCOLOR',(0,0),(-1,0),GOLD),
          ('FONTNAME',(0,0),(-1,0),'Helvetica-Bold'),('FONTSIZE',(0,0),(-1,-1),7.5),
          ('GRID',(0,0),(-1,-1),0.4,colors.HexColor('#e0e0e0')),('PADDING',(0,0),(-1,-1),5),('ALIGN',(2,1),(-1,-1),'CENTER')]
    for i,p in enumerate(panels,1):
        ts.append(('BACKGROUND',(0,i),(-1,i),sev_bg.get(p['worst_severity'],colors.white)))
        if p['worst_severity']=='Critical': ts.append(('TEXTCOLOR',(4,i),(4,i),RED))
    pt.setStyle(TableStyle(ts)); story.append(pt); story.append(Spacer(1,0.5*cm))
    story.append(Paragraph('Defect Type Summary', h1_style))
    drows = [['Defect Type','Count','Severity','Power Loss/Instance','Repair Cost/Instance']]
    for cls_id, info in DEFECT_CLASSES.items():
        cnt = s['defect_type_distribution'].get(info['name'],0)
        if cnt > 0: drows.append([info['name'],str(cnt),info['severity'],f"{info['power_loss_pct']}%",f"Rs.{info['repair_cost']:,}"])
    dt = Table(drows, colWidths=[4.5*cm,1.5*cm,2.5*cm,4*cm,4.5*cm])
    dt.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#1a1a1a')),('TEXTCOLOR',(0,0),(-1,0),GOLD),
        ('FONTNAME',(0,0),(-1,0),'Helvetica-Bold'),('FONTSIZE',(0,0),(-1,-1),8.5),
        ('ROWBACKGROUNDS',(0,1),(-1,-1),[LIGHT,colors.white]),('GRID',(0,0),(-1,-1),0.4,colors.HexColor('#e0e0e0')),('PADDING',(0,0),(-1,-1),6)]))
    story.append(dt); story.append(Spacer(1,0.5*cm))
    story.append(HRFlowable(width='100%',thickness=1,color=colors.HexColor('#dddddd'))); story.append(Spacer(1,0.3*cm))
    story.append(Paragraph('Recommendations', h1_style))
    recs = []
    if s['critical_panels']>0: recs.append(f"<b>{s['critical_panels']} critical panel(s)</b> require immediate inspection — prioritize within 48 hours.")
    if s['total_power_loss_pct']>0: recs.append(f"Fleet power loss of <b>{s['total_power_loss_pct']}%</b> costs approx. <b>Rs.{s['total_annual_revenue_loss']:,}/year</b> in lost generation.")
    if s['total_repair_cost']>0: recs.append(f"Total repair estimate: <b>Rs.{s['total_repair_cost']:,}</b>. Consider panel replacement for health scores below 40%.")
    recs.append("Schedule a follow-up scan within 30 days after repairs to verify health improvement.")
    for rec in recs: story.append(Paragraph(f"• {rec}", body_style)); story.append(Spacer(1,0.12*cm))
    story.append(Spacer(1,0.4*cm)); story.append(HRFlowable(width='100%',thickness=1,color=colors.HexColor('#dddddd'))); story.append(Spacer(1,0.2*cm))
    story.append(Paragraph('Generated by SolarGuard AI · Powered by YOLOv8 · For internal use only', meta_style))
    doc.build(story); buf.seek(0)
    return send_file(buf, mimetype='application/pdf', as_attachment=True,
                     download_name=f"SolarGuard_Report_{datetime.now().strftime('%Y%m%d_%H%M')}.pdf")

@app.route('/api/report/<session_id>/csv')
def export_csv(session_id):
    resp = get_session(session_id); data = resp.get_json()
    if not data or 'error' in data: return jsonify({'error':'Session not found'}), 404
    lines = ['Rank,Filename,Health Score,Defect Count,Severity,Power Loss %,Repair Cost (INR),Annual Revenue Loss (INR),Status,Notes']
    for p in data['panels']:
        lines.append(','.join([str(p['priority_rank']),f'"{p["filename"]}"',str(p['health_score']),str(p['defect_count']),
                               p['worst_severity'],str(p['power_loss_pct']),str(p['repair_cost']),str(p['annual_revenue_loss']),
                               p.get('status','Pending'),f'"{p.get("notes","")}"']))
    return send_file(BytesIO('\n'.join(lines).encode()), mimetype='text/csv', as_attachment=True,
                     download_name=f'SolarGuard_{session_id[:8]}.csv')

@app.route('/uploads/<path:filename>')
def uploaded_file(filename): return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

@app.route('/results/<path:filename>')
def result_file(filename): return send_from_directory(app.config['RESULTS_FOLDER'], filename)

if __name__ == '__main__':
    os.makedirs('uploads', exist_ok=True); os.makedirs('results', exist_ok=True); init_db()
    app.run(debug=True, port=5000)