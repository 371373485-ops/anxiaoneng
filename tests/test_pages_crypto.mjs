import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require=createRequire(import.meta.url);
const root=path.resolve(import.meta.dirname,'..');
const Crypto=require(path.join(root,'pages/crypto.js'));
const Unlock=require(path.join(root,'pages/unlock.js'));
const Cli=await import(pathToFileURL(path.join(root,'scripts/encrypt-share.mjs')).href);
const password=['test','only','correct','passphrase','2026'].join('-');
const payload={
  currentMonth:'2026-06',currentPlanKey:'2026-v1',
  actuals:{'2026-06':{branches:[{orgId:'ORG_A',n:'上海分公司',r:'第一责任区',d:{经营利润:123.45,已赚保费:999}}],regions:{},national:{}}},
  _plans:{'2026-v1':{branches:[{orgId:'ORG_A',n:'上海分公司',r:'第一责任区',d:{经营利润年度计划:1500}}],regions:{},national:{}}}
};

function clone(value){return JSON.parse(JSON.stringify(value));}
function mutateBase64(value){const bytes=Crypto.base64ToBytes(value);bytes[Math.floor(bytes.length/2)]^=1;return Crypto.bytesToBase64(bytes);}

async function envelope(){return Crypto.encryptJson(payload,password,{createdAt:'2026-06-21T00:00:00.000Z',dataVersion:'release-1'});}

test('uses required versioned PBKDF2 and AES-GCM format',async()=>{
  const encrypted=await envelope();
  assert.equal(encrypted.format,'anxiaoneng-encrypted-share');
  assert.equal(encrypted.version,1);
  assert.deepEqual({name:encrypted.kdf.name,hash:encrypted.kdf.hash,iterations:encrypted.kdf.iterations},{name:'PBKDF2',hash:'SHA-256',iterations:600000});
  assert.equal(Crypto.base64ToBytes(encrypted.kdf.salt).length,16);
  assert.equal(encrypted.cipher.name,'AES-GCM');
  assert.equal(Crypto.base64ToBytes(encrypted.cipher.iv).length,12);
  assert.deepEqual(Object.keys(encrypted.meta).sort(),['createdAt','dataVersion']);
});

test('same plaintext and password produce different salt IV and ciphertext',async()=>{
  const first=await envelope(),second=await envelope();
  assert.notEqual(first.kdf.salt,second.kdf.salt);
  assert.notEqual(first.cipher.iv,second.cipher.iv);
  assert.notEqual(first.cipher.data,second.cipher.data);
});

test('correct password restores complete UTF-8 Chinese JSON',async()=>{
  assert.deepEqual(await Crypto.decryptJson(await envelope(),password),payload);
});

test('wrong password and mutations of data IV or salt cannot decrypt',async()=>{
  const original=await envelope();
  await assert.rejects(Crypto.decryptJson(original,['test','only','wrong','passphrase','2026'].join('-')),/Decryption failed/);
  for(const field of ['data','iv']){
    const changed=clone(original);changed.cipher[field]=mutateBase64(changed.cipher[field]);
    await assert.rejects(Crypto.decryptJson(changed,password),/Decryption failed/);
  }
  const changedSalt=clone(original);changedSalt.kdf.salt=mutateBase64(changedSalt.kdf.salt);
  await assert.rejects(Crypto.decryptJson(changedSalt,password),/Decryption failed/);
});

test('encrypted JSON contains no organization name metric or password plaintext',async()=>{
  const text=JSON.stringify(await envelope());
  for(const forbidden of ['上海分公司','经营利润','已赚保费',password])assert.equal(text.includes(forbidden),false,forbidden);
});

test('CLI validates allowed organizations and writes atomically without secrets',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'anxiaoneng-crypto-'));
  const input=path.join(directory,'plain.json'),first=path.join(directory,'A'.repeat(32)+'.json'),second=path.join(directory,'B'.repeat(32)+'.json');
  await fs.writeFile(input,JSON.stringify(payload),'utf8');
  const result1=await Cli.encryptFile({inputPath:input,outputPath:first,allowedOrgIds:['ORG_A'],dataVersion:'release-1',password,confirmPassword:password});
  const result2=await Cli.encryptFile({inputPath:input,outputPath:second,allowedOrgIds:['ORG_A'],dataVersion:'release-1',password,confirmPassword:password});
  assert.equal(result1.organizationCount,1);
  const text1=await fs.readFile(first,'utf8'),text2=await fs.readFile(second,'utf8');
  assert.notEqual(text1,text2);
  assert.equal(text1.includes(password),false);
  assert.equal(text1.includes('上海分公司'),false);
  assert.deepEqual(await Crypto.decryptJson(JSON.parse(text1),password),payload);
  assert.deepEqual((await fs.readdir(directory)).filter(name=>name.includes('tmp-encrypted-share')),[]);
  await assert.rejects(Cli.encryptFile({inputPath:input,outputPath:path.join(directory,'C'.repeat(32)+'.json'),allowedOrgIds:['ORG_B'],dataVersion:'release-1',password,confirmPassword:password}),/unauthorized|absent/);
  assert.throws(()=>Cli.parseArgs(['in.json','out.json','--password='+password,'--allowed-org','ORG_A']),/hidden interactive input/);
  await fs.rm(directory,{recursive:true,force:true});
});

test('browser controller never touches storage and refresh requires password again',async()=>{
  const encrypted=await envelope();
  let storageReads=0,backupReads=0,waited=0;
  const fetch=async(url)=>{if(String(url).includes('_data_backup'))backupReads++;return {ok:true,json:async()=>clone(encrypted)};};
  const first=Unlock.createController({cryptoApi:Crypto,fetch,wait:async(ms)=>{waited=ms;}});
  globalThis.localStorage={getItem(){storageReads++;throw new Error('must not read storage');}};
  await first.load('https://example.test/pages/data/token.json');
  await assert.rejects(first.unlock(['test','only','wrong','passphrase','2026'].join('-')),/密码错误或分享文件已损坏/);
  assert.ok(waited>=500);
  assert.deepEqual(await first.unlock(password),payload);
  assert.equal(first.isUnlocked(),true);
  const refreshed=Unlock.createController({cryptoApi:Crypto,fetch,wait:async()=>{}});
  await refreshed.load('https://example.test/pages/data/token.json');
  assert.equal(refreshed.isUnlocked(),false);
  assert.equal(storageReads,0);
  assert.equal(backupReads,0);
  delete globalThis.localStorage;
});

test('browser install injects decrypted payload only after password submission',async()=>{
  const encrypted=await envelope();
  let submitHandler,refreshCount=0,visibilityCount=0;
  const button={disabled:false};
  const input={value:password,focus(){}};
  const error={textContent:''};
  const form={
    addEventListener(type,handler){if(type==='submit')submitHandler=handler;},
    querySelector(selector){return selector==='button'?button:null;},
  };
  const host={
    innerHTML:'',
    querySelector(selector){
      if(selector==='#pagesUnlockForm')return form;
      if(selector==='#pagesUnlockPassword')return input;
      if(selector==='#pagesUnlockError')return error;
      return null;
    },
  };
  const document={baseURI:'https://owner.github.io/anxiaoneng/',body:host,getElementById(id){return id==='pagesUnlockRoot'?host:null;}};
  const app={ALL_DATA:{actuals:{old:{branches:[{n:'旧数据'}]}},_plans:{}},currentMonth:'old',currentPlanKey:'old'};
  globalThis.refreshMergedData=()=>{refreshCount++;app.ALL_DATA._merged={rebuilt:true};};
  globalThis.applyShareVisibility=()=>{visibilityCount++;};
  assert.equal(Unlock.install(app,{
    cryptoApi:Crypto,document,
    location:{origin:'https://owner.github.io',hostname:'owner.github.io',pathname:'/anxiaoneng/share/random-token',search:''},
    fetch:async()=>({ok:true,json:async()=>clone(encrypted)}),wait:async()=>{},
  }),true);
  assert.deepEqual(app.ALL_DATA,Unlock.emptyData());
  const loading=globalThis.loadSharedDashboard();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(typeof submitHandler,'function');
  submitHandler({preventDefault(){}});
  await loading;
  assert.equal(input.value,'');
  assert.equal(app.currentMonth,'2026-06');
  assert.equal(app.ALL_DATA.actuals['2026-06'].branches[0].n,'上海分公司');
  assert.deepEqual(app.ALL_DATA._merged,{rebuilt:true});
  assert.equal(refreshCount,1);
  assert.equal(visibilityCount,1);
  delete globalThis.loadSharedDashboard;
  delete globalThis.refreshMergedData;
  delete globalThis.applyShareVisibility;
});
test('GitHub Pages path resolves encrypted file within repository and bootstrap precedes main init',()=>{
  const location={origin:'https://owner.github.io',hostname:'owner.github.io',pathname:'/anxiaoneng/share/random-token',search:''};
  assert.equal(Unlock.shouldInstall(location),true);
  assert.equal(Unlock.encryptedUrl('random-token',Unlock.encryptedBase(location)),'https://owner.github.io/anxiaoneng/pages/data/random-token.json');
  return fs.readFile(path.join(root,'index.html'),'utf8').then(html=>{
    assert.ok(html.indexOf('pages/crypto.js')<html.indexOf('dashboard-data.js'));
    assert.ok(html.indexOf('pages/unlock.js')<html.indexOf('dashboard-data.js'));
    assert.ok(html.indexOf('pages/crypto.js')<html.indexOf('dashboard-main.js'));
    assert.ok(html.indexOf('pages/unlock.js')<html.indexOf('dashboard-main.js'));
    assert.ok(html.indexOf('dashboard-data.js')<html.indexOf('dashboard-share.js'));
  });
});
