#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require=createRequire(import.meta.url);
const Crypto=require('../pages/crypto.js');
const ROOT=path.resolve(import.meta.dirname,'..');
const OUTPUT_NAME='pages-dist';
const TOKEN_PATTERN=/^[A-Za-z0-9_-]{32,128}$/;
const RUNTIME_FILES=[
  'chart.umd.min.js',
  'dashboard-data.js','dashboard-config.js','dashboard-compute.js','dashboard-metrics.js',
  'dashboard-charts.js','dashboard-render.js','dashboard-alerts.js','dashboard-share.js',
  'dashboard-main.js','dashboard-diagnosis.css','dashboard-publish.css',
  'dashboard-export.js','dashboard-publish.js','dashboard-ai.js','dashboard-agent.js',
  'dashboard-diagnosis.js','dashboard-remediation.js','xlsx.full.min.js',
  'pages/crypto.js','pages/unlock.js','pages/unlock.css',
];
const FORBIDDEN_NAMES=[
  /^\.env(?:\.|$)/i,/\.(?:db|sqlite|sqlite3)$/i,/^_data_backup\.json$/i,
  /\.decrypted\.json$/i,/\.tmp-encrypted-share/i,/\.py$/i,/\.log$/i,
];
const FORBIDDEN_PARTS=new Set(['.git','backend','backups','docs','memory','plaintext-share','pages-private','tests','reports']);
const PLAINTEXT_MARKERS=['分公司','责任区','经营利润','已赚保费','综合成本率','actuals','_plans','branches','national','regions'];
const SECRET_PATTERNS=[
  /postgres(?:ql)?:\/\//i,/DATABASE_URL/i,/POSTGRES_PASSWORD/i,/PROXY_SHARED_SECRET/i,
  /(?:OPENAI|ZAI|ANTHROPIC|GITHUB)_API_KEY/i,/sk-[A-Za-z0-9_-]{16,}/,
  /[0-9a-f]{32}\.[A-Za-z0-9]{16,}/i,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

function normalizeBasePath(value){
  let base=(value||'/').trim();
  if(!base.startsWith('/'))base='/'+base;
  base=base.replace(/\/{2,}/g,'/');
  if(!base.endsWith('/'))base+='/';
  if(base.includes('..')||/[?#]/.test(base))throw new Error('PAGES_BASE_PATH must be an absolute URL path');
  return base;
}
function escapeHtml(value){return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
function rootPage(basePath){
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>只读加密分享</title><style>body{margin:0;display:grid;min-height:100vh;place-items:center;background:#f4f7fb;color:#172033;font-family:system-ui,sans-serif}.card{max-width:520px;margin:24px;padding:36px;background:#fff;border:1px solid #dce4ef;border-radius:18px;text-align:center}.card h1{font-size:24px}.card p{color:#617086;line-height:1.7}</style></head><body><main class="card"><h1>只读加密分享</h1><p>请使用管理者提供的完整分享链接。此页面不提供数据管理、登录或后端接口。</p><small>站点路径：${escapeHtml(basePath)}</small></main></body></html>\n`;
}
function removeElementByMarker(html,marker){
  return html.replace(new RegExp(`<[^>]+${marker}[^>]*>[\\s\\S]*?<\\/[^>]+>`,`gi`),'').replace(new RegExp(`<[^>]+${marker}[^>]*\\/?>`,`gi`),'');
}
function sharePage(source,basePath){
  let html='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><base href="'+basePath+'"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><link rel="stylesheet" href="pages/unlock.css?v=1"><title>分公司经营与效能数据看板</title></head><body><div id="pagesUnlockRoot"></div>'+
'<script src="pages/crypto.js?v=1"><\/script>'+
'<script src="pages/unlock.js?v=1"><\/script>'+
'<script>'+
'(function(){'+
'var scope="pagesUnlockRoot";'+
'function msg(t){var d=document.getElementById(scope);if(d)d.innerHTML="<div style=padding:40px;text-align:center;font:16px/1.8 system-ui,sans-serif;color:#333>"+t+"</div>";}'+
'var U=window.AnxiaonengUnlock,C=window.AnxiaonengCrypto;'+
'if(!U||!C){msg("模块加载失败");return;}'+
'if(!U.shouldInstall(window.location)){msg("非分享链接");return;}'+
'var token=U.tokenFromLocation(window.location),base="'+basePath+'";'+
'var url="pages/data/"+encodeURIComponent(token)+".json";'+
'var ctrl=U.createController({cryptoApi:C,fetch:window.fetch.bind(window),wait:function(ms){return new Promise(function(r){setTimeout(r,ms);})},location:window.location,document:document});'+
'ctrl.load(url).then(function(){'+
'  var host=document.getElementById(scope);'+
'  host.innerHTML="<section class=pages-unlock role=dialog><div class=pages-unlock-card><div class=pages-unlock-mark>\u{1F510}</div><h1>\u89E3\u9501\u53EA\u8BFB\u5206\u4EAB</h1><p>\u8BF7\u8F93\u5165\u7BA1\u7406\u8005\u53D1\u9001\u7684\u8BBF\u95EE\u5BC6\u7801\u3002</p><form id=pagesUnlockForm><label for=pagesUnlockPassword>\u8BBF\u95EE\u5BC6\u7801</label><input id=pagesUnlockPassword type=password minlength=16 required><button type=submit>\u89E3\u9501\u770B\u677F</button><p id=pagesUnlockError class=pages-unlock-error></p></form></div></section>";'+
'  var form=host.querySelector("#pagesUnlockForm"),pw=host.querySelector("#pagesUnlockPassword"),err=host.querySelector("#pagesUnlockError"),btn=form.querySelector("button");'+
'  form.addEventListener("submit",function(e){e.preventDefault();var p=pw.value;pw.value="";err.textContent="";btn.disabled=true;'+
'    ctrl.unlock(p).then(function(data){'+
'      try{sessionStorage.setItem("__share_data",JSON.stringify(data));}catch(ex){}'+
'      document.getElementById(scope).innerHTML="<div style=text-align:center;padding:50px;font-size:18px>\u89E3\u9501\u6210\u529F\uFF0C\u8DF3\u8F6C\u4E2D...</div>";'+
'      setTimeout(function(){window.location.href="'+basePath+'";},300);'+
'    }).catch(function(){err.textContent=U.ERROR_MESSAGE;btn.disabled=false;pw.focus();});'+
'  });'+
'  pw.focus();'+
'}).catch(function(e){msg("\u52A0\u8F7D\u5931\u8D25: "+(e.message||e));});'+
'})();'+
'<\/script></body></html>';
  return html;
}
  const actual=Object.keys(value||{}).sort(),wanted=[...expected].sort();
  if(actual.length!==wanted.length||actual.some((key,index)=>key!==wanted[index]))throw new Error(`Unexpected ${label} fields`);
}
function sensitiveEnvironmentValues(){
  return Object.entries(process.env)
    .filter(([name,value])=>/(?:PASSWORD|SECRET|TOKEN|API_KEY|DATABASE_URL)/i.test(name)&&typeof value==='string'&&value.length>=8)
    .map(([,value])=>value);
}
function validateEncryptedFile(token,text){
  if(!TOKEN_PATTERN.test(token))throw new Error(`Invalid encrypted token filename: ${token}`);
  let envelope;
  try{envelope=JSON.parse(text);}catch(error){throw new Error(`Invalid JSON for token ${token}`);}
  assertExactKeys(envelope,['format','version','kdf','cipher','meta'],'encrypted envelope');
  assertExactKeys(envelope.kdf,['name','hash','iterations','salt'],'KDF');
  assertExactKeys(envelope.cipher,['name','iv','data'],'cipher');
  assertExactKeys(envelope.meta,['createdAt','dataVersion'],'meta');
  Crypto.validateEnvelope(envelope);
  if(envelope.kdf.iterations!==600000)throw new Error(`PBKDF2 iterations must be 600000 for token ${token}`);
  const serialized=JSON.stringify(envelope);
  for(const marker of PLAINTEXT_MARKERS)if(serialized.includes(marker))throw new Error(`Business plaintext marker found in ${token}: ${marker}`);
  for(const pattern of SECRET_PATTERNS)if(pattern.test(serialized))throw new Error(`Credential or database marker found in ${token}`);
  if(serialized.includes(token)===false){/* token intentionally remains only in filename and route */}
  return envelope;
}
async function copyFile(root,temp,relative){
  const source=path.join(root,relative),target=path.join(temp,relative);
  const stat=await fs.stat(source);if(!stat.isFile())throw new Error(`Required file missing: ${relative}`);
  await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(source,target);
}
async function listFiles(directory,prefix=''){
  const result=[];
  for(const entry of await fs.readdir(directory,{withFileTypes:true})){
    const relative=path.posix.join(prefix,entry.name),absolute=path.join(directory,entry.name);
    if(entry.isDirectory())result.push(...await listFiles(absolute,relative));else if(entry.isFile())result.push(relative);
  }
  return result.sort();
}
function scanOutputFiles(files){
  const allowed=new Set(['index.html',...RUNTIME_FILES]);
  for(const relative of files){
    const normalized=relative.replace(/\\/g,'/'),parts=normalized.split('/'),name=parts.at(-1);
    if(parts.some(part=>FORBIDDEN_PARTS.has(part))||FORBIDDEN_NAMES.some(pattern=>pattern.test(name)))throw new Error(`Forbidden output file: ${normalized}`);
    if(allowed.has(normalized))continue;
    if(/^pages\/data\/[A-Za-z0-9_-]{32,128}\.json$/.test(normalized))continue;
    if(/^share\/[A-Za-z0-9_-]{32,128}\/index\.html$/.test(normalized))continue;
    throw new Error(`Output file is outside the strict allowlist: ${normalized}`);
  }
}
async function scanOutputContent(directory,files){
  for(const relative of files){
    if(!/\.(?:html|json|js|css)$/.test(relative))continue;
    const content=await fs.readFile(path.join(directory,relative),'utf8');
    for(const pattern of SECRET_PATTERNS)if(pattern.test(content))throw new Error(`Sensitive content found in output: ${relative}`);
    for(const secretValue of sensitiveEnvironmentValues())if(content.includes(secretValue))throw new Error(`Environment secret value found in output: ${relative}`);
    if(relative.startsWith('pages/data/')){
      const token=path.basename(relative,'.json');validateEncryptedFile(token,content);
    }
  }
}
export async function buildPages({root=ROOT,output=path.join(root,OUTPUT_NAME),basePath=process.env.PAGES_BASE_PATH||'/'}={}){
  const base=normalizeBasePath(basePath),temp=path.join(path.dirname(output),`.${path.basename(output)}.${process.pid}.${Date.now()}.tmp`),dataDir=path.join(root,'pages/data');
  await fs.rm(temp,{recursive:true,force:true});await fs.mkdir(temp,{recursive:true});
  try{
    for(const file of RUNTIME_FILES)await copyFile(root,temp,file);
    const sourceHtml=await fs.readFile(path.join(root,'index.html'),'utf8');
    await fs.writeFile(path.join(temp,'index.html'),rootPage(base),'utf8');
    let encrypted=[];
    try{encrypted=(await fs.readdir(dataDir,{withFileTypes:true})).filter(entry=>entry.isFile()).map(entry=>entry.name).sort();}catch(error){if(error.code!=='ENOENT')throw error;}
    for(const filename of encrypted){
      if(!filename.endsWith('.json'))throw new Error(`Only encrypted JSON is allowed in pages/data: ${filename}`);
      const token=filename.slice(0,-5),text=await fs.readFile(path.join(dataDir,filename),'utf8');
      validateEncryptedFile(token,text);
      const dataTarget=path.join(temp,'pages/data',filename);await fs.mkdir(path.dirname(dataTarget),{recursive:true});await fs.writeFile(dataTarget,text,'utf8');
      const shareTarget=path.join(temp,'share',token,'index.html');await fs.mkdir(path.dirname(shareTarget),{recursive:true});await fs.writeFile(shareTarget,sharePage(sourceHtml,base),'utf8');
    }
    const files=await listFiles(temp);scanOutputFiles(files);await scanOutputContent(temp,files);
    await fs.rm(output,{recursive:true,force:true});await fs.rename(temp,output);
    return {output,basePath:base,tokens:encrypted.map(name=>name.slice(0,-5)),files:await listFiles(output)};
  }catch(error){await fs.rm(temp,{recursive:true,force:true});throw error;}
}
async function main(){try{const result=await buildPages();console.log(`Pages build complete: ${result.files.length} files, ${result.tokens.length} encrypted share(s), base ${result.basePath}`);}catch(error){console.error(`Pages build failed: ${error.message}`);process.exitCode=1;}}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
