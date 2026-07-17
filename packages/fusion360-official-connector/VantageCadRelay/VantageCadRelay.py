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
ADDIN_VERSION = "0.1.1"
DEFAULT_PORT = 32145
ALLOWLIST = {
    "create_sketch",
    "create_extrude",
    "create_fillet",
    "create_chamfer",
    "create_shell",
    "create_pattern",
    "set_variable",
    "create_assembly",
    "feature_script",
    "verify_topology",
    "render_views",
    "create_checkpoint",
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


def execute_operation(operation: str, parameters: dict) -> dict:
    if operation not in ALLOWLIST:
        raise ValueError(f"Operation not allowlisted: {operation}")

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
        plane = root.xYConstructionPlane
        sketch = root.sketches.add(plane)
        sketch.name = str(parameters.get("name") or "VantageSketch")
        # Optional rectangle from width/height mm (Fusion internal units are cm)
        width_mm = float(parameters.get("widthMm") or parameters.get("width") or 40)
        height_mm = float(parameters.get("heightMm") or parameters.get("height") or 40)
        w = width_mm / 10.0
        h = height_mm / 10.0
        lines = sketch.sketchCurves.sketchLines
        lines.addTwoPointRectangle(
            adsk.core.Point3D.create(-w / 2, -h / 2, 0),
            adsk.core.Point3D.create(w / 2, h / 2, 0),
        )
        summary = document_summary()
        fp = fingerprint_from(summary, operation)
        return {
            "externalFeatureId": sketch.name,
            "output": {"operation": operation, "sketch": sketch.name},
            "topology": {"fingerprint": fp, "summary": summary},
            "render": {"mimeType": "image/svg+xml", "content": svg_checkpoint(sketch.name)},
            "checkpointRef": f"fusion-cp-{fp[:16]}",
        }

    if operation == "create_extrude":
        sketches = root.sketches
        if sketches.count < 1:
            raise RuntimeError("create_extrude requires an existing sketch (run create_sketch first).")
        sketch = sketches.item(sketches.count - 1)
        if sketch.profiles.count < 1:
            raise RuntimeError("Sketch has no closed profile to extrude.")
        profile = sketch.profiles.item(0)
        depth_mm = float(parameters.get("depthMm") or parameters.get("depth") or 10)
        distance = adsk.core.ValueInput.createByReal(depth_mm / 10.0)
        extrudes = root.features.extrudeFeatures
        ext_input = extrudes.createInput(profile, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
        ext_input.setDistanceExtent(False, distance)
        extrude = extrudes.add(ext_input)
        summary = document_summary()
        fp = fingerprint_from(summary, operation)
        return {
            "externalFeatureId": extrude.name,
            "output": {"operation": operation, "extrude": extrude.name, "depthMm": depth_mm},
            "topology": {"fingerprint": fp, "summary": summary},
            "render": {"mimeType": "image/svg+xml", "content": svg_checkpoint(extrude.name)},
            "checkpointRef": f"fusion-cp-{fp[:16]}",
        }

    # Remaining mutations are allowlisted but require explicit implementation / testing.
    raise RuntimeError(
        f"Operation '{operation}' is allowlisted but not yet implemented in the Vantage Fusion connector. "
        "Use create_sketch / create_extrude / verify_* in a disposable document first."
    )


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
