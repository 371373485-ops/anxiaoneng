import http.server, socketserver, os, sys, json, urllib.request, urllib.error, ssl, threading, time, hashlib

# 导入 AI Agent 引擎
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    from ai_agent import handle_agent_request, SessionManager
except Exception as e:
    print(f'[Warning] ai_agent import failed: {e}', flush=True)
    handle_agent_request = None
    SessionManager = None

PORT = 8921
DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(DIR)

# ── Zhipu GLM API config ──
def _get_api_key():
    key = os.environ.get("ZAI_API_KEY", "")
    if key and key != "autoclaw-internal-proxy":
        return key
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Environment") as _key:
            val, _ = winreg.QueryValueEx(_key, "ZAI_API_KEY")
            print(f'[Config] API Key loaded from registry', flush=True)
            return val
    except Exception:
        return key

ZHIPU_API_KEY = _get_api_key()
ZHIPU_API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
ZHIPU_MODEL = os.environ.get("ZAI_MODEL", "glm-4-plus")
MAX_TOKENS = int(os.environ.get("ZAI_MAX_TOKENS", "4096"))

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
- 所有百分比率指标内部用小数表示（0.85=85%），万元类和人数类用实际值"""

# ══════════ 个性化分析：指标定义表 ══════════
METRIC_FIELDS = [
    {'g':'保费','k':'车险计划','l':'车险计划','u':'万元','aliases':['车险']},
    {'g':'保费','k':'车险实际','l':'车险实际','u':'万元','aliases':['车险保费']},
    {'g':'保费','k':'车险时间进度计划达成率','l':'车险达成率','u':'%','aliases':['车险达成']},
    {'g':'保费','k':'财产险计划','l':'财产险计划','u':'万元','aliases':['财产险']},
    {'g':'保费','k':'财产险实际','l':'财产险实际','u':'万元','aliases':['财产险保费']},
    {'g':'保费','k':'财产险时间进度计划达成率','l':'财产险达成率','u':'%','aliases':['财产险达成']},
    {'g':'保费','k':'人身险计划','l':'人身险计划','u':'万元','aliases':['人身险']},
    {'g':'保费','k':'人身险实际','l':'人身险实际','u':'万元','aliases':['人身险保费']},
    {'g':'保费','k':'人身险时间进度计划达成率','l':'人身险达成率','u':'%','aliases':['人身险达成']},
    {'g':'保费','k':'保费实际合计','l':'保费实际合计','u':'万元','aliases':['保费收入','总保费','保费合计']},
    {'g':'保费','k':'保费年度计划','l':'保费年度计划','u':'万元','aliases':['保费计划']},
    {'g':'保费','k':'已赚保费','l':'已赚保费','u':'万元','aliases':[]},
    {'g':'保费','k':'已赚保费计划','l':'已赚保费计划','u':'万元','aliases':[]},
    {'g':'保费','k':'时间进度计划达成率','l':'保费达成率','u':'%','aliases':['保费达成','收入达成']},
    {'g':'效益','k':'经营利润','l':'经营利润','u':'万元','aliases':['利润']},
    {'g':'效益','k':'当月经营利润','l':'当月经营利润','u':'万元','aliases':['当月利润']},
    {'g':'效益','k':'经营利润年度计划','l':'利润年度计划','u':'万元','aliases':['利润计划']},
    {'g':'效益','k':'时间进度达成率','l':'利润达成率','u':'%','aliases':['利润达成']},
    {'g':'效益','k':'综合成本率实际（整体利润口径）','l':'综合成本率','u':'%','aliases':['COR','成本率']},
    {'g':'效益','k':'综合成本率计划（整体利润口径）','l':'综合成本率计划','u':'%','aliases':['COR计划']},
    {'g':'效益','k':'与本年计划比较','l':'COR与计划差','u':'%','aliases':['COR偏差']},
    {'g':'效益','k':'已赚赔付率实际','l':'已赚赔付率','u':'%','aliases':['赔付率']},
    {'g':'效益','k':'已赚费用率实际','l':'已赚费用率','u':'%','aliases':['费用率']},
    {'g':'效能','k':'前台人均产能计划','l':'前台产能(计划)','u':'万元/人','aliases':[]},
    {'g':'效能','k':'前台人均产能实际','l':'前台产能(实际)','u':'万元/人','aliases':['前台产能']},
    {'g':'效能','k':'前台人人均产能计划达成率','l':'前台产能达成率','u':'%','aliases':[]},
    {'g':'效能','k':'后台人均产能计划','l':'后台产能(计划)','u':'万元/人','aliases':[]},
    {'g':'效能','k':'后台人均产能实际','l':'后台产能(实际)','u':'万元/人','aliases':['后台产能']},
    {'g':'效能','k':'后台人人均产能计划达成率','l':'后台产能达成率','u':'%','aliases':[]},
    {'g':'效能','k':'整体人均产能计划','l':'整体产能(计划)','u':'万元/人','aliases':[]},
    {'g':'效能','k':'整体人均产能实际','l':'整体产能(实际)','u':'万元/人','aliases':['人均产能','产能']},
    {'g':'效能','k':'整体人人均产能计划达成率','l':'整体产能达成率','u':'%','aliases':['产能达成率']},
    {'g':'效能','k':'前台人均利润计划','l':'前台人均利润(计划)','u':'万元/人','aliases':[]},
    {'g':'效能','k':'前台人均利润实际','l':'前台人均利润(实际)','u':'万元/人','aliases':['前台人均利润']},
    {'g':'效能','k':'前台人均利润达成率','l':'前台人均利润达成率','u':'%','aliases':[]},
    {'g':'效能','k':'后台人均利润计划','l':'后台人均利润(计划)','u':'万元/人','aliases':[]},
    {'g':'效能','k':'后台人均利润实际','l':'后台人均利润(实际)','u':'万元/人','aliases':['后台人均利润']},
    {'g':'效能','k':'后台人均利润达成率','l':'后台人均利润达成率','u':'%','aliases':[]},
    {'g':'效能','k':'整体人均利润计划','l':'整体人均利润(计划)','u':'万元/人','aliases':[]},
    {'g':'效能','k':'整体人均利润实际','l':'整体人均利润(实际)','u':'万元/人','aliases':['人均利润']},
    {'g':'效能','k':'整体人均利润达成率','l':'整体人均利润达成率','u':'%','aliases':['人均利润达成率']},
    {'g':'效能','k':'前台人力成本预算','l':'前台成本(预算)','u':'万元','aliases':[]},
    {'g':'效能','k':'前台人力成本实际','l':'前台成本(实际)','u':'万元','aliases':['前台成本']},
    {'g':'效能','k':'前台人力成本预算执行率','l':'前台成本执行率','u':'%','aliases':[]},
    {'g':'效能','k':'后台人力成本预算','l':'后台成本(预算)','u':'万元','aliases':[]},
    {'g':'效能','k':'后台人力成本实际','l':'后台成本(实际)','u':'万元','aliases':['后台成本']},
    {'g':'效能','k':'后台人力成本预算执行率','l':'后台成本执行率','u':'%','aliases':[]},
    {'g':'效能','k':'整体人力成本预算','l':'整体成本(预算)','u':'万元','aliases':[]},
    {'g':'效能','k':'整体人力成本实际','l':'整体成本(实际)','u':'万元','aliases':['人力成本']},
    {'g':'效能','k':'整体人力成本预算执行率','l':'整体成本执行率','u':'%','aliases':['成本执行率']},
    {'g':'效能','k':'前台人力成本保费率计划','l':'前台保费率(计划)','u':'%','aliases':[]},
    {'g':'效能','k':'前台人力成本保费率实际','l':'前台保费率(实际)','u':'%','aliases':['前台保费率']},
    {'g':'效能','k':'前台人力成本保费率计划执行率','l':'前台保费率执行率','u':'%','aliases':[]},
    {'g':'效能','k':'后台人力成本保费率预算','l':'后台保费率(计划)','u':'%','aliases':[]},
    {'g':'效能','k':'后台人力成本保费率实际','l':'后台保费率(实际)','u':'%','aliases':['后台保费率']},
    {'g':'效能','k':'后台人力成本保费率计划执行率','l':'后台保费率执行率','u':'%','aliases':[]},
    {'g':'效能','k':'整体人力成本保费率预算','l':'整体保费率(计划)','u':'%','aliases':[]},
    {'g':'效能','k':'整体人力成本保费率实际','l':'整体保费率(实际)','u':'%','aliases':['保费率','人力成本保费率']},
    {'g':'效能','k':'整体人力成本保费率计划执行率','l':'整体保费率执行率','u':'%','aliases':['保费率执行率']},
    {'g':'效能','k':'前台人力成本利润值计划','l':'前台利润值(计划)','u':'万元','aliases':[]},
    {'g':'效能','k':'前台人力成本利润值实际','l':'前台利润值(实际)','u':'万元','aliases':['前台利润值']},
    {'g':'效能','k':'后台人力成本利润值预算','l':'后台利润值(计划)','u':'万元','aliases':[]},
    {'g':'效能','k':'后台人力成本利润值实际','l':'后台利润值(实际)','u':'万元','aliases':['后台利润值']},
    {'g':'效能','k':'整体人力成本利润值预算','l':'整体利润值(计划)','u':'万元','aliases':[]},
    {'g':'效能','k':'整体人力成本利润值实际','l':'整体利润值(实际)','u':'万元','aliases':['利润值']},
    {'g':'人员','k':'前台人员计划','l':'前台计划','u':'人','aliases':[]},
    {'g':'人员','k':'前台人员实际','l':'前台实际','u':'人','aliases':['前台人数']},
    {'g':'人员','k':'前台平均人数','l':'前台平均','u':'人','aliases':[]},
    {'g':'人员','k':'前台人员计划执行率','l':'前台执行率','u':'%','aliases':[]},
    {'g':'人员','k':'后台人员计划','l':'后台计划','u':'人','aliases':[]},
    {'g':'人员','k':'后台人员实际','l':'后台实际','u':'人','aliases':['后台人数']},
    {'g':'人员','k':'后台平均人数','l':'后台平均','u':'人','aliases':[]},
    {'g':'人员','k':'后台人员计划执行率','l':'后台执行率','u':'%','aliases':[]},
    {'g':'人员','k':'整体人员计划','l':'整体计划','u':'人','aliases':['人员计划']},
    {'g':'人员','k':'整体人员实际','l':'整体实际','u':'人','aliases':['人数','人员']},
    {'g':'人员','k':'整体平均人数','l':'整体平均','u':'人','aliases':['平均人数']},
    {'g':'人员','k':'整体人员计划执行率','l':'整体执行率','u':'%','aliases':['人员执行率']},
]

import re as _re

def _match_metrics(question):
    matched = []
    for field in METRIC_FIELDS:
        candidates = [field['k'], field['l']] + field.get('aliases', [])
        for candidate in candidates:
            if candidate and candidate in question:
                matched.append(field)
                break
    if not matched:
        group_map = {'保费': ['保费','车险','财产险','人身险'],
                     '效益': ['效益','利润','成本率','赔付率','费用率','COR'],
                     '效能': ['效能','人效','产能','人力成本','利润值','保费率'],
                     '人员': ['人员','人数','编制']}
        for gname, gkeywords in group_map.items():
            if any(kw in question for kw in gkeywords):
                matched.extend([f for f in METRIC_FIELDS if f['g'] == gname])
    if not matched:
        matched = METRIC_FIELDS
    seen = set(); result = []
    for f in matched:
        if f['k'] not in seen:
            seen.add(f['k']); result.append(f)
    # 只在匹配到过多指标时截断（broad问题如"经营情况"会匹配整组）
    if len(result) > 8:
        result = result[:8]
    return result

def _filter_metrics(data, matched_keys, period, org):
    result = {}
    for key in matched_keys:
        if key in data and data[key] is not None:
            val = data[key]
            if isinstance(val, (int, float)):
                if '率' in key or '达成' in key or '执行率' in key:
                    result[key] = round(val, 4)
                else:
                    result[key] = round(val, 2)
            else:
                result[key] = val
    return result

def _extract_data_for_question(question, data):
    actuals = data.get('actuals', {})
    merged = data.get('_merged', {})
    region_names = ['第一责任区', '第二责任区', '第三责任区', '第四责任区']
    branch_names = list(set(b['n'] for m in actuals.values() for b in m.get('branches', [])))
    mentioned_branches = [b for b in branch_names if b in question]
    mentioned_regions = [r for r in region_names if r in question]
    all_branches = '全国' in question or '整体' in question or '所有' in question or '全部' in question
    matched_fields = _match_metrics(question)
    matched_keys = [f['k'] for f in matched_fields]
    years = _re.findall(r'20\d{2}', question)
    if not years:
        years = sorted(set(mk.split('-')[0] for mk in list(merged.keys()) + list(actuals.keys())))
    if '近三年' in question or '近3年' in question:
        max_year = max(years) if years else '2026'
        years = [str(int(max_year) - i) for i in range(2, -1, -1)]
    elif '近两年' in question or '近2年' in question:
        max_year = max(years) if years else '2026'
        years = [str(int(max_year) - i) for i in range(1, -1, -1)]
    result = {'periods': {}, 'query': {
        'branches': mentioned_branches, 'regions': mentioned_regions,
        'allBranches': all_branches,
        'metrics': [{'key': f['k'], 'label': f['l'], 'unit': f['u'], 'group': f['g']} for f in matched_fields],
        'years': years
    }}
    # 月份限制：按用户问的时间范围给数据，不人为截断
    max_periods = 24
    for mk in sorted(merged.keys()):
        yr = mk.split('-')[0]
        if yr not in years:
            continue
        if len(result['periods']) >= max_periods:
            break
        mdata = merged[mk]
        period_data = {'period': mk}
        if mentioned_branches:
            period_data['branches'] = {}
            for bn in mentioned_branches:
                b = next((x for x in mdata.get('branches', []) if x.get('n') == bn), None)
                if b:
                    period_data['branches'][bn] = _filter_metrics(b.get('d', {}), matched_keys, mk, bn)
        elif mentioned_regions:
            period_data['regions'] = {}
            for rn in mentioned_regions:
                rdata = mdata.get('regions', {}).get(rn, {})
                if rdata:
                    period_data['regions'][rn] = _filter_metrics(rdata, matched_keys, mk, rn)
        elif all_branches:
            period_data['national'] = _filter_metrics(mdata.get('national', {}), matched_keys, mk, '全国')
            # 只在有指定指标时才展开 regions，避免全量数据过大
            if matched_fields != METRIC_FIELDS:
                period_data['regions'] = {}
                for rn in region_names:
                    rdata = mdata.get('regions', {}).get(rn, {})
                    if rdata:
                        period_data['regions'][rn] = _filter_metrics(rdata, matched_keys, mk, rn)
        else:
            period_data['national'] = _filter_metrics(mdata.get('national', {}), matched_keys, mk, '全国')
            if matched_fields != METRIC_FIELDS:
                period_data['regions'] = {}
                for rn in region_names:
                    rdata = mdata.get('regions', {}).get(rn, {})
                    if rdata:
                        period_data['regions'][rn] = _filter_metrics(rdata, matched_keys, mk, rn)
        result['periods'][mk] = period_data
    return result


def _format_data_table(extracted, data):
    """将提取的数据子集格式化为紧凑文本表格，大幅减少 token 消耗"""
    lines = []
    query = extracted.get('query', {})
    periods = extracted.get('periods', {})
    branches = query.get('branches', [])
    regions = query.get('regions', [])
    all_b = query.get('allBranches', False)
    metrics = query.get('metrics', [])

    if not metrics:
        lines.append('（暂无匹配指标数据）')
        return '\n'.join(lines)

    # 构建指标 key→label 映射
    mlabel = {m['key']: m['label'] for m in metrics}
    munit = {m['key']: m['unit'] for m in metrics}
    mkeys = [m['key'] for m in metrics]

    # 按组织维度分组收集数据
    sorted_pks = sorted(periods.keys())

    if branches:
        for bn in branches:
            lines.append(f'\n【{bn}】')
            # 表头：月份 + 指标1 | 指标2 | ...
            header = ['月份'] + [mlabel.get(k, k) for k in mkeys]
            lines.append(' | '.join(header))
            lines.append(' | '.join(['---'] * len(header)))
            for pk in sorted_pks:
                pdata = periods.get(pk, {}).get('branches', {}).get(bn, {})
                if not pdata: continue
                row = [pk.split('-')[1] if '-' in pk else pk]  # 只显示月
                for k in mkeys:
                    v = pdata.get(k)
                    if v is None: row.append('-')
                    elif munit.get(k) == '%': row.append(f'{v*100:.2f}%')
                    elif munit.get(k) == '人': row.append(f'{v:.0f}人')
                    else: row.append(f'{v:.2f}')
                lines.append(' | '.join(row))
    elif regions:
        for rn in regions:
            lines.append(f'\n【{rn}】')
            header = ['月份'] + [mlabel.get(k, k) for k in mkeys]
            lines.append(' | '.join(header))
            lines.append(' | '.join(['---'] * len(header)))
            for pk in sorted_pks:
                pdata = periods.get(pk, {}).get('regions', {}).get(rn, {})
                if not pdata: continue
                row = [pk.split('-')[1] if '-' in pk else pk]
                for k in mkeys:
                    v = pdata.get(k)
                    if v is None: row.append('-')
                    elif munit.get(k) == '%': row.append(f'{v*100:.2f}%')
                    elif munit.get(k) == '人': row.append(f'{v:.0f}人')
                    else: row.append(f'{v:.2f}')
                lines.append(' | '.join(row))
    else:
        # 全国汇总
        lines.append('\n【全国汇总】')
        header = ['月份'] + [mlabel.get(k, k) for k in mkeys]
        lines.append(' | '.join(header))
        lines.append(' | '.join(['---'] * len(header)))
        for pk in sorted_pks:
            pdata = periods.get(pk, {}).get('national', {})
            if not pdata: continue
            row = [pk.split('-')[1] if '-' in pk else pk]
            for k in mkeys:
                v = pdata.get(k)
                if v is None: row.append('-')
                elif munit.get(k) == '%': row.append(f'{v*100:.2f}%')
                elif munit.get(k) == '人': row.append(f'{v:.0f}人')
                else: row.append(f'{v:.2f}')
            lines.append(' | '.join(row))
        # 责任区（如果有且数据不多）
        if regions or all_b:
            region_names = ['第一责任区','第二责任区','第三责任区','第四责任区']
            for rn in region_names:
                has_data = any(rn in periods.get(pk, {}).get('regions', {}) for pk in sorted_pks)
                if not has_data: continue
                lines.append(f'\n【{rn}】')
                header = ['月份'] + [mlabel.get(k, k) for k in mkeys]
                lines.append(' | '.join(header))
                lines.append(' | '.join(['---'] * len(header)))
                for pk in sorted_pks:
                    pdata = periods.get(pk, {}).get('regions', {}).get(rn, {})
                    if not pdata: continue
                    row = [pk.split('-')[1] if '-' in pk else pk]
                    for k in mkeys:
                        v = pdata.get(k)
                        if v is None: row.append('-')
                        elif munit.get(k) == '%': row.append(f'{v*100:.2f}%')
                        elif munit.get(k) == '人': row.append(f'{v:.0f}人')
                        else: row.append(f'{v:.2f}')
                    lines.append(' | '.join(row))

    result = '\n'.join(lines)
    # 如果结果太大（>8KB），截断提示
    if len(result) > 8000:
        result = result[:8000] + '\n...（数据较多，以上为摘要，如需完整数据请指定更精确的指标或时间范围）'
    return result


class H(http.server.SimpleHTTPRequestHandler):

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
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, PATCH, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_PATCH(self):
        if self.path.startswith('/api/remediation-tasks/'):
            self._handle_remediation_api()
        elif self.path.startswith('/api/agent-runs/'):
            self._handle_agent_api()
        else:
            self.send_response(404)
            self._send_cors()
            self.end_headers()

    def _send_cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')

    def do_POST(self):
        if self.path == '/save-backup':
            try:
                length = int(self.headers.get('Content-Length', 0))
                data = self.rfile.read(length)
                bkpath = os.path.join(DIR, '_data_backup.json')
                with open(bkpath, 'wb') as f:
                    f.write(data)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self._send_cors()
                self.end_headers()
                self.wfile.write(json.dumps({'ok': True, 'size': len(data)}).encode())
                print('[Backup] Saved', len(data), 'bytes to', bkpath, flush=True)
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self._send_cors()
                self.end_headers()
                self.wfile.write(json.dumps({'ok': False, 'error': str(e)}).encode())

        elif self.path == '/ai/chat':
            self._handle_ai_chat()

        elif self.path == '/ai/health':
            self._handle_ai_health()

        elif self.path == '/ai/analyze':
            self._handle_ai_analyze()

        elif self.path == '/ai/agent':
            self._handle_ai_agent()

        elif self.path.startswith('/api/diagnoses'):
            self._handle_diagnosis_api()

        elif self.path.startswith('/api/remediation-tasks'):
            self._handle_remediation_api()

        elif self.path.startswith('/api/agent-runs'):
            self._handle_agent_api()

        else:
            self.send_response(404)
            self._send_cors()
            self.end_headers()

    def _handle_ai_health(self):
        ok = bool(ZHIPU_API_KEY)
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self._send_cors()
        self.end_headers()
        self.wfile.write(json.dumps({'ok': ok, 'aiEnabled': ok, 'model': ZHIPU_MODEL, 'hasKey': ok}).encode())

    # ══════════ JSON 文件持久化辅助 ══════════
    def _load_json(self, filename):
        path = os.path.join(DIR, filename)
        try:
            with open(path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return {}

    def _save_json(self, filename, data):
        path = os.path.join(DIR, filename)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def _send_json(self, obj, code=200):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self._send_cors()
        self.end_headers()
        self.wfile.write(json.dumps(obj, ensure_ascii=False).encode())

    def _read_body(self):
        length = int(self.headers.get('Content-Length', 0))
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length).decode('utf-8'))

    # ══════════ /api/diagnoses ══════════
    def _handle_diagnosis_api(self):
        try:
            if self.path == '/api/diagnoses':
                body = self._read_body()
                diag_id = 'diag_' + hashlib.md5(
                    (body.get('branch', '') + body.get('period', '') + str(time.time())).encode()
                ).hexdigest()[:12]
                body['id'] = diag_id
                body['createdAt'] = time.strftime('%Y-%m-%dT%H:%M:%S')
                diagnoses = self._load_json('_diagnoses.json')
                diagnoses[diag_id] = body
                self._save_json('_diagnoses.json', diagnoses)
                self._send_json(body)
                print(f'[Diagnosis] Saved {diag_id} for {body.get("branch", "")}', flush=True)
                return

            if self.path.endswith('/interpretations'):
                diag_id = self.path.split('/')[-2]
                diagnoses = self._load_json('_diagnoses.json')
                if diag_id not in diagnoses:
                    self._send_json({'error': 'not found'}, 404)
                    return
                diagnosis = diagnoses[diag_id]
                context = {
                    'period': diagnosis.get('period'),
                    'branch': diagnosis.get('branch'),
                    'riskLevel': diagnosis.get('riskLevel'),
                    'summary': diagnosis.get('summary'),
                    'facts': diagnosis.get('facts', []),
                    'patterns': diagnosis.get('patterns', []),
                    'inferences': diagnosis.get('inferences', []),
                    'recommendations': diagnosis.get('recommendations', [])
                }
                question = '请基于以上诊断数据，生成结构化的 AI 深度解读报告，包括：1) 风险总结 2) 关键发现 3) 改进建议。每条建议需有标题和具体行动方案。'
                messages = [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": f"诊断数据（JSON）：\n{json.dumps(context, ensure_ascii=False, indent=2)}\n\n{question}"}
                ]
                payload = json.dumps({
                    "model": ZHIPU_MODEL,
                    "messages": messages,
                    "stream": False,
                    "temperature": 0.7,
                    "max_tokens": MAX_TOKENS
                }).encode('utf-8')
                req = urllist.Request(ZHIPU_API_URL, data=payload, method='POST')
                req.add_header('Authorization', f'Bearer {ZHIPU_API_KEY}')
                req.add_header('Content-Type', 'application/json')
                ctx = ssl.create_default_context()
                resp = urllib.request.urlopen(req, context=ctx, timeout=180)
                result = json.loads(resp.read().decode('utf-8'))
                ai_text = result.get('choices', [{}])[0].get('message', {}).get('content', '')
                interpretation = {
                    'id': 'interp_' + diag_id,
                    'diagnosisId': diag_id,
                    'summary': ai_text[:500] if ai_text else '',
                    'insights': [{'text': ai_text}],
                    'recommendations': [],
                    'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%S')
                }
                self._send_json(interpretation)
                print(f'[Diagnosis] AI interpretation generated for {diag_id}', flush=True)
                return

            self._send_json({'error': 'unknown path'}, 404)
        except Exception as e:
            print(f'[Diagnosis API Error] {e}', flush=True)
            self._send_json({'error': str(e)}, 500)

    # ══════════ /api/remediation-tasks ══════════
    def _handle_remediation_api(self):
        try:
            if self.path.startswith('/api/remediation-tasks/') and self.path.endswith('/reviews'):
                # POST /{id}/reviews
                task_id = self.path.split('/')[-2]
                body = self._read_body()
                tasks = self._load_json('_remediation_tasks.json')
                if task_id not in tasks:
                    self._send_json({'error': 'not found'}, 404)
                    return
                review = {
                    'id': 'rev_' + task_id + '_' + str(int(time.time())),
                    'taskId': task_id,
                    'diagnosisId': body.get('diagnosisId', ''),
                    'notes': body.get('notes', ''),
                    'createdAt': time.strftime('%Y-%m-%dT%H:%M:%S')
                }
                tasks[task_id].setdefault('reviews', []).append(review)
                self._save_json('_remediation_tasks.json', tasks)
                self._send_json(review)
                print(f'[Remediation] Review added to {task_id}', flush=True)
                return

            if self.path.startswith('/api/remediation-tasks/'):
                # PATCH /{id} — update status
                task_id = self.path.split('/')[-1]
                body = self._read_body()
                tasks = self._load_json('_remediation_tasks.json')
                if task_id not in tasks:
                    self._send_json({'error': 'not found'}, 404)
                    return
                for k, v in body.items():
                    tasks[task_id][k] = v
                tasks[task_id]['updatedAt'] = time.strftime('%Y-%m-%dT%H:%M:%S')
                self._save_json('_remediation_tasks.json', tasks)
                self._send_json(tasks[task_id])
                print(f'[Remediation] Updated {task_id}: {body}', flush=True)
                return

            if self.path == '/api/remediation-tasks':
                body = self._read_body()
                task_id = 'task_' + hashlib.md5(
                    (body.get('branch', '') + body.get('metric', '') + str(time.time())).encode()
                ).hexdigest()[:12]
                body['id'] = task_id
                body['status'] = body.get('status', 'draft')
                body['createdAt'] = time.strftime('%Y-%m-%dT%H:%M:%S')
                tasks = self._load_json('_remediation_tasks.json')
                tasks[task_id] = body
                self._save_json('_remediation_tasks.json', tasks)
                self._send_json(body)
                print(f'[Remediation] Created {task_id} for {body.get("branch", "")}', flush=True)
                return

            self._send_json({'error': 'unknown path'}, 404)
        except Exception as e:
            print(f'[Remediation API Error] {e}', flush=True)
            self._send_json({'error': str(e)}, 500)

    # ══════════ /api/agent-runs ══════════
    def _handle_agent_api(self):
        try:
            if self.path == '/api/agent-runs':
                # POST — start agent run
                body = self._read_body()
                run_id = 'run_' + hashlib.md5(
                    (body.get('branch', '') + str(time.time())).encode()
                ).hexdigest()[:12]
                run = {
                    'id': run_id,
                    'status': 'running',
                    'branch': body.get('branch', ''),
                    'period': body.get('period', ''),
                    'steps': [],
                    'result': None,
                    'createdAt': time.strftime('%Y-%m-%dT%H:%M:%S')
                }
                runs = self._load_json('_agent_runs.json')
                runs[run_id] = run
                self._save_json('_agent_runs.json', runs)
                self._send_json(run)
                print(f'[Agent] Started {run_id} for {body.get("branch", "")}', flush=True)
                return

            if self.path.endswith('/cancel'):
                run_id = self.path.split('/')[-2]
                runs = self._load_json('_agent_runs.json')
                if run_id not in runs:
                    self._send_json({'error': 'not found'}, 404)
                    return
                runs[run_id]['status'] = 'cancelled'
                runs[run_id]['updatedAt'] = time.strftime('%Y-%m-%dT%H:%M:%S')
                self._save_json('_agent_runs.json', runs)
                self._send_json(runs[run_id])
                print(f'[Agent] Cancelled {run_id}', flush=True)
                return

            if self.path.endswith('/inputs'):
                # POST — submit input for awaiting_input run
                run_id = self.path.split('/')[-2]
                body = self._read_body()
                runs = self._load_json('_agent_runs.json')
                if run_id not in runs:
                    self._send_json({'error': 'not found'}, 404)
                    return
                runs[run_id].setdefault('inputs', []).append(body)
                runs[run_id]['status'] = 'running'
                runs[run_id]['updatedAt'] = time.strftime('%Y-%m-%dT%H:%M:%S')
                self._save_json('_agent_runs.json', runs)
                self._send_json(runs[run_id])
                print(f'[Agent] Input submitted to {run_id}', flush=True)
                return

            if self.path.startswith('/api/agent-runs/'):
                # GET — query run status
                run_id = self.path.split('/')[-1]
                runs = self._load_json('_agent_runs.json')
                if run_id not in runs:
                    self._send_json({'error': 'not found'}, 404)
                    return
                self._send_json(runs[run_id])
                return

            self._send_json({'error': 'unknown path'}, 404)
        except Exception as e:
            print(f'[Agent API Error] {e}', flush=True)
            self._send_json({'error': str(e)}, 500)

    def _handle_ai_chat(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length).decode('utf-8'))
            question = body.get('question', '')
            context = body.get('context', {})

            if not question:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self._send_cors()
                self.end_headers()
                self.wfile.write(json.dumps({'error': '缺少 question 参数'}).encode())
                return

            if not ZHIPU_API_KEY:
                self.send_response(200)
                self.send_header('Content-Type', 'text/event-stream')
                self.send_header('Cache-Control', 'no-cache')
                self._send_cors()
                self.end_headers()
                self.wfile.write('data: {"error": "API Key 未配置，请设置 ZAI_API_KEY 环境变量"}\n\n'.encode('utf-8'))
                self.wfile.write(b'data: [DONE]\n\n')
                return

            # Build messages
            context_str = json.dumps(context, ensure_ascii=False, indent=2)
            messages = [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": f"以下是平台经营数据（JSON格式）：\n\n{context_str}\n\n请基于以上数据回答问题。"}
            ]
            if context.get('branches'):
                messages.append({"role": "user", "content": "请逐个分析有预警的分公司，给出具体的风险点和建议。"})
            messages.append({"role": "user", "content": question})

            payload = json.dumps({
                "model": ZHIPU_MODEL,
                "messages": messages,
                "stream": True,
                "temperature": 0.7,
                "max_tokens": 32768
            }).encode('utf-8')

            req = urllib.request.Request(ZHIPU_API_URL, data=payload, method='POST')
            req.add_header('Authorization', f'Bearer {ZHIPU_API_KEY}')
            req.add_header('Content-Type', 'application/json')

            ctx = ssl.create_default_context()

            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Cache-Control', 'no-cache')
            self._send_cors()
            self.end_headers()

            try:
                resp = urllib.request.urlopen(req, context=ctx, timeout=180)
                for line in resp:
                    line = line.decode('utf-8').strip()
                    if not line.startswith('data:'):
                        continue
                    data_str = line[5:].strip()
                    if data_str == '[DONE]':
                        self.wfile.write(b'data: [DONE]\n\n')
                        self.wfile.flush()
                        break
                    try:
                        chunk = json.loads(data_str)
                        delta = chunk.get('choices', [{}])[0].get('delta', {})
                        content = delta.get('content', '')
                        if content:
                            out = json.dumps({'content': content}, ensure_ascii=False)
                            self.wfile.write(f'data: {out}\n\n'.encode('utf-8'))
                            self.wfile.flush()
                    except json.JSONDecodeError:
                        continue
            except urllib.error.HTTPError as e:
                err_body = e.read().decode('utf-8', errors='replace')
                err_msg = json.dumps({'error': f'API请求失败({e.code}): {err_body[:200]}'}, ensure_ascii=False)
                self.wfile.write(f'data: {err_msg}\n\n'.encode('utf-8'))
                self.wfile.write(b'data: [DONE]\n\n')
                self.wfile.flush()
            except Exception as e:
                err_msg = json.dumps({'error': f'请求异常: {str(e)}'}, ensure_ascii=False)
                self.wfile.write(f'data: {err_msg}\n\n'.encode('utf-8'))
                self.wfile.write(b'data: [DONE]\n\n')
                self.wfile.flush()

        except Exception as e:
            print(f'[AI Chat Error] {e}', flush=True)
            try:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self._send_cors()
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode())
            except:
                pass

    def _handle_ai_analyze(self):
        """个性化 AI 分析：智能取数 + GLM 调用"""
        try:
            body = self._read_body()
            question = body.get('question', '')
            if not question:
                self._send_json({'error': '缺少 question 参数'}, 400)
                return
            backup_path = os.path.join(DIR, '_data_backup.json')
            with open(backup_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            data_subset = _extract_data_for_question(question, data)
            data_table = _format_data_table(data_subset, data)
            system_prompt = SYSTEM_PROMPT + """

## 个性化分析规则
- 你正在分析华安保险分公司的经营数据
- 数据以下方表格形式提供，已按用户问题智能筛选
- 表格中百分比已转为百分数（如98.47%），金额单位为万元，人数单位为人
- 回答时必须使用表格中的真实数据，禁止编造任何数字
- 如果数据不足以回答问题，明确说明"平台暂无此数据"
- 分析要有深度，不只是罗列数字，要解读趋势变化和可能的原因
- 所有引用的数据必须保留2位小数，百分比类带%号，金额类带万元单位
- 无论用户问什么时间范围、什么指标、什么机构、什么比较方式，都要基于数据给出完整回答
- 可以做同比、环比、排名、趋势、计划达成等任何分析维度
- 如果用户问的指标在数据中存在，必须找到并使用，不要说查不到
- **回答风格：极度精简**。数据用紧凑表格呈现（不要重复原始表格，只列关键对比/变化），每个指标1-2句话总结趋势+异常。绝不写长段落。整体回答控制在800字以内。"""
            user_prompt = f"""以下是看板中的经营数据（已按你的问题筛选并整理为表格）：

{data_table}

请回答用户的问题。要求：
1. 所有引用的数字必须来自以上表格，禁止编造
2. 趋势分析需明确标注各期数值和变化方向
3. 对比分析需计算差值并说明含义
4. 如数据覆盖范围不足（如只有 1 个月），明确说明局限性
5. **回答要极度精简**：数据用紧凑表格，每个指标1-2句话。不要重复原始表格，只列关键对比和变化。整体控制在800字以内。
6. 数据格式：2位小数+单位（98.47%、5,023.50万元）

【用户问题】{question}"""
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ]
            payload = json.dumps({
                "model": ZHIPU_MODEL,
                "messages": messages,
                "stream": False,
                "temperature": 0.3,
                "max_tokens": 32768
            }).encode('utf-8')
            req = urllib.request.Request(ZHIPU_API_URL, data=payload, method='POST')
            req.add_header('Authorization', f'Bearer {ZHIPU_API_KEY}')
            req.add_header('Content-Type', 'application/json')
            ctx = ssl.create_default_context()
            try:
                resp = urllib.request.urlopen(req, context=ctx, timeout=180)
                body = resp.read().decode('utf-8')
                result = json.loads(body)
                content = result.get('choices', [{}])[0].get('message', {}).get('content', '')
                if not content:
                    content = '（AI 未返回内容，请重试）'
                self._send_json({'content': content})
            except urllib.error.HTTPError as e:
                err_body = e.read().decode('utf-8', errors='replace')
                self._send_json({'error': f'API请求失败({e.code}): {err_body[:300]}'}, 500)
            except Exception as e:
                self._send_json({'error': f'请求异常: {str(e)}'}, 500)
        except Exception as e:
            print(f'[AI Analyze Error] {e}', flush=True)
            try:
                self._send_json({'error': str(e)}, 500)
            except:
                pass

    def _handle_ai_agent(self):
        """AI Agent: 意图解析 → 查询计算 → GLM 流式生成"""
        if handle_agent_request is None:
            self._send_json({'error': 'AI Agent 模块未加载'}, 500)
            return
        try:
            from ai_agent import ZHIPU_API_KEY as _agent_key, ZHIPU_MODEL as _agent_model
            body = self._read_body()
            question = body.get('question', '')
            session_id = body.get('sessionId', '')
            if not question:
                self._send_json({'error': '缺少 question 参数'}, 400)
                return

            # 1. 意图解析 + 查询计算
            result = handle_agent_request(question, session_id or None, DIR)
            if 'error' in result:
                self._send_json({'error': result['error']}, 500)
                return

            messages = result['messages']
            sid = result['session_id']

            # 2. GLM 流式调用
            _api_key = _agent_key or ZHIPU_API_KEY
            _model = _agent_model or ZHIPU_MODEL
            payload = json.dumps({
                'model': _model,
                'messages': messages,
                'stream': True,
                'temperature': 0.3,
                'max_tokens': MAX_TOKENS
            }).encode('utf-8')
            req = urllib.request.Request(ZHIPU_API_URL, data=payload, method='POST')
            req.add_header('Authorization', f'Bearer {_api_key}')
            req.add_header('Content-Type', 'application/json')
            ctx = ssl.create_default_context()

            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Cache-Control', 'no-cache')
            self._send_cors()
            self.end_headers()

            # 发送 sessionId 作为首条元数据
            self.wfile.write(f'data: {json.dumps({"sessionId": sid}, ensure_ascii=False)}\n\n'.encode('utf-8'))
            self.wfile.flush()

            # 流式转发 GLM 输出
            full_text = []
            try:
                resp = urllib.request.urlopen(req, context=ctx, timeout=180)
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
                            self.wfile.write(f'data: {out}\n\n'.encode('utf-8'))
                            self.wfile.flush()
                    except json.JSONDecodeError:
                        continue
            except urllib.error.HTTPError as e:
                err_body = e.read().decode('utf-8', errors='replace')
                err_msg = json.dumps({'error': f'API请求失败({e.code}): {err_body[:200]}'}, ensure_ascii=False)
                self.wfile.write(f'data: {err_msg}\n\n'.encode('utf-8'))
            except Exception as e:
                err_msg = json.dumps({'error': f'请求异常: {str(e)}'}, ensure_ascii=False)
                self.wfile.write(f'data: {err_msg}\n\n'.encode('utf-8'))

            # 保存对话历史
            if SessionManager and full_text:
                SessionManager.add_message(sid, 'assistant', ''.join(full_text))

            self.wfile.write(b'data: [DONE]\n\n')
            self.wfile.flush()
            print(f'[AI Agent] question="{question[:50]}..." session={sid}', flush=True)

        except Exception as e:
            print(f'[AI Agent Error] {e}', flush=True)
            try:
                self._send_json({'error': str(e)}, 500)
            except:
                pass

    def do_GET(self):
        try:
            if self.path == '/ai/health':
                self._handle_ai_health()
            elif self.path == '/api/health':
                self._handle_ai_health()
            elif self.path.startswith('/api/diagnoses/'):
                diag_id = self.path.split('/')[-1]
                diagnoses = self._load_json('_diagnoses.json')
                if diag_id in diagnoses:
                    self._send_json(diagnoses[diag_id])
                else:
                    self._send_json({'error': 'not found'}, 404)
            elif self.path.startswith('/api/remediation-tasks'):
                tasks = self._load_json('_remediation_tasks.json')
                task_list = list(tasks.values())
                # Optional ?branch= filter
                if '?' in self.path:
                    from urllib.parse import urlparse, parse_qs
                    qs = parse_qs(urlparse(self.path).query)
                    if 'branch' in qs:
                        task_list = [t for t in task_list if t.get('branch') == qs['branch'][0]]
                self._send_json(task_list)
            elif self.path.startswith('/api/agent-runs/'):
                run_id = self.path.split('/')[-1]
                runs = self._load_json('_agent_runs.json')
                if run_id in runs:
                    self._send_json(runs[run_id])
                else:
                    self._send_json({'error': 'not found'}, 404)
            elif self.path == '/api/pilot-metrics':
                self._send_json({
                    'branches': [],
                    'metrics': {
                        'avgCor': None,
                        'avgLossRatio': None,
                        'avgExpRatio': None,
                        'totalPrem': None
                    },
                    'updatedAt': ''
                })
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


socketserver.ThreadingTCPServer.allow_reuse_address = True
print(f'http://localhost:{PORT}/', flush=True)
print(f'AI endpoint: http://localhost:{PORT}/ai/chat', flush=True)
print(f'AI model: {ZHIPU_MODEL}', flush=True)
print(f'API Key: {"已配置" if ZHIPU_API_KEY else "❌ 未配置！请设置 ZAI_API_KEY 环境变量"}', flush=True)
with socketserver.ThreadingTCPServer(('', PORT), H) as h:
    h.serve_forever()
