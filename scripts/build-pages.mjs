#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const ROOT=path.resolve(import.meta.dirname,'..');
const OUTPUT_NAME='pages-dist';
const RUNTIME_FILES=[
  'chart.umd.min.js',
  'dashboard-data.js','dashboard-config.js','dashboard-compute.js','dashboard-metrics.js',
  'dashboard-charts.js','dashboard-render.js','dashboard-alerts.js','dashboard-share.js','dashboard-trend.js',
  'dashboard-main.js','dashboard-diagnosis.css',
];
const FORBIDDEN_NAMES=[
  /^\.env(?:\.|$)/i,/\.(?:db|sqlite|sqlite3)$/i,
  /\.decrypted\.json$/i,/\.tmp-encrypted-share/i,/\.py$/i,/\.log$/i,
];
const FORBIDDEN_PARTS=new Set(['.git','backend','backups','docs','memory','plaintext-share','pages-private','tests','reports']);
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

function publicReadonlyScript(publishedAt){
  return `<script>
(function(){
  function installPublicReadonly(){
    if(!window.App)return;
    App.shareMode=true;
    App.shareToken='public';
    App.shareMeta={mode:'public',allowExport:false,dataVersion:{id:'public',period:App.currentMonth||'',publishedAt:${JSON.stringify(publishedAt)}}};
    App.isReadOnly=function(){return true;};
    App.shareCanExport=function(){return false;};
    if(typeof applyShareVisibility==='function')applyShareVisibility();
    if(typeof installShareGuards==='function')installShareGuards();
  }
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',function(){setTimeout(installPublicReadonly,0);});
  }else{
    setTimeout(installPublicReadonly,0);
  }
})();
</script>`;
}

function publicPage(source,basePath,publishedAt){
  let html=source;
  const stripPatterns=[
    /<script[^>]*src="(?:pages\/crypto|pages\/unlock|dashboard-publish|dashboard-ai|dashboard-agent|dashboard-diagnosis|dashboard-remediation|dashboard-export)\.js[^>]*><\/script>/g,
    /<script[^>]*src="xlsx\.full\.min\.js[^>]*><\/script>/g,
    /<link[^>]*href="(?:dashboard-publish|pages\/unlock)\.css[^>]*"\s*\/?>/g,
    /href="[^"]*\.xlsx"/g,
  ];
  for(const pattern of stripPatterns)html=html.replace(pattern,'');
  html=html.replace(/<[^>]+data-share-restricted[^>]*>[\s\S]*?<\/[^>]+>/gi,'');
  html=html.replace(/<input[^>]+data-share-restricted[^>]*\/?\s*>/gi,'');
  html=html.replace(/<[^>]+data-share-ai[^>]*>[\s\S]*?<\/[^>]+>/gi,'');
  html=html.replace(/<[^>]+data-share-export[^>]*>[\s\S]*?<\/[^>]+>/gi,'');
  html=html.replace(/<base\s+href="[^"]*"\s*\/?>/i,`<base href="${basePath}">`);
  if(!html.includes(`<base href="${basePath}">`))html=html.replace(/<head>/i,`<head><base href="${basePath}">`);
  html=html.replace(/<meta name="viewport"/i,'<meta name="robots" content="noindex,nofollow"><meta name="viewport"');
  html=html.replace(/<script src="dashboard-main\.js[^"]*"><\/script>/,publicReadonlyScript(publishedAt)+'<script src="dashboard-main.js?v=20260623"></script>');
  return html;
}

function sensitiveEnvironmentValues(){
  return Object.entries(process.env)
    .filter(([name,value])=>/(?:PASSWORD|SECRET|TOKEN|API_KEY|DATABASE_URL)/i.test(name)&&typeof value==='string'&&value.length>=8)
    .map(([,value])=>value);
}

function validatePublicData(text){
  let data;
  try{data=JSON.parse(text);}catch(error){throw new Error('Public data JSON is invalid');}
  if(!data||typeof data!=='object'||!data.actuals||!data._plans)throw new Error('Public data must contain actuals and _plans');
  const serialized=JSON.stringify(data);
  for(const pattern of SECRET_PATTERNS)if(pattern.test(serialized))throw new Error('Credential or database marker found in public data');
  return data;
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
  const allowed=new Set(['index.html','_data_backup.json',...RUNTIME_FILES]);
  for(const relative of files){
    const normalized=relative.replace(/\\/g,'/'),parts=normalized.split('/'),name=parts.at(-1);
    if(parts.some(part=>FORBIDDEN_PARTS.has(part))||FORBIDDEN_NAMES.some(pattern=>pattern.test(name)))throw new Error(`Forbidden output file: ${normalized}`);
    if(allowed.has(normalized))continue;
    throw new Error(`Output file is outside the strict allowlist: ${normalized}`);
  }
}

async function scanOutputContent(directory,files){
  for(const relative of files){
    if(!/\.(?:html|json|js|css)$/.test(relative))continue;
    const content=await fs.readFile(path.join(directory,relative),'utf8');
    for(const pattern of SECRET_PATTERNS)if(pattern.test(content))throw new Error(`Sensitive content found in output: ${relative}`);
    for(const secretValue of sensitiveEnvironmentValues())if(content.includes(secretValue))throw new Error(`Environment secret value found in output: ${relative}`);
    if(relative==='_data_backup.json')validatePublicData(content);
  }
}

export async function buildPages({root=ROOT,output=path.join(root,OUTPUT_NAME),basePath=process.env.PAGES_BASE_PATH||'/'}={}){
  const base=normalizeBasePath(basePath),temp=path.join(path.dirname(output),`.${path.basename(output)}.${process.pid}.${Date.now()}.tmp`);
  await fs.rm(temp,{recursive:true,force:true});await fs.mkdir(temp,{recursive:true});
  try{
    for(const file of RUNTIME_FILES)await copyFile(root,temp,file);
    const sourceHtml=await fs.readFile(path.join(root,'index.html'),'utf8');
    const publicDataPath=path.join(root,'pages/public-data.json');
    const fallbackDataPath=path.join(root,'_data_backup.json');
    let publicDataText;
    try{publicDataText=await fs.readFile(publicDataPath,'utf8');}
    catch(error){if(error.code==='ENOENT')publicDataText=await fs.readFile(fallbackDataPath,'utf8');else throw error;}
    validatePublicData(publicDataText);
    await fs.writeFile(path.join(temp,'_data_backup.json'),publicDataText,'utf8');
    await fs.writeFile(path.join(temp,'index.html'),publicPage(sourceHtml,base,new Date().toISOString()),'utf8');
    const files=await listFiles(temp);scanOutputFiles(files);await scanOutputContent(temp,files);
    await fs.rm(output,{recursive:true,force:true});await fs.rename(temp,output);
    return {output,basePath:base,files:await listFiles(output)};
  }catch(error){await fs.rm(temp,{recursive:true,force:true});throw error;}
}

async function main(){
  try{
    const result=await buildPages();
    console.log(`Pages build complete: ${result.files.length} public file(s), base ${result.basePath}`);
  }catch(error){
    console.error(`Pages build failed: ${error.message}`);
    process.exitCode=1;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
