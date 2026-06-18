import http.client
import importlib.util
import json
import os
from pathlib import Path
import socketserver
import tempfile
import threading


ROOT = Path(__file__).resolve().parents[1]
SERVER_PATH = ROOT / "_server.py"


def load_server(temp_dir):
    os.environ["SERVER_DATA_DIR"] = str(temp_dir)
    os.environ["SERVER_PORT"] = "0"
    os.environ["ZAI_API_KEY"] = "test-key"
    os.environ["ZHIPU_API_URL"] = "http://127.0.0.1:1/should-not-be-called"
    spec = importlib.util.spec_from_file_location("server_under_test", SERVER_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def request(port, method, path, body=b"", headers=None):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    request_headers = dict(headers or {})
    request_headers.setdefault("Content-Length", str(len(body)))
    conn.request(method, path, body=body, headers=request_headers)
    response = conn.getresponse()
    data = response.read()
    result = response.status, response.getheaders(), data
    conn.close()
    return result


def assert_json(data, expected):
    actual = json.loads(data.decode("utf-8"))
    assert actual == expected, (actual, expected)


def main():
    original_cwd = os.getcwd()
    with tempfile.TemporaryDirectory() as temp:
        temp_dir = Path(temp)
        module = load_server(temp_dir)
        external_calls = []

        def blocked_urlopen(*args, **kwargs):
            external_calls.append((args, kwargs))
            raise AssertionError("external AI API call attempted")

        module.urllib.request.urlopen = blocked_urlopen
        socketserver.ThreadingTCPServer.allow_reuse_address = True
        server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), module.H)
        port = server.server_address[1]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        try:
            backup_path = temp_dir / "_data_backup.json"
            valid_body = json.dumps({"actuals": {}}).encode("utf-8")

            status, _, data = request(
                port,
                "POST",
                "/save-backup",
                valid_body,
                {"Origin": "https://evil.example", "Content-Type": "application/json"},
            )
            assert status == 403
            assert_json(data, {"ok": False, "error": "origin not allowed"})
            assert not backup_path.exists()

            status, headers, data = request(
                port,
                "POST",
                "/save-backup",
                valid_body,
                {"Origin": "http://localhost:8921", "Content-Type": "application/json"},
            )
            assert status == 200
            assert dict(headers).get("Access-Control-Allow-Origin") == "http://localhost:8921"
            assert backup_path.exists()
            assert json.loads(backup_path.read_text(encoding="utf-8")) == {"actuals": {}}

            backup_path.unlink()
            status, _, _ = request(
                port,
                "POST",
                "/save-backup",
                valid_body,
                {"Content-Type": "application/json"},
            )
            assert status == 200
            assert backup_path.exists()

            previous = backup_path.read_bytes()
            status, _, data = request(
                port,
                "POST",
                "/save-backup",
                b"not-json",
                {"Content-Type": "application/json"},
            )
            assert status == 400
            assert_json(data, {"ok": False, "error": "invalid JSON"})
            assert backup_path.read_bytes() == previous

            status, _, data = request(
                port,
                "POST",
                "/save-backup",
                b"",
                {"Content-Length": str(module.SAVE_BACKUP_MAX_BYTES + 1)},
            )
            assert status == 413
            assert_json(data, {"ok": False, "error": "request body too large"})

            status, _, data = request(
                port,
                "POST",
                "/ai/chat",
                b'{"question":"test"}',
                {"Origin": "https://evil.example", "Content-Type": "application/json"},
            )
            assert status == 403
            assert_json(data, {"ok": False, "error": "origin not allowed"})
            assert external_calls == []

            status, _, data = request(
                port,
                "POST",
                "/ai/chat",
                b"",
                {"Content-Length": str(module.AI_CHAT_MAX_BYTES + 1)},
            )
            assert status == 413
            assert_json(data, {"ok": False, "error": "request body too large"})
            assert external_calls == []

            status, _, data = request(
                port,
                "POST",
                "/ai/health",
                b"",
                {"Origin": "https://evil.example"},
            )
            assert status == 403
            assert_json(data, {"ok": False, "error": "origin not allowed"})

            status, _, data = request(
                port,
                "OPTIONS",
                "/ai/chat",
                b"",
                {"Origin": "https://evil.example"},
            )
            assert status == 403
            assert_json(data, {"ok": False, "error": "origin not allowed"})

            conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
            conn.putrequest("POST", "/save-backup")
            conn.putheader("Content-Length", "invalid")
            conn.endheaders()
            response = conn.getresponse()
            data = response.read()
            assert response.status == 400
            assert_json(data, {"ok": False, "error": "invalid Content-Length"})
            conn.close()

            print("PASS invalid Origin backup rejected without file write")
            print("PASS allowed localhost Origin backup accepted")
            print("PASS missing Origin backup accepted")
            print("PASS invalid JSON rejected without overwriting backup")
            print("PASS oversized request rejected")
            print("PASS invalid Origin AI chat rejected without external API call")
            print("PASS oversized AI chat rejected without external API call")
            print("PASS invalid Origin AI health POST rejected")
            print("PASS invalid Origin OPTIONS rejected")
            print("PASS invalid Content-Length rejected")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
            os.chdir(original_cwd)


if __name__ == "__main__":
    main()
