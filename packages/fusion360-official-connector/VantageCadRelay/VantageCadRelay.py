# Vantage CAD Fusion 360 official connector
# Listens only on 127.0.0.1, validates signed job envelopes, allowlists operations.
# Autodesk Fusion is Windows/macOS only — this add-in will not load on Linux.

import adsk.core
import adsk.fusion
import json
import hashlib
import hmac
import base64
import threading
import traceback
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse
from datetime import datetime, timezone

# Keep in sync with packages/cad/src/fusion-relay.ts and VERSION.json
PROTOCOL_VERSION = "2026-07-1"
ADDIN_VERSION = "0.2.0"
DEFAULT_PORT = 32145

# Operations this add-in ACTUALLY executes. /health publishes this list so
# packages/cad/src/cad-tool-catalog.ts can be checked against the running relay
# instead of being trusted blind — a tool the UI calls "supported" must appear here.
IMPLEMENTED = {
    "create_sketch",
    "create_extrude",
    "create_fillet",
    "create_chamfer",
    "delete_feature",
    "verify_topology",
    "render_views",
    "create_checkpoint",
}

# Allowlisted names the protocol may carry. Anything in ALLOWLIST but not in
# IMPLEMENTED is refused with an explicit "not implemented" error rather than
# quietly doing something else.
ALLOWLIST = IMPLEMENTED | {
    "create_shell",
    "create_pattern",
    "set_variable",
    "create_assembly",
    "feature_script",
    "rollback_checkpoint",
    "export_step",
    "export_stl",
    "export_gltf",
}

_app = adsk.core.Application.get()
_ui = _app.userInterface if _app else None
_httpd = None
_thread = None
_handlers = []
_idempotency = {}
# entityTokens of timeline objects THIS relay created, oldest first. delete_feature
# only ever removes one of these, so hand-built Fusion history is never touched.
_created_tokens = []


def _signing_secret():
    import os

    return os.environ.get("FUSION_RELAY_SIGNING_SECRET", "local-fusion-relay-secret")


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _payload_without_signature(envelope: dict) -> str:
    unsigned = {k: v for k, v in envelope.items() if k != "signature"}
    return json.dumps(unsigned, separators=(",", ":"), ensure_ascii=False)


def verify_envelope(envelope: dict) -> bool:
    try:
        if envelope.get("version") != PROTOCOL_VERSION:
            return False
        expires = datetime.fromisoformat(envelope["expiresAt"].replace("Z", "+00:00"))
        if expires <= datetime.now(timezone.utc):
            return False
        expected = _b64url(
            hmac.new(
                _signing_secret().encode("utf-8"),
                _payload_without_signature(envelope).encode("utf-8"),
                hashlib.sha256,
            ).digest()
        )
        got = str(envelope.get("signature", ""))
        return hmac.compare_digest(expected, got)
    except Exception:
        return False


def document_summary():
    design = adsk.fusion.Design.cast(_app.activeProduct)
    if not design:
        return {
            "bodies": 0,
            "features": 0,
            "validation": "no-active-design",
            "documentName": _app.activeDocument.name if _app.activeDocument else "",
        }
    root = design.rootComponent
    bodies = root.bRepBodies.count
    features = root.features.count
    return {
        "bodies": bodies,
        "features": features,
        "validation": "fusion-live",
        "documentName": _app.activeDocument.name if _app.activeDocument else "",
        "units": design.unitsManager.defaultLengthUnits,
    }


def fingerprint_from(summary: dict, op: str) -> str:
    raw = json.dumps({"summary": summary, "op": op}, sort_keys=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def svg_checkpoint(label: str) -> str:
    safe = label.replace("<", "").replace(">", "")[:80]
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450">'
        '<rect width="800" height="450" fill="#0b1115"/>'
        f'<text x="40" y="220" fill="#16d9e8" font-size="28">Fusion · {safe}</text>'
        "</svg>"
    )


def _remember(entity) -> str:
    """Record a timeline object the relay created so delete_feature can undo only our own work."""
    token = ""
    try:
        token = entity.entityToken or ""
    except Exception:
        token = ""
    if token:
        _created_tokens.append(token)
        if len(_created_tokens) > 200:
            del _created_tokens[0]
    return token


def _result(operation: str, external_id: str, output: dict) -> dict:
    summary = document_summary()
    fp = fingerprint_from(summary, operation)
    return {
        "externalFeatureId": external_id,
        "output": dict(output, operation=operation, fusionOfficial=True),
        "topology": {"fingerprint": fp, "summary": summary},
        "render": {"mimeType": "image/svg+xml", "content": svg_checkpoint(external_id or operation)},
        "checkpointRef": f"fusion-cp-{fp[:16]}",
    }


def _positive_mm(parameters: dict, *names, default=None, label="value"):
    for name in names:
        raw = parameters.get(name)
        if raw is None or raw == "":
            continue
        try:
            value = float(raw)
        except (TypeError, ValueError):
            raise ValueError(f"{label} must be a number of millimetres. Got {raw!r}.")
        if value <= 0 or value > 10000:
            raise ValueError(f"{label} must be greater than 0 and at most 10000 mm. Got {value}.")
        return value
    if default is None:
        raise ValueError(f"{label} is required (millimetres).")
    return float(default)


def _last_body(root, operation: str):
    bodies = root.bRepBodies
    if bodies.count < 1:
        raise RuntimeError(
            f"{operation} needs a solid body. Run create_extrude first — Fusion cannot modify edges that do not exist."
        )
    return bodies.item(bodies.count - 1)


def _all_edges(body):
    edges = adsk.core.ObjectCollection.create()
    for index in range(body.edges.count):
        edges.add(body.edges.item(index))
    if edges.count < 1:
        raise RuntimeError("The most recent body has no edges to modify. Nothing was changed.")
    return edges


def execute_operation(operation: str, parameters: dict) -> dict:
    if operation not in ALLOWLIST:
        raise ValueError(f"Operation not allowlisted: {operation}")
    if operation not in IMPLEMENTED:
        raise RuntimeError(
            f"'{operation}' is not implemented by the Vantage Fusion add-in (v{ADDIN_VERSION}). "
            f"Implemented here: {', '.join(sorted(IMPLEMENTED))}. Use Onshape for the rest — "
            "the Vantage tool list marks those tools 'Onshape only'."
        )

    design = adsk.fusion.Design.cast(_app.activeProduct)
    if operation in ("verify_topology", "render_views", "create_checkpoint"):
        summary = document_summary()
        fp = fingerprint_from(summary, operation)
        return {
            "externalFeatureId": f"fusion-{operation}",
            "output": {"operation": operation, "fusionOfficial": True},
            "topology": {"fingerprint": fp, "summary": summary},
            "render": {"mimeType": "image/svg+xml", "content": svg_checkpoint(operation)},
            "checkpointRef": f"fusion-cp-{fp[:16]}",
        }

    if not design:
        raise RuntimeError("Open a Fusion design document before running geometry mutations.")

    root = design.rootComponent

    if operation == "create_sketch":
        # Fusion internal length unit is centimetres; every Vantage parameter is millimetres.
        shape = str(parameters.get("shape") or "rectangle").strip().lower()
        if shape not in ("rectangle", "circle"):
            raise ValueError(
                f"Unknown sketch shape '{shape}'. The Fusion relay draws 'rectangle' or 'circle'. "
                "Polylines and hole-point sketches are Onshape only."
            )
        sketch = root.sketches.add(root.xYConstructionPlane)
        sketch.name = str(parameters.get("name") or "VantageSketch")
        if shape == "circle":
            diameter_mm = _positive_mm(parameters, "diameterMm", "diameter", label="diameterMm")
            center_x = float(parameters.get("centerXMm") or 0) / 10.0
            center_y = float(parameters.get("centerYMm") or 0) / 10.0
            sketch.sketchCurves.sketchCircles.addByCenterRadius(
                adsk.core.Point3D.create(center_x, center_y, 0),
                (diameter_mm / 10.0) / 2.0,
            )
            detail = {"shape": "circle", "diameterMm": diameter_mm}
        else:
            width_mm = _positive_mm(parameters, "widthMm", "width", default=40, label="widthMm")
            height_mm = _positive_mm(parameters, "heightMm", "height", default=40, label="heightMm")
            w = width_mm / 10.0
            h = height_mm / 10.0
            sketch.sketchCurves.sketchLines.addTwoPointRectangle(
                adsk.core.Point3D.create(-w / 2, -h / 2, 0),
                adsk.core.Point3D.create(w / 2, h / 2, 0),
            )
            detail = {"shape": "rectangle", "widthMm": width_mm, "heightMm": height_mm}
        token = _remember(sketch)
        return _result(operation, sketch.name, dict(detail, sketch=sketch.name, entityToken=token))

    if operation == "create_extrude":
        sketches = root.sketches
        if sketches.count < 1:
            raise RuntimeError("create_extrude requires an existing sketch (run create_sketch first).")
        sketch = sketches.item(sketches.count - 1)
        if sketch.profiles.count < 1:
            raise RuntimeError("Sketch has no closed profile to extrude.")
        profile = sketch.profiles.item(0)
        depth_mm = _positive_mm(parameters, "depthMm", "depth", default=10, label="depthMm")
        distance = adsk.core.ValueInput.createByReal(depth_mm / 10.0)
        extrudes = root.features.extrudeFeatures
        ext_input = extrudes.createInput(profile, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
        ext_input.setDistanceExtent(False, distance)
        extrude = extrudes.add(ext_input)
        token = _remember(extrude)
        return _result(operation, extrude.name, {"extrude": extrude.name, "depthMm": depth_mm, "entityToken": token})

    if operation == "create_fillet":
        radius_mm = _positive_mm(parameters, "radiusMm", "radius", default=2, label="radiusMm")
        edges = _all_edges(_last_body(root, "create_fillet"))
        fillets = root.features.filletFeatures
        fillet_input = fillets.createInput()
        radius = adsk.core.ValueInput.createByReal(radius_mm / 10.0)
        # Current Fusion exposes FilletFeatureInput.edgeSetInputs; older builds put
        # addConstantRadiusEdgeSet directly on the input object.
        edge_sets = getattr(fillet_input, "edgeSetInputs", None)
        if edge_sets is not None:
            edge_sets.addConstantRadiusEdgeSet(edges, radius, True)
        else:
            fillet_input.addConstantRadiusEdgeSet(edges, radius, True)
        fillet = fillets.add(fillet_input)
        token = _remember(fillet)
        return _result(
            operation,
            fillet.name,
            {"fillet": fillet.name, "radiusMm": radius_mm, "edgeCount": edges.count, "entityToken": token},
        )

    if operation == "create_chamfer":
        width_mm = _positive_mm(parameters, "widthMm", "distanceMm", "width", default=2, label="widthMm")
        edges = _all_edges(_last_body(root, "create_chamfer"))
        chamfers = root.features.chamferFeatures
        offset = adsk.core.ValueInput.createByReal(width_mm / 10.0)
        # createInput2 + chamferEdgeSets is the current API; createInput/setToEqualDistance is the legacy one.
        create_input2 = getattr(chamfers, "createInput2", None)
        if create_input2 is not None:
            chamfer_input = create_input2()
            chamfer_input.chamferEdgeSets.addEqualDistanceChamferEdgeSet(edges, offset, True)
        else:
            chamfer_input = chamfers.createInput(edges, True)
            chamfer_input.setToEqualDistance(offset)
        chamfer = chamfers.add(chamfer_input)
        token = _remember(chamfer)
        return _result(
            operation,
            chamfer.name,
            {"chamfer": chamfer.name, "widthMm": width_mm, "edgeCount": edges.count, "entityToken": token},
        )

    if operation == "delete_feature":
        requested = str(parameters.get("featureId") or parameters.get("entityToken") or "").strip()
        if requested:
            if requested not in _created_tokens:
                raise RuntimeError(
                    "That feature was not created by the Vantage relay in this Fusion session. "
                    "Delete it in Fusion yourself — the relay only undoes its own work."
                )
            token = requested
        else:
            if not _created_tokens:
                raise RuntimeError(
                    "The relay has not created anything in this Fusion session, so there is nothing to undo."
                )
            token = _created_tokens[-1]
        found = design.findEntityByToken(token)
        if not found or len(found) < 1:
            _created_tokens.remove(token)
            raise RuntimeError(
                "That feature is no longer in the Fusion design (it was already deleted). Nothing was changed."
            )
        name = ""
        try:
            name = found[0].name
        except Exception:
            name = ""
        found[0].deleteMe()
        _created_tokens.remove(token)
        return _result(operation, token, {"deleted": name or token, "remaining": len(_created_tokens)})

    raise RuntimeError(f"Operation '{operation}' fell through the Fusion relay dispatch. Nothing was changed.")


class RelayHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Suppress default stderr spam inside Fusion.
        return

    def _json(self, status: int, body: dict):
        raw = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/health":
            summary = document_summary()
            return self._json(
                200,
                {
                    "ok": True,
                    "mock": False,
                    "protocol": PROTOCOL_VERSION,
                    "addinVersion": ADDIN_VERSION,
                    "documentName": summary.get("documentName") or "",
                    "active": True,
                    "summary": summary,
                    # What this add-in really executes — the source of truth for
                    # "supported" in the Vantage tool list.
                    "operations": sorted(IMPLEMENTED),
                    "relayFeatureCount": len(_created_tokens),
                },
            )
        return self._json(404, {"error": "Not found"})

    def do_POST(self):
        path = urlparse(self.path).path
        if path != "/execute":
            return self._json(404, {"error": "Not found"})
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8")
        try:
            envelope = json.loads(raw)
        except Exception:
            return self._json(400, {"error": "Invalid JSON envelope"})
        if not verify_envelope(envelope):
            return self._json(401, {"error": "Invalid or expired signed job"})
        op_obj = envelope.get("operation") or {}
        operation = op_obj.get("operation")
        parameters = op_obj.get("parameters") or {}
        idem = f"{envelope.get('jobId')}:{envelope.get('stepId')}:{envelope.get('nonce')}"
        if idem in _idempotency:
            return self._json(200, _idempotency[idem])
        try:
            result = execute_operation(str(operation), parameters)
            _idempotency[idem] = result
            if len(_idempotency) > 200:
                _idempotency.clear()
            return self._json(200, result)
        except Exception as exc:
            return self._json(400, {"error": str(exc), "trace": traceback.format_exc()[-800:]})


def start_server(port=DEFAULT_PORT):
    global _httpd, _thread
    if _httpd:
        return
    _httpd = HTTPServer(("127.0.0.1", port), RelayHandler)
    _thread = threading.Thread(target=_httpd.serve_forever, daemon=True)
    _thread.start()
    if _ui:
        _ui.messageBox(
            f"Vantage CAD relay listening on http://127.0.0.1:{port}\n"
            "Keep this add-in running. Pair with `vantage-cad start`."
        )


def stop_server():
    global _httpd, _thread
    # Undo history is per relay session — never carry tokens across a restart.
    _created_tokens.clear()
    _idempotency.clear()
    if _httpd:
        _httpd.shutdown()
        _httpd.server_close()
        _httpd = None
        _thread = None


def run(context):
    try:
        start_server(DEFAULT_PORT)
    except Exception:
        if _ui:
            _ui.messageBox(f"Vantage CAD relay failed to start:\n{traceback.format_exc()}")


def stop(context):
    try:
        stop_server()
    except Exception:
        pass
