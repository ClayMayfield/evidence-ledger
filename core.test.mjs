import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateClaim } from './core.mjs';

const rows = [{label:'Box A',value:'8',unit:'kg'},{label:'Box B',value:'12000',unit:'g'}];
test('compares values with mass conversion and exposes the mismatch', () => {
  assert.equal(evaluateClaim(rows,{kind:'value',label:'Box A',value:'8',unit:'g'}).status,'inconsistent');
  assert.equal(evaluateClaim(rows,{kind:'value',label:'Box A',value:'8000',unit:'g'}).status,'consistent');
  assert.equal(evaluateClaim(rows,{kind:'compare',left:'Box A',right:'Box B',operator:'<'}).status,'consistent');
});
test('never turns blanks or ambiguous data into a conclusion', () => {
  const claim={kind:'value',label:'A',value:'0',unit:'unitless'};
  assert.equal(evaluateClaim([{label:'A',value:'',unit:'unitless'}],claim).status,'uncertain');
  assert.equal(evaluateClaim([{label:'A',value:'0',unit:'unitless'},{label:'A',value:'1',unit:'unitless'}],claim).status,'uncertain');
  assert.equal(evaluateClaim([{label:'A',value:'0',unit:'lb'}],claim).status,'uncertain');
  assert.equal(evaluateClaim([],claim).status,'uncertain');
  assert.equal(evaluateClaim([{label:'A',value:'0',unit:''}],claim).status,'uncertain');
  assert.equal(evaluateClaim([{label:'A',value:'0',unit:'unitless'}],claim).status,'consistent');
});
test('checks ratio with zero reference and signed values', () => {
  const data=[{label:'A',value:'-2',unit:'unitless'},{label:'B',value:'-1',unit:'unitless'},{label:'Z',value:'0',unit:'unitless'}];
  assert.equal(evaluateClaim(data,{kind:'ratio',left:'A',right:'B',factor:'2'}).status,'consistent');
  assert.equal(evaluateClaim(data,{kind:'ratio',left:'A',right:'Z',factor:'2'}).status,'uncertain');
});
test('checks an ordered strict trend and missing points', () => {
  const data=[{label:'Mon',value:'10',unit:'unitless'},{label:'Tue',value:'30',unit:'unitless'},{label:'Wed',value:'20',unit:'unitless'}];
  assert.equal(evaluateClaim(data,{kind:'trend',labels:['Mon','Tue','Wed'],direction:'increasing'}).status,'inconsistent');
  assert.equal(evaluateClaim(data,{kind:'trend',labels:['Mon','Tue','Thu'],direction:'increasing'}).status,'uncertain');
  assert.equal(evaluateClaim(data,{kind:'trend',labels:['Tue','Wed'],direction:'decreasing'}).status,'consistent');
});
test('compares decimals exactly without tolerance or floating-point underflow',()=>{
  const value=(a,b)=>evaluateClaim([{label:'A',value:a,unit:'g'}],{kind:'value',label:'A',value:b,unit:'g'}).status;
  assert.equal(value('0','1e-400'),'inconsistent');
  assert.equal(value('1000000000','1000000000.5'),'inconsistent');
  assert.equal(value('1e-400','1e-400'),'consistent');
  assert.equal(value('1e-1001','0'),'uncertain');
  assert.equal(evaluateClaim([{label:'A',value:'1000000000.5',unit:'g'},{label:'B',value:'1000000000',unit:'g'}],{kind:'compare',left:'A',right:'B',operator:'>'}).status,'consistent');
  assert.equal(evaluateClaim([{label:'A',value:9007199254740993,unit:'g'}],{kind:'value',label:'A',value:'9007199254740993',unit:'g'}).status,'uncertain');
});
test('compares explicitly matching units without assuming unit conversion',()=>{
  const data=[{label:'A',value:'10',unit:'visitors'},{label:'B',value:'12',unit:'visitors'},{label:'C',value:'10',unit:'Visitors'}];
  assert.equal(evaluateClaim(data,{kind:'compare',left:'A',right:'B',operator:'<'}).status,'consistent');
  assert.equal(evaluateClaim(data,{kind:'compare',left:'A',right:'C',operator:'='}).status,'uncertain');
  assert.equal(evaluateClaim([{label:'A',value:'1',unit:'USD'}],{kind:'value',label:'A',value:'1',unit:'EUR'}).status,'uncertain');
});
