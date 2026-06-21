#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require=createRequire(import.meta.url);
const Crypto=require('../pages/crypto.js');
const ALLOWED_ROOT_FIELDS=new Set(['actuals','_plans','currentMonth','currentPlanKey','_importTimes','_alertRules','__rulesConfigured']);

export function parseArgs(argv){
  const positional=[],allowedOrgIds=[],options={dataVersion:'v1'};
  for(let i=0;i<argv.length;i++){
    const value=argv[i];
    if(value==='--allowed-org'){
      const org=argv[++i];if(!org)throw new Error('--allowed-org requires an orgId');
      allowedOrgIds.push(...org.split(',').map(item=>item.trim()).filter(Boolean));
    }else if(value==='--data-version'){
      options.dataVersion=argv[++i]||'';
    }else if(value==='--password'||value.startsWith('--password=')){
      throw new Error('Passwords are accepted only through hidden interactive input');
    }else if(value.startsWith('-'))throw new Error(`Unknown option: ${value}`);
    else positional.push(value);
  }
  if(positional.length!==2)throw new Error('Usage: node scripts/encrypt-share.mjs <plaintext.json> <encrypted.json> --allowed-org ORG_ID [--data-version VERSION]');
  if(!allowedOrgIds.length)throw new Error('At least one --allowed-org is required');
  if(!/^[A-Za-z0-9._-]{1,80}$/.test(options.dataVersion))throw new Error('dataVersion must be a non-sensitive identifier');
  return {inputPath:positional[0],outputPath:positional[1],allowedOrgIds:[...new Set(allowedOrgIds)],dataVersion:options.dataVersion};
}

function branchLists(payload){
  const lists=[];
  for(const sectionName of ['actuals','_plans']){
    const section=payload[sectionName]||{};
    for(const key of Object.keys(section)){
      const item=section[key];
      if(!item||typeof item!=='object'||Array.isArray(item))throw new Error(`Invalid ${sectionName} entry`);
      if(item.national&&Object.keys(item.national).length)throw new Error(`${sectionName}.${key}.national must be removed before sharing`);
      if(item.regions&&Object.keys(item.regions).length)throw new Error(`${sectionName}.${key}.regions must be removed before sharing`);
      if(!Array.isArray(item.branches))throw new Error(`${sectionName}.${key}.branches must be an array`);
      lists.push(item.branches);
    }
  }
  return lists;
}

export function validateAllowedPayload(payload,allowedOrgIds){
  Crypto.validateSharePayload(payload);
  for(const field of Object.keys(payload))if(!ALLOWED_ROOT_FIELDS.has(field))throw new Error(`Unexpected root field: ${field}`);
  const allowed=new Set(allowedOrgIds),seen=new Set();
  for(const branches of branchLists(payload)){
    for(const branch of branches){
      if(!branch||typeof branch.orgId!=='string'||!branch.orgId)throw new Error('Every shared branch must contain orgId');
      if(!allowed.has(branch.orgId))throw new Error(`Payload contains an unauthorized orgId: ${branch.orgId}`);
      seen.add(branch.orgId);
    }
  }
  if(!seen.size)throw new Error('Payload contains no shareable organizations');
  for(const orgId of allowed)if(!seen.has(orgId))throw new Error(`Allowed orgId is absent from payload: ${orgId}`);
  return {organizationCount:seen.size};
}

export async function readHidden(promptText,{input=process.stdin,output=process.stderr}={}){
  if(!input.isTTY||typeof input.setRawMode!=='function')throw new Error('Password input requires an interactive terminal');
  output.write(promptText);
  input.setEncoding('utf8');input.setRawMode(true);input.resume();
  return new Promise((resolve,reject)=>{
    let value='';
    function finish(error){input.off('data',onData);input.setRawMode(false);input.pause();output.write('\n');error?reject(error):resolve(value);}
    function onData(chunk){
      for(const char of chunk){
        if(char==='\u0003')return finish(new Error('Cancelled'));
        if(char==='\r'||char==='\n')return finish();
        if(char==='\u007f'||char==='\b'){value=value.slice(0,-1);continue;}
        if(char>=' ')value+=char;
      }
    }
    input.on('data',onData);
  });
}

function validateOutputToken(outputPath){
  const filename=path.basename(outputPath);
  if(!filename.endsWith('.json'))throw new Error('Encrypted output must use a .json filename');
  const token=filename.slice(0,-5);
  if(!/^[A-Za-z0-9_-]{32,128}$/.test(token))throw new Error('Output filename must be an independent random token of at least 32 URL-safe characters');
  return token;
}

export async function encryptFile({inputPath,outputPath,allowedOrgIds,dataVersion,password,confirmPassword}){
  validateOutputToken(outputPath);
  if(password!==confirmPassword)throw new Error('Password confirmation does not match');
  if(typeof password!=='string'||password.length<16)throw new Error('Password must contain at least 16 characters');
  const inputText=await fs.readFile(inputPath,'utf8');
  const payload=JSON.parse(inputText);
  const summary=validateAllowedPayload(payload,allowedOrgIds);
  const envelope=await Crypto.encryptJson(payload,password,{createdAt:new Date().toISOString(),dataVersion});
  const outputText=JSON.stringify(envelope,null,2)+'\n';
  const directory=path.dirname(path.resolve(outputPath));
  await fs.mkdir(directory,{recursive:true});
  const random=new Uint8Array(12);globalThis.crypto.getRandomValues(random);
  const suffix=Array.from(random,byte=>byte.toString(16).padStart(2,'0')).join('');
  const temporary=path.join(directory,`.${path.basename(outputPath)}.${suffix}.tmp-encrypted-share`);
  try{
    await fs.writeFile(temporary,outputText,{encoding:'utf8',mode:0o600,flag:'wx'});
    await fs.rename(temporary,path.resolve(outputPath));
  }catch(error){await fs.rm(temporary,{force:true}).catch(()=>{});throw error;}
  return {organizationCount:summary.organizationCount,outputPath:path.resolve(outputPath)};
}

async function main(){
  try{
    const args=parseArgs(process.argv.slice(2));
    const password=await readHidden('访问密码（至少16个字符）：');
    const confirmation=await readHidden('再次输入访问密码：');
    process.stderr.write(`已验证机构白名单，共 ${args.allowedOrgIds.length} 个 orgId。正在加密…\n`);
    const result=await encryptFile({...args,password,confirmPassword:confirmation});
    process.stdout.write(`Encrypted share created for ${result.organizationCount} organization(s): ${result.outputPath}\n`);
  }catch(error){process.stderr.write(`Encryption failed: ${error.message}\n`);process.exitCode=1;}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
