import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAuthService } from '../src/auth/auth-service.ts';
import { PlatformApi } from '../src/platform/api.ts';

// API-adapter unit tests only. Platform acceptance separately uses real PostgreSQL,
// SMTP and API. The former no-network Demo contract is intentionally retired.
const credentials = {account:'adapter-unit-user',password:'UnitTest-Password-12!'};
const user = {id:'31cc0853-a9dc-4c13-ae23-410a7b1e4f22',username:credentials.account,displayName:'Unit User',email:'unit@example.invalid',role:'USER',status:'ACTIVE',memberStatus:'NONE',emailVerified:true,grade:'',major:'',directionIds:[],profileVersion:1,createdAt:'2026-01-01T00:00:00Z'};
const session = {user:null,csrfToken:'unit-csrf-token',grants:[],expiresAt:null};
const json = (data,status=200) => new Response(JSON.stringify(status < 400 ? {data} : {error:data}), {status,headers:{'Content-Type':'application/json'}});
function adapter(handler) {
  const calls=[];
  const api = new PlatformApi(async (url,options) => {
    calls.push({url,options});
    if (url.endsWith('/auth/session')) return json(session);
    return handler(url,options);
  });
  return {api,auth:createAuthService(api),calls};
}
const valid = () => adapter(async (_url,options) => {
  const body = JSON.parse(options.body);
  return body.account === credentials.account && body.password === credentials.password
    ? json({...session,user,csrfToken:'rotated-unit-csrf'}) : json({code:'INVALID_IDENTITY',message:'Invalid account or password'},401);
});

test('real authentication adapter sends credentialed network request with server CSRF',async()=>{
  const {auth,api,calls}=valid();
  const result=await auth.authenticate(credentials);
  assert.equal(result.ok,true); assert.equal(result.identity.id,user.id);
  assert.deepEqual(calls.map(call=>call.url),['/api/v1/auth/session','/api/v1/auth/login']);
  assert.equal(calls[1].options.credentials,'same-origin'); assert.equal(calls[1].options.cache,'no-store');
  assert.equal(calls[1].options.headers['X-CSRF-Token'],session.csrfToken);
  assert.equal(api.session.csrfToken,'rotated-unit-csrf');
  assert.equal('token' in result,false); assert.equal('password' in result.identity,false);
});
test('unknown account and wrong password remain rejected',async()=>{
  const {auth}=valid();
  for(const input of [{account:'unknown',password:credentials.password},{...credentials,password:'wrong'}]) {
    const result=await auth.authenticate(input); assert.equal(result.ok,false); assert.equal(result.code,'INVALID_IDENTITY');
  }
});
test('account trimming keeps password whitespace and case exact',async()=>{
  const {auth,calls}=valid(); assert.equal((await auth.authenticate({...credentials,account:` ${credentials.account} `})).ok,true);
  for(const password of [` ${credentials.password}`,`${credentials.password} `,credentials.password.toUpperCase()]) {
    assert.equal((await auth.authenticate({...credentials,password})).ok,false);
    assert.equal(JSON.parse(calls.at(-1).options.body).password,password);
  }
});
test('empty input is denied before sending a login request',async()=>{
  const {auth,calls}=valid();
  for(const input of [{account:'',password:''},{account:'   ',password:credentials.password},{account:credentials.account,password:''}]) assert.equal((await auth.authenticate(input)).ok,false);
  assert.equal(calls.length,0);
});
test('already cancelled credentials reject with AbortError',async()=>{
  const {auth,calls}=valid(),controller=new AbortController(); controller.abort();
  await assert.rejects(auth.authenticate(credentials,controller.signal),{name:'AbortError'}); assert.equal(calls.length,0);
});
test('in-flight cancellation cannot promote a pending identity',async()=>{
  const {api,auth}=adapter((_url,options)=>new Promise((resolve,reject)=>{
    options.signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true});
  }));
  const controller=new AbortController(),pending=auth.authenticate(credentials,controller.signal);
  const rejected=assert.rejects(pending,{name:'AbortError'}); await new Promise(resolve=>setImmediate(resolve)); controller.abort(); await rejected;
  assert.equal(api.session?.user,null);
});
test('prior success does not authorize a later denied identity',async()=>{
  const {api,auth}=valid(); assert.equal((await auth.authenticate(credentials)).ok,true);
  assert.equal((await auth.authenticate({...credentials,password:'wrong'})).ok,false); assert.equal(api.session,null);
});
test('unavailable API never falls back to the old public Demo credentials',async()=>{
  const {auth}=adapter(async()=>{throw new TypeError('network offline')});
  const result=await auth.authenticate({account:'ixd-demo',password:'ixd2026'});
  assert.equal(result.ok,false); assert.equal(result.code,'UNAVAILABLE');
});
test('rate limits and permission failures remain explicit',async()=>{
  for(const [status,code] of [[403,'FORBIDDEN'],[429,'RATE_LIMITED'],[503,'UNAVAILABLE']]) {
    const {auth}=adapter(async()=>json({code,message:'service feedback'},status));
    const result=await auth.authenticate(credentials); assert.equal(result.ok,false); assert.equal(result.code,code);
  }
});
test('malformed success with no authenticated user is not accepted',async()=>{
  const {auth}=adapter(async()=>json(session)); assert.equal((await auth.authenticate(credentials)).ok,false);
});
test('authentication does not persist credentials or read browser cookies/storage',async()=>{
  const saved=new Map();
  try {
    for(const name of ['localStorage','sessionStorage','indexedDB','caches','document']) {
      saved.set(name,Object.getOwnPropertyDescriptor(globalThis,name));
      Object.defineProperty(globalThis,name,{configurable:true,get(){throw new Error(`Unexpected ${name} access`)}});
    }
    assert.equal((await valid().auth.authenticate(credentials)).ok,true);
  } finally { for(const [name,descriptor] of saved) {if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];} }
});
