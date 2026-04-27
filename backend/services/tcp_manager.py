"""
MediCloud Multi-Device TCP Manager
===================================
Connects to ALL devices simultaneously — exactly like LiveHealth.
Each device runs in its own background thread.
IsClient: false = MediCloud connects TO the machine (this lab's mode).
IsClient: true  = Machine connects TO MediCloud.
"""

import socket
import threading
import time
import datetime
from database import SessionLocal
from models.models import LabResult, Patient, Device as DeviceModel
from parsers.astm_parser import auto_parse

# ── Per-device state ────────────────────────────────────────────────────────
# device_id → { running, connected, thread, logs, total }
device_states = {}
device_lock   = threading.Lock()

# Global server socket for server-mode devices
server_sockets = {}   # port → socket


# ── Logging ──────────────────────────────────────────────────────────────────
def add_log(device_id: int, msg: str, level: str = "info"):
    ts = datetime.datetime.now().strftime("%H:%M:%S")
    entry = {"time": ts, "msg": msg, "level": level}
    with device_lock:
        if device_id not in device_states:
            device_states[device_id] = _default_state()
        device_states[device_id]["logs"].append(entry)
        # keep last 100
        device_states[device_id]["logs"] = device_states[device_id]["logs"][-100:]
    print(f"[TCP/DEV-{device_id}/{level.upper()}] {msg}")


def _default_state():
    return {
        "running":   False,
        "connected": False,
        "thread":    None,
        "logs":      [],
        "total":     0,
        "last_barcode": None,
    }


# ── DB helpers ────────────────────────────────────────────────────────────────
def get_device(device_id: int):
    db = SessionLocal()
    d  = db.query(DeviceModel).filter(DeviceModel.id == device_id).first()
    db.close()
    return d

def set_device_online(device_id: int, online: bool):
    db = SessionLocal()
    d  = db.query(DeviceModel).filter(DeviceModel.id == device_id).first()
    if d:
        d.is_online = online
        db.commit()
    db.close()

def save_result(device_id: int, raw_data: str, device_type: str = "Hematology"):
    try:
        parsed  = auto_parse(raw_data, device_type)
        barcode = parsed.get("barcode") or "UNKNOWN"
        db      = SessionLocal()
        patient = db.query(Patient).filter(Patient.barcode == barcode).first()
        result  = LabResult(
            patient_id  = patient.id if patient else None,
            device_id   = device_id,
            barcode     = barcode,
            test_name   = f"{parsed.get('device_type','Unknown')} ({len(parsed.get('parameters',[]))} params)",
            raw_data    = raw_data,
            parsed_data = parsed,
            status      = "completed"
        )
        db.add(result)
        db.commit()
        rid = result.id
        db.close()
        with device_lock:
            if device_id in device_states:
                device_states[device_id]["total"]        += 1
                device_states[device_id]["last_barcode"]  = barcode
        add_log(device_id, f"✅ Result #{rid} saved — Barcode: {barcode} — {len(parsed.get('parameters',[]))} parameters", "success")
        return rid
    except Exception as e:
        add_log(device_id, f"❌ Save error: {e}", "error")
        return None


# ── ASTM receive ──────────────────────────────────────────────────────────────
def receive_astm(sock: socket.socket, timeout: int = 300) -> str:
    raw = ""
    sock.settimeout(timeout)
    try:
        while True:
            chunk = sock.recv(4096)
            if not chunk:
                break
            raw += chunk.decode("ascii", errors="ignore")
            if "L|1|N" in raw:
                break
    except socket.timeout:
        pass
    except Exception:
        pass
    return raw.strip()


# ── MODE 1: CLIENT — MediCloud connects TO machine (IsClient: false) ──────────
def client_thread_fn(device_id: int, ip: str, port: int, device_type: str, retry: int):
    add_log(device_id, f"🔵 CLIENT MODE — Connecting to {ip}:{port}", "info")
    while True:
        with device_lock:
            if not device_states.get(device_id, {}).get("running"):
                break
        try:
            add_log(device_id, f"🔗 Connecting to {ip}:{port}...", "info")
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(10)
            sock.connect((ip, port))

            with device_lock:
                if device_id in device_states:
                    device_states[device_id]["connected"] = True
            set_device_online(device_id, True)
            add_log(device_id, f"🟢 Connected to {ip}:{port}", "success")
            add_log(device_id, "⏳ Waiting for sample to be inserted...", "info")

            while True:
                with device_lock:
                    if not device_states.get(device_id, {}).get("running"):
                        break
                raw = receive_astm(sock, timeout=300)
                if not raw:
                    add_log(device_id, "⚠️ Connection closed by machine", "warn")
                    break
                add_log(device_id, f"📥 Received {len(raw)} bytes — parsing...", "info")
                save_result(device_id, raw, device_type)
                add_log(device_id, "⏳ Ready for next sample...", "info")

            sock.close()
        except ConnectionRefusedError:
            add_log(device_id, f"❌ Machine refused connection at {ip}:{port} — is machine ON?", "error")
        except socket.timeout:
            add_log(device_id, f"⏱️ Connection timeout to {ip}:{port}", "warn")
        except Exception as e:
            add_log(device_id, f"❌ Error: {e}", "error")

        with device_lock:
            if device_id in device_states:
                device_states[device_id]["connected"] = False
        set_device_online(device_id, False)

        with device_lock:
            if not device_states.get(device_id, {}).get("running"):
                break

        add_log(device_id, f"🔄 Reconnecting in {retry}s...", "info")
        for _ in range(retry):
            time.sleep(1)
            with device_lock:
                if not device_states.get(device_id, {}).get("running"):
                    break

    with device_lock:
        if device_id in device_states:
            device_states[device_id]["connected"] = False
            device_states[device_id]["running"]   = False
    set_device_online(device_id, False)
    add_log(device_id, "⏹ Client stopped", "warn")


# ── MODE 2: SERVER — Machine connects TO MediCloud (IsClient: true) ───────────
def server_thread_fn(device_id: int, port: int, device_type: str):
    global server_sockets
    add_log(device_id, f"🟢 SERVER MODE — Listening on port {port}", "info")
    try:
        srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        srv.bind(("0.0.0.0", port))
        srv.listen(5)
        srv.settimeout(1.0)
        server_sockets[port] = srv

        while True:
            with device_lock:
                if not device_states.get(device_id, {}).get("running"):
                    break
            try:
                conn, addr = srv.accept()
                with device_lock:
                    if device_id in device_states:
                        device_states[device_id]["connected"] = True
                set_device_online(device_id, True)
                add_log(device_id, f"🔌 Machine connected from {addr[0]}:{addr[1]}", "success")
                raw = receive_astm(conn)
                conn.close()
                with device_lock:
                    if device_id in device_states:
                        device_states[device_id]["connected"] = False
                set_device_online(device_id, False)
                if raw:
                    add_log(device_id, f"📥 Received {len(raw)} bytes — parsing...", "info")
                    save_result(device_id, raw, device_type)
                    add_log(device_id, "⏳ Waiting for next sample...", "info")
            except socket.timeout:
                continue
            except Exception as e:
                if device_states.get(device_id, {}).get("running"):
                    add_log(device_id, f"❌ Connection error: {e}", "error")
    except Exception as e:
        add_log(device_id, f"❌ Server error: {e}", "error")
    finally:
        try: srv.close()
        except: pass
        if port in server_sockets:
            del server_sockets[port]
    with device_lock:
        if device_id in device_states:
            device_states[device_id]["running"]   = False
            device_states[device_id]["connected"] = False
    set_device_online(device_id, False)
    add_log(device_id, "⏹ Server stopped", "warn")


# ── Public API ────────────────────────────────────────────────────────────────
def connect_device(device_id: int, retry: int = 10):
    """Start connection for a single device"""
    device = get_device(device_id)
    if not device:
        return False, "Device not found"

    with device_lock:
        if device_id not in device_states:
            device_states[device_id] = _default_state()
        if device_states[device_id]["running"]:
            return False, "Already running"
        device_states[device_id]["running"]   = True
        device_states[device_id]["connected"] = False
        device_states[device_id]["logs"]      = []

    if not device.is_client:
        # IsClient: false → MediCloud connects TO machine
        t = threading.Thread(
            target=client_thread_fn,
            args=(device_id, device.ip_address, device.port, device.device_type, retry),
            daemon=True
        )
    else:
        # IsClient: true → wait for machine to connect
        t = threading.Thread(
            target=server_thread_fn,
            args=(device_id, device.port, device.device_type),
            daemon=True
        )

    with device_lock:
        device_states[device_id]["thread"] = t
    t.start()
    return True, f"Started {'client' if not device.is_client else 'server'} for {device.name}"


def disconnect_device(device_id: int):
    """Stop connection for a single device"""
    with device_lock:
        if device_id in device_states:
            device_states[device_id]["running"]   = False
            device_states[device_id]["connected"] = False
    # Close server socket if server mode
    device = get_device(device_id)
    if device and device.is_client and device.port in server_sockets:
        try: server_sockets[device.port].close()
        except: pass
    set_device_online(device_id, False)
    add_log(device_id, "⏹ Disconnected by user", "warn")


def connect_all(retry: int = 10):
    """Connect to ALL devices simultaneously"""
    db      = SessionLocal()
    devices = db.query(DeviceModel).all()
    db.close()
    results = []
    for d in devices:
        ok, msg = connect_device(d.id, retry)
        results.append({"device_id": d.id, "name": d.name, "status": "started" if ok else "error", "message": msg})
    return results


def disconnect_all():
    """Disconnect all devices"""
    db      = SessionLocal()
    devices = db.query(DeviceModel).all()
    db.close()
    for d in devices:
        disconnect_device(d.id)


def get_device_state(device_id: int):
    with device_lock:
        return device_states.get(device_id, _default_state())


def get_all_states():
    with device_lock:
        return {did: {
            "running":      s["running"],
            "connected":    s["connected"],
            "total":        s["total"],
            "last_barcode": s["last_barcode"],
            "logs":         s["logs"][-20:],
        } for did, s in device_states.items()}
