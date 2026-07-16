# -*- coding: utf-8 -*-
"""
AI Agent 引擎 — 数据查询 + 计算 + 会话管理 + 意图解析 + 分析生成
Phase 1-2: 核心引擎
"""

import os, sys, json, time, hashlib, re, ssl, urllib.request, urllib.error

# ── 配置 ──
DIR = os.path.dirname(os.path.abspath(__file__))
ZHIPU_API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
ZHIPU_MODEL = os.environ.get("ZAI_MODEL", "glm-4-flash")
MAX_TOKENS = int(os.environ.get("ZAI_MAX_TOKENS", "4096"))


def _get_api_key():
    """Load API key only from the current process environment."""
    return os.environ.get("ZAI_API_KEY", "").strip()


ZHIPU_API_KEY = _get_api_key()

# ── 指标定义表（77 个，从 App.FIELDS 同步） ──
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


# ════════════════════════════════════════════════════════════════
#  DataQuery — 数据查询引擎（全动态，零硬编码维度）
# ════════════════════════════════════════════════════════════════
class DataQuery:
    def __init__(self, data):
        self.merged = data.get('_merged', {})
        self.actuals = data.get('actuals', {})
        self.plans = data.get('_plans', {})
        self.branches = self._discover_branches()
        self.regions = self._discover_regions()
        self.months = self._discover_months()
        self.metrics = self._discover_metrics()
        self.branch_region_map = self._build_branch_region_map()
        self.metric_defs = self._discover_metric_defs()

    def _discover_branches(self):
        names = set()
        for m in self.merged.values():
            for b in m.get('branches', []):
                if b.get('n'): names.add(b['n'])
        return sorted(names)

    def _discover_regions(self):
        regions = set()
        for m in self.merged.values():
            regions.update(m.get('regions', {}).keys())
            for b in m.get('branches', []):
                if b.get('r'): regions.add(b['r'])
        return sorted(regions)

    def _discover_months(self):
        return sorted(set(list(self.merged.keys()) + list(self.actuals.keys())))

    def _discover_metrics(self):
        all_keys = set()
        for m in self.merged.values():
            all_keys.update(m.get('national', {}).keys())
        return sorted(all_keys)

    def _build_branch_region_map(self):
        mapping = {}
        for m in self.merged.values():
            for b in m.get('branches', []):
                if b.get('n') and b.get('r'):
                    mapping[b['n']] = b['r']
        return mapping

    def _discover_metric_defs(self):
        defs = {}
        for f in METRIC_FIELDS:
            defs[f['k']] = f
        for mk in self.metrics:
            if mk not in defs:
                if '率' in mk or '达成' in mk or '执行率' in mk:
                    unit = '%'
                elif '人数' in mk or '人员' in mk:
                    unit = '人'
                else:
                    unit = '万元'
                defs[mk] = {'k': mk, 'l': mk, 'u': unit, 'g': '其他', 'aliases': []}
        return defs

    def _get_source(self, org, period):
        mdata = self.merged.get(period)
        if not mdata: return None
        if org == '全国' or org == '整体':
            return mdata.get('national', {})
        if org in self.regions:
            return mdata.get('regions', {}).get(org, {})
        if org in self.branches:
            b = next((x for x in mdata.get('branches', []) if x.get('n') == org), None)
            return b.get('d', {}) if b else {}
        return None

    def query(self, org, period, metrics=None):
        source = self._get_source(org, period)
        if source is None: return None
        if metrics is None: metrics = self.metrics
        result = {}
        for mk in metrics:
            if mk in source and source[mk] is not None:
                v = source[mk]
                if isinstance(v, (int, float)):
                    defn = self.metric_defs.get(mk, {})
                    if defn.get('u') == '%' or '率' in mk or '达成' in mk:
                        result[mk] = round(v, 4)
                    else:
                        result[mk] = round(v, 2)
                else:
                    result[mk] = v
        return result

    def query_trend(self, org, metric, periods=None):
        if not periods: periods = self.months
        series = []
        for p in periods:
            v = self.query(org, p, [metric])
            if v and metric in v:
                series.append({'month': p, 'value': v[metric]})
        return series

    def query_rank(self, org, period, metric, direction='desc'):
        mdata = self.merged.get(period)
        if not mdata: return None
        all_vals = []
        for b in mdata.get('branches', []):
            v = b.get('d', {}).get(metric)
            if v is not None and isinstance(v, (int, float)):
                all_vals.append({'name': b['n'], 'value': v})
        all_vals.sort(key=lambda x: x['value'], reverse=(direction == 'desc'))
        target = self.query(org, period, [metric])
        if not target: return None
        tv = target.get(metric)
        if tv is None: return None
        # 浮点精度问题：query() 返回 round 后的值，原始值未 round，用 1e-4 容差
        rank = None
        for i, x in enumerate(all_vals):
            if abs(x['value'] - tv) < 1e-4:
                rank = i + 1
                break
        total = len(all_vals)
        if rank is None:
            return None
        return {
            'rank': rank, 'total': total,
            'percentile': round(rank / total, 2) if total else None,
            'best': all_vals[0] if all_vals else None,
            'worst': all_vals[-1] if all_vals else None,
            'median': all_vals[total // 2] if all_vals else None,
            'targetValue': tv
        }

    def query_all_branches(self, period, metric, direction='desc'):
        mdata = self.merged.get(period)
        if not mdata: return []
        result = []
        for b in mdata.get('branches', []):
            v = b.get('d', {}).get(metric)
            if v is not None and isinstance(v, (int, float)):
                result.append({'name': b['n'], 'region': b.get('r', ''),
                               'value': round(v, 4 if '率' in metric else 2)})
        result.sort(key=lambda x: x['value'], reverse=(direction == 'desc'))
        for i, r in enumerate(result):
            r['rank'] = i + 1
        return result

    def query_compare(self, org1, org2, period, metrics):
        d1 = self.query(org1, period, metrics)
        d2 = self.query(org2, period, metrics)
        if not d1 or not d2: return None
        result = {}
        for mk in metrics:
            v1 = d1.get(mk)
            v2 = d2.get(mk)
            if v1 is not None and v2 is not None:
                result[mk] = {'org1': org1, 'org2': org2, 'value1': v1, 'value2': v2,
                              'diff': round(v1 - v2, 4)}
        return result

    def query_yoy(self, org, period, metric):
        yr, mo = period.split('-')
        prev = str(int(yr) - 1) + '-' + mo
        curr = self.query(org, period, [metric])
        prev_d = self.query(org, prev, [metric])
        if not curr or not prev_d: return None
        cv, pv = curr.get(metric), prev_d.get(metric)
        if cv is None or pv is None: return None
        return Compute.yoy(cv, pv)

    def query_mom(self, org, period, metric):
        yr, mo = period.split('-')[0], int(period.split('-')[1])
        prev = str(int(yr) - 1) + '-12' if mo == 1 else yr + '-' + str(mo - 1).zfill(2)
        curr = self.query(org, period, [metric])
        prev_d = self.query(org, prev, [metric])
        if not curr or not prev_d: return None
        cv, pv = curr.get(metric), prev_d.get(metric)
        if cv is None or pv is None: return None
        return Compute.mom(cv, pv)

    def query_plan_achievement(self, org, period, metric):
        actual = self.query(org, period, [metric])
        if not actual: return None
        av = actual.get(metric)
        if av is None: return None
        # 动态查找计划指标
        plan_key = None
        candidates = []
        if '实际' in metric:
            candidates.append(metric.replace('实际', '计划'))
        if '实际（' in metric:
            candidates.append(metric.replace('实际（', '计划（'))
        for ck in candidates:
            if ck in self.metrics:
                plan_key = ck
                break
        if not plan_key:
            mg = self.metric_defs.get(metric, {}).get('g', '')
            for mk in self.metrics:
                if mk != metric and '计划' in mk and self.metric_defs.get(mk, {}).get('g') == mg:
                    ba = metric.replace('实际', '').replace('（整体利润口径）', '')
                    bp = mk.replace('计划', '').replace('（整体利润口径）', '')
                    if ba == bp:
                        plan_key = mk
                        break
        if not plan_key: return None
        plan = self.query(org, period, [plan_key])
        if not plan: return None
        pv = plan.get(plan_key)
        if pv is None: return None
        return Compute.plan_achievement(av, pv)

    def get_available_context(self):
        return {
            'branches': self.branches,
            'regions': self.regions,
            'months': self.months,
            'branchRegionMap': self.branch_region_map,
            'metrics': [{'key': k, 'label': v.get('l', k), 'unit': v.get('u', ''),
                         'group': v.get('g', '')} for k, v in self.metric_defs.items()]
        }


# ════════════════════════════════════════════════════════════════
#  Compute — 计算引擎
# ════════════════════════════════════════════════════════════════
class Compute:
    @staticmethod
    def yoy(current, last_year):
        if current is None or last_year is None: return None
        diff = current - last_year
        pct = (diff / abs(last_year)) if last_year != 0 else None
        return {'current': round(current, 4), 'lastYear': round(last_year, 4),
                'diff': round(diff, 4), 'changePct': round(pct, 4) if pct is not None else None}

    @staticmethod
    def mom(current, prev_month):
        if current is None or prev_month is None: return None
        diff = current - prev_month
        pct = (diff / abs(prev_month)) if prev_month != 0 else None
        return {'current': round(current, 4), 'prevMonth': round(prev_month, 4),
                'diff': round(diff, 4), 'changePct': round(pct, 4) if pct is not None else None}

    @staticmethod
    def plan_achievement(actual, plan):
        if actual is None or plan is None or plan == 0: return None
        rate = actual / plan
        return {'actual': round(actual, 4), 'plan': round(plan, 4),
                'rate': round(rate, 4), 'gap': round(actual - plan, 4)}

    @staticmethod
    def rank(value, all_values, direction='desc'):
        sorted_vals = sorted(all_values, reverse=(direction == 'desc'))
        rank = sorted_vals.index(value) + 1 if value in sorted_vals else None
        total = len(sorted_vals)
        return {'rank': rank, 'total': total,
                'percentile': round(rank / total, 2) if total and rank else None,
                'median': sorted_vals[total // 2] if total else None,
                'best': sorted_vals[0] if total else None,
                'worst': sorted_vals[-1] if total else None}

    @staticmethod
    def trend(series):
        if len(series) < 2: return {'direction': 'insufficient_data'}
        vals = [s['value'] for s in series]
        first, last = vals[0], vals[-1]
        diff = last - first
        direction = 'up' if diff > 0 else ('down' if diff < 0 else 'flat')
        n = len(vals)
        x_mean = (n - 1) / 2
        y_mean = sum(vals) / n
        numerator = sum((i - x_mean) * (v - y_mean) for i, v in enumerate(vals))
        denominator = sum((i - x_mean) ** 2 for i in range(n))
        slope = numerator / denominator if denominator != 0 else 0
        volatility = (sum((v - y_mean) ** 2 for v in vals) / n) ** 0.5
        return {'direction': direction, 'diff': round(diff, 4), 'slope': round(slope, 6),
                'first': round(first, 4), 'last': round(last, 4),
                'volatility': round(volatility, 4)}

    @staticmethod
    def cor_decompose(loss_rate, expense_rate):
        if loss_rate is None or expense_rate is None: return None
        cor = loss_rate + expense_rate
        return {'cor': round(cor, 4), 'lossRate': round(loss_rate, 4),
                'expenseRate': round(expense_rate, 4),
                'lossShare': round(loss_rate / cor, 4) if cor != 0 else None,
                'expenseShare': round(expense_rate / cor, 4) if cor != 0 else None}


# ════════════════════════════════════════════════════════════════
#  SessionManager — 会话上下文管理
# ════════════════════════════════════════════════════════════════
class SessionManager:
    sessions = {}

    @classmethod
    def get_or_create(cls, session_id=None):
        if not session_id:
            session_id = 'sess_' + hashlib.md5(str(time.time()).encode()).hexdigest()[:12]
        if session_id not in cls.sessions:
            cls.sessions[session_id] = {
                'messages': [],
                'lastContext': {},
                'createdAt': time.time()
            }
        return session_id, cls.sessions[session_id]

    @classmethod
    def add_message(cls, session_id, role, content, query_context=None):
        sid, session = cls.get_or_create(session_id)
        session['messages'].append({
            'role': role, 'content': content,
            'queryContext': query_context, 'timestamp': time.time()
        })
        if len(session['messages']) > 20:
            session['messages'] = session['messages'][-20:]
        if query_context:
            session['lastContext'] = query_context

    @classmethod
    def get_context_summary(cls, session_id):
        sid, session = cls.get_or_create(session_id)
        if not session['messages']:
            return ''
        parts = []
        lc = session.get('lastContext', {})
        if lc.get('org'):
            parts.append(f"上一轮讨论的机构：{lc['org']}")
        if lc.get('metrics'):
            parts.append(f"上一轮讨论的指标：{', '.join(lc['metrics'][:5])}")
        if lc.get('period'):
            parts.append(f"上一轮讨论的时间：{lc['period']}")
        recent = session['messages'][-4:]
        for m in recent:
            if m['role'] == 'user':
                parts.append(f"用户问过：{m['content'][:100]}")
            else:
                parts.append(f"AI答过：{m['content'][:100]}")
        return '\n'.join(parts)


# ════════════════════════════════════════════════════════════════
#  意图理解层
# ════════════════════════════════════════════════════════════════
INTENT_PROMPT = """你是一个保险经营数据分析助手。用户会提出分析需求，你需要解析出结构化的查询计划。

## 当前可用数据维度

### 机构（{branch_count}家分公司 + {region_count}个责任区 + 全国）
分公司列表：{branches}
责任区列表：{regions}

### 指标（{metric_count}个）
{metric_list}

### 可用月份
{available_months}

## 输出要求
请输出JSON格式的查询计划：
{{
  "orgs": ["机构名列表"],
  "periods": ["月份列表, 如 2026-05"],
  "metrics": ["指标key列表"],
  "analysisType": "描述|对比|排名|趋势|归因|计划达成",
  "comparison": "同比|环比|计划|机构间对比|无",
  "timeRange": "用户原始时间表述",
  "resolvedPronouns": "如果用户用了代词或省略，解析出具体指代"
}}

## 规则
- 如果用户说"它""该分公司"等代词，根据上下文解析为具体机构名
- 如果用户说"近三年"，解析为具体年份列表
- 如果用户未指定机构，默认为全国
- 如果用户未指定时间，默认为最新月（{latest_month}）
- 如果用户说"全部指标"或未指定指标，返回空数组[]
- 指标key必须使用上面列出的精确key名称
- 只输出JSON，不要输出其他内容"""


def _call_glm(messages, temperature=0.1, stream=False, max_tokens=512):
    """调用 GLM API（非流式）"""
    payload = json.dumps({
        "model": ZHIPU_MODEL,
        "messages": messages,
        "stream": stream,
        "temperature": temperature,
        "max_tokens": max_tokens
    }).encode('utf-8')
    req = urllib.request.Request(ZHIPU_API_URL, data=payload, method='POST')
    req.add_header('Authorization', f'Bearer {ZHIPU_API_KEY}')
    req.add_header('Content-Type', 'application/json')
    ctx = ssl.create_default_context()
    resp = urllib.request.urlopen(req, context=ctx, timeout=60)
    return json.loads(resp.read().decode('utf-8'))


def parse_intent(question, session_context, dq):
    """用 GLM 解析用户意图，输出结构化查询计划"""
    ctx = dq.get_available_context()
    br_map_str = '; '.join([f'{b}→{r}' for b, r in ctx['branchRegionMap'].items()])
    metric_groups = {}
    for m in ctx['metrics']:
        g = m['group'] or '其他'
        if g not in metric_groups:
            metric_groups[g] = []
        metric_groups[g].append(f"{m['key']}({m['label']})")
    metric_list_str = '\n'.join([f"### {g}\n" + ', '.join(items) for g, items in metric_groups.items()])

    messages = [
        {"role": "system", "content": INTENT_PROMPT.format(
            branch_count=len(ctx['branches']),
            region_count=len(ctx['regions']),
            branches=', '.join(ctx['branches']),
            regions=', '.join(ctx['regions']),
            metric_count=len(ctx['metrics']),
            metric_list=metric_list_str,
            available_months=', '.join(ctx['months']),
            latest_month=ctx['months'][-1] if ctx['months'] else ''
        )},
        {"role": "user", "content": f"会话上下文：\n{session_context}\n\n用户问题：{question}\n\n请输出查询计划JSON。"}
    ]
    try:
        response = _call_glm(messages, temperature=0.1, stream=False, max_tokens=512)
    # Note: intent parsing uses small max_tokens for speed
        text = response['choices'][0]['message']['content']
        json_match = re.search(r'\{[\s\S]*\}', text)
        if json_match:
            plan = json.loads(json_match.group())
            # 验证 orgs
            valid_orgs = []
            for o in plan.get('orgs', []):
                if o in ctx['branches'] or o in ctx['regions'] or o == '全国':
                    valid_orgs.append(o)
            if not valid_orgs:
                valid_orgs = ['全国']
            plan['orgs'] = valid_orgs
            # 验证 metrics
            valid_metrics = [m for m in plan.get('metrics', []) if m in dq.metrics]
            plan['metrics'] = valid_metrics
            # 验证 periods
            valid_periods = [p for p in plan.get('periods', []) if p in dq.months]
            if not valid_periods:
                valid_periods = [ctx['months'][-1]] if ctx['months'] else []
            plan['periods'] = valid_periods
            return plan
    except Exception as e:
        print(f'[Intent Parse Error] {e}', flush=True)
    return None


# ════════════════════════════════════════════════════════════════
#  分析层
# ════════════════════════════════════════════════════════════════
ANALYSIS_SYSTEM_PROMPT = """你是华安保险的经营分析专家。以下是系统已查询并计算好的结构化分析结果（JSON格式）。
所有数值已经过精确计算，你不需要自己做任何数学运算，只需解读这些结果。

## 回答要求：
1. 区分事实和推断：
   - 【数据事实】：直接来自计算结果的陈述
   - 【业务推断】：基于数据事实的因果推断
   - 【数据不足】：当前数据无法支撑的结论

2. 分析深度：不要只罗列数字，要解读经营含义

3. 主动建议关联指标

4. 比率类指标（如COR、赔付率）用小数表示，0.95=95%
5. 所有数字必须来自提供的计算结果，禁止编造

## 计算结果：
{computed_results}

## 会话上下文：
{session_context}

## 用户问题：
{question}"""


def execute_query_plan(plan, dq):
    """执行查询计划，返回结构化计算结果"""
    results = {'query': plan, 'data': {}}
    orgs = plan.get('orgs', ['全国'])
    periods = plan.get('periods', [])
    metrics = plan.get('metrics', [])
    atype = plan.get('analysisType', '描述')
    comparison = plan.get('comparison', '无')

    if not metrics:
        # 默认核心指标
        metrics = ['保费实际合计', '综合成本率实际（整体利润口径）', '已赚赔付率实际',
                   '已赚费用率实际', '经营利润', '整体人均产能实际', '整体人均利润实际']

    for org in orgs:
        results['data'][org] = {}
        for period in periods:
            pd = results['data'][org].setdefault(period, {})

            # 基础查询
            raw = dq.query(org, period, metrics)
            if raw:
                pd['values'] = raw

            # 同比
            if comparison in ('同比', None) and len(periods) == 1:
                yoy_data = {}
                for mk in metrics:
                    y = dq.query_yoy(org, period, mk)
                    if y: yoy_data[mk] = y
                if yoy_data: pd['yoy'] = yoy_data

            # 环比
            if comparison in ('环比', None) and len(periods) == 1:
                mom_data = {}
                for mk in metrics:
                    m = dq.query_mom(org, period, mk)
                    if m: mom_data[mk] = m
                if mom_data: pd['mom'] = mom_data

            # 排名
            if atype in ('排名', None) and org in dq.branches:
                rank_data = {}
                for mk in metrics:
                    r = dq.query_rank(org, period, mk)
                    if r: rank_data[mk] = r
                if rank_data: pd['rank'] = rank_data

            # 计划达成
            if atype in ('计划达成', None) or comparison == '计划':
                plan_data = {}
                for mk in metrics:
                    pa = dq.query_plan_achievement(org, period, mk)
                    if pa: plan_data[mk] = pa
                if plan_data: pd['plan'] = plan_data

        # 趋势
        if atype == '趋势' and len(periods) >= 2:
            trend_data = {}
            for mk in metrics:
                t = Compute.trend(dq.query_trend(org, mk, periods))
                trend_data[mk] = t
            results['data'][org]['trend'] = trend_data

    # 机构间对比
    if atype == '对比' and len(orgs) >= 2:
        for period in periods:
            cmp = dq.query_compare(orgs[0], orgs[1], period, metrics)
            if cmp:
                results['data']['_comparison'] = {period: cmp}

    # 全分公司排名
    if atype == '排名' and periods:
        for period in periods:
            for mk in metrics:
                all_r = dq.query_all_branches(period, mk)
                if all_r:
                    results['data'].setdefault('_rankings', {})[period + '_' + mk] = all_r[:10]

    return results


def handle_agent_request(question, session_id, server_dir):
    """主流程编排：意图解析 → 查询计算 → 构建prompt → 返回生成参数

    Args:
        question: 用户问题
        session_id: 会话ID（可选）
        server_dir: _server.py 所在目录

    Returns:
        dict: {messages, session_id} 或 {error: ...}
    """
    # 1. 加载数据
    backup_path = os.path.join(server_dir, '_data_backup.json')
    with open(backup_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    # 2. 初始化查询引擎
    dq = DataQuery(data)

    # 3. 会话上下文
    sid, session = SessionManager.get_or_create(session_id)
    ctx_summary = SessionManager.get_context_summary(sid)

    # 4. 意图解析
    plan = parse_intent(question, ctx_summary, dq)
    if not plan:
        # Fallback: 简单关键词匹配
        plan = _fallback_intent(question, dq)
        if not plan:
            plan = {'orgs': ['全国'], 'periods': [dq.months[-1]] if dq.months else [],
                    'metrics': [], 'analysisType': '描述', 'comparison': '无'}

    # 5. 执行查询计划
    computed = execute_query_plan(plan, dq)

    # 6. 记录会话上下文
    query_ctx = {
        'org': plan.get('orgs', [''])[0] if plan.get('orgs') else '',
        'metrics': plan.get('metrics', []),
        'period': plan.get('periods', [''])[0] if plan.get('periods') else ''
    }
    SessionManager.add_message(sid, 'user', question, query_ctx)

    # 7. 构建分析 prompt
    computed_json = json.dumps(computed, ensure_ascii=False, indent=2)
    # 截断过长的数据
    if len(computed_json) > 12000:
        computed_json = computed_json[:12000] + '\n... (数据已截断)'

    messages = [
        {"role": "system", "content": ANALYSIS_SYSTEM_PROMPT.format(
            computed_results=computed_json,
            session_context=ctx_summary,
            question=question
        )},
        {"role": "user", "content": f"请基于以上计算结果回答用户的问题：{question}"}
    ]

    return {'messages': messages, 'session_id': sid, 'plan': plan, 'computed': computed}


def _fallback_intent(question, dq):
    """关键词匹配 fallback"""
    plan = {'orgs': [], 'periods': [], 'metrics': [], 'analysisType': '描述', 'comparison': '无'}

    # 机构匹配
    for b in dq.branches:
        if b in question or b.replace('分公司', '') in question:
            plan['orgs'].append(b)
    for r in dq.regions:
        if r in question:
            plan['orgs'].append(r)
    if not plan['orgs']:
        if '全国' in question or '整体' in question or '所有' in question:
            plan['orgs'] = ['全国']
        else:
            plan['orgs'] = ['全国']

    # 指标匹配
    for f in METRIC_FIELDS:
        candidates = [f['k'], f['l']] + f.get('aliases', [])
        for c in candidates:
            if c and c in question:
                plan['metrics'].append(f['k'])
                break

    # 时间匹配
    years = re.findall(r'20\d{2}', question)
    if years:
        for y in years:
            for m in dq.months:
                if m.startswith(y):
                    plan['periods'].append(m)
    if not plan['periods']:
        plan['periods'] = [dq.months[-1]] if dq.months else []

    # 分析类型
    if '排名' in question or '最低' in question or '最高' in question or '最好' in question or '最差' in question:
        plan['analysisType'] = '排名'
    elif '对比' in question or '比较' in question or '差异' in question:
        plan['analysisType'] = '对比'
    elif '趋势' in question or '变化' in question or '走势' in question:
        plan['analysisType'] = '趋势'
    elif '同比' in question:
        plan['analysisType'] = '描述'
        plan['comparison'] = '同比'
    elif '环比' in question:
        plan['analysisType'] = '描述'
        plan['comparison'] = '环比'

    return plan
