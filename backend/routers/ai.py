"""
AI routes: /ai/chat, /ai/analyze, /ai/agent, /ai/health
Migrated from _server.py — keeps the same request/response contract.
"""
import json
import os
import re
import ssl
import urllib.error
import urllib.request
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from ..ai_agent import (
    handle_agent_request,
    SessionManager,
    ZHIPU_API_KEY as AGENT_API_KEY,
    ZHIPU_MODEL as AGENT_MODEL,
    METRIC_FIELDS as AGENT_METRIC_FIELDS,
)

router = APIRouter()

# ── Project root (same as _server.py's DIR) ──
ROOT = Path(__file__).resolve().parents[2]

# ── Zhipu GLM API config (matches _server.py) ──


def _get_api_key():
    key = os.environ.get("ZAI_API_KEY", "")
    if key and key != "autoclaw-internal-proxy":
        return key
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Environment") as _key:
            val, _ = winreg.QueryValueEx(_key, "ZAI_API_KEY")
            return val
    except Exception:
        return key


ZHIPU_API_KEY = _get_api_key()
ZHIPU_API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
ZHIPU_MODEL = os.environ.get("ZAI_MODEL", "glm-4-flash")
MAX_TOKENS = int(os.environ.get("ZAI_MAX_TOKENS", "4096"))

SYSTEM_PROMPT = """你是一个专业的保险公司经营分析助手，服务于华安保险的管理层。你的职责是：
1. 分析分公司的保费、利润、赔付率、费用率、人力效能等经营数据
2. 识别经营风险、定位问题根源、提出可执行的管理建议
3. 回答用户关于经营指标含义、行业标准、改进方向的问题

分析原则：
- 用数据说话：所有结论必须基于提供的数据，不要编造数据
- 推理透明：说明判断依据，让用户理解你为什么这样分析
- 建议具体：不说"需要关注"，说"建议核查近3月大额赔案分布，对比去年同期看是否存在结构性变化"
- 语言简洁专业：面向保险公司管理人员，用行业术语但不过度学术化
- 态度客观中立：对事不对人，目标是帮助分公司改善经营

数据说明：
- 保费达成率 = 实际保费 / (年度计划 × 时间进度系数)，体现收入端进度
- 综合成本率(COR) = 1 - 经营利润/已赚保费，100%表示承保盈利
- 赔付率 = 已赚赔付/已赚保费，反映业务质量
- 费用率 = 已赚费用/已赚保费，反映运营效率
- 人均产能 = 保费/人数/时间进度系数，反映人效
- 所有百分比率指标内部用小数表示（0.85=85%），万元类和人数类用实际值"""

# ── Metric definitions (reuse from ai_agent) ──
METRIC_FIELDS = AGENT_METRIC_FIELDS

# ── Helper functions (from _server.py) ──


def _match_metrics(question):
    """Match metrics mentioned in the user question."""
    matched = []
    for field in METRIC_FIELDS:
        candidates = [field['k'], field['l']] + field.get('aliases', [])
        for candidate in candidates:
            if candidate and candidate in question:
                matched.append(field)
                break
    if not matched:
        group_map = {
            '保费': ['保费', '车险', '财产险', '人身险'],
            '效益': ['效益', '利润', '成本率', '赔付率', '费用率', 'COR'],
            '效能': ['效能', '人效', '产能', '人力成本', '利润率', '保费率'],
            '人员': ['人员', '人数', '编制'],
        }
        for gname, gkeywords in group_map.items():
            if any(kw in question for kw in gkeywords):
                matched.extend([f for f in METRIC_FIELDS if f['g'] == gname])
    if not matched:
        matched = METRIC_FIELDS
    seen = set()
    result = []
    for f in matched:
        if f['k'] not in seen:
            seen.add(f['k'])
            result.append(f)
    return result


def _filter_metrics(data, matched_keys, period, org):
    """Round and filter metric values."""
    result = {}
    for key in matched_keys:
        if key in data and data[key] is not None:
            val = data[key]
            if isinstance(val, (int, float)):
                if '%' in key or '达成' in key or '执行率' in key:
                    result[key] = round(val, 4)
                else:
                    result[key] = round(val, 2)
            else:
                result[key] = val
    return result


def _extract_data_for_question(question, data):
    """Extract relevant metric data for the user question."""
    actuals = data.get('actuals', {})
    merged = data.get('_merged', {})
    region_names = ['第一责任区', '第二责任区', '第三责任区', '第四责任区']
    branch_names = list(
        set(b['n'] for m in actuals.values() for b in m.get('branches', []))
    )
    mentioned_branches = [b for b in branch_names if b in question]
    mentioned_regions = [r for r in region_names if r in question]
    all_branches = (
        '全国' in question
        or '整体' in question
        or '所有' in question
        or '全部' in question
    )
    matched_fields = _match_metrics(question)
    matched_keys = [f['k'] for f in matched_fields]
    years = re.findall(r'20\d{2}', question)
    if not years:
        years = sorted(
            set(mk.split('-')[0] for mk in list(merged.keys()) + list(actuals.keys()))
        )
    if '近三年' in question or '三年' in question:
        max_year = max(years) if years else '2026'
        years = [str(int(max_year) - i) for i in range(2, -1, -1)]
    elif '近两年' in question or '两年' in question:
        max_year = max(years) if years else '2026'
        years = [str(int(max_year) - i) for i in range(1, -1, -1)]
    result = {
        'periods': {},
        'query': {
            'branches': mentioned_branches,
            'regions': mentioned_regions,
            'allBranches': all_branches,
            'metrics': [
                {'key': f['k'], 'label': f['l'], 'unit': f['u'], 'group': f['g']}
                for f in matched_fields
            ],
            'years': years,
        },
    }
    for mk in sorted(merged.keys()):
        yr = mk.split('-')[0]
        if yr not in years:
            continue
        if len(result['periods']) >= 6:
            break
        mdata = merged[mk]
        period_data = {'period': mk}
        if mentioned_branches:
            period_data['branches'] = {}
            for bn in mentioned_branches:
                b = next(
                    (x for x in mdata.get('branches', []) if x.get('n') == bn), None
                )
                if b:
                    period_data['branches'][bn] = _filter_metrics(
                        b.get('d', {}), matched_keys, mk, bn
                    )
        elif mentioned_regions:
            period_data['regions'] = {}
            for rn in mentioned_regions:
                rdata = mdata.get('regions', {}).get(rn, {})
                if rdata:
                    period_data['regions'][rn] = _filter_metrics(
                        rdata, matched_keys, mk, rn
                    )
        elif all_branches:
            period_data['national'] = _filter_metrics(
                mdata.get('national', {}), matched_keys, mk, '全国'
            )
            if matched_fields != METRIC_FIELDS:
                period_data['regions'] = {}
                for rn in region_names:
                    rdata = mdata.get('regions', {}).get(rn, {})
                    if rdata:
                        period_data['regions'][rn] = _filter_metrics(
                            rdata, matched_keys, mk, rn
                        )
        else:
            period_data['national'] = _filter_metrics(
                mdata.get('national', {}), matched_keys, mk, '全国'
            )
            if matched_fields != METRIC_FIELDS:
                period_data['regions'] = {}
                for rn in region_names:
                    rdata = mdata.get('regions', {}).get(rn, {})
                    if rdata:
                        period_data['regions'][rn] = _filter_metrics(
                            rdata, matched_keys, mk, rn
                        )
        result['periods'][mk] = period_data
    return result


# ── SSE streaming helper ──


def _stream_glm(payload):
    """Generator that yields SSE chunks from the GLM API."""
    ctx = ssl.create_default_context()
    try:
        resp = urllib.request.urlopen(
            urllib.request.Request(
                ZHIPU_API_URL,
                data=payload.encode('utf-8'),
                method='POST',
                headers={
                    'Authorization': f'Bearer {ZHIPU_API_KEY}',
                    'Content-Type': 'application/json',
                },
            ),
            context=ctx,
            timeout=60,
        )
        for line in resp:
            line = line.decode('utf-8').strip()
            if not line.startswith('data:'):
                continue
            data_str = line[5:].strip()
            if data_str == '[DONE]':
                yield 'data: [DONE]\n\n'
                break
            try:
                chunk = json.loads(data_str)
                delta = chunk.get('choices', [{}])[0].get('delta', {})
                content = delta.get('content', '')
                if content:
                    out = json.dumps({'content': content}, ensure_ascii=False)
                    yield f'data: {out}\n\n'
            except json.JSONDecodeError:
                continue
    except urllib.error.HTTPError as e:
        err_body = e.read().decode('utf-8', errors='replace')
        err_msg = json.dumps(
            {'error': f'API request failed ({e.code}): {err_body[:200]}'},
            ensure_ascii=False,
        )
        yield f'data: {err_msg}\n\n'
        yield 'data: [DONE]\n\n'
    except Exception as e:
        err_msg = json.dumps({'error': f'Request error: {str(e)}'}, ensure_ascii=False)
        yield f'data: {err_msg}\n\n'
        yield 'data: [DONE]\n\n'


# ════════════════════════════════════════════════════════════════
#  Routes
# ════════════════════════════════════════════════════════════════


@router.get("/ai/health")
def ai_health():
    """Health check: reports whether the AI API key is configured."""
    ok = bool(ZHIPU_API_KEY)
    return {
        'ok': ok,
        'aiEnabled': ok,
        'model': ZHIPU_MODEL,
        'hasKey': ok,
    }


@router.post("/ai/chat")
async def ai_chat(request: Request):
    """AI conversation endpoint with SSE streaming."""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON body")

    question = body.get('question', '')
    context = body.get('context', {})

    if not question:
        raise HTTPException(400, "missing question parameter")

    if not ZHIPU_API_KEY:

        def _err_gen():
            yield 'data: {"error": "API Key not configured, set ZAI_API_KEY env var"}\n\n'
            yield 'data: [DONE]\n\n'

        return StreamingResponse(_err_gen(), media_type='text/event-stream')

    # Build messages
    context_str = json.dumps(context, ensure_ascii=False, indent=2)
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": f"Below is platform business data (JSON):\n\n{context_str}\n\nPlease answer based on this data:",
        },
    ]
    if context.get('branches'):
        messages.append(
            {
                "role": "user",
                "content": "Please analyze each alerted branch, provide specific risks and suggestions",
            }
        )
    messages.append({"role": "user", "content": question})

    payload = json.dumps(
        {
            "model": ZHIPU_MODEL,
            "messages": messages,
            "stream": True,
            "temperature": 0.7,
            "max_tokens": 4096,
        },
        ensure_ascii=False,
    )

    return StreamingResponse(_stream_glm(payload), media_type='text/event-stream')


@router.post("/ai/analyze")
async def ai_analyze(request: Request):
    """Personalized AI analysis: smart data extraction + GLM streaming."""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON body")

    question = body.get('question', '')
    if not question:
        raise HTTPException(400, "missing question parameter")

    backup_path = ROOT / '_data_backup.json'
    with open(backup_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    data_subset = _extract_data_for_question(question, data)
    data_json = json.dumps(data_subset, ensure_ascii=False, indent=2)

    system_prompt = (
        SYSTEM_PROMPT
        + """

## Personalized Analysis Rules
- You are analyzing HuaAn Insurance branch business data
- Data is provided in JSON format with monthly metric data
- Ratio metrics (COR, loss ratio, achievement rate) are decimals (0.95=95%)
- Absolute metrics (premium, profit) are in wan-yuan
- Headcount metrics are in persons
- Must use provided real data, no fabrication
- If data insufficient, clearly state "Platform does not have this data"
- Analysis must be deep, not just listing numbers; interpret trends and causes"""
    )

    user_prompt = f"""Here is dashboard business data (JSON):

{data_json}

Please answer the user's question. Requirements:
1. All cited numbers must come from the above data, no fabrication
2. Trend analysis must clearly state period values and direction
3. Comparison analysis must calculate differences and explain meaning
4. If data coverage is limited (e.g. only 1 month), clearly state limitations

[User Question] {question}"""

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    payload = json.dumps(
        {
            "model": ZHIPU_MODEL,
            "messages": messages,
            "stream": True,
            "temperature": 0.3,
            "max_tokens": 4096,
        },
        ensure_ascii=False,
    )

    return StreamingResponse(_stream_glm(payload), media_type='text/event-stream')


@router.post("/ai/agent")
async def ai_agent(request: Request):
    """AI Agent: intent parsing -> query + compute -> GLM streaming."""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON body")

    question = body.get('question', '')
    session_id = body.get('sessionId', '')

    if not question:
        raise HTTPException(400, "missing question parameter")

    # 1. Intent parsing + query & compute
    result = handle_agent_request(question, session_id or None, str(ROOT))
    if 'error' in result:
        raise HTTPException(500, result['error'])

    messages = result['messages']
    sid = result['session_id']

    # 2. GLM streaming call
    _api_key = AGENT_API_KEY or ZHIPU_API_KEY
    _model = AGENT_MODEL or ZHIPU_MODEL
    payload = json.dumps(
        {
            'model': _model,
            'messages': messages,
            'stream': True,
            'temperature': 0.3,
            'max_tokens': MAX_TOKENS,
        },
        ensure_ascii=False,
    )

    def _agent_stream():
        # Yield sessionId as first metadata line (matches _server.py)
        yield f'data: {json.dumps({"sessionId": sid}, ensure_ascii=False)}\n\n'

        full_text = []
        ctx = ssl.create_default_context()
        try:
            resp = urllib.request.urlopen(
                urllib.request.Request(
                    ZHIPU_API_URL,
                    data=payload.encode('utf-8'),
                    method='POST',
                    headers={
                        'Authorization': f'Bearer {_api_key}',
                        'Content-Type': 'application/json',
                    },
                ),
                context=ctx,
                timeout=60,
            )
            for line in resp:
                line = line.decode('utf-8').strip()
                if not line.startswith('data:'):
                    continue
                data_str = line[5:].strip()
                if data_str == '[DONE]':
                    break
                try:
                    chunk = json.loads(data_str)
                    delta = chunk.get('choices', [{}])[0].get('delta', {})
                    content = delta.get('content', '')
                    if content:
                        full_text.append(content)
                        out = json.dumps({'content': content}, ensure_ascii=False)
                        yield f'data: {out}\n\n'
                except json.JSONDecodeError:
                    continue
        except urllib.error.HTTPError as e:
            err_body = e.read().decode('utf-8', errors='replace')
            err_msg = json.dumps(
                {'error': f'API request failed ({e.code}): {err_body[:200]}'},
                ensure_ascii=False,
            )
            yield f'data: {err_msg}\n\n'
        except Exception as e:
            err_msg = json.dumps(
                {'error': f'Request error: {str(e)}'}, ensure_ascii=False
            )
            yield f'data: {err_msg}\n\n'

        # Save conversation history
        if full_text:
            SessionManager.add_message(sid, 'assistant', ''.join(full_text))

        yield 'data: [DONE]\n\n'

    return StreamingResponse(_agent_stream(), media_type='text/event-stream')
