import os
import json
import uuid
import shutil
import cv2
import numpy as np
from flask import Flask, render_template, request, jsonify, send_from_directory
from werkzeug.utils import secure_filename
from ultralytics import YOLO
from PIL import Image
import base64
from io import BytesIO
from datetime import datetime
import threading

app = Flask(__name__)
app.config['SECRET_KEY'] = 'solar-defect-detection-2024'
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['RESULTS_FOLDER'] = 'results'
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024  # 500MB max

# Load YOLOv8 model
MODEL_PATH = 'best.pt'
model = None

def get_model():
    global model
    if model is None:
        if os.path.exists(MODEL_PATH):
            model = YOLO(MODEL_PATH)
        else:
            # Demo mode: simulate detections if model not found
            model = None
    return model

DEFECT_CLASSES = {
    # Class IDs must match the order your YOLOv8 model was trained on.
    # Based on your dataset: black_core(72) crack(109) finger(140) fragment(5)
    # horizontal_dislocation(24) printing_error(48) scratch(9) short_circuit(24)
    # star_crack(17) thick_line(38) other_defect(17)
    # Alphabetical order is the default YOLO class assignment when using a
    # standard dataset folder structure — adjust IDs if your model differs.
    0: {
        'name': 'Black Core',
        'severity': 'Critical',
        'color': '#FF2D55',
        'description': 'Dark core region indicating severe cell failure or internal short'
    },
    1: {
        'name': 'Crack',
        'severity': 'Critical',
        'color': '#FF3B30',
        'description': 'Structural crack compromising cell integrity and current flow'
    },
    2: {
        'name': 'Line Scratch',
        'severity': 'High',
        'color': '#FF6B35',
        'description': 'Broken or interrupted finger electrode reducing current collection'
    },
    3: {
        'name': 'Fragment',
        'severity': 'Critical',
        'color': '#FF0000',
        'description': 'Cell fragment — physical breakage with high failure risk'
    },
    4: {
        'name': 'Horizontal Dislocation',
        'severity': 'High',
        'color': '#FF9500',
        'description': 'Lateral displacement of cell or sub-cell region affecting uniformity'
    },
    5: {
        'name': 'Printing Error',
        'severity': 'Medium',
        'color': '#FFCC00',
        'description': 'Screen-printing defect causing irregular metallization pattern'
    },
    6: {
        'name': 'Scratch',
        'severity': 'Low',
        'color': '#007AFF',
        'description': 'Surface scratch — may affect anti-reflective coating or contacts'
    },
    7: {
        'name': 'Short Circuit',
        'severity': 'Critical',
        'color': '#BF5AF2',
        'description': 'Electrical short circuit causing localized heating and power loss'
    },
    8: {
        'name': 'Star Crack',
        'severity': 'Critical',
        'color': '#FF375F',
        'description': 'Radial crack pattern typically caused by mechanical stress or hail'
    },
    9: {
        'name': 'Thick Line',
        'severity': 'Medium',
        'color': '#34C759',
        'description': 'Abnormally thick bus/finger line causing shading and resistance issues'
    },
    10: {
        'name': 'Other Defect',
        'severity': 'Low',
        'color': '#636366',
        'description': 'Unclassified anomaly detected — requires manual inspection'
    },
}

SEVERITY_ORDER = {'Critical': 0, 'High': 1, 'Medium': 2, 'Low': 3}

def simulate_detection(image_path):
    """Simulate YOLO detections for demo mode (11 real classes)"""
    import random
    random.seed(hash(image_path) % 1000)
    img = cv2.imread(image_path)
    if img is None:
        return [], (0, 0)
    h, w = img.shape[:2]
    detections = []
    num_defects = random.randint(0, 5)
    for _ in range(num_defects):
        cls_id = random.randint(0, 10)   # 11 classes: 0–10
        x1 = random.randint(0, max(1, w - 100))
        y1 = random.randint(0, max(1, h - 100))
        x2 = min(x1 + random.randint(50, 150), w)
        y2 = min(y1 + random.randint(50, 150), h)
        conf = round(random.uniform(0.45, 0.98), 2)
        detections.append({'class_id': cls_id, 'confidence': conf, 'bbox': [x1, y1, x2, y2]})
    return detections, (h, w)

def run_inference(image_path):
    """Run YOLO inference on single image"""
    mdl = get_model()
    if mdl is None:
        return simulate_detection(image_path)
    
    results = mdl(image_path, conf=0.25, iou=0.45)
    detections = []
    img = cv2.imread(image_path)
    h, w = img.shape[:2] if img is not None else (0, 0)
    
    for r in results:
        boxes = r.boxes
        if boxes is not None:
            for box in boxes:
                cls_id = int(box.cls[0])
                conf = float(box.conf[0])
                x1, y1, x2, y2 = map(int, box.xyxy[0])
                detections.append({'class_id': cls_id, 'confidence': conf, 'bbox': [x1, y1, x2, y2]})
    return detections, (h, w)

def draw_annotated_image(image_path, detections, output_path):
    """Draw bounding boxes on image and save"""
    img = cv2.imread(image_path)
    if img is None:
        return False
    
    for det in detections:
        cls_id = det['class_id']
        conf = det['confidence']
        x1, y1, x2, y2 = det['bbox']
        info = DEFECT_CLASSES.get(cls_id, {'name': f'Class {cls_id}', 'color': '#FFFFFF'})
        
        # Parse hex color to BGR
        hex_color = info['color'].lstrip('#')
        r, g, b = tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
        color = (b, g, r)
        
        cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)
        label = f"{info['name']} {conf:.2f}"
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
        cv2.rectangle(img, (x1, y1-th-8), (x1+tw+4, y1), color, -1)
        cv2.putText(img, label, (x1+2, y1-4), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255,255,255), 1)
    
    cv2.imwrite(output_path, img)
    return True

def image_to_base64(path):
    with open(path, 'rb') as f:
        return base64.b64encode(f.read()).decode('utf-8')

def compute_health_score(detections):
    """Compute panel health score 0-100 based on detected defects and their severity"""
    if not detections:
        return 100
    score = 100
    # Penalty per detection weighted by severity and confidence
    # Critical defects (black_core, crack, fragment, short_circuit, star_crack): -20 pts
    # High defects (finger, horizontal_dislocation): -12 pts
    # Medium defects (printing_error, thick_line): -6 pts
    # Low defects (scratch, other_defect): -3 pts
    penalties = {'Critical': 20, 'High': 12, 'Medium': 6, 'Low': 3}
    for det in detections:
        cls_id = det['class_id']
        severity = DEFECT_CLASSES.get(cls_id, {}).get('severity', 'Low')
        conf = det['confidence']
        score -= penalties.get(severity, 3) * conf
    return max(0, round(score, 1))

# Store session results in memory
session_results = {}

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/dashboard')
def dashboard():
    return render_template('dashboard.html')

@app.route('/api/analyze', methods=['POST'])
def analyze():
    """Analyze uploaded images"""
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
        if f.filename == '':
            continue
        filename = secure_filename(f.filename)
        if not filename.lower().endswith(('.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp')):
            continue
        
        filepath = os.path.join(session_dir, filename)
        f.save(filepath)
        
        detections, (h, w) = run_inference(filepath)
        
        annotated_path = os.path.join(results_dir, f'annotated_{filename}')
        draw_annotated_image(filepath, detections, annotated_path)
        
        defect_summary = {}
        for det in detections:
            cls_id = det['class_id']
            name = DEFECT_CLASSES.get(cls_id, {}).get('name', f'Class {cls_id}')
            if name not in defect_summary:
                defect_summary[name] = {'count': 0, 'confidences': [], 'severity': DEFECT_CLASSES.get(cls_id, {}).get('severity', 'Low'), 'color': DEFECT_CLASSES.get(cls_id, {}).get('color', '#888')}
            defect_summary[name]['count'] += 1
            defect_summary[name]['confidences'].append(det['confidence'])
        
        for k in defect_summary:
            confs = defect_summary[k]['confidences']
            defect_summary[k]['avg_confidence'] = round(sum(confs)/len(confs), 3)
        
        health_score = compute_health_score(detections)
        
        # Determine worst severity
        worst_severity = 'Good'
        if detections:
            severities = [DEFECT_CLASSES.get(d['class_id'], {}).get('severity', 'Low') for d in detections]
            for sev in ['Critical', 'High', 'Medium', 'Low']:
                if sev in severities:
                    worst_severity = sev
                    break
        
        panel_results.append({
            'id': str(uuid.uuid4()),
            'filename': filename,
            'defect_count': len(detections),
            'defect_summary': defect_summary,
            'health_score': health_score,
            'worst_severity': worst_severity,
            'image_size': {'width': w, 'height': h},
            'annotated_image': f'/results/{session_id}/annotated_{filename}',
            'original_image': f'/uploads/{session_id}/{filename}',
            'detections': detections,
            'timestamp': datetime.now().isoformat()
        })
    
    # Sort by defect count descending (priority order)
    panel_results.sort(key=lambda x: (
        SEVERITY_ORDER.get(x['worst_severity'], 99),
        -x['defect_count']
    ))
    
    # Add priority rank
    for i, p in enumerate(panel_results):
        p['priority_rank'] = i + 1
    
    # Aggregate stats
    total_defects = sum(p['defect_count'] for p in panel_results)
    defect_type_counts = {}
    for p in panel_results:
        for dtype, info in p['defect_summary'].items():
            defect_type_counts[dtype] = defect_type_counts.get(dtype, 0) + info['count']
    
    severity_dist = {'Critical': 0, 'High': 0, 'Medium': 0, 'Low': 0, 'Good': 0}
    for p in panel_results:
        severity_dist[p['worst_severity']] = severity_dist.get(p['worst_severity'], 0) + 1
    
    avg_health = round(sum(p['health_score'] for p in panel_results) / len(panel_results), 1) if panel_results else 100
    
    result_data = {
        'session_id': session_id,
        'panels': panel_results,
        'summary': {
            'total_panels': len(panel_results),
            'total_defects': total_defects,
            'avg_health_score': avg_health,
            'defect_type_distribution': defect_type_counts,
            'severity_distribution': severity_dist,
            'critical_panels': severity_dist.get('Critical', 0),
            'healthy_panels': severity_dist.get('Good', 0)
        }
    }
    
    session_results[session_id] = result_data
    
    # Save to file too
    with open(os.path.join(results_dir, 'results.json'), 'w') as f:
        json.dump(result_data, f, indent=2)
    
    return jsonify(result_data)

@app.route('/api/session/<session_id>')
def get_session(session_id):
    if session_id in session_results:
        return jsonify(session_results[session_id])
    results_file = os.path.join(app.config['RESULTS_FOLDER'], session_id, 'results.json')
    if os.path.exists(results_file):
        with open(results_file) as f:
            return jsonify(json.load(f))
    return jsonify({'error': 'Session not found'}), 404

@app.route('/uploads/<path:filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

@app.route('/results/<path:filename>')
def result_file(filename):
    return send_from_directory(app.config['RESULTS_FOLDER'], filename)

if __name__ == '__main__':
    os.makedirs('uploads', exist_ok=True)
    os.makedirs('results', exist_ok=True)
    app.run(debug=True, port=5000)