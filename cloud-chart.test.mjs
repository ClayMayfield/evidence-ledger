import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installCloudChart,readImageForPreview} from './cloud-chart.mjs';

function element(){return {events:{},disabled:false,hidden:false,textContent:'',value:'',files:[],addEventListener(name,fn){this.events[name]=fn;},removeAttribute(name){delete this[name];}};}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function setup(readPreview=async file=>`data:${file.type};base64,c3ludGhldGlj`){
  const elements=Object.fromEntries(['file','sample','preview','send','status','result'].map(k=>[k,element()]));
  const calls=[],responses=[];let modelCalls=0;
  const getModel=()=>{modelCalls++;return {generateContent:args=>{calls.push(args);const d=deferred();responses.push(d);return d.promise;}};};
  installCloudChart({elements,getModel,inCloud:'cloud',readPreview,createSample:async()=>png});
  return {elements,calls,responses,getModelCalls:()=>modelCalls};
}
const png={type:'image/png',size:123};
const response=(text='synthetic suggestion',source='cloud')=>({response:{inferenceSource:source,text:()=>text}});

test('previews locally without contacting the model; explicit send submits only the chosen image',async()=>{
  const t=setup(),e=t.elements;e.file.files=[png];await e.file.events.change();
  assert.equal(t.getModelCalls(),0);assert.equal(e.preview.hidden,false);assert.match(e.status.textContent,/has not been sent/);
  const request=e.send.events.click();assert.equal(t.calls.length,1);assert.equal(e.send.disabled,true);
  assert.deepEqual(t.calls[0][1],{type:'inlineData',inlineData:{data:'c3ludGhldGlj',mimeType:'image/png'}});
  t.responses[0].resolve(response());await request;
  assert.equal(e.result.textContent,'synthetic suggestion');assert.match(e.status.textContent,/Verify every detail/);
});

test('invalid selections clear prior image and result without calling the model',async()=>{
  const t=setup(),e=t.elements;e.file.files=[png];await e.file.events.change();
  const pending=e.send.events.click();t.responses[0].resolve(response());await pending;
  e.file.files=[{type:'image/png',size:4*1024*1024+1}];await e.file.events.change();
  assert.equal(e.preview.hidden,true);assert.equal(e.send.disabled,true);assert.equal(e.result.textContent,'No suggestions yet.');
  await e.send.events.click();assert.equal(t.calls.length,1);
  e.file.files=[{type:'image/gif',size:1}];await e.file.events.change();assert.equal(e.send.disabled,true);
});

test('later selections supersede a slow preview and an in-flight result',async()=>{
  const first=deferred(),second=deferred();let n=0;const t=setup(()=>++n===1?first.promise:second.promise),e=t.elements;
  e.file.files=[png];const a=e.file.events.change();await Promise.resolve();e.file.files=[{type:'image/jpeg',size:2}];const b=e.file.events.change();
  second.resolve('data:image/jpeg;base64,Yg==');await b;first.resolve('data:image/png;base64,YQ==');await a;
  assert.equal(e.preview.src,'data:image/jpeg;base64,Yg==');
  const request=e.send.events.click();e.file.files=[];await e.file.events.change();t.responses[0].resolve(response('obsolete'));await request;
  assert.equal(e.result.textContent,'No suggestions yet.');assert.equal(e.send.disabled,true);assert.match(e.status.textContent,/No current image selected/);
});

test('unconfirmed cloud source and failed requests never display model content',async()=>{
  const t=setup(),e=t.elements;e.file.files=[png];await e.file.events.change();
  let p=e.send.events.click();t.responses[0].resolve(response('not safe to display','unknown'));await p;
  assert.doesNotMatch(e.result.textContent,/not safe/);assert.match(e.status.textContent,/did not confirm/);
  p=e.send.events.click();t.responses[1].reject(new Error('synthetic failure'));await p;assert.match(e.status.textContent,/failed/);assert.match(e.result.textContent,/No suggestions/);
});

test('browser preview rejects invalid dimensions and content',async()=>{
  const oldReader=globalThis.FileReader,oldImage=globalThis.Image;
  try{
    globalThis.FileReader=class{readAsDataURL(){this.result='data:image/png;base64,YQ==';this.onload();}};
    globalThis.Image=class{constructor(){this.naturalWidth=4000;this.naturalHeight=4000;}async decode(){}};
    await assert.rejects(()=>readImageForPreview(png),/dimension/);
    globalThis.Image=class{constructor(){this.naturalWidth=100;this.naturalHeight=100;}async decode(){throw new Error('bad image');}};
    await assert.rejects(()=>readImageForPreview(png),/bad image/);
  }finally{globalThis.FileReader=oldReader;globalThis.Image=oldImage;}
});


test('synthetic sample is locally previewed and requires an explicit send',async()=>{
  const t=setup(),e=t.elements;await e.sample.events.click();
  assert.equal(t.calls.length,0);assert.equal(e.preview.hidden,false);assert.match(e.status.textContent,/has not been sent/);
});

test('changing images during an upload explains that the earlier request is not cancelled',async()=>{
  const t=setup(),e=t.elements;e.file.files=[png];await e.file.events.change();
  const pending=e.send.events.click();e.file.files=[{type:'image/jpeg',size:123}];await e.file.events.change();
  assert.equal(t.calls.length,1);assert.match(e.status.textContent,/earlier image request is still running/);assert.match(e.status.textContent,/does not cancel/);assert.equal(e.send.disabled,true);
  t.responses[0].resolve(response('old image'));await pending;
  assert.equal(e.result.textContent,'No suggestions yet.');assert.equal(e.send.disabled,false);assert.match(e.status.textContent,/earlier request has finished/);
});

test('finishing an earlier upload clears the running notice after cancelling a new selection',async()=>{
  const t=setup(),e=t.elements;e.file.files=[png];await e.file.events.change();
  const pending=e.send.events.click();e.file.files=[];await e.file.events.change();
  assert.match(e.status.textContent,/earlier image request is still running/);
  t.responses[0].resolve(response('obsolete'));await pending;
  assert.doesNotMatch(e.status.textContent,/still running/);assert.match(e.status.textContent,/earlier request has finished/);
  assert.equal(e.send.disabled,true);assert.equal(e.result.textContent,'No suggestions yet.');
});
