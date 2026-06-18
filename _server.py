import http.server, socketserver, os, sys, json, urllib.request, urllib.error, ssl, threading

PORT = int(os.environ.get("SERVER_PORT", "8921"))
DIR = os.path.abspath(os.environ.get("SERVER_DATA_DIR", os.path.dirname(os.path.abspath(__file__))))
os.chdir(DIR)
ALLOWED_CORS_ORIGINS = {
    'http://127.0.0.1:8921',
    'http://localhost:8921',
}
SAVE_BACKUP_MAX_BYTES = 10 * 1024 * 1024
AI_CHAT_MAX_BYTES = 1 * 1024 * 1024

# ── Zhipu GLM API config ──
ZHIPU_API_KEY = os.environ.get("ZAI_API_KEY", "")
ZHIPU_API_URL = os.environ.get(
    "ZHIPU_API_URL",
    "https://open.bigmodel.cn/api/paas/v4/chat/completions",
)
ZHIPU_MODEL = "glm-4-flash"  # 性价比之选，可改为 glm-4 获得更好质量

SYSTEM_PROMPT = """你是一个专业的保险公司经营分析助手，服务于华安保险的管理层。你的职责是：
1. 分析分公司的保费、利润、赔付率、费用率、人力效能等经营数据
2. 识别经营风险、定位问题根源、提出可执行的管理建议
3. 回答用户关于经营指标含义、行业标准、改进方向的问题

分析原则：
- 用数据说话：所有结论必须基于提供的数据，不要编造数字
- 推理透明：说明判断依据，让用户理解你为什么这样分析
- 建议具体：不说「需要关注」，说「建议核查近3月大额赔案分布，对比去年同期看是否存在结构性变化」
- 语言简洁专业：面向保险公司管理人员，用行业术语但不过度学术化
- 态度客观中立：对事不对人，目标是帮助分公司改善经营

数据说明：
- 保费达成率 = 实际保费 / (年度计划 × 时间进度系数)，体现收入端进度
- 综合成本率(COR) = 1 - 经营利润/已赚保费，<100%表示承保盈利
- 赔付率 = 已赚赔付/已赚保费，反映业务质量
- 费用率 = 已赚费用/已赚保费，反映运营效率
- 人均产能 = 保费/人数/时间进度系数，反映人效
- 所有百分比率指标内部用小数表示（0.85=85%），万元类和人数类用实际值

🚫 严格禁止（违反即为不准确分析）：
1. 不要编造没有在数据中出现的数字、比率、金额
2. 不要声称「同比/环比变化」除非上下文明确给了对比期数据
3. 不要断言某分公司「低于全国平均」除非你明确看到了全国数据和该分公司的数据对比
4. 不确定时直接说「需要更多数据才能判断」，不要猜测填充
5. 不要把预警阈值当成行业标准——预警阈值是看板使用者自行设定的内部管理标准"""


class H(http.server.SimpleHTTPRequestHandler):

    # Force UTF-8 charset for text responses
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.txt': 'text/plain; charset=utf-8',
    }
    # Add UTF-8 charset for text files
    extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map)
    extensions_map['.html'] = 'text/html; charset=utf-8'
    extensions_map['.js'] = 'text/javascript; charset=utf-8'
    extensions_map['.css'] = 'text/css; charset=utf-8'
    extensions_map['.json'] = 'application/json; charset=utf-8'

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store,no-cache,must-revalidate,max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_OPTIONS(self):
        """Handle CORS preflight"""
        if not self._is_allowed_origin():
            self._send_json(403, {'ok': False, 'error': 'origin not allowed'})
            return
        self.send_response(200)
        self._send_cors()
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def _is_allowed_origin(self):
        origin = self.headers.get('Origin')
        return origin is None or origin in ALLOWED_CORS_ORIGINS

    def _send_cors(self):
        origin = self.headers.get('Origin')
        if origin in ALLOWED_CORS_ORIGINS:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')

    def _send_json(self, status, payload):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self._send_cors()
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode())

    def _read_request_body(self, max_bytes):
        raw_length = self.headers.get('Content-Length')
        try:
            if raw_length is None:
                raise ValueError
            length = int(raw_length)
            if length < 0:
                raise ValueError
        except (TypeError, ValueError):
            self._send_json(400, {'ok': False, 'error': 'invalid Content-Length'})
            return None
        if length > max_bytes:
            self._send_json(413, {'ok': False, 'error': 'request body too large'})
            return None
        return self.rfile.read(length)

    def _validate_backup_payload(self, data):
        try:
            payload = json.loads(data.decode('utf-8'))
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            raise ValueError('invalid JSON') from e
        if not isinstance(payload, dict):
            raise ValueError('backup payload must be a JSON object')
        if 'actuals' not in payload and '_plans' not in payload:
            raise ValueError('backup payload must contain actuals or _plans')

    def do_POST(self):
        if not self._is_allowed_origin():
            self._send_json(403, {'ok': False, 'error': 'origin not allowed'})
            return

        if self.path == '/save-backup':
            try:
                data = self._read_request_body(SAVE_BACKUP_MAX_BYTES)
                if data is None:
                    return
                self._validate_backup_payload(data)
                bkpath = os.path.join(DIR, '_data_backup.json')
                with open(bkpath, 'wb') as f:
                    f.write(data)
                self._send_json(200, {'ok': True, 'size': len(data)})
                print('[Backup] Saved', len(data), 'bytes to', bkpath, flush=True)
            except ValueError as e:
                self._send_json(400, {'ok': False, 'error': str(e)})
            except Exception as e:
                self._send_json(500, {'ok': False, 'error': str(e)})

        elif self.path == '/ai/chat':
            body = self._read_request_body(AI_CHAT_MAX_BYTES)
            if body is not None:
                self._handle_ai_chat(body)

        elif self.path == '/ai/health':
            self._handle_ai_health()

        else:
            self.send_response(404)
            self._send_cors()
            self.end_headers()

    def _handle_ai_health(self):
        """Check if AI API is available"""
        has_key = bool(ZHIPU_API_KEY)
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self._send_cors()
        self.end_headers()
        self.wfile.write(json.dumps({
            'ok': has_key,
            'model': ZHIPU_MODEL if has_key else None,
            'message': 'AI 服务已就绪' if has_key else '未配置 API Key，请在服务端设置 ZAI_API_KEY 环境变量'
        }).encode())

    def _handle_ai_chat(self, body):
        """Handle AI chat requests with SSE streaming"""
        if not ZHIPU_API_KEY:
            self.send_response(503)
            self.send_header('Content-Type', 'application/json')
            self._send_cors()
            self.end_headers()
            self.wfile.write(json.dumps({
                'error': 'AI 服务未配置，请设置 ZAI_API_KEY 环境变量'
            }).encode())
            return

        try:
            req = json.loads(body)
            question = req.get('question', '')
            context = req.get('context', {})

            if not question.strip():
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self._send_cors()
                self.end_headers()
                self.wfile.write(json.dumps({'error': '问题不能为空'}).encode())
                return

            # Build user message with context
            user_msg = self._build_user_message(question, context)

            # Call Zhipu API with streaming
            api_req = {
                "model": ZHIPU_MODEL,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_msg}
                ],
                "stream": True,
                "temperature": 0.7,
                "max_tokens": 2048
            }

            req_data = json.dumps(api_req).encode('utf-8')
            api_req_obj = urllib.request.Request(
                ZHIPU_API_URL,
                data=req_data,
                headers={
                    'Content-Type': 'application/json',
                    'Authorization': f'Bearer {ZHIPU_API_KEY}'
                },
                method='POST'
            )

            # Setup SSE response
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('Connection', 'keep-alive')
            self.send_header('X-Accel-Buffering', 'no')
            self._send_cors()
            self.end_headers()

            # Create SSL context that doesn't verify (for dev only)
            ctx = ssl.create_default_context()

            try:
                with urllib.request.urlopen(api_req_obj, context=ctx, timeout=60) as resp:
                    # Read SSE stream from Zhipu
                    buffer = b''
                    while True:
                        chunk = resp.read(4096)
                        if not chunk:
                            break
                        buffer += chunk
                        # Process complete SSE events
                        while b'\n\n' in buffer:
                            event_data, buffer = buffer.split(b'\n\n', 1)
                            lines = event_data.decode('utf-8').strip().split('\n')
                            for line in lines:
                                if line.startswith('data: '):
                                    data_str = line[6:]
                                    if data_str == '[DONE]':
                                        # Send done event
                                        self.wfile.write(b'data: [DONE]\n\n')
                                        self.wfile.flush()
                                        return
                                    try:
                                        data = json.loads(data_str)
                                        choices = data.get('choices', [])
                                        if choices:
                                            delta = choices[0].get('delta', {})
                                            content = delta.get('content', '')
                                            if content:
                                                sse_data = json.dumps({'content': content})
                                                self.wfile.write(f'data: {sse_data}\n\n'.encode('utf-8'))
                                                self.wfile.flush()
                                    except json.JSONDecodeError:
                                        pass
            except urllib.error.HTTPError as e:
                error_body = e.read().decode('utf-8', errors='replace')
                print(f'[AI] API Error {e.code}: {error_body}', flush=True)
                if e.code == 401:
                    err_msg = 'API Key 无效或已过期，请更新 ZAI_API_KEY 环境变量'
                elif e.code == 429:
                    err_msg = 'API 调用频率过高，请稍后重试'
                else:
                    err_msg = f'API调用失败({e.code})'
                self.wfile.write(f'data: {json.dumps({"error": err_msg})}\n\n'.encode('utf-8'))
                self.wfile.flush()
            except Exception as e:
                print(f'[AI] Stream Error: {e}', flush=True)
                self.wfile.write(f'data: {json.dumps({"error": f"网络异常: {str(e)}"})}\n\n'.encode('utf-8'))
                self.wfile.flush()

        except json.JSONDecodeError:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self._send_cors()
            self.end_headers()
            self.wfile.write(json.dumps({'error': '请求数据格式错误'}).encode())
        except Exception as e:
            print(f'[AI] Server Error: {e}', flush=True)
            try:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self._send_cors()
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode())
            except:
                pass

    def _build_user_message(self, question, context):
        """Build a structured user message with data context"""
        parts = []

        # Current period info
        period = context.get('period', '未知')
        parts.append(f"【当前分析周期】{period}")

        # Overall summary
        summary = context.get('summary', {})
        if summary:
            parts.append(f"\n【整体概况】")
            parts.append(f"- 高风险分公司: {summary.get('highRisk', 0)}家")
            parts.append(f"- 中风险分公司: {summary.get('midRisk', 0)}家")
            parts.append(f"- 告警总数: {summary.get('totalAlerts', 0)}条")
            parts.append(f"- 涉及分公司: {summary.get('involvedBranches', 0)}家")

        # Specific branch data if provided
        branches = context.get('branches', [])
        if branches:
            parts.append(f"\n【分公司数据】")
            for b in branches:
                parts.append(f"\n--- {b.get('name', '未知')} ---")
                parts.append(f"风险等级: {b.get('riskLevel', '未知')}")
                kpi = b.get('kpi', {})
                for k, v in kpi.items():
                    parts.append(f"- {k}: {v}")

        # Alert details
        alerts = context.get('alerts', [])
        if alerts:
            parts.append(f"\n【触发的预警】（共{len(alerts)}条）")
            for a in alerts[:10]:  # Limit to 10
                parts.append(f"- [{a.get('severity', '')}] {a.get('field', '')}: {a.get('value', '')}")

        # Comparison data (if previous month data available)
        comparison = context.get('comparison')
        if comparison:
            parts.append(f"\n【{comparison.get('label', '对比')}数据：{comparison.get('period', '')}】")
            parts.append("⚠️ 以下是上月同期数据，可用于环比分析。如果没有该数据，不要编造环比结论。")
            cn = comparison.get('national', {})
            if cn:
                parts.append(f"\n全国汇总（上月）：")
                for k, v in cn.items():
                    parts.append(f"- {k}: {v}")
            cb = comparison.get('branches', {})
            if cb:
                parts.append(f"\n各分公司（上月，仅列出有数据的分公司）：")
                for bname, kpi in cb.items():
                    parts.append(f"\n--- {bname}（上月）---")
                    for k, v in kpi.items():
                        parts.append(f"- {k}: {v}")

        # User question
        parts.append(f"\n【用户问题】{question}")
        parts.append("\n请基于以上数据进行分析，给出专业、简洁的回答。")

        return '\n'.join(parts)

    # ── Override GET to add CORS and AI health ──
    def do_GET(self):
        try:
            if self.path == '/ai/health':
                self._handle_ai_health()
            else:
                super().do_GET()
        except BrokenPipeError:
            pass
        except ConnectionResetError:
            pass
        except Exception as e:
            print(f'[GET Error] {self.path}: {e}', flush=True)
            try:
                self.send_response(500)
                self.end_headers()
            except:
                pass


def serve():
    print(f'http://localhost:{PORT}/', flush=True)
    print(f'AI endpoint: http://localhost:{PORT}/ai/chat', flush=True)
    print(f'AI model: {ZHIPU_MODEL}', flush=True)
    print(f'API Key: {"已配置" if ZHIPU_API_KEY else "❌ 未配置！请设置 ZAI_API_KEY 环境变量"}', flush=True)

    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H) as h:
        h.serve_forever()


if __name__ == '__main__':
    serve()
