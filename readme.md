# 分公司经营与效能数据看板

面向保险公司总分公司月度经营分析场景的数据看板，纯前端架构，零后端依赖。

## 功能

- **多层级指标看板**：保费、效益、效能、人员四大维度，12 项核心经营指标，支持总公司/区域/分公司三级下钻
- **Excel 数据导入**：月度实际数据与年度计划数据批量导入，自动完成指标衍生计算
- **多月份与多版本计划切换**：自由切换月份，支持计划版本管理
- **分公司对比模式**：多分公司同指标横向对比，异常值自动高亮
- **可配置预警规则引擎**：自定义阈值与预警等级（error/warn/info）
- **AI 预警解读**：基于规则引擎自动生成分析报告，含风险矩阵、经营模式识别、归因分析与管理建议
- **移动端自适应**：支持手机端查看
- **数据导出**：筛选后数据导出为 Excel

## 使用方式

打开 [看板页面](https://371373485-ops.github.io/anxiaoneng/)，导入 Excel 数据即可使用。无需安装任何软件。

## 技术栈

纯前端 HTML5 + CSS3 + JavaScript ES6，基于 SheetJS（xlsx）处理 Excel，Chart.js 渲染图表。通过 GitHub Pages 部署。

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
