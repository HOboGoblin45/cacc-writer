"""
desktop_agent/agent_v3.py
--------------------------
Appraisal Agent — ACI Desktop Agent v3 (Phase 3 — Click-to-Activate)

Clean rewrite using the new inserter.py module.
All field positions come from field_maps/1004.json (ratio-based).

ENDPOINTS
    GET  /health              — agent status
    POST /insert              — insert text into one field
    POST /insert-batch        — insert multiple fields
    POST /insert-grid         — insert into comp grid cell
    POST /read-field          — read current text from a field
    GET  /screenshot          — capture ACI screenshot
    POST /reload-maps         — reload field maps
    GET  /field-map           — return current field map
    GET  /list-windows        — list open windows

HOW TO RUN
    C:\\Python313-32\\python.exe desktop_agent\\agent_v3.py
"""

import sys
import os
import time
import logging
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from flask import Flask, request, jsonify
import inserter

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format='[agent] %(asctime)s %(levelname)s: %(message)s',
    datefmt='%H:%M:%S',
)
log = logging.getLogger('cacc_agent')

# ── Flask app ─────────────────────────────────────────────────────────────────

app = Flask(__name__)
AGENT_PORT = 5180


@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'ok': True,
        'agent': 'cacc-aci-agent',
        'version': '3.0.0',
        'phase': 3,
        'strategy': 'click_to_activate',
        'pywinauto': inserter.PYWINAUTO_AVAILABLE,
        'pyperclip': inserter.PYPERCLIP_AVAILABLE,
        'win32': inserter.WIN32_AVAILABLE,
        'pil': inserter.PIL_AVAILABLE,
        'port': AGENT_PORT,
    })


@app.route('/insert', methods=['POST'])
def insert():
    """Insert text into a single ACI field."""
    data = request.get_json(force=True, silent=True) or {}
    field_id = str(data.get('fieldId', '')).strip()
    text = str(data.get('text', '')).strip()
    form_type = str(data.get('formType', '1004')).strip()
    section = data.get('section')

    if not field_id:
        return jsonify({'ok': False, 'error': 'fieldId is required'}), 400
    if not text:
        return jsonify({'ok': False, 'error': 'text is required'}), 400

    if not inserter.PYWINAUTO_AVAILABLE:
        return jsonify({
            'ok': False,
            'error': 'ACI insertion not available in SaaS mode',
            'method': 'stub',
        }), 503

    aci_hwnd = inserter.find_aci_hwnd()
    if not aci_hwnd:
        return jsonify({
            'ok': False,
            'error': 'ACI is not open. Please open ACI with a report loaded.',
        }), 503

    result = inserter.insert_field(aci_hwnd, field_id, text, form_type, section)
    status_code = 200 if result.get('ok') else 500
    return jsonify(result), status_code


@app.route('/insert-batch', methods=['POST'])
def insert_batch():
    """Insert multiple fields in sequence."""
    data = request.get_json(force=True, silent=True) or {}
    fields = data.get('fields', [])
    form_type = str(data.get('formType', '1004')).strip()
    delay = float(data.get('delay', 0.5))

    if not fields:
        return jsonify({'ok': False, 'error': 'fields array is required'}), 400

    aci_hwnd = inserter.find_aci_hwnd()
    if not aci_hwnd:
        return jsonify({
            'ok': False,
            'error': 'ACI is not open.',
        }), 503

    result = inserter.insert_batch(aci_hwnd, fields, form_type, delay)
    return jsonify(result)


@app.route('/insert-sequential', methods=['POST'])
def insert_sequential():
    """Insert multiple values using Tab to advance between consecutive fields."""
    data = request.get_json(force=True, silent=True) or {}
    first_field = str(data.get('firstFieldId', '')).strip()
    texts = data.get('texts', [])
    form_type = str(data.get('formType', '1004')).strip()
    section = data.get('section')

    if not first_field:
        return jsonify({'ok': False, 'error': 'firstFieldId is required'}), 400
    if not texts:
        return jsonify({'ok': False, 'error': 'texts array is required'}), 400

    aci_hwnd = inserter.find_aci_hwnd()
    if not aci_hwnd:
        return jsonify({'ok': False, 'error': 'ACI is not open.'}), 503

    skip_populated = data.get('skipPopulated', True)
    result = inserter.insert_sequential(aci_hwnd, first_field, texts, form_type, section, skip_populated)
    return jsonify(result)


@app.route('/insert-grid', methods=['POST'])
def insert_grid():
    """Insert into a comp grid cell."""
    data = request.get_json(force=True, silent=True) or {}
    row_id = str(data.get('rowId', '')).strip()
    comp_num = int(data.get('compNum', 1))
    text = str(data.get('text', '')).strip()
    form_type = str(data.get('formType', '1004')).strip()

    if not row_id:
        return jsonify({'ok': False, 'error': 'rowId is required'}), 400
    if not text:
        return jsonify({'ok': False, 'error': 'text is required'}), 400

    aci_hwnd = inserter.find_aci_hwnd()
    if not aci_hwnd:
        return jsonify({'ok': False, 'error': 'ACI is not open.'}), 503

    result = inserter.insert_comp_grid_cell(aci_hwnd, row_id, comp_num, text, form_type)
    return jsonify(result)


@app.route('/read-field', methods=['POST'])
def read_field():
    """Read current text from a field (click to activate, then read)."""
    data = request.get_json(force=True, silent=True) or {}
    field_id = str(data.get('fieldId', '')).strip()
    form_type = str(data.get('formType', '1004')).strip()
    section = data.get('section')

    if not field_id:
        return jsonify({'ok': False, 'error': 'fieldId is required'}), 400

    aci_hwnd = inserter.find_aci_hwnd()
    if not aci_hwnd:
        return jsonify({'ok': False, 'error': 'ACI is not open.'}), 503

    field_map = inserter.load_field_map(form_type)
    
    # Find field config
    field_cfg = None
    for sec_name, sec_data in field_map.items():
        if sec_name.startswith('_') or not isinstance(sec_data, dict):
            continue
        if field_id in sec_data:
            field_cfg = sec_data[field_id]
            tab_ratio = sec_data.get('_tab_click_ratio', field_cfg.get('tab_click_ratio'))
            break

    if not field_cfg:
        return jsonify({'ok': False, 'error': f"Field '{field_id}' not found"}), 404

    field_ratio = field_cfg.get('field_click_ratio')
    if not field_ratio:
        return jsonify({'ok': False, 'error': f"No position for '{field_id}'"}), 404

    # Navigate and click
    if tab_ratio is not None:
        inserter.navigate_tab(aci_hwnd, tab_ratio)
        time.sleep(0.3)
    
    inserter.activate_field(aci_hwnd, field_ratio)
    time.sleep(0.3)

    edit_hwnd, edit_cls, edit_rect = inserter.find_active_edit(aci_hwnd)
    if not edit_hwnd:
        return jsonify({'ok': False, 'error': 'No edit control found'}), 404

    text = inserter.read_edit_text(edit_hwnd)
    return jsonify({
        'ok': True,
        'field_id': field_id,
        'text': text,
        'edit_class': edit_cls,
    })


@app.route('/screenshot', methods=['GET'])
def screenshot():
    """Capture ACI screenshot."""
    label = request.args.get('label', 'manual')
    path = inserter.capture_screenshot(label)
    if path:
        return jsonify({'ok': True, 'path': path})
    return jsonify({'ok': False, 'error': 'Screenshot failed'}), 500


@app.route('/reload-maps', methods=['POST'])
def reload_maps():
    """Reload field maps from disk."""
    inserter.reload_field_maps()
    return jsonify({'ok': True, 'message': 'Field maps reloaded'})


@app.route('/field-map', methods=['GET'])
def field_map():
    """Return the current field map."""
    form_type = request.args.get('formType', '1004')
    data = inserter.load_field_map(form_type)
    return jsonify({'ok': True, 'formType': form_type, 'fieldMap': data})


@app.route('/list-windows', methods=['GET'])
def list_windows():
    """List visible top-level windows."""
    if not inserter.WIN32_AVAILABLE:
        return jsonify({'ok': False, 'error': 'win32 not available'})
    
    import win32gui
    windows = []
    def cb(hwnd, _):
        if win32gui.IsWindowVisible(hwnd):
            title = win32gui.GetWindowText(hwnd)
            if title:
                windows.append({'handle': hwnd, 'title': title})
    win32gui.EnumWindows(cb, None)
    return jsonify({'ok': True, 'windows': windows})


# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    log.info('=' * 60)
    log.info('Appraisal Agent — ACI Desktop Agent v3 (Phase 3)')
    log.info(f'Port:       {AGENT_PORT}')
    log.info(f'Strategy:   click-to-activate')
    log.info(f'pywinauto:  {inserter.PYWINAUTO_AVAILABLE}')
    log.info(f'pyperclip:  {inserter.PYPERCLIP_AVAILABLE}')
    log.info(f'win32:      {inserter.WIN32_AVAILABLE}')
    log.info(f'PIL:        {inserter.PIL_AVAILABLE}')
    log.info('=' * 60)

    # Load and report field maps
    fm = inserter.load_field_map('1004')
    sections = [k for k in fm.keys() if not k.startswith('_')]
    log.info(f'Field map sections: {sections}')

    app.run(host='127.0.0.1', port=AGENT_PORT, debug=False)
