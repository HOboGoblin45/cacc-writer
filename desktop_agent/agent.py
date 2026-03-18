"""
desktop_agent/agent.py
----------------------
# =============================================================================
# LEGACY SYSTEM — DO NOT EXTEND
# =============================================================================
# This file is part of the original CACC Writer v1 ad-hoc agent architecture.
# It remains functional and is now wrapped as a deterministic TOOL by the new
# LangGraph workflow system (server/tools/aciTool.ts).
#
# New automation logic belongs in:  server/tools/aciTool.ts
# New workflow logic belongs in:    server/workflow/appraisalWorkflow.ts
#
# DO NOT add new endpoints or business logic here.
# DO NOT delete this file — the new aciTool.ts calls this agent via HTTP.
# =============================================================================

CACC Writer — ACI Desktop Automation Agent  (Phase 2 — Flask HTTP Server)

Imports all core logic from agent_core.py and exposes it as HTTP endpoints.

ENDPOINTS
    GET  /health              — agent status + capability flags
    POST /insert              — insert text into one ACI field
    POST /insert-batch        — insert text into multiple fields in sequence
    POST /test-field          — dry-run: can we locate this field?
    POST /probe               — dry-run: full TX32 resolution diagnostics
    GET  /dump-controls       — dump all TX32 controls in current view
    POST /read-field          — read current text from a field
    GET  /get-current-section — detect current active tab/section
    GET  /calibrate           — discover all controls (TX32-aware, fixed)
    GET  /list-windows        — list all open top-level windows
    POST /reload-maps         — clear field map cache
    GET  /learned-targets     — view all learned targeting strategies

HOW TO RUN
    python desktop_agent/agent.py
"""

import sys
import os
import time
import logging

# Ensure agent_core is importable from the same directory
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from flask import Flask, request, jsonify
import agent_core as core

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format='[agent] %(asctime)s %(levelname)s: %(message)s',
    datefmt='%H:%M:%S',
)
log = logging.getLogger('cacc_agent')

# ── Flask app ─────────────────────────────────────────────────────────────────

app = Flask(__name__)

# ── GET /health ───────────────────────────────────────────────────────────────

@app.route('/health', methods=['GET'])
def health():
    """Agent status and capability flags."""
    learned = core.load_learned()
    return jsonify({
        'ok':              True,
        'agent':           'cacc-aci-agent',
        'version':         '3.0.0',
        'phase':           2,
        'pywinauto':       core.PYWINAUTO_AVAILABLE,
        'pyperclip':       core.PYPERCLIP_AVAILABLE,
        'pil':             core.PIL_AVAILABLE,
        'win32':           core.WIN32_AVAILABLE,
        'port':            core.AGENT_PORT,
        'learned_targets': len(learned),
        'max_retries':     core.MAX_RETRIES,
        'verify_enabled':  core.VERIFY_INSERTION,
    })

# ── POST /insert ──────────────────────────────────────────────────────────────

@app.route('/insert', methods=['POST'])
def insert():
    """
    Insert text into a single ACI field.

    Request:  { fieldId, text, formType }
    Response: { ok, inserted, method, verified, verifyMethod,
                fieldId, fieldLabel, attempts, diagnostics }
    """
    data      = request.get_json(force=True, silent=True) or {}
    field_id  = str(data.get('fieldId', '')).strip()
    text      = str(data.get('text', '')).strip()
    form_type = str(data.get('formType', '1004')).strip()

    if not field_id:
        return jsonify({'ok': False, 'error': 'fieldId is required'}), 400
    if not text:
        return jsonify({'ok': False, 'error': 'text is required'}), 400

    # Stub mode — pywinauto not installed
    if not core.PYWINAUTO_AVAILABLE:
        log.info(f"[STUB] insert '{field_id}' ({len(text)} chars)")
        return jsonify({
            'ok': True, 'inserted': False, 'method': 'stub',
            'message': 'pywinauto not available — install on Windows to enable ACI automation.',
        })

    field_map    = core.load_field_map(form_type)
    field_cfg    = field_map.get(field_id, {'label': field_id})
    field_label  = field_cfg.get('label', field_id)

    log.info(f"INSERT '{field_label}' (id={field_id} form={form_type} chars={len(text)})")

    aci = core.connect_uia()
    if not aci:
        core.capture_screenshot(f'no_aci_{field_id}')
        return jsonify({
            'ok': False,
            'error': 'Could not connect to ACI. Make sure ACI is open with a report loaded.',
        }), 503

    try:
        main = core.ensure_main_report_surface(app=aci)
        win_sig = (main.window_text() or '') if main else ''
    except Exception:
        win_sig = ''

    # Attempt insertion with retries
    result = {'success': False, 'method': 'none', 'attempts': [],
               'tx32_ctrl': None, 'diagnostics': {}}
    for attempt_n in range(1, core.MAX_RETRIES + 1):
        log.info(f"  Attempt {attempt_n}/{core.MAX_RETRIES}")
        result = core.insert_field(aci, field_cfg, text, form_type, field_id)
        if result['success']:
            break
        time.sleep(0.5)

    if not result['success']:
        shot = core.capture_screenshot(f'insert_fail_{field_id}')
        log.error(f"  ✗ All strategies failed for '{field_label}'. "
                  f"Attempts: {result['attempts']}")
        return jsonify({
            'ok':          False,
            'error':       f"Insertion failed after {core.MAX_RETRIES} attempts",
            'fieldId':     field_id,
            'fieldLabel':  field_label,
            'attempts':    result['attempts'],
            'diagnostics': result.get('diagnostics', {}),
            'screenshot':  shot,
        }), 500

    # Verification — non-blocking: a readback failure does NOT report insertion as failed.
    # The paste went through (insertion_ok=True). We just may not be able to confirm it.
    verify_mode = str(field_cfg.get('verification_mode', '')).strip().lower()
    verify = {'passed': False, 'method': 'skipped', 'actual_preview': ''}
    if verify_mode == 'skip':
        verify = {'passed': False, 'method': 'skipped_by_field_config', 'actual_preview': ''}
    elif core.VERIFY_INSERTION:
        time.sleep(0.2)
        verify = core.verify_insertion(
            aci, field_cfg, text, result.get('tx32_ctrl'))
        if not verify['passed']:
            # Readback failed — log a warning but do NOT treat as insertion failure.
            # ACI TX32 controls often return '' from window_text() right after paste.
            log.warning(f"  ✗ Readback inconclusive for '{field_label}' "
                        f"(method={verify['method']}) — insertion likely succeeded")
            core.capture_screenshot(f'verify_inconclusive_{field_id}')
            verify['method'] = 'readback_inconclusive'

    # Persist successful strategy
    diag = result.get('diagnostics', {})
    core.save_learned(form_type, field_id, {
        'label':            field_label,
        'tabName':          field_cfg.get('tab_name', ''),
        'strategy':         result['method'],
        'tx32_rect':        diag.get('tx32_rect'),
        'label_matched':    diag.get('label_text', field_label),
        'window_signature': win_sig,
        'verified':         verify['passed'],
        'insertion_ok':     True,   # paste/write was dispatched successfully
    })

    log.info(f"  DONE: method={result['method']} "
             f"verified={verify['passed']} verifyMethod={verify['method']}")

    return jsonify({
        'ok':           True,
        'inserted':     True,
        'verified':     verify['passed'],
        'verifyMethod': verify['method'],
        'method':       result['method'],
        'fieldId':      field_id,
        'fieldLabel':   field_label,
        'attempts':     result['attempts'],
        'diagnostics':  diag,
    })

# ── POST /insert-batch ────────────────────────────────────────────────────────

@app.route('/insert-batch', methods=['POST'])
def insert_batch():
    """
    Insert text into multiple ACI fields in sequence.

    Request:  { formType, fields: [{ fieldId, text }, ...] }
    Response: { ok, results: { fieldId: {...} }, errors: { fieldId: msg } }
    """
    data      = request.get_json(force=True, silent=True) or {}
    form_type = str(data.get('formType', '1004')).strip()
    fields    = data.get('fields', [])

    if not isinstance(fields, list) or not fields:
        return jsonify({'ok': False, 'error': 'fields must be a non-empty array'}), 400
    if len(fields) > 30:
        return jsonify({'ok': False, 'error': 'Maximum 30 fields per batch'}), 400

    if not core.PYWINAUTO_AVAILABLE:
        return jsonify({
            'ok': True,
            'results': {f.get('fieldId', '?'): {'ok': True, 'method': 'stub'}
                        for f in fields},
            'errors': {}, 'message': 'stub mode',
        })

    aci = core.connect_uia()
    if not aci:
        core.capture_screenshot('batch_no_aci')
        return jsonify({'ok': False, 'error': 'Could not connect to ACI.'}), 503

    try:
        main = core.ensure_main_report_surface(app=aci)
        win_sig = (main.window_text() or '') if main else ''
    except Exception:
        win_sig = ''

    field_map = core.load_field_map(form_type)
    results   = {}
    errors    = {}

    for item in fields:
        fid  = str(item.get('fieldId', '')).strip()
        text = str(item.get('text', '')).strip()
        if not fid or not text:
            errors[fid or '?'] = 'fieldId and text are required'
            continue

        field_cfg   = field_map.get(fid, {'label': fid})
        field_label = field_cfg.get('label', fid)
        log.info(f"BATCH '{field_label}' ({len(text)} chars)")

        result = {'success': False, 'method': 'none', 'attempts': [],
                   'tx32_ctrl': None, 'diagnostics': {}}
        for _ in range(core.MAX_RETRIES):
            result = core.insert_field(aci, field_cfg, text, form_type, fid)
            if result['success']:
                break
            time.sleep(0.5)

        if result['success']:
            verify_mode = str(field_cfg.get('verification_mode', '')).strip().lower()
            verify = {'passed': False, 'method': 'skipped', 'actual_preview': ''}
            if verify_mode == 'skip':
                verify = {'passed': False, 'method': 'skipped_by_field_config', 'actual_preview': ''}
            elif core.VERIFY_INSERTION:
                time.sleep(0.2)
                verify = core.verify_insertion(
                    aci, field_cfg, text, result.get('tx32_ctrl'))
            diag = result.get('diagnostics', {})
            core.save_learned(form_type, fid, {
                'label':            field_label,
                'tabName':          field_cfg.get('tab_name', ''),
                'strategy':         result['method'],
                'tx32_rect':        diag.get('tx32_rect'),
                'label_matched':    field_label,
                'window_signature': win_sig,
                'verified':         verify['passed'],
            })
            results[fid] = {
                'ok': True, 'method': result['method'],
                'verified': verify['passed'],
                'verifyMethod': verify['method'],
                'fieldLabel': field_label,
            }
        else:
            core.capture_screenshot(f'batch_fail_{fid}')
            errors[fid] = f"Insertion failed after {core.MAX_RETRIES} attempts"

        time.sleep(core.INSERT_DELAY_MS / 1000)

    return jsonify({'ok': True, 'results': results, 'errors': errors})

# ── POST /test-field ──────────────────────────────────────────────────────────

@app.route('/test-field', methods=['POST'])
def test_field():
    """
    Dry-run: locate a field and report whether it can be found, without inserting.

    Request:  { fieldId, formType }
    Response: { ok, found, strategies, tx32_candidates, learned_target }
    """
    data      = request.get_json(force=True, silent=True) or {}
    field_id  = str(data.get('fieldId', '')).strip()
    form_type = str(data.get('formType', '1004')).strip()

    if not field_id:
        return jsonify({'ok': False, 'error': 'fieldId is required'}), 400
    if not core.PYWINAUTO_AVAILABLE:
        return jsonify({'ok': True, 'found': False, 'message': 'stub mode'})

    field_map   = core.load_field_map(form_type)
    field_cfg   = field_map.get(field_id, {'label': field_id})
    field_label = field_cfg.get('label', field_id)
    aid         = field_cfg.get('automation_id') or ''
    ctrl_idx    = field_cfg.get('control_index')
    tab_name    = field_cfg.get('tab_name', '')
    aliases     = field_cfg.get('aliases', [])
    mode_probe  = core.probe_field_strategy(field_cfg, form_type)
    if mode_probe.get('supported') and field_cfg.get('mode_required'):
        return jsonify({
            'ok': True,
            'found': mode_probe.get('found', False),
            'fieldId': field_id,
            'fieldLabel': field_label,
            'formType': form_type,
            'tabName': tab_name,
            'strategies': {
                'field_mode': {
                    'found': mode_probe.get('found', False),
                    'method': mode_probe.get('method'),
                },
            },
            'tx32_candidates': [],
            'learned_target': core.get_learned(form_type, field_id),
        })

    aci = core.connect_uia()
    if not aci:
        return jsonify({'ok': False, 'error': 'Could not connect to ACI.'}), 503

    main_win   = core.ensure_main_report_surface(app=aci)
    strategies = {}

    if mode_probe.get('supported'):
        strategies['field_mode'] = {
            'found': mode_probe.get('found', False),
            'method': mode_probe.get('method'),
        }

    # Test automation_id
    if aid:
        try:
            main_win.child_window(auto_id=aid, control_type='Edit').wrapper_object()
            strategies['automation_id'] = {'found': True, 'value': aid}
        except Exception as e:
            strategies['automation_id'] = {'found': False, 'error': str(e)[:120]}
    else:
        strategies['automation_id'] = {'found': False, 'error': 'not configured'}

    # Test control_index
    if ctrl_idx is not None and isinstance(ctrl_idx, int):
        try:
            edits = main_win.children(control_type='Edit')
            if ctrl_idx < len(edits):
                strategies['control_index'] = {'found': True, 'value': ctrl_idx,
                                               'total': len(edits)}
            else:
                strategies['control_index'] = {'found': False,
                                               'error': f'{ctrl_idx} >= {len(edits)}'}
        except Exception as e:
            strategies['control_index'] = {'found': False, 'error': str(e)[:120]}
    else:
        strategies['control_index'] = {'found': False, 'error': 'not configured'}

    # Test exact label
    try:
        main_win.child_window(title=field_label, control_type='Edit').wrapper_object()
        strategies['label_exact'] = {'found': True, 'value': field_label}
    except Exception as e:
        strategies['label_exact'] = {'found': False, 'error': str(e)[:120]}

    # Test TX32 label proximity
    tx32_candidates = []
    app32 = core.connect_win32()
    if app32:
        try:
            win32_win = core.ensure_main_report_surface(app32=app32)
            if tab_name:
                core.navigate_tab(win32_win, tab_name, form_type, field_cfg)
                time.sleep(0.4)
            ctrl, score, method = core.locate_field_tx32(
                win32_win, field_cfg, form_type)
            strategies['tx32_label_proximity'] = {
                'found': ctrl is not None, 'score': score, 'method': method}
            disc = core.discover_tx32(win32_win)
            for c in disc['content_controls']:
                r = c['rect']
                tx32_candidates.append({
                    'text': c['text'][:60],
                    'left': r.left, 'top': r.top,
                    'width': c['width'], 'height': c['height'],
                })
        except Exception as e:
            strategies['tx32_label_proximity'] = {
                'found': False, 'error': str(e)[:120]}
    else:
        strategies['tx32_label_proximity'] = {
            'found': False, 'error': 'win32 connect failed'}

    found = any(v.get('found') for v in strategies.values())
    return jsonify({
        'ok':              True,
        'found':           found,
        'fieldId':         field_id,
        'fieldLabel':      field_label,
        'formType':        form_type,
        'tabName':         tab_name,
        'strategies':      strategies,
        'tx32_candidates': tx32_candidates,
        'learned_target':  core.get_learned(form_type, field_id),
    })

# ── POST /probe ───────────────────────────────────────────────────────────────

@app.route('/probe', methods=['POST'])
def probe():
    """
    Phase 2: Full TX32 resolution diagnostics without inserting.
    Navigate to tab, discover TX32 controls, score candidates.

    Request:  { fieldId, formType }
    Response: { ok, tx32_discovered, best_candidate, score, method, ... }
    """
    data      = request.get_json(force=True, silent=True) or {}
    field_id  = str(data.get('fieldId', '')).strip()
    form_type = str(data.get('formType', '1004')).strip()

    if not field_id:
        return jsonify({'ok': False, 'error': 'fieldId is required'}), 400
    if not core.PYWINAUTO_AVAILABLE:
        return jsonify({'ok': False, 'error': 'pywinauto not available'})

    field_map   = core.load_field_map(form_type)
    field_cfg   = field_map.get(field_id, {'label': field_id})
    field_label = field_cfg.get('label', field_id)
    tab_name    = field_cfg.get('tab_name', '')
    aliases     = field_cfg.get('aliases', [])
    mode_probe  = core.probe_field_strategy(field_cfg, form_type)

    if mode_probe.get('supported'):
        return jsonify({
            'ok': True,
            'fieldId': field_id,
            'fieldLabel': field_label,
            'formType': form_type,
            'tabName': tab_name,
            'tabNavigated': True,
            'tx32_discovered': {
                'total': 0,
                'title': 0,
                'content': 0,
                'labels': [],
                'all_content': [],
            },
            'best_candidate': None,
            'score': 100 if mode_probe.get('found') else 0,
            'method': mode_probe.get('method'),
            'learned_target': core.get_learned(form_type, field_id),
        })

    app32 = core.connect_win32()
    if not app32:
        return jsonify({'ok': False, 'error': 'Could not connect to ACI (win32).'}), 503

    win32_win     = core.ensure_main_report_surface(app32=app32)
    tab_navigated = False
    if tab_name:
        tab_navigated = core.navigate_tab(win32_win, tab_name, form_type, field_cfg)
        if tab_navigated:
            time.sleep(0.5)

    disc = core.discover_tx32(win32_win)
    ctrl, score, method = core.locate_field_tx32(win32_win, field_cfg, form_type)

    best = None
    if ctrl is not None:
        try:
            r    = ctrl.rectangle()
            best = {
                'left': r.left, 'top': r.top,
                'width': r.right - r.left, 'height': r.bottom - r.top,
                'text_preview': core.read_tx32(ctrl)[:100],
            }
        except Exception:
            best = {'error': 'could not read rect'}

    # Serialize all content controls for diagnostics
    all_content = []
    for c in disc['content_controls']:
        r = c['rect']
        all_content.append({
            'left': r.left, 'top': r.top,
            'width': c['width'], 'height': c['height'],
            'text': c['text'][:60],
        })

    return jsonify({
        'ok':            True,
        'fieldId':       field_id,
        'fieldLabel':    field_label,
        'formType':      form_type,
        'tabName':       tab_name,
        'tabNavigated':  tab_navigated,
        'tx32_discovered': {
            'total':    len(disc['all_tx32']),
            'title':    len(disc['title_controls']),
            'content':  len(disc['content_controls']),
            'labels':   disc['label_texts'][:20],
            'all_content': all_content,
        },
        'best_candidate': best,
        'score':          score,
        'method':         method,
        'learned_target': core.get_learned(form_type, field_id),
    })

# ── GET /dump-controls ────────────────────────────────────────────────────────

@app.route('/dump-controls', methods=['GET'])
def dump_controls():
    """
    Phase 2: Dump all TX32 controls in the current ACI view.
    Query params: ?tab=Neig  (optional — navigate to tab first)
    """
    if not core.PYWINAUTO_AVAILABLE:
        return jsonify({'ok': False, 'error': 'pywinauto not available'})

    tab_name = request.args.get('tab', '').strip()
    app32    = core.connect_win32()
    if not app32:
        return jsonify({'ok': False, 'error': 'Could not connect to ACI (win32).'}), 503

    win32_win = app32.top_window()
    win_title = core.window_signature(win32_win)

    if tab_name:
        core.navigate_tab(win32_win, tab_name)
        time.sleep(0.5)

    disc = core.discover_tx32(win32_win)

    def _ser(entries):
        out = []
        for e in entries:
            r = e['rect']
            out.append({
                'left': r.left, 'top': r.top,
                'width': e['width'], 'height': e['height'],
                'text': e['text'][:80],
            })
        return out

    return jsonify({
        'ok':              True,
        'window':          win_title,
        'tab_requested':   tab_name or None,
        'current_tab':     core.get_current_tab(win32_win),
        'total_tx32':      len(disc['all_tx32']),
        'title_controls':  _ser(disc['title_controls']),
        'content_controls': _ser(disc['content_controls']),
        'label_texts':     disc['label_texts'][:30],
    })

# ── POST /read-field ──────────────────────────────────────────────────────────

@app.route('/read-field', methods=['POST'])
def read_field():
    """
    Phase 2: Read current text from a field without inserting.

    Request:  { fieldId, formType, targetRect? }
    Response: { ok, fieldId, fieldLabel, text, method }
    """
    data      = request.get_json(force=True, silent=True) or {}
    field_id  = str(data.get('fieldId', '')).strip()
    form_type = str(data.get('formType', '1004')).strip()

    if not field_id:
        return jsonify({'ok': False, 'error': 'fieldId is required'}), 400
    if not core.PYWINAUTO_AVAILABLE:
        return jsonify({'ok': False, 'error': 'pywinauto not available'})

    field_map   = core.load_field_map(form_type)
    field_cfg   = field_map.get(field_id, {'label': field_id})
    field_label = field_cfg.get('label', field_id)
    tab_name    = field_cfg.get('tab_name', '')
    aliases     = field_cfg.get('aliases', [])
    target_rect = data.get('targetRect')

    app32 = core.connect_win32()
    if not app32:
        return jsonify({'ok': False, 'error': 'Could not connect to ACI (win32).'}), 503

    win32_win = core.ensure_main_report_surface(app32=app32)
    if tab_name:
        core.navigate_tab(win32_win, tab_name, form_type, field_cfg)
        time.sleep(0.5)

    ctrl = core.find_tx32_by_rect(win32_win, target_rect)
    score = None
    method = 'tx32_rect_match'
    if ctrl is None:
        ctrl, score, method = core.locate_field_tx32(win32_win, field_cfg, form_type)
    if ctrl is None:
        return jsonify({
            'ok': False, 'fieldId': field_id, 'fieldLabel': field_label,
            'error': 'Could not locate TX32 control for this field',
            'method': method,
        })

    text = core.read_tx32(ctrl)
    return jsonify({
        'ok':         True,
        'fieldId':    field_id,
        'fieldLabel': field_label,
        'text':       text,
        'chars':      len(text),
        'method':     f'tx32_readback:{method}',
        'score':      score,
    })

# ── GET /get-current-section ──────────────────────────────────────────────────

@app.route('/get-current-section', methods=['GET'])
def get_current_section():
    """
    Phase 2: Detect the currently active tab/section in ACI.
    Response: { ok, currentTab, windowTitle, tx32_label_texts }
    """
    if not core.PYWINAUTO_AVAILABLE:
        return jsonify({'ok': False, 'error': 'pywinauto not available'})

    app32 = core.connect_win32()
    if not app32:
        return jsonify({'ok': False, 'error': 'Could not connect to ACI (win32).'}), 503

    win32_win = core.ensure_main_report_surface(app32=app32)
    tab       = core.get_current_tab(win32_win)
    win_title = core.window_signature(win32_win)
    disc      = core.discover_tx32(win32_win)

    return jsonify({
        'ok':              True,
        'currentTab':      tab,
        'windowTitle':     win_title,
        'tx32_label_texts': disc['label_texts'][:20],
        'content_count':   len(disc['content_controls']),
    })

# ── GET /calibrate ────────────────────────────────────────────────────────────

@app.route('/calibrate', methods=['GET'])
def calibrate():
    """
    Phase 2 fixed calibration: discovers TX32 controls using descendants().

    The old calibration used children() and returned 0 controls because
    ACI's TX32 controls are nested deep in the hierarchy.
    This version uses descendants() and finds real controls.

    Query params: ?tab=Neig  (optional — navigate to tab before calibrating)
    Response: { ok, window, tab, tx32_controls, label_texts, total_controls }
    """
    if not core.PYWINAUTO_AVAILABLE:
        return jsonify({'ok': False, 'error': 'pywinauto not available'})

    tab_name = request.args.get('tab', '').strip()
    app32    = core.connect_win32()
    if not app32:
        return jsonify({'ok': False, 'error': 'Could not connect to ACI (win32).'}), 503

    win32_win = core.ensure_main_report_surface(app32=app32)
    win_title = core.window_signature(win32_win)

    if tab_name:
        core.navigate_tab(win32_win, tab_name)
        time.sleep(0.5)

    disc = core.discover_tx32(win32_win)

    # Build rich calibration output
    tx32_out = []
    for e in disc['all_tx32']:
        r = e['rect']
        tx32_out.append({
            'left':   r.left,
            'top':    r.top,
            'width':  e['width'],
            'height': e['height'],
            'text':   e['text'][:80],
            'type':   ('title' if e['height'] <= core.TX32_TITLE_MAX_H
                       else 'content' if e['height'] >= core.TX32_CONTENT_MIN_H
                       else 'mid'),
        })

    # Also try UIA for any standard Edit controls
    uia_controls = []
    try:
        aci_uia  = core.connect_uia()
        if aci_uia:
            main_win = core.ensure_main_report_surface(app=aci_uia)
            for ctrl in main_win.descendants(control_type='Edit'):
                try:
                    r   = ctrl.rectangle()
                    aid = ctrl.automation_id() or ''
                    cls = ctrl.class_name() or ''
                    uia_controls.append({
                        'automation_id': aid,
                        'class_name':    cls,
                        'left':  r.left, 'top': r.top,
                        'width': r.right - r.left, 'height': r.bottom - r.top,
                    })
                except Exception:
                    continue
    except Exception:
        pass

    return jsonify({
        'ok':            True,
        'window':        win_title,
        'tab_requested': tab_name or None,
        'current_tab':   core.get_current_tab(win32_win),
        'total_tx32':    len(disc['all_tx32']),
        'tx32_controls': tx32_out,
        'label_texts':   disc['label_texts'][:30],
        'uia_edit_controls': uia_controls[:20],
        'note': ('TX32 controls found via descendants() — Phase 2 fix. '
                 'Old calibration used children() and returned 0 controls.'),
    })

# ── GET /list-windows ─────────────────────────────────────────────────────────

@app.route('/list-windows', methods=['GET'])
def list_windows():
    """List all visible top-level windows (for debugging ACI window title)."""
    if not core.PYWINAUTO_AVAILABLE:
        return jsonify({'ok': False, 'error': 'pywinauto not available'})
    try:
        from pywinauto import Desktop
        windows = []
        for w in Desktop(backend='win32').windows():
            try:
                title = w.window_text() or ''
                cls   = w.class_name() or ''
                if title.strip():
                    windows.append({'title': title, 'class': cls})
            except Exception:
                continue
        return jsonify({'ok': True, 'windows': windows, 'count': len(windows)})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

# ── POST /reload-maps ─────────────────────────────────────────────────────────

@app.route('/reload-maps', methods=['POST'])
def reload_maps():
    """Clear the field map cache so updated JSON files are reloaded."""
    core.reload_field_maps()
    return jsonify({'ok': True, 'message': 'Field map cache cleared.'})

# ── GET /learned-targets ──────────────────────────────────────────────────────

@app.route('/learned-targets', methods=['GET'])
def learned_targets():
    """
    View all learned targeting strategies.
    Query params: ?formType=1004  (optional filter)
    """
    form_type = request.args.get('formType', '').strip()
    all_learned = core.load_learned()

    if form_type:
        filtered = {k: v for k, v in all_learned.items()
                    if v.get('formType') == form_type}
    else:
        filtered = all_learned

    return jsonify({
        'ok':     True,
        'count':  len(filtered),
        'filter': form_type or 'all',
        'targets': filtered,
    })

# ── GET /dump-all-controls ────────────────────────────────────────────────────

@app.route('/dump-all-controls', methods=['GET'])
def dump_all_controls():
    """
    Phase 2 diagnostic: dump EVERY descendant control in the ACI window.
    This is used to discover the real class names of tab buttons.

    Query params:
      ?max=200        (default 200 — limit results)
      ?filter=Neig    (optional — only show controls whose text contains this)

    Response: { ok, window, count, controls: [{class, control_type, text, left, top, w, h}] }
    """
    if not core.PYWINAUTO_AVAILABLE:
        return jsonify({'ok': False, 'error': 'pywinauto not available'})

    max_ctrls  = int(request.args.get('max', 200))
    text_filter = request.args.get('filter', '').strip().lower()

    app32 = core.connect_win32()
    if not app32:
        return jsonify({'ok': False, 'error': 'Could not connect to ACI (win32).'}), 503

    win32_win = core.ensure_main_report_surface(app32=app32)
    win_title = core.window_signature(win32_win)

    controls = []
    try:
        for ctrl in win32_win.descendants():
            try:
                txt = (ctrl.window_text() or '').strip()
                cls = (ctrl.class_name() or '').strip()
                r   = ctrl.rectangle()
                w   = r.right  - r.left
                h   = r.bottom - r.top
                # Skip invisible / zero-size controls
                if w <= 0 or h <= 0:
                    continue
                # Apply text filter if provided
                if text_filter and text_filter not in txt.lower():
                    continue
                controls.append({
                    'class':        cls,
                    'text':         txt[:60],
                    'left':         r.left,
                    'top':          r.top,
                    'width':        w,
                    'height':       h,
                })
                if len(controls) >= max_ctrls:
                    break
            except Exception:
                continue
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

    return jsonify({
        'ok':      True,
        'window':  win_title,
        'count':   len(controls),
        'filter':  text_filter or None,
        'controls': controls,
    })

# ── GET /dump-section-tabs ────────────────────────────────────────────────────

@app.route('/dump-section-tabs', methods=['GET'])
def dump_section_tabs():
    """
    Phase 2 diagnostic: enumerate children of ACISectionTabs and ACIRpdCompView.
    This reveals the real tab button structure so navigate_tab can be fixed.

    Response: { ok, section_tabs_children, rpd_comp_children, ... }
    """
    if not core.PYWINAUTO_AVAILABLE:
        return jsonify({'ok': False, 'error': 'pywinauto not available'})

    app32 = core.connect_win32()
    if not app32:
        return jsonify({'ok': False, 'error': 'Could not connect to ACI (win32).'}), 503

    win32_win = core.ensure_main_report_surface(app32=app32)
    win_title = core.window_signature(win32_win)

    def _enum_children(parent_ctrl, label):
        result = []
        try:
            children = parent_ctrl.children()
            for i, child in enumerate(children):
                try:
                    txt = (child.window_text() or '').strip()
                    cls = (child.class_name() or '').strip()
                    r   = child.rectangle()
                    result.append({
                        'index': i,
                        'class': cls,
                        'text':  txt[:60],
                        'left':  r.left,
                        'top':   r.top,
                        'width': r.right - r.left,
                        'height': r.bottom - r.top,
                    })
                except Exception as e:
                    result.append({'index': i, 'error': str(e)[:80]})
        except Exception as e:
            result = [{'error': f'{label} children() failed: {str(e)[:120]}'}]
        return result

    # 1. ACISectionTabs children
    section_tabs_info = {'found': False, 'rect': None, 'children': []}
    try:
        tabs_ctrl = win32_win.child_window(class_name='ACISectionTabs')
        r = tabs_ctrl.rectangle()
        section_tabs_info = {
            'found':    True,
            'rect':     {'left': r.left, 'top': r.top,
                         'width': r.right - r.left, 'height': r.bottom - r.top},
            'children': _enum_children(tabs_ctrl, 'ACISectionTabs'),
        }
    except Exception as e:
        section_tabs_info['error'] = str(e)[:120]

    # 2. ACIRpdCompView children (left navigation panel)
    rpd_comp_info = {'found': False, 'rect': None, 'children': []}
    try:
        rpd_ctrl = win32_win.child_window(class_name='ACIRpdCompView')
        r = rpd_ctrl.rectangle()
        rpd_comp_info = {
            'found':    True,
            'rect':     {'left': r.left, 'top': r.top,
                         'width': r.right - r.left, 'height': r.bottom - r.top},
            'children': _enum_children(rpd_ctrl, 'ACIRpdCompView'),
        }
    except Exception as e:
        rpd_comp_info['error'] = str(e)[:120]

    # 3. Also try descendants of ACISectionTabs (deeper walk)
    section_tabs_descendants = []
    try:
        tabs_ctrl = win32_win.child_window(class_name='ACISectionTabs')
        for ctrl in tabs_ctrl.descendants():
            try:
                txt = (ctrl.window_text() or '').strip()
                cls = (ctrl.class_name() or '').strip()
                r   = ctrl.rectangle()
                w   = r.right - r.left
                h   = r.bottom - r.top
                if w > 0 and h > 0:
                    section_tabs_descendants.append({
                        'class': cls, 'text': txt[:60],
                        'left': r.left, 'top': r.top,
                        'width': w, 'height': h,
                    })
            except Exception:
                continue
    except Exception as e:
        section_tabs_descendants = [{'error': str(e)[:120]}]

    return jsonify({
        'ok':                       True,
        'window':                   win_title,
        'section_tabs':             section_tabs_info,
        'rpd_comp_view':            rpd_comp_info,
        'section_tabs_descendants': section_tabs_descendants,
    })

# ── GET /screenshot ───────────────────────────────────────────────────────────

@app.route('/screenshot', methods=['GET'])
def screenshot():
    """
    Take a screenshot of the current screen and save it to screenshots/.
    Query params: ?label=my_label  (optional — used in filename)
    Response: { ok, path }
    """
    label = request.args.get('label', 'manual').strip() or 'manual'
    path  = core.capture_screenshot(label)
    if path:
        return jsonify({'ok': True, 'path': path})
    return jsonify({'ok': False, 'error': 'Screenshot failed (PIL not available or disabled)'}), 500

# ── GET /dump-tx32-visibility ─────────────────────────────────────────────────

@app.route('/dump-tx32-visibility', methods=['GET'])
def dump_tx32_visibility():
    """
    Phase 2 diagnostic: dump ALL TX32 controls with their WS_VISIBLE state.

    This reveals which controls are in hidden views (addendum vs form view).
    After clicking a section tab, the visible set should change.

    Query params: ?tab=Neig  (optional — navigate to tab first)
    Response: { ok, window, tab_navigated, controls: [{visible, class, h, w, text}] }
    """
    if not core.PYWINAUTO_AVAILABLE:
        return jsonify({'ok': False, 'error': 'pywinauto not available'})

    tab_name = request.args.get('tab', '').strip()
    app32    = core.connect_win32()
    if not app32:
        return jsonify({'ok': False, 'error': 'Could not connect to ACI (win32).'}), 503

    win32_win     = core.ensure_main_report_surface(app32=app32)
    win_title     = core.window_signature(win32_win)
    tab_navigated = False

    if tab_name:
        core.bring_to_foreground(win32_win)
        time.sleep(0.2)
        tab_navigated = core.navigate_tab(win32_win, tab_name)
        if tab_navigated:
            time.sleep(1.0)  # extra wait for ACI to redraw

    # Take a screenshot after navigation for visual confirmation
    shot_path = core.capture_screenshot(f'tx32_vis_{tab_name or "notab"}')

    # Enumerate ALL TX32 controls with visibility state
    controls = []
    try:
        raw = win32_win.descendants(class_name='TX32')
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

    for ctrl in raw:
        try:
            r       = ctrl.rectangle()
            h       = r.bottom - r.top
            w       = r.right  - r.left
            if w <= 0 or h <= 0:
                continue
            visible = core._is_tx32_visible(ctrl)
            text    = ''
            try:
                text = (ctrl.window_text() or '').strip()[:80]
            except Exception:
                pass
            # Try to get parent class for context
            parent_cls = ''
            try:
                parent_cls = (ctrl.parent().class_name() or '').strip()
            except Exception:
                pass
            controls.append({
                'visible':    visible,
                'parent_cls': parent_cls,
                'height':     h,
                'width':      w,
                'left':       r.left,
                'top':        r.top,
                'text':       text,
                'type':       ('title'   if h <= core.TX32_TITLE_MAX_H
                               else 'content' if h >= core.TX32_CONTENT_MIN_H
                               else 'mid'),
            })
        except Exception:
            continue

    visible_count   = sum(1 for c in controls if c['visible'])
    invisible_count = sum(1 for c in controls if not c['visible'])

    return jsonify({
        'ok':             True,
        'window':         win_title,
        'tab_requested':  tab_name or None,
        'tab_navigated':  tab_navigated,
        'screenshot':     shot_path,
        'total_tx32':     len(controls),
        'visible_count':  visible_count,
        'invisible_count': invisible_count,
        'controls':       controls,
    })

# ── DELETE /learned-targets/<key> ─────────────────────────────────────────────

@app.route('/learned-targets/<path:key>', methods=['DELETE'])
def delete_learned_target(key):
    """Delete a specific learned target by key (formType::fieldId)."""
    import json, os
    all_learned = core.load_learned()
    if key not in all_learned:
        return jsonify({'ok': False, 'error': f"Key '{key}' not found"}), 404
    del all_learned[key]
    core._learned = all_learned
    try:
        with open(core.LEARNED_TARGETS_FILE, 'w') as f:
            json.dump(all_learned, f, indent=2)
        return jsonify({'ok': True, 'deleted': key, 'remaining': len(all_learned)})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == '__main__':
    import os
    log.info("=" * 60)
    log.info("CACC Writer — ACI Desktop Agent  (Phase 2)")
    log.info(f"Port:       {core.AGENT_PORT}")
    log.info(f"pywinauto:  {core.PYWINAUTO_AVAILABLE}")
    log.info(f"pyperclip:  {core.PYPERCLIP_AVAILABLE}")
    log.info(f"win32:      {core.WIN32_AVAILABLE}")
    log.info(f"PIL:        {core.PIL_AVAILABLE}")
    log.info(f"ACI pattern: {core.ACI_WINDOW_PATTERN}")
    log.info(f"Field maps: {core.FIELD_MAPS_DIR}")
    log.info(f"Learned:    {core.LEARNED_TARGETS_FILE}")
    log.info("=" * 60)

    if not core.PYWINAUTO_AVAILABLE:
        log.warning("Running in STUB MODE — pywinauto not installed.")
        log.warning("Install with: pip install pywinauto pyperclip pillow pywin32")

    # Pre-load field maps for common form types
    for ft in ('1004', '1025', '1073', '1004c', 'commercial'):
        core.load_field_map(ft)

    # Pre-load learned targets
    core.load_learned()

    app.run(host='127.0.0.1', port=core.AGENT_PORT, debug=False)
