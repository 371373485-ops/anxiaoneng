import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const repo=path.resolve(import.meta.dirname,'..');
const {buildPages}=await import(pathToFileURL(path.join(repo,'scripts/build-pages.mjs')).href);
const runtime=[
  'chart.umd.min.js','xlsx.full.min.js',
  'dashboard-data.js','dashboard-config.js','dashboard-compute.js','dashboard-metrics.js',
  'dashboard-charts.js','dashboard-render.js','dashboard-alerts.js','dashboard-share.js',
  'dashboard-trend.js','dashboard-main.js',
  'dashboard-export.js','dashboard-publish.js','dashboard-ai-engine.js','dashboard-diagnosis-index.js','dashboard-ai.js','dashboard-agent.js',
  'dashboard-diagnosis.js','dashboard-remediation.js',
  'dashboard-diagnosis.css','dashboard-publish.css',
  'pages/crypto.js','pages/unlock.js','pages/unlock.css',
];

test('buildPages produces a full-featured static site',async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'pages-test-'));
  try{
    const result=await buildPages({root:repo,output:path.join(tmp,'dist'),basePath:'/test/'});
    assert.ok(result.files.length>=runtime.length+2,`expected at least ${runtime.length+2} files, got ${result.files.length}`);
    // index.html must exist
    assert.ok(result.files.includes('index.html'),'index.html missing');
    // _data_backup.json must exist
    assert.ok(result.files.includes('_data_backup.json'),'_data_backup.json missing');
    // All runtime files must be present
    for(const f of runtime)assert.ok(result.files.includes(f),`runtime file missing: ${f}`);
    // base href must be set
    const html=await fs.readFile(path.join(result.output,'index.html'),'utf8');
    assert.ok(html.includes('<base href="/test/">'),'base href not set correctly');
    const referencedAssets=[];
    for(const match of html.matchAll(/<script[^>]+src="([^"]+)"/g)){
      const src=match[1];
      if(/^(?:https?:)?\/\//.test(src))continue;
      referencedAssets.push(src.split('?')[0].replace(/^\.\//,''));
    }
    for(const match of html.matchAll(/<link[^>]+href="([^"]+)"/g)){
      const href=match[1];
      if(/^(?:https?:)?\/\//.test(href))continue;
      const clean=href.split('?')[0].replace(/^\.\//,'');
      if(/\.(?:css|js)$/.test(clean))referencedAssets.push(clean);
    }
    for(const asset of referencedAssets){
      assert.ok(result.files.includes(asset),`referenced asset missing from Pages output: ${asset}`);
    }
    // No readonly injection
    assert.ok(!html.includes('shareMode=true'),'should not inject shareMode');
    assert.ok(!html.includes('isReadOnly'),'should not inject isReadOnly');
    // No stripped scripts — all dashboard modules should be referenced
    assert.ok(html.includes('dashboard-ai.js'),'dashboard-ai.js should not be stripped');
    assert.ok(html.includes('dashboard-export.js'),'dashboard-export.js should not be stripped');
    assert.ok(html.includes('xlsx.full.min.js'),'xlsx should not be stripped');
  }finally{await fs.rm(tmp,{recursive:true,force:true});}
});

test('buildPages rejects invalid basePath',async()=>{
  await assert.rejects(buildPages({basePath:'../escape/'}),/absolute URL path/);
  await assert.rejects(buildPages({basePath:'?query=1'}),/absolute URL path/);
});

test('buildPages output contains no secrets',async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'pages-test-'));
  try{
    const result=await buildPages({root:repo,output:path.join(tmp,'dist'),basePath:'/'});
    for(const f of result.files){
      if(!/\.(?:html|json|js|css)$/.test(f))continue;
      const content=await fs.readFile(path.join(result.output,f),'utf8');
      assert.ok(!/sk-[A-Za-z0-9_-]{20,}/.test(content),`API key pattern found in ${f}`);
      assert.ok(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content),`Private key found in ${f}`);
    }
  }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
