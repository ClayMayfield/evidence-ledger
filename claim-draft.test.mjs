import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseClaimDraft,assertClaimLabelsInStatement,assertClaimEvidenceInStatement} from './claim-draft.mjs';

test('extracts four supported claim types without changing long numeric tokens',()=>{
  assert.deepEqual(parseClaimDraft('```json\n{"kind":"value","label":" Box A ","value":9007199254740993.1234567890123456789,"unit":"kg"}\n```'),{kind:'value',label:'Box A',value:'9007199254740993.1234567890123456789',unit:'kg'});
  assert.deepEqual(parseClaimDraft('{"kind":"compare","left":"A","operator":">","right":"B"}'),{kind:'compare',left:'A',operator:'>',right:'B'});
  assert.deepEqual(parseClaimDraft('{"kind":"ratio","left":"A","factor":-1.25000000000000001e+3,"right":"B"}'),{kind:'ratio',left:'A',factor:'-1.25000000000000001e+3',right:'B'});
  assert.deepEqual(parseClaimDraft('{"kind":"trend","labels":["Monday","Tuesday"],"direction":"increasing"}'),{kind:'trend',labels:['Monday','Tuesday'],direction:'increasing'});
});

test('rejects unsupported, incomplete, ambiguous or malicious shapes',()=>{
  const inputs=[
    'null','[]','[{"kind":"value","label":"Weight","value":8,"unit":"g"}]','not json','{"kind":"__proto__"}',
    '{"kind":"value","label":"A","value":1,"unit":"g","verdict":"consistent"}',
    '{"kind":"value","label":"A","value":null,"unit":"g"}',
    '{"kind":"value","label":"A","value":true,"unit":"g"}',
    '{"kind":"value","label":"A","value":01,"unit":"g"}',
    '{"kind":"value","label":"A","value":"1e1001","unit":"g"}',
    '{"kind":"value","label":"A","value":"2","unit":""}',
    '{"kind":"compare","left":"A","operator":">=","right":"B"}',
    '{"kind":"ratio","left":"A","factor":"unknown","right":"B"}',
    '{"kind":"trend","labels":["A","A"],"direction":"increasing"}',
    '{"kind":"trend","labels":["A,B","C"],"direction":"increasing"}',
    '{"kind":"trend","labels":["A","B"],"direction":"flat"}',
    '{"kind":"value","label":42,"value":1,"unit":"g"}'
  ];
  for(const input of inputs) assert.throws(()=>parseClaimDraft(input),undefined,input);
});

test('accepts zero and finite supported range while bounding inputs',()=>{
  assert.equal(parseClaimDraft('{"kind":"value","label":"A","value":-0,"unit":"unitless"}').value,'-0');
  assert.equal(parseClaimDraft('{"kind":"ratio","left":"A","factor":".5e-1000","right":"B"}').factor,'.5e-1000');
  assert.throws(()=>parseClaimDraft(' '.repeat(16001)));
  assert.throws(()=>parseClaimDraft(JSON.stringify({kind:'trend',labels:Array.from({length:31},(_,i)=>String(i)),direction:'decreasing'})));
});

test('requires each draft label to appear in the source statement',()=>{
  const value=parseClaimDraft('{"kind":"value","label":"Box A","value":8,"unit":"g"}');
  assert.doesNotThrow(()=>assertClaimLabelsInStatement(value,'BOX  \n A weighs 8 grams.'));
  assert.throws(()=>assertClaimLabelsInStatement({...value,label:'Weight'},'Box A weighs 8 grams.'));
  for(const kind of ['compare','ratio']) {
    const draft=kind==='compare'?{kind,left:'Alpha',operator:'>',right:'Beta'}:{kind,left:'Alpha',factor:'2',right:'Beta'};
    assert.doesNotThrow(()=>assertClaimLabelsInStatement(draft,'Alpha is larger than Beta.'));
    assert.throws(()=>assertClaimLabelsInStatement(draft,'Alpha is larger than Gamma.'));
  }
  const trend={kind:'trend',labels:['Monday','Tuesday','Wednesday'],direction:'increasing'};
  assert.doesNotThrow(()=>assertClaimLabelsInStatement(trend,'Monday, Tuesday, and Wednesday increased.'));
  assert.throws(()=>assertClaimLabelsInStatement(trend,'Monday and Wednesday increased.'));
});

test('requires an adjacent equivalent numeric token and matching unit',()=>{
  const draft={kind:'value',label:'Box A',value:'8',unit:'g'};
  for(const text of ['Box A weighs 8 grams.','box a weighs 8.0 GRAM','Box A weighs 8e0 g.','Box A weighs 0.8e1 g.'])
    assert.doesNotThrow(()=>assertClaimEvidenceInStatement(draft,text),text);
  for(const text of ['Box A weighs 80 grams.','Box A weighs -8 grams.','Box A weighs 8 kilograms.','Box A weighs 8 mg.','Box A weighs 1,008 grams.','Box A weighs 3–8 grams.'])
    assert.throws(()=>assertClaimEvidenceInStatement(draft,text),undefined,text);
  for(const text of ['Box A weighs −8 grams.','Box A weighs − 8 grams.','Box A weighs - 8 grams.','Box A has 8 g/L.','Box A has 8 g / L.','Box A has 8 grams per day.','Box A has 8 g·m.','Box A has 8 g m^-3.','Box A has 8 g−1.','Box A weighs < 8 g.','Box A weighs > 8 g.','Box A weighs under 8 g.','Box A weighs ≠ 8 g.','Box A weighs 8 ± 2 g.','Box A weighs 8 to 12 g.'])
    assert.throws(()=>assertClaimEvidenceInStatement(draft,text),undefined,text);
  assert.throws(()=>assertClaimEvidenceInStatement({...draft,unit:'kg'},'Box A has 8 kg/m3.'));
  assert.throws(()=>assertClaimEvidenceInStatement({...draft,value:'2'},'Box A weighs 8 ± 2 g.'));
  assert.throws(()=>assertClaimEvidenceInStatement({...draft,value:'12'},'Box A weighs 8 to 12 g.'));
  assert.throws(()=>assertClaimEvidenceInStatement({...draft,value:'80',unit:'kg'},'Box A weighs 8 grams.'));
  assert.throws(()=>assertClaimEvidenceInStatement({...draft,value:'8',unit:'kg'},'Box A weighs 8 grams and Box B weighs 80 kg.'));
  assert.throws(()=>assertClaimEvidenceInStatement({...draft,label:'Box 8'},'Box 8 weighs 20 grams.'));
  assert.doesNotThrow(()=>assertClaimEvidenceInStatement({...draft,value:'12',unit:'kg'},'Box A weighs 12 kilograms.'));
  assert.doesNotThrow(()=>assertClaimEvidenceInStatement({...draft,value:'5',unit:'USD'},'Box A costs 5 USD.'));
  assert.throws(()=>assertClaimEvidenceInStatement(draft,'Box A weighs 8 G.'));
  assert.throws(()=>assertClaimEvidenceInStatement({...draft,value:'5',unit:'USD'},'Box A costs 5 usd.'));
  assert.throws(()=>assertClaimEvidenceInStatement({...draft,value:'5',unit:'USD'},'Box A costs 5 XUSD.'));
});

test('rejects qualifiers and requires explicit numeric ratio outside labels',()=>{
  const value={kind:'value',label:'Box A',value:'8',unit:'g'};
  for(const text of ['Box A does not weigh 8 grams.','Box A isn’t 8 grams.','Box A weighs about 8 grams.','Box A is at least 8 grams.','Box A weighs less than 8 grams.'])
    assert.throws(()=>assertClaimEvidenceInStatement(value,text),undefined,text);
  const ratio={kind:'ratio',left:'Box 2',factor:'2',right:'Box 3'};
  assert.doesNotThrow(()=>assertClaimEvidenceInStatement(ratio,'Box 2 is 2 times Box 3.'));
  assert.throws(()=>assertClaimEvidenceInStatement(ratio,'Box 2 is larger than Box 3.'));
  assert.throws(()=>assertClaimEvidenceInStatement(ratio,'Box 2 is 20 times Box 3.'));
  assert.throws(()=>assertClaimEvidenceInStatement(ratio,'Box 2 is more than 2 times Box 3.'));
  assert.throws(()=>assertClaimEvidenceInStatement({kind:'compare',left:'A',right:'B',operator:'>'},'A is not larger than B.'));
  assert.doesNotThrow(()=>assertClaimEvidenceInStatement({kind:'compare',left:'A',right:'B',operator:'<'},'A < B.'));
});
