import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const repo=path.resolve(import.meta.dirname,'..');
const {buildPages}=await import(pathToFileURL(path.join(repo,'scripts/build-pages.mjs')).href);
const runtime=[
  'chart.umd.min.js','dashboard-data.js','dashboard-config.js','dashboard-compute.js',
  'dashboard-metrics.js','dashboard-charts.js','dashboard-render.js','dashboard-alerts.js',
  'dashboard-share.js','dashboard-trend.js','dashboard-main.js','dashboard-diagnosis.css',
];

async function makeFixture(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'anxiaoneng-public-pages-'));
  for(const relative of ['index.html',...runtime]){
    const source=path.join(repo,relative),target=path.join(root,relative);
    await fs.mkdir(path.dirname(target),{recursive:true});
    await fs.copyFile(source,target);
  }
  await fs.mkdir(path.join(root,'pages'),{recursive:true});
  await fs.writeFile(path.join(root,'pages/public-data.json'),JSON.stringify({
    currentMonth:'2026-06',
    currentPlanKey:'auto',
    actuals:{'2026-06':{branches:[{orgId:'ORG_A',n:'测试分公司',r:'第一责任区',d:{经营利润:1}}],regions:{},national:{}}},
    _plans:{}
  }));
  await fs.writeFile(path.join(root,'.env.production'),'DO_NOT_COPY=private\n');
  await fs.writeFile(path.join(root,'diagnosis.db'),'database');
  await fs.mkdir(path.join(root,'backups'));await fs.writeFile(path.join(root,'backups/backup.dump'),'backup');
  return root;
}

async function files(directory,prefix=''){
  const result=[];
  for(const entry of await fs.readdir(directory,{withFileTypes:true})){
    const relative=path.posix.join(prefix,entry.name),absolute=path.join(directory,entry.name);
    if(entry.isDirectory())result.push(...await files(absolute,relative));else result.push(relative);
  }
  return result.sort();
}

test('build creates public read-only Pages artifact without encryption gate',async()=>{
  const root=await makeFixture(),output=path.join(root,'pages-dist');
  const result=await buildPages({root,output,basePath:'/account-repo/'});
  const built=await files(output);
  assert.deepEqual(result.basePath,'/account-repo/');
  assert.ok(built.includes('index.html'));
  assert.ok(built.includes('_data_backup.json'));
  for(const file of runtime)assert.ok(built.includes(file),file);
  for(const forbidden of ['diagnosis.db','.env.production','backups/backup.dump','pages/crypto.js','pages/unlock.js','pages/unlock.css'])assert.equal(built.includes(forbidden),false);
  assert.equal(built.some(file=>file.startsWith('share/')),false);
  assert.equal(built.some(file=>file.startsWith('pages/data/')),false);

  const html=await fs.readFile(path.join(output,'index.html'),'utf8');
  assert.ok(html.includes('<base href="/account-repo/">'));
  assert.ok(html.includes("App.shareToken='public'"));
  assert.ok(html.includes('dashboard-main.js'));
  assert.equal(html.includes('pages/unlock.js'),false);
  assert.equal(html.includes('pages/crypto.js'),false);
  assert.equal(html.includes('dashboard-publish.js'),false);
  assert.equal(html.includes('dashboard-ai.js'),false);
  assert.equal(html.includes('dashboard-agent.js'),false);
  assert.equal(html.includes('dashboard-remediation.js'),false);
  assert.equal(html.includes('xlsx.full.min.js'),false);
  assert.equal(html.includes('.xlsx"'),false);

  const data=JSON.parse(await fs.readFile(path.join(output,'_data_backup.json'),'utf8'));
  assert.equal(data.currentMonth,'2026-06');
  assert.ok(data.actuals);
  await fs.rm(root,{recursive:true,force:true});
});

test('build rejects missing malformed or credential-bearing public data',async()=>{
  const root=await makeFixture(),output=path.join(root,'pages-dist');
  await fs.writeFile(path.join(root,'pages/public-data.json'),JSON.stringify({hello:'world'}));
  await assert.rejects(buildPages({root,output,basePath:'/repo/'}),/actuals and _plans/);
  await fs.writeFile(path.join(root,'pages/public-data.json'),JSON.stringify({actuals:{},_plans:{},DATABASE_URL:'postgres://secret'}));
  await assert.rejects(buildPages({root,output,basePath:'/repo/'}),/Credential/);
  await fs.rm(root,{recursive:true,force:true});
});

test('workflow is manual-only minimal and uploads only pages-dist',async()=>{
  const workflow=await fs.readFile(path.join(repo,'.github/workflows/deploy-pages.yml'),'utf8');
  assert.match(workflow,/workflow_dispatch:/);
  assert.doesNotMatch(workflow,/pull_request:|push:/);
  assert.match(workflow,/contents:\s*read/);
  assert.match(workflow,/pages:\s*write/);
  assert.match(workflow,/id-token:\s*write/);
  assert.match(workflow,/actions\/configure-pages@v5/);
  assert.match(workflow,/actions\/upload-pages-artifact@v3/);
  assert.match(workflow,/actions\/deploy-pages@v4/);
  assert.match(workflow,/path:\s*pages-dist/);
  assert.doesNotMatch(workflow,/secrets\.|encrypt-share|password/i);
  assert.match(workflow,/node --test tests\/test_pages_build\.mjs/);
  assert.ok(workflow.indexOf('node --test tests/test_pages_build.mjs')<workflow.indexOf('node scripts/build-pages.mjs'));
  assert.match(workflow,/concurrency:/);
});
