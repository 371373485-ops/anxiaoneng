import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require=createRequire(import.meta.url);
const repo=path.resolve(import.meta.dirname,'..');
const Crypto=require(path.join(repo,'pages/crypto.js'));
const {buildPages}=await import(pathToFileURL(path.join(repo,'scripts/build-pages.mjs')).href);
const runtime=[
  'chart.umd.min.js','dashboard-data.js','dashboard-config.js','dashboard-compute.js',
  'dashboard-metrics.js','dashboard-charts.js','dashboard-render.js','dashboard-alerts.js',
  'dashboard-share.js','dashboard-main.js','dashboard-diagnosis.css',
  'pages/crypto.js','pages/unlock.js','pages/unlock.css',
];
const password=['pages','build','test','passphrase','2026'].join('-');
const tokens=['A'.repeat(40),'B'.repeat(40)];

async function makeFixture(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'anxiaoneng-pages-build-'));
  for(const relative of ['index.html',...runtime]){
    const source=path.join(repo,relative),target=path.join(root,relative);
    await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(source,target);
  }
  await fs.mkdir(path.join(root,'pages/data'),{recursive:true});
  await fs.writeFile(path.join(root,'.env.production'),'DO_NOT_COPY=private\n');
  await fs.writeFile(path.join(root,'diagnosis.db'),'database');
  await fs.mkdir(path.join(root,'backups'));await fs.writeFile(path.join(root,'backups/backup.dump'),'backup');
  for(let i=0;i<tokens.length;i++){
    const payload={currentMonth:`2026-0${i+1}`,currentPlanKey:'auto',actuals:{[`2026-0${i+1}`]:{branches:[{orgId:`ORG_${i}`,n:`测试机构${i}`,r:'测试区域',d:{测试指标:i+1}}],regions:{},national:{}}},_plans:{}};
    const envelope=await Crypto.encryptJson(payload,password,{createdAt:'2026-06-21T00:00:00.000Z',dataVersion:`build-${i+1}`});
    await fs.writeFile(path.join(root,'pages/data',tokens[i]+'.json'),JSON.stringify(envelope));
  }
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

test('build creates strict project-path artifact and one isolated route per token',async()=>{
  const root=await makeFixture(),output=path.join(root,'pages-dist');
  const result=await buildPages({root,output,basePath:'/account-repo/'});
  assert.deepEqual(result.tokens,tokens);
  const built=await files(output);
  for(const forbidden of ['diagnosis.db','.env.production','backups/backup.dump'])assert.equal(built.includes(forbidden),false);
  for(const token of tokens){
    assert.ok(built.includes(`pages/data/${token}.json`));
    assert.ok(built.includes(`share/${token}/index.html`));
    const html=await fs.readFile(path.join(output,'share',token,'index.html'),'utf8');
    assert.ok(html.includes('<base href="/account-repo/">'));
    assert.equal(html.includes('<base href="/">'),false);
    assert.equal(html.includes('dashboard-publish.js'),false);
    assert.equal(html.includes('dashboard-ai.js'),false);
    assert.equal(html.includes('xlsx.full.min.js'),false);
    assert.equal(html.includes('.xlsx"'),false);
    for(const match of html.matchAll(/(?:src|href)="([^"]+)"/g)){
      const url=match[1];
      if(url.startsWith('data:')||url==='/account-repo/')continue;
      assert.equal(url.startsWith('/'),false,`resource must resolve through the generated base path: ${url}`);
    }
  }
  const first=await fs.readFile(path.join(output,'pages/data',tokens[0]+'.json'),'utf8');
  const second=await fs.readFile(path.join(output,'pages/data',tokens[1]+'.json'),'utf8');
  assert.notEqual(first,second);
  assert.equal((await Crypto.decryptJson(JSON.parse(first),password)).currentMonth,'2026-01');
  assert.equal((await Crypto.decryptJson(JSON.parse(second),password)).currentMonth,'2026-02');
  const allText=(await Promise.all(built.filter(file=>/\.(?:html|js|css|json)$/.test(file)).map(file=>fs.readFile(path.join(output,file),'utf8')))).join('\n');
  assert.equal(allText.includes(password),false);
  assert.equal(allText.includes('/api/data-versions'),false);
  assert.equal(allText.includes('/api/share-links'),false);
  assert.equal(allText.includes('/api/me'),false);
  const rootHtml=await fs.readFile(path.join(output,'index.html'),'utf8');
  assert.equal(rootHtml.includes('<script'),false);
  assert.equal(rootHtml.includes('publish-admin-root'),false);
  assert.equal(rootHtml.includes('dashboard-'),false);
  await fs.rm(root,{recursive:true,force:true});
});

test('custom-domain build uses root base path',async()=>{
  const root=await makeFixture(),output=path.join(root,'pages-dist');
  await buildPages({root,output,basePath:'/'});
  const html=await fs.readFile(path.join(output,'share',tokens[0],'index.html'),'utf8');
  assert.ok(html.includes('<base href="/">'));
  await fs.rm(root,{recursive:true,force:true});
});

test('removing encrypted file removes its generated share route on rebuild',async()=>{
  const root=await makeFixture(),output=path.join(root,'pages-dist');
  await buildPages({root,output,basePath:'/repo/'});
  await fs.rm(path.join(root,'pages/data',tokens[1]+'.json'));
  const result=await buildPages({root,output,basePath:'/repo/'});
  assert.deepEqual(result.tokens,[tokens[0]]);
  await assert.rejects(fs.access(path.join(output,'share',tokens[1],'index.html')));
  await fs.rm(root,{recursive:true,force:true});
});

test('build rejects plaintext JSON invalid tokens credentials and wrong crypto parameters',async()=>{
  const cases=[
    {name:'short.json',value:{actuals:{},_plans:{}}},
    {name:'C'.repeat(40)+'.json',value:{format:'anxiaoneng-encrypted-share',version:1,kdf:{name:'PBKDF2',hash:'SHA-256',iterations:600000,salt:'cGxhaW50ZXh0LXNhbHQ='},cipher:{name:'AES-GCM',iv:'MTIzNDU2Nzg5MDEy',data:'经营利润'},meta:{createdAt:'2026-06-21T00:00:00.000Z',dataVersion:'v1'}}},
  ];
  for(const item of cases){
    const root=await makeFixture(),output=path.join(root,'pages-dist');
    await fs.rm(path.join(root,'pages/data'),{recursive:true,force:true});await fs.mkdir(path.join(root,'pages/data'));
    await fs.writeFile(path.join(root,'pages/data',item.name),JSON.stringify(item.value));
    await assert.rejects(buildPages({root,output,basePath:'/repo/'}));
    await fs.rm(root,{recursive:true,force:true});
  }
  const leakedRoot=await makeFixture(),leakedOutput=path.join(leakedRoot,'pages-dist');
  const leakedTarget=path.join(leakedRoot,'pages/data',tokens[0]+'.json'),leakedEnvelope=JSON.parse(await fs.readFile(leakedTarget,'utf8'));
  leakedEnvelope.leak='经营利润';await fs.writeFile(leakedTarget,JSON.stringify(leakedEnvelope));
  await assert.rejects(buildPages({root:leakedRoot,output:leakedOutput,basePath:'/repo/'}),/Unexpected encrypted envelope fields|Business plaintext/);
  await fs.rm(leakedRoot,{recursive:true,force:true});

  const root=await makeFixture(),output=path.join(root,'pages-dist');
  const target=path.join(root,'pages/data',tokens[0]+'.json'),envelope=JSON.parse(await fs.readFile(target,'utf8'));
  envelope.kdf.iterations=100000;await fs.writeFile(target,JSON.stringify(envelope));
  await assert.rejects(buildPages({root,output,basePath:'/repo/'}),/600000/);
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
  assert.ok(workflow.indexOf('node --test tests/test_pages_crypto.mjs')<workflow.indexOf('node scripts/build-pages.mjs'));
  assert.ok(workflow.indexOf('node --test tests/test_pages_build.mjs')<workflow.indexOf('node scripts/build-pages.mjs'));
  assert.match(workflow,/concurrency:/);
});
