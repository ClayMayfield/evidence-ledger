import {test} from 'node:test';import assert from 'node:assert/strict';import {parseSuggestions} from './suggestions.mjs';
test('preserves JSON numbers as their exact original text',()=>{
 const r=parseSuggestions('{"observations":[{"label":"A","value":9007199254740993,"unit":"g"},{"label":"B","value":9007199254740991.1,"unit":"g"},{"label":"C","value":-1.23000000000000001e+30,"unit":"g"},{"label":"D","value":"9007199254740993","unit":"g"}]}');
 assert.deepEqual(r.rows.map(row=>row.value),['9007199254740993','9007199254740991.1','-1.23000000000000001e+30','9007199254740993']);assert.equal(r.rejectedNumeric,false);
});
test('leaves unsupported values blank and keeps quoted text intact',()=>{
 const r=parseSuggestions('{"observations":[{"label":"Box \\\"1\\\"","value":true,"unit":"m2"},{"label":"B2","value":null,"unit":"kg"},{"label":"C","value":8,"unit":"kg"}]}');
 assert.equal(r.rows[0].label,'Box "1"');assert.equal(r.rows[0].value,'');assert.equal(r.rejectedNumeric,true);assert.equal(r.rows[1].value,'');assert.equal(r.rows[2].value,'8');
});
test('accepts fenced JSON and rejects invalid or oversized lists',()=>{assert.equal(parseSuggestions('```json\n{"observations":[]}\n```').rows.length,0);assert.throws(()=>parseSuggestions('not json'));assert.throws(()=>parseSuggestions('{"observations":[{"value":01}]}'));assert.throws(()=>parseSuggestions(JSON.stringify({observations:Array(31).fill({})})));});
