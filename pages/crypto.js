(function(root,factory){
  var api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.AnxiaonengCrypto=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  var FORMAT='anxiaoneng-encrypted-share';
  var VERSION=1;
  var DEFAULT_ITERATIONS=600000;
  var encoder=new TextEncoder();
  var decoder=new TextDecoder('utf-8',{fatal:true});

  function webCrypto(){
    if(!root.crypto||!root.crypto.subtle||!root.crypto.getRandomValues)throw new Error('Web Crypto API unavailable');
    return root.crypto;
  }
  function bytesToBase64(bytes){
    var binary='',chunk=0x8000;
    for(var i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode.apply(null,bytes.subarray(i,i+chunk));
    if(typeof btoa==='function')return btoa(binary);
    if(typeof Buffer!=='undefined')return Buffer.from(bytes).toString('base64');
    throw new Error('Base64 encoder unavailable');
  }
  function base64ToBytes(value){
    if(typeof value!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(value)||value.length%4!==0)throw new Error('Invalid encrypted share format');
    var binary;
    try{
      binary=typeof atob==='function'?atob(value):Buffer.from(value,'base64').toString('binary');
    }catch(error){throw new Error('Invalid encrypted share format');}
    var bytes=new Uint8Array(binary.length);
    for(var i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    return bytes;
  }
  function safeMeta(meta){
    var value=meta||{},createdAt=value.createdAt||new Date().toISOString();
    if(typeof createdAt!=='string'||createdAt.length>40||!/^[0-9T:+.Z-]+$/.test(createdAt)||!Number.isFinite(Date.parse(createdAt)))throw new Error('createdAt must be an ISO timestamp');
    if(value.dataVersion!=null&&!/^[A-Za-z0-9._-]{1,80}$/.test(String(value.dataVersion)))throw new Error('dataVersion must be a non-sensitive identifier');
    return {createdAt:createdAt,dataVersion:String(value.dataVersion||'v1')};
  }
  function aadFor(envelope){
    return encoder.encode(JSON.stringify({
      format:envelope.format,version:envelope.version,
      kdf:{name:envelope.kdf.name,hash:envelope.kdf.hash,iterations:envelope.kdf.iterations,salt:envelope.kdf.salt},
      cipher:{name:envelope.cipher.name,iv:envelope.cipher.iv},meta:envelope.meta
    }));
  }
  function validateEnvelope(value){
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid encrypted share format');
    if(value.format!==FORMAT||value.version!==VERSION)throw new Error('Invalid encrypted share format');
    if(!value.kdf||value.kdf.name!=='PBKDF2'||value.kdf.hash!=='SHA-256')throw new Error('Invalid encrypted share format');
    if(!Number.isInteger(value.kdf.iterations)||value.kdf.iterations<100000||value.kdf.iterations>2000000)throw new Error('Invalid encrypted share format');
    if(!value.cipher||value.cipher.name!=='AES-GCM')throw new Error('Invalid encrypted share format');
    var salt=base64ToBytes(value.kdf.salt),iv=base64ToBytes(value.cipher.iv),data=base64ToBytes(value.cipher.data);
    if(salt.length<16||iv.length!==12||data.length<17)throw new Error('Invalid encrypted share format');
    var meta=safeMeta(value.meta);
    if(meta.createdAt!==value.meta.createdAt||meta.dataVersion!==value.meta.dataVersion)throw new Error('Invalid encrypted share format');
    return {salt:salt,iv:iv,data:data};
  }
  async function deriveKey(password,salt,iterations,usage){
    var subtle=webCrypto().subtle;
    var material=await subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveKey']);
    return subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt:salt,iterations:iterations},material,{name:'AES-GCM',length:256},false,[usage]);
  }
  async function encryptJson(value,password,meta,options){
    if(typeof password!=='string'||password.length<16)throw new Error('Password must contain at least 16 characters');
    var opts=options||{},iterations=opts.iterations==null?DEFAULT_ITERATIONS:opts.iterations;
    if(!Number.isInteger(iterations)||iterations<100000||iterations>2000000)throw new Error('Invalid PBKDF2 iterations');
    var cryptoApi=webCrypto(),salt=opts.salt||cryptoApi.getRandomValues(new Uint8Array(16)),iv=opts.iv||cryptoApi.getRandomValues(new Uint8Array(12));
    if(!(salt instanceof Uint8Array)||salt.length<16||!(iv instanceof Uint8Array)||iv.length!==12)throw new Error('Invalid salt or IV');
    var envelope={format:FORMAT,version:VERSION,kdf:{name:'PBKDF2',hash:'SHA-256',iterations:iterations,salt:bytesToBase64(salt)},cipher:{name:'AES-GCM',iv:bytesToBase64(iv),data:''},meta:safeMeta(meta)};
    var key=await deriveKey(password,salt,iterations,'encrypt');
    var plaintext=encoder.encode(JSON.stringify(value));
    var encrypted=await cryptoApi.subtle.encrypt({name:'AES-GCM',iv:iv,additionalData:aadFor(envelope),tagLength:128},key,plaintext);
    envelope.cipher.data=bytesToBase64(new Uint8Array(encrypted));
    return envelope;
  }
  async function decryptJson(envelope,password){
    if(typeof password!=='string'||!password)throw new Error('Decryption failed');
    try{
      var parsed=validateEnvelope(envelope),key=await deriveKey(password,parsed.salt,envelope.kdf.iterations,'decrypt');
      var clear=await webCrypto().subtle.decrypt({name:'AES-GCM',iv:parsed.iv,additionalData:aadFor(envelope),tagLength:128},key,parsed.data);
      return JSON.parse(decoder.decode(clear));
    }catch(error){throw new Error('Decryption failed');}
  }
  function validateSharePayload(payload){
    if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error('Invalid share payload');
    if(!payload.actuals||typeof payload.actuals!=='object'||Array.isArray(payload.actuals))throw new Error('Invalid share payload');
    if(!payload._plans||typeof payload._plans!=='object'||Array.isArray(payload._plans))throw new Error('Invalid share payload');
    if(typeof payload.currentMonth!=='string'||typeof payload.currentPlanKey!=='string')throw new Error('Invalid share payload');
    if('_merged' in payload)throw new Error('Invalid share payload');
    return payload;
  }
  return {FORMAT:FORMAT,VERSION:VERSION,DEFAULT_ITERATIONS:DEFAULT_ITERATIONS,encryptJson:encryptJson,decryptJson:decryptJson,validateEnvelope:validateEnvelope,validateSharePayload:validateSharePayload,bytesToBase64:bytesToBase64,base64ToBytes:base64ToBytes};
});
