#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const ROOT=path.resolve(import.meta.dirname,'..');
const OUTPUT_NAME='pages-dist';

// All runtime files — full feature set, nothing stripped
const RUNTIME_FILES=[
  'chart.umd.min.js','xlsx.full.min.js',
  'dashboard-data.js','dashboard-config.js','dashboard-compute.js','dashboard-metrics.js',
  'dashboard-charts.js','dashboard-render.js','dashboard-alerts.js','dashboard-share.js',
  'dashboard-trend.js','dashboard-main.js',
  'dashboard-export.js','dashboard-publish.js','ai-client.js','dashboard-ai.js','dashboard-agent.js',
  'dashboard-diagnosis.js','dashboard-remediation.js',
  'dashboard-diagnosis.css','dashboard-publish.css',
  'pages/crypto.js','pages/unlock.js','pages/unlock.css',
];

const FORBIDDEN_NAMES=[
  /^\.env(?:\.|$)/i,/\.(?:db|sqlite|sqlite3)$/i,
  /\.decrypted\.json$/i,/\.tmp-encrypted-share/i,/\.py$/i,/\.log$/i,
];
const FORBIDDEN_PARTS=new Set(['.git','backend','backups','docs','memory','plaintext-share','pages-private','tests','reports','evolution-drafts']);
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

function fullPage(source,basePath){
  let html=source;
  // Set base href for GitHub Pages subpath
  html=html.replace(/<base\s+href="[^"]*"\s*\/?>/i,`<base href="${basePath}">`);
  if(!html.includes(`<base href="${basePath}">`))html=html.replace(/<head>/i,`<head><base href="${basePath}">`);
  // Add noindex
  html=html.replace(/<meta name="viewport"/i,'<meta name="robots" content="noindex,nofollow"><meta name="viewport"');
  return html;
}

function sensitiveEnvironmentValues(){
  return Object.entries(process.env)
    .filter(([name,value])=>/(?:PASSWORD|SECRET|TOKEN|API_KEY|DATABASE_URL)/i.test(name)&&typeof value==='string'&&value.length>=8)
    .map(([,value])=>value);
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
  }
}

export async function buildPages({root=ROOT,output=path.join(root,OUTPUT_NAME),basePath=process.env.PAGES_BASE_PATH||'/'}={}){
  const base=normalizeBasePath(basePath),temp=path.join(path.dirname(output),`.${path.basename(output)}.${process.pid}.${Date.now()}.tmp`);
  await fs.rm(temp,{recursive:true,force:true});await fs.mkdir(temp,{recursive:true});
  try{
    // Copy all runtime files
    for(const file of RUNTIME_FILES)await copyFile(root,temp,file);
    // Copy data backup
    const dataPath=path.join(root,'_data_backup.json');
    const dataText=await fs.readFile(dataPath,'utf8');
    // Validate it's valid JSON
    try{JSON.parse(dataText);}catch{throw new Error('_data_backup.json is not valid JSON');}
    await fs.writeFile(path.join(temp,'_data_backup.json'),dataText,'utf8');
    // Build full-featured index.html (no stripping, no readonly injection)
    const sourceHtml=await fs.readFile(path.join(root,'index.html'),'utf8');
    await fs.writeFile(path.join(temp,'index.html'),fullPage(sourceHtml,base),'utf8');
    // Security scan
    const files=await listFiles(temp);scanOutputFiles(files);await scanOutputContent(temp,files);
    await fs.rm(output,{recursive:true,force:true});await fs.rename(temp,output);
    return {output,basePath:base,files:await listFiles(output)};
  }catch(error){await fs.rm(temp,{recursive:true,force:true});throw error;}
}

async function main(){
  try{
    const result=await buildPages();
    console.log(`Pages build complete: ${result.files.length} files, full-featured, base ${result.basePath}`);
  }catch(error){
    console.error(`Pages build failed: ${error.message}`);
    process.exitCode=1;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
