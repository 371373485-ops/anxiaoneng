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
  let html=source;
  // Strip sensitive scripts and references from share pages
  const SENSITIVE_PATTERNS=[
    /<script[^>]*src="(?:dashboard-publish|dashboard-ai|dashboard-agent|dashboard-diagnosis|dashboard-remediation|dashboard-export)\.js[^>]*><\/script>/g,
    /<script[^>]*src="xlsx\.full\.min\.js[^>]*><\/script>/g,
    /<link[^>]*href="dashboard-publish\.css[^>]*"\s*\/?>/g,
    /href="[^"]*\.xlsx"/g,
  ];
  for(const p of SENSITIVE_PATTERNS)html=html.replace(p,'');
  // Strip data-share-restricted elements
  html=html.replace(/<[^>]+data-share-restricted[^>]*>[\s\S]*?<\/[^>]+>/gi,'');
  html=html.replace(/<input[^>]+data-share-restricted[^>]*\/?\s*>/gi,'');
  html=html.replace(/<base\s+href="[^"]*"\s*\/?>/i,`<base href="${basePath}">`);
  if(!html.includes(`<base href="${basePath}">`))html=html.replace(/<head>/i,`<head><base href="${basePath}">`);
  html=html.replace(/<meta name="viewport"/i,'<meta name="robots" content="noindex,nofollow"><meta name="viewport"');
  var trigger="<script>"+
"var d=document.getElementById('pagesUnlockRoot');"+
"if(window.__anxiaonengEncryptedSharePending){"+
  "d.innerHTML='<div style=padding:20px;font-family:monospace;font-size:14px>'+"+
    "'pending=true, token='+window.AnxiaonengUnlock.tokenFromLocation(location)+'<br>'+"+
    "'Crypto='+!!window.AnxiaonengCrypto+'<br>Unlock='+!!window.AnxiaonengUnlock+'</div>';"+
  "var app=window.App||{};"+
  "var ok=window.AnxiaonengUnlock.install(app);"+
  "d.innerHTML+='install='+ok+' shareMode='+(app&&app.shareMode)+' encrypted='+(app&&app.encryptedShareMode)+'<br>';"+
  "window.loadSharedDashboard().then(function(r){d.innerHTML+='LOAD_OK';}).catch(function(e){d.innerHTML+='LOAD_FAIL: '+e.message;console.error(e);});"+
"}else{d.innerHTML='NOT_PENDING';}"+
"<\\/script>";
  html=html.replace('</body>',trigger+'</body>');
  return html;
}
function assertExactKeys(value,expected,label){
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
