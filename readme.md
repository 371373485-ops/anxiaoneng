# 分公司经营与效能数据看板

面向保险公司总分公司月度经营分析场景的数据看板，纯前端架构，零后端依赖。

## 功能

- **多层级指标看板**：保费、效益、效能、人员四大维度，12 项核心经营指标，支持总公司/区域/分公司三级下钻
- **Excel 数据导入**：月度实际数据与年度计划数据批量导入，自动完成指标衍生计算
- **多月份与多版本计划切换**：自由切换月份，支持计划版本管理
- **分公司对比模式**：多分公司同指标横向对比，异常值自动高亮
- **可配置预警规则引擎**：自定义阈值与预警等级（error/warn/info）
- **智能经营诊断**：基于规则引擎自动生成风险总览、分公司诊断、证据追溯与整改建议
- **数据查询与报告生成**：支持自然语言入口下的标准化查数、筛选、排名、主题、趋势、对比查询，并可生成分公司管理汇报型分析报告
- **移动端自适应**：支持手机端查看
- **数据导出**：筛选后数据导出为 Excel

## 使用方式

打开 [看板页面](https://371373485-ops.github.io/anxiaoneng/)，导入 Excel 数据即可使用。无需安装任何软件。

## 技术栈

纯前端 HTML5 + CSS3 + JavaScript ES6，基于 SheetJS（xlsx）处理 Excel，Chart.js 渲染图表。通过 GitHub Pages 部署。

智能经营诊断的内部生产版本增加 FastAPI + PostgreSQL 后端。公开 GitHub
Pages 仍只运行规则诊断，不发送经营数据，也不启用生成式 AI。

## 智能经营诊断

- 基础诊断由规则引擎确定性生成，当前公开前端不展示“个性化 AI 分析”和“AI 深度解读”入口。
- 数据查询采用“自然语言入口 + 标准化查询执行器”，结果只来自当前看板数据和证据包。
- 支持证据追溯、规则诊断、审计及整改任务闭环。
- 整改任务按 `draft → confirmed → in_progress → completed → closed` 流转。

本地启动内部版本：

```powershell
python -m pip install -r backend/requirements.txt
$env:AI_ENABLED="false"
uvicorn backend.app:app --host 127.0.0.1 --port 8921
```

## 智能体工作流 V1

内部版本新增可靠、可审计的经营智能体执行链：

- `POST /api/agent-runs` 创建目标分析任务。
- `GET /api/agent-runs/{id}` 查看计划、工具步骤、状态与结构化结果。
- `POST /api/agent-runs/{id}/inputs` 补充缺失机构、周期或任务信息。
- `POST /api/agent-runs/{id}/cancel` 取消未完成任务。
- `GET /api/tools` 查看白名单工具及版本。
- `GET/POST /api/agent-memories` 读取或保存按 `orgId` 隔离的受控记忆。
- `GET /api/pilot-metrics` 查看试点失败率、采纳反馈、任务转化、延迟与发布门禁。

所有数字由确定性工具和证据快照提供；模型不负责心算。跨表诊断、
评测、整改任务与状态历史使用原子事务。默认 `AI_ENABLED=false`，
模型异常或输出校验失败时继续返回规则诊断。

运行完整测试：

```powershell
python -m pip install -r backend/requirements-dev.txt
python -m unittest discover -s tests -v
node --check dashboard-agent.js
node --check dashboard-diagnosis.js
```

## AI 可靠性 V2

- 默认采用严格校验；数字、证据、机构、指标方向、相关性、建议具体性、
  因果表述和安全风险均有独立评分。
- 新增 `insufficient_evidence`、`validation_failed`、
  `human_review_required` 和 `degraded` 状态。
- `POST /api/agent-runs/{id}/shadow-generate` 仅在显式启用 AI 后运行，
  生成结果始终进入不可见影子区。
- `POST /api/shadow-runs` 可提交候选输出进行离线可靠性验证。
- `POST /api/human-reviews` 保存业务专家盲评。
- `POST /api/release-gates` 按严格阈值生成发布阻断结论。
- 评测集包含不少于 200 个场景，并支持盲测筛选及1至5次重复运行。
- GitHub Actions 在每次推送和合并请求中执行完整测试、前端语法检查和
  评测集数量检查。

PostgreSQL 生产部署可复制 `backend/.env.example` 配置环境变量后运行：

```powershell
docker compose up --build
```

生产环境必须设置 `APP_ENV=production`，并使用 `AUTH_MODE=proxy` 由可信
身份网关注入用户、角色和机构范围；服务间调用可改用 `AUTH_MODE=token`
并配置 `API_AUTH_TOKEN`。不要把共享密钥下发到浏览器。默认
`AI_ENABLED=false`，完成内部安全评审后再启用并配置 `ZAI_API_KEY`。

## 项目结构

```
├── 安效能数据看板.html        # 主页面（含完整 CSS）
├── dashboard-data.js          # 数据层
├── dashboard-compute.js       # 计算引擎
├── dashboard-config.js        # 指标配置
├── dashboard-render.js        # 渲染层
├── dashboard-main.js          # 主控逻辑
├── dashboard-alerts.js        # 预警规则引擎
├── dashboard-charts.js        # 图表
├── dashboard-export.js        # Excel 导出
├── dashboard-ai.js            # AI 预警解读
└── deploy/                    # GitHub Pages 部署目录
```

## 部署

通过 GitHub Pages 自动部署，`deploy/` 目录对应站点根目录。

## 发布同步

发布前从项目根目录执行：

```powershell
.\scripts\sync-deploy.ps1
```

脚本以根目录为唯一源码，将 `index.html`、`dashboard-*.js`、`dashboard.css`、`chart.umd.min.js`、`xlsx.full.min.js`、`readme.md` 和两个 Excel 导入模板同步到 `deploy/`。如果 `gh-pages/` 目录存在，也会同步同一批文件。执行完成后会输出每个目标文件的大小和 SHA256，用于确认版本一致。
