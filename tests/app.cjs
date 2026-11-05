const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto, randomUUID } = require('node:crypto');
const script=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const settings={enabled:true,privacyNotice:'가짜 시험 안내만 사용',consentVersion:'TEST_ONLY_v1',retentionMonths:1,retentionTimeZone:'Asia/Seoul'};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function browser(post=async()=>Response.json({saved:true,id:randomUUID(),createdAt:new Date().toISOString()},{status:201}),config=settings) {
  const nodes={},calls=[],timers=new Map();let timerId=0;
  for(const [,id] of html.matchAll(/id="([^"]+)"/g)) nodes[id]={value:'',checked:false,disabled:id==='btn-submit',style:{},textContent:'',events:{},classList:{toggle(){}},addEventListener(n,f){this.events[n]=f;}};
  const document={getElementById(id){assert.ok(nodes[id],`HTML contains ${id}`);return nodes[id];},querySelectorAll(){return [];}};
  vm.runInNewContext(script,{document,crypto:webcrypto,AbortController,Date,Number,Object,Error,
    setTimeout(fn){const id=++timerId;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);},
    fetch:async(url,options)=>{
      calls.push({url,options});
      if(url.endsWith('/config')) return Response.json(config);
      return post(url,options);
    }});
  return {nodes,calls,timers,fill(){nodes['user-name'].value='가짜_TEST_고객';nodes['user-phone'].value='010-0000-0000';nodes['privacy-consent'].checked=true;nodes['overseas-consent'].checked=true;},
    submit(){return nodes['lead-form'].events.submit({preventDefault(){}});}};
}
test('HTML has no seed customer records or local PIN gate; submits start disabled',()=>{
  assert.ok(!/ADMIN_PIN|admin-pin|var leads|leads\.unshift/.test(html+script));
  assert.ok(!/localStorage|sessionStorage|indexedDB/.test(script));
  assert.match(html,/<button id="btn-submit"[^>]*disabled>/);
  assert.match(script,/https:\/\/docs\.google\.com\/spreadsheets\/d\//);
});
test('disabled or incomplete server policy never opens intake',async()=>{
  for(const config of [{enabled:false},{enabled:true}, {...settings,retentionMonths:0}, {...settings,retentionTimeZone:'UTC'}, {...settings,retentionDays:30,retentionMonths:undefined}]) {
    const b=browser(undefined,config);await flush();b.fill();await b.submit();
    assert.equal(b.nodes['btn-submit'].disabled,true);assert.equal(b.calls.length,1);
    assert.notEqual(b.nodes['view-complete'].style.display,'block');
  }
});
test('invalid input and missing either explicit consent never send customer data',async()=>{
  const b=browser();await flush();b.fill();
  b.nodes['privacy-consent'].checked=false;await b.submit();
  b.nodes['privacy-consent'].checked=true;b.nodes['overseas-consent'].checked=false;await b.submit();
  b.nodes['overseas-consent'].checked=true;b.nodes['user-phone'].value='invalid';await b.submit();
  b.nodes['user-phone'].value='010-0000-0000';b.nodes['user-name'].value='';await b.submit();
  assert.equal(b.calls.length,1);
});
test('collection notice states one calendar month and explains Korean month-end handling',async()=>{
  const b=browser();await flush();
  assert.match(b.nodes['retention-notice'].textContent,/접수 후 1개월 보관 후 자동 삭제/);
  assert.match(b.nodes['retention-notice'].textContent,/한국시간/);
  assert.match(b.nodes['retention-notice'].textContent,/다음 달 말일 같은 시각/);
  assert.doesNotMatch(b.nodes['retention-notice'].textContent,/30일/);
});
test('pending save prevents double click and only confirmed receipt clears input and shows completion',async()=>{
  let release;const delayed=new Promise(resolve=>{release=resolve;});
  const b=browser(()=>delayed);await flush();b.fill();
  const pending=b.submit();await b.submit();
  assert.equal(b.calls.length,2);assert.equal(b.nodes['btn-submit'].disabled,true);
  assert.notEqual(b.nodes['view-complete'].style.display,'block');assert.equal(b.nodes['user-name'].value,'가짜_TEST_고객');
  const id=randomUUID();release(Response.json({saved:true,id,createdAt:new Date().toISOString()},{status:201}));await pending;
  assert.equal(b.nodes['view-complete'].style.display,'block');assert.equal(b.nodes['user-name'].value,'');assert.equal(b.nodes['receipt-id'].textContent,id);
  assert.equal(b.nodes['privacy-consent'].checked,false);assert.equal(b.nodes['overseas-consent'].checked,false);
  assert.equal(b.calls[1].options.credentials,'omit');
});
test('network, storage, invalid receipt and non-final 202 responses preserve input without completion',async()=>{
  const replies=[()=>{throw Error('mock network failure');},()=>Response.json({error:'모의 저장 실패'},{status:503}),
    ()=>Response.json({saved:false}),()=>Response.json({saved:true,id:'bad',createdAt:'bad'}),
    ()=>Response.json({saved:true,id:randomUUID(),createdAt:new Date().toISOString()},{status:202}),
    ()=>new Response('not JSON')];
  for(const reply of replies){
    const b=browser(reply);await flush();b.fill();await b.submit();
    assert.notEqual(b.nodes['view-complete'].style.display,'block');assert.equal(b.nodes['user-name'].value,'가짜_TEST_고객');assert.equal(b.nodes['btn-submit'].disabled,false);
  }
});
test('timeout preserves draft and retries reuse the same request id; successful retry accepts original receipt',async()=>{
  let attempt=0;const b=browser((url,options)=>{
    if(++attempt===1) return new Promise((resolve,reject)=>{void resolve;options.signal.addEventListener('abort',()=>{const e=Error('timeout');e.name='AbortError';reject(e);});});
    return Response.json({saved:true,id:JSON.parse(options.body).requestId,createdAt:new Date().toISOString()});
  });
  await flush();b.fill();const pending=b.submit();
  for(const fn of [...b.timers.values()]) fn();await pending;
  assert.match(b.nodes['submit-status'].textContent,/超過|초과/);assert.equal(b.nodes['user-name'].value,'가짜_TEST_고객');
  await b.submit();assert.equal(b.calls.length,3);
  assert.equal(JSON.parse(b.calls[1].options.body).requestId,JSON.parse(b.calls[2].options.body).requestId);
  assert.equal(b.nodes['view-complete'].style.display,'block');
});
test('timeout also covers response body download; editing a failed draft gets a different request id',async()=>{
  let attempt=0;const b=browser((url,options)=>{
    if(++attempt===1) return {ok:true,status:201,json:()=>new Promise((resolve,reject)=>{void resolve;options.signal.addEventListener('abort',()=>{const e=Error('timeout');e.name='AbortError';reject(e);});})};
    return Response.json({error:'mock failure'},{status:503});
  });
  await flush();b.fill();const pending=b.submit();await flush();
  for(const fn of [...b.timers.values()]) fn();await pending;
  b.nodes['user-name'].value='가짜_수정_고객';await b.submit();
  assert.notEqual(JSON.parse(b.calls[1].options.body).requestId,JSON.parse(b.calls[2].options.body).requestId);
  assert.equal(b.nodes['user-name'].value,'가짜_수정_고객');assert.notEqual(b.nodes['view-complete'].style.display,'block');
});
