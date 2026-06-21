import { readFileSync } from 'fs';
import assert from 'assert';
import vm from 'vm';
const T = 'C:/Users/liuyi/.openclaw-autoclaw/agents/agent-aa5swh/workspace';
const S = readFileSync(T+'/dashboard-compute.js','utf-8');
const App = {
  currentMonth: "2026-04",
  DATA: { branches: [], regions: {}, national: {} },
  FIELDS: [
    { k: "保费实际合计", u: "万元", rd: "desc", c: 1, m: 0 },
    { k: "保费年度计划", u: "万元", rd: "desc", m: 0 },
    { k: "经营利润", u: "万元", rd: "desc", c: 1, m: 1 },
    { k: "经营利润年度计划", u: "万元", rd: "desc", m: 1 },
    { k: "综合成本率实际（整体利润口径）", u: "%", rd: "asc", c: 1, m: 0 },
    { k: "时间进度达成率", u: "%", rd: "desc", c: 1, m: 0 },
    { k: "车险计划", u: "万元", rd: "desc", m: 1 },
    { k: "车险实际", u: "万元", rd: "desc", m: 1 },
    { k: "财产险计划", u: "万元", rd: "desc", m: 1 },
    { k: "财产险实际", u: "万元", rd: "desc", m: 1 },
    { k: "人身险计划", u: "万元", rd: "desc", m: 1 },
    { k: "人身险实际", u: "万元", rd: "desc", m: 1 },
    { k: "已赚保费", u: "万元", rd: "desc", m: 1 },
    { k: "已赚保费计划", u: "万元", rd: "desc", m: 1 },
    { k: "前台人员计划", u: "人", rd: "desc", m: 1 },
    { k: "前台人员实际", u: "人", rd: "desc", m: 1 },
    { k: "后台人员计划", u: "人", rd: "desc", m: 1 },
    { k: "后台人员实际", u: "人", rd: "desc", m: 1 },
    { k: "前台平均人数", u: "人", rd: "desc", m: 1 },
    { k: "后台平均人数", u: "人", rd: "desc", m: 1 },
    { k: "前台人力成本预算", u: "万元", rd: "desc", m: 1 },
    { k: "前台人力成本实际", u: "万元", rd: "desc", m: 1 },
    { k: "后台人力成本预算", u: "万元", rd: "desc", m: 1 },
    { k: "后台人力成本实际", u: "万元", rd: "desc", m: 1 },
    { k: "整体人力成本预算", u: "万元", rd: "desc", m: 1 },
    { k: "整体人力成本实际", u: "万元", rd: "desc", m: 1 },
  ],
  RANK_ASC: {
    "综合成本率实际（整体利润口径）": 1,
  },
};
const sandbox = { App, console };
vm.createContext(sandbox);
vm.runInContext(S, sandbox);
const { fmtVal, getColor, computeDerived, rankAllBranches } = sandbox;
let passed = 0, failed = 0;
const results = [];
function test(name, fn) {
  try { fn(); passed++; results.push("  PASS: " + name); }
  catch (e) { failed++; results.push("  FAIL: " + name + " -> " + e.message); }
}
console.log("\n-- fmtVal --");
test("null returns dash", () => { assert.strictEqual(fmtVal(null,"万元"),"-"); assert.strictEqual(fmtVal(null,"%"),"-"); });
test("NaN returns dash", () => { assert.strictEqual(fmtVal(NaN,"万元"),"-"); });
test("万元 zero shows 0", () => { assert.strictEqual(fmtVal(0,"万元"),"0"); });
test("万元 <100 2 decimals", () => { assert.strictEqual(fmtVal(50.567,"万元"),"50.57"); assert.strictEqual(fmtVal(0.01,"万元"),"0.01"); });
test("万元 >=100 rounded locale", () => { assert.strictEqual(fmtVal(100,"万元"),"100"); assert.strictEqual(fmtVal(12345.67,"万元"),"12,346"); });
test("万元 negative", () => { assert.strictEqual(fmtVal(-50.567,"万元"),"-50.57"); assert.strictEqual(fmtVal(-200,"万元"),"-200"); });
test("pct multiply 100", () => { assert.strictEqual(fmtVal(0.5,"%"),"50.00%"); assert.strictEqual(fmtVal(-0.25,"%"),"-25.00%"); });
test("人 rounded", () => { assert.strictEqual(fmtVal(5.7,"人"),"6"); assert.strictEqual(fmtVal(1234,"人"),"1,234"); });
test("万元/人 2 decimals", () => { assert.strictEqual(fmtVal(10.567,"万元/人"),"10.57"); });
test("unknown unit default", () => { assert.strictEqual(fmtVal(3.141,"zzz"),"3.14"); });
console.log("\n-- getColor --");
test("pct desc >=1 green", () => { assert.strictEqual(getColor("%","desc",1.0),"hi-green"); assert.strictEqual(getColor("%","desc",0.99),"hi-red"); });
test("pct asc <=0.98 green", () => { assert.strictEqual(getColor("%","asc",0.98),"hi-green"); assert.strictEqual(getColor("%","asc",0.99),"hi-red"); });
test("wan desc >0 green <0 red 0 blank", () => {
  assert.strictEqual(getColor("万元","desc",100),"hi-green");
  assert.strictEqual(getColor("万元","desc",-1),"hi-red");
  assert.strictEqual(getColor("万元","desc",0),"");
});
test("unknown unit blank", () => { assert.strictEqual(getColor("人","desc",5),""); });
console.log("\n-- computeDerived --");
test("empty data no throw", () => { const d={}; computeDerived(d); assert.strictEqual(typeof d["保费实际合计"],"number"); });
test("partial 车险 only", () => {
  const d={"车险计划":1000,"车险实际":300}; computeDerived(d);
  assert.strictEqual(d["保费实际合计"],300);
  const tp=4/12;
  assert(Math.abs(d["时间进度计划达成率"]-300/(1000*tp))<0.001);
});
test("complete data", () => {
  const d={
    "车险计划":1000,"车险实际":300,"财产险计划":800,"财产险实际":250,"人身险计划":600,"人身险实际":150,
    "经营利润年度计划":500,"经营利润":120,"已赚保费":2000,"已赚保费计划":2400,
    "前台人员计划":10,"前台人员实际":9,"前台平均人数":8,
    "后台人员计划":5,"后台人员实际":4,"后台平均人数":4,
    "前台人力成本预算":200,"前台人力成本实际":60,
    "后台人力成本预算":100,"后台人力成本实际":30,
    "整体人力成本预算":300,"整体人力成本实际":90
  };
  computeDerived(d);
  assert.strictEqual(d["保费实际合计"],700);
  assert.strictEqual(d["保费年度计划"],2400);
  assert.strictEqual(d["整体人员计划"],15);
  assert.strictEqual(d["整体人员实际"],13);
  assert(Math.abs(d["综合成本率实际（整体利润口径）"]-0.94)<0.001);
});
test("negative profit rate=0", () => {
  const d={"经营利润年度计划":500,"经营利润":-100,"已赚保费":2000,"车险计划":0,"车险实际":0,"财产险计划":0,"财产险实际":0,"人身险计划":0,"人身险实际":0,"前台人员计划":0,"前台人员实际":0,"后台人员计划":0,"后台人员实际":0,"前台人力成本预算":0,"前台人力成本实际":0,"后台人力成本预算":0,"后台人力成本实际":0};
  computeDerived(d);
  assert.strictEqual(d["时间进度达成率"],0);
});
test("zero earned COR NaN", () => {
  const d={"经营利润年度计划":500,"经营利润":100,"已赚保费":0,"车险计划":0,"车险实际":0,"财产险计划":0,"财产险实际":0,"人身险计划":0,"人身险实际":0,"前台人员计划":0,"前台人员实际":0,"后台人员计划":0,"后台人员实际":0,"前台人力成本预算":0,"前台人力成本实际":0,"后台人力成本预算":0,"后台人力成本实际":0};
  computeDerived(d);
  assert.strictEqual(isNaN(d["综合成本率实际（整体利润口径）"]),true);
});
console.log("\n-- rankAllBranches --");
test("desc rank higher=1", () => {
  sandbox.App.DATA.branches=[{n:"A",d:{"车险实际":100}},{n:"B",d:{"车险实际":200}},{n:"C",d:{"车险实际":50}}];
  const r=sandbox.rankAllBranches();
  assert.strictEqual(r["B"]["车险实际"],1);
  assert.strictEqual(r["A"]["车险实际"],2);
  assert.strictEqual(r["C"]["车险实际"],3);
});
test("asc rank lower=1", () => {
  sandbox.App.DATA.branches=[{n:"A",d:{"综合成本率实际（整体利润口径）":0.95}},{n:"B",d:{"综合成本率实际（整体利润口径）":0.85}},{n:"C",d:{"综合成本率实际（整体利润口径）":1.05}}];
  const r=sandbox.rankAllBranches();
  assert.strictEqual(r["B"]["综合成本率实际（整体利润口径）"],1);
  assert.strictEqual(r["A"]["综合成本率实际（整体利润口径）"],2);
  assert.strictEqual(r["C"]["综合成本率实际（整体利润口径）"],3);
});
test("tied same rank next skips", () => {
  sandbox.App.DATA.branches=[{n:"A",d:{"车险实际":100}},{n:"B",d:{"车险实际":100}},{n:"C",d:{"车险实际":50}}];
  const r=sandbox.rankAllBranches();
  assert.strictEqual(r["A"]["车险实际"],1);
  assert.strictEqual(r["B"]["车险实际"],1);
  assert.strictEqual(r["C"]["车险实际"],3);
});
test("empty branches blank obj", () => {
  sandbox.App.DATA.branches=[];
  assert.strictEqual(Object.keys(sandbox.rankAllBranches()).length,0);
});
test("missing field treated as 0", () => {
  sandbox.App.DATA.branches=[{n:"A",d:{"车险实际":100}},{n:"B",d:{}}];
  const r=sandbox.rankAllBranches();
  assert.strictEqual(r["A"]["车险实际"],1);
  assert.strictEqual(r["B"]["车险实际"],2);
});
console.log("\n" + "=".repeat(50));
console.log("Results: " + passed + " passed, " + failed + " failed, " + (passed+failed) + " total");
console.log("=".repeat(50));
results.forEach(function(r){console.log(r);});
if (failed > 0) { console.log("\nSOME TESTS FAILED"); } else { console.log("\nALL TESTS PASSED"); }
