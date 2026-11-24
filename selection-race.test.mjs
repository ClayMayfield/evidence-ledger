// Exercises the actual app's asynchronous image-selection handlers against a
// controllable DOM/image boundary. This is not a real browser rendering test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {parseClaimDraft,assertClaimEvidenceInStatement} from './claim-draft.mjs';
import {evaluateClaim} from './core.mjs';

const source=(await readFile(new URL('./app.mjs',import.meta.url),'utf8'))
  .replace(/^import .* from .*;\s*$/gm,'')
  .replace(/\bimport\(/g,'fakeImport(');

function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
async function flush(){await new Promise(resolve=>setImmediate(resolve));}

async function harness(sdkFixture=null){
  const elements=new Map(), pendingBlobs=[], imageJobs=new Map(), urls=new Map(), docListeners={};let nextUrl=0;
  class Element {
    constructor(tag=''){this.tag=tag;this.children=[];this.dataset={};this.listeners={};this.attributes={};this.value='';this.files=[];this.disabled=false;}
    addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
    dispatch(type){for(const fn of this.listeners[type]??[])fn({target:this});for(const fn of docListeners[type]??[])fn({target:this});}
    append(...children){this.children.push(...children);}
    replaceChildren(...children){this.children=[...children];}
    setAttribute(name,value){this.attributes[name]=value;}
    querySelectorAll(tag){const result=[];for(const child of this.children){if(child.tag===tag)result.push(child);result.push(...child.querySelectorAll(tag));}return result;}
    remove(){}
  }
  const document={
    getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},
    addEventListener(type,fn){(docListeners[type]??=[]).push(fn);},
    createElement(tag){const el=new Element(tag);if(tag==='canvas'){
      el.getContext=()=>({fillRect(){},fillText(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}});
      el.toBlob=callback=>pendingBlobs.push(callback);
    }return el;}
  };
  document.getElementById('claim-kind').value='value';
  document.getElementById('check-btn').disabled=true;
  const URL={createObjectURL(file){const url=`blob:test-${++nextUrl}`;urls.set(url,file);return url;},revokeObjectURL(){}};
  class Image {constructor(){this.naturalWidth=100;this.naturalHeight=100;}decode(){const name=urls.get(this.src).name;const job=deferred();imageJobs.set(name,job);return job.promise;}}
  class File {constructor(parts,name,opts){this.name=name;this.type=opts.type;this.size=10;}}
  const window={addEventListener(){},open(){return null;},...(sdkFixture?{LanguageModel:{}}:{})};
  const context={document,window,Image,File,URL,queueMicrotask,Promise,
    fakeImport:()=>sdkFixture?Promise.resolve(sdkFixture):Promise.reject(new Error('SDK not needed')),
    runtime:{reviewOrigin:'http://127.0.0.1:43127',cloudOrigin:'http://127.0.0.1:43123'},
    evaluateClaim,parseCsv(){},compareSources(){},parseSuggestions(){},parseClaimDraft,assertClaimEvidenceInStatement,console};
  vm.runInNewContext(source,context,{filename:'app.mjs'});
  await flush(); // settle deliberately unavailable remote SDK imports
  return {elements,pendingBlobs,imageJobs,urls,File,window};
}

test('reopening the cloud reader preserves its existing window',async()=>{
  const h=await harness(),button=h.elements.get('open-cloud-chart');let opens=0,focuses=0;
  const popup={closed:false,focus(){focuses++;}};h.window.open=()=>{opens++;return popup;};
  button.dispatch('click');button.dispatch('click');assert.equal(opens,1);assert.equal(focuses,1);
  assert.match(h.elements.get('open-cloud-chart-status').textContent,/already open/);
  popup.closed=true;button.dispatch('click');assert.equal(opens,2);
});

test('a chosen image supersedes a sample still being generated',async()=>{
  const h=await harness(), get=id=>h.elements.get(id), file=new h.File([],'chosen.png',{type:'image/png'});
  get('sample-btn').dispatch('click');
  get('chart-file').files=[file];get('chart-file').dispatch('change');await flush();
  h.imageJobs.get('chosen.png').resolve();await flush();
  h.pendingBlobs.shift()({});await flush();
  assert.equal(h.urls.get(get('chart-preview').src),file);
  assert.equal(get('claim-text').value,'');
  assert.equal(get('sample-btn').disabled,false);
});

test('a chosen image supersedes a sample already decoding, even if the sample finishes last',async()=>{
  const h=await harness(), get=id=>h.elements.get(id), file=new h.File([],'chosen.png',{type:'image/png'});
  get('sample-btn').dispatch('click');h.pendingBlobs.shift()({});await flush();
  get('chart-file').files=[file];get('chart-file').dispatch('change');await flush();
  h.imageJobs.get('chosen.png').resolve();await flush();
  h.imageJobs.get('synthetic-sample.png').resolve();await flush();
  assert.equal(h.urls.get(get('chart-preview').src),file);
  assert.equal(get('claim-text').value,'');
  assert.equal(get('sample-btn').disabled,false);
});

test('a sample still loads when no later selection or edit interrupts it',async()=>{
  const h=await harness(),get=id=>h.elements.get(id);
  get('sample-btn').dispatch('click');h.pendingBlobs.shift()({});await flush();
  h.imageJobs.get('synthetic-sample.png').resolve();await flush();
  assert.equal(h.urls.get(get('chart-preview').src).name,'synthetic-sample.png');
  assert.equal(get('claim-text').value,'Box A weighs 8 grams.');
  assert.equal(get('sample-btn').disabled,false);
});

test('blank observations cannot be confirmed but partial entries remain uncertain',async()=>{
  const h=await harness(),get=id=>h.elements.get(id);
  const inputs=get('observations').querySelectorAll('input');
  inputs[0].value='  ';inputs[1].value=' ';inputs[2].value='';
  get('confirm-btn').dispatch('click');
  assert.equal(get('check-btn').disabled,true);
  assert.match(get('confirm-status').textContent,/Enter an observation before confirming/);

  inputs[0].value='Box A';inputs[0].dispatch('input');
  get('confirm-btn').dispatch('click');
  assert.equal(get('check-btn').disabled,false);
  const fields=get('claim-fields').querySelectorAll('input');
  fields[0].value='Box A';fields[1].value='8';fields[2].value='g';
  get('check-btn').dispatch('click');
  assert.equal(get('result').children[0].textContent,'UNCERTAIN');
});

test('observation controls identify their current row after removal',async()=>{
  const h=await harness(),get=id=>h.elements.get(id);
  get('add-row').dispatch('click');
  const [first,second]=get('observations').children;
  assert.equal(second.children[1].children[0].attributes['aria-label'],'Observation value, row 2');
  first.children[3].children[0].dispatch('click');
  assert.equal(second.children[1].children[0].attributes['aria-label'],'Observation value, row 1');
  assert.equal(second.children[3].children[0].attributes['aria-label'],'Remove observation, row 1');
});

function mockSdk(response){return {getApps:()=>[],initializeApp:()=>({}),getAI:()=>({}),GoogleAIBackend:class{},InferenceMode:{ONLY_ON_DEVICE:'device'},InferenceSource:{ON_DEVICE:'on_device'},getGenerativeModel:()=>({initializeDeviceModel:async()=>{},generateContent:()=>response.promise})};}
function aiResult(){return {response:{text:()=>'{"kind":"value","label":"Box A","value":8,"unit":"g"}',inferenceSource:'on_device'}};}
test('a device claim draft fills editable fields without checking automatically',async()=>{
  const response=deferred(),h=await harness(mockSdk(response)),get=id=>h.elements.get(id);
  get('claim-text').value='Box A weighs 8 grams';get('claim-text').dispatch('input');
  get('claim-suggest-btn').dispatch('click');await flush();response.resolve(aiResult());await flush();
  assert.equal(get('claim-kind').value,'value');
  assert.deepEqual(get('claim-fields').querySelectorAll('input').map(el=>el.value),['Box A','8','g']);
  assert.match(get('claim-suggest-status').textContent,/Verify and edit/);
  assert.equal(get('check-btn').disabled,true);
  get('claim-text').value='Box A weighs 9 grams';get('claim-text').dispatch('input');
  assert.deepEqual(get('claim-fields').querySelectorAll('input').map(el=>el.value),['Box A','8','g']);
  assert.match(get('claim-suggest-status').textContent,/Statement changed since the draft/);
});
test('a claim draft arriving after a user edit preserves the edited fields',async()=>{
  const response=deferred(),h=await harness(mockSdk(response)),get=id=>h.elements.get(id);
  get('claim-text').value='Box A weighs 8 grams';get('claim-text').dispatch('input');
  get('claim-suggest-btn').dispatch('click');await flush();
  const first=get('claim-fields').querySelectorAll('input')[0];first.value='my edit';first.dispatch('input');
  response.resolve(aiResult());await flush();
  assert.equal(get('claim-fields').querySelectorAll('input')[0].value,'my edit');
  assert.match(get('claim-suggest-status').textContent,/review changed/);
  assert.match(get('claim-model-response').textContent,/Box A/);
});
test('a non-device response never replaces manually entered claim fields',async()=>{
  const response=deferred(),h=await harness(mockSdk(response)),get=id=>h.elements.get(id);
  get('claim-text').value='Box A weighs 8 grams';get('claim-text').dispatch('input');
  const first=get('claim-fields').querySelectorAll('input')[0];first.value='manual';
  get('claim-suggest-btn').dispatch('click');await flush();
  const reply=aiResult();reply.response.inferenceSource='in_cloud';response.resolve(reply);await flush();
  assert.equal(get('claim-fields').querySelectorAll('input')[0].value,'manual');
  assert.match(get('claim-suggest-status').textContent,/did not report an on-device result/);
});
test('a fabricated entity name never replaces manually entered claim fields',async()=>{
  const response=deferred(),h=await harness(mockSdk(response)),get=id=>h.elements.get(id);
  get('claim-text').value='Box A weighs 8 grams';get('claim-text').dispatch('input');
  const first=get('claim-fields').querySelectorAll('input')[0];first.value='manual';
  get('claim-suggest-btn').dispatch('click');await flush();
  response.resolve({response:{text:()=>'{"kind":"value","label":"Weight","value":8,"unit":"g"}',inferenceSource:'on_device'}});await flush();
  assert.equal(get('claim-fields').querySelectorAll('input')[0].value,'manual');
  assert.match(get('claim-suggest-status').textContent,/label not found in the statement/);
  assert.equal(get('check-btn').disabled,true);
});
test('loading a sample clears the old draft indication when fields are replaced',async()=>{
  const response=deferred(),h=await harness(mockSdk(response)),get=id=>h.elements.get(id);
  get('claim-text').value='Box A weighs 8 grams';get('claim-text').dispatch('input');
  get('claim-suggest-btn').dispatch('click');await flush();response.resolve(aiResult());await flush();
  get('sample-btn').dispatch('click');h.pendingBlobs.shift()({});await flush();
  h.imageJobs.get('synthetic-sample.png').resolve();await flush();
  assert.match(get('claim-suggest-status').textContent,/previous draft was cleared/);
  assert.deepEqual(get('claim-fields').querySelectorAll('input').map(el=>el.value),['','','']);
});
