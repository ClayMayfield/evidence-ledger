import { evaluateClaim } from './core.mjs';

// String input is deliberate: this experimental screen only accepts synthetic data.
export function parseCsv(text, papa) {
  if (typeof text !== 'string' || text.length > 50000) return {error:'CSV text must be no longer than 50,000 characters.'};
  if (!papa || typeof papa.parse !== 'function') return {error:'CSV parser is unavailable.'};
  const parsed=papa.parse(text.replace(/^\uFEFF/,''),{header:false,delimiter:',',dynamicTyping:false,download:false,skipEmptyLines:'greedy'});
  if(parsed.errors.length)return {error:'Could not read the CSV; check quotes and commas.'};
  const [header,...rows]=parsed.data;
  if(!header||header.length!==3||header.map(v=>v.trim().toLowerCase()).join(',')!=='label,value,unit')return {error:'Use exactly these columns in this order: label,value,unit.'};
  if(!rows.length||rows.length>100)return {error:'Provide between 1 and 100 rows.'};
  const seen=new Set(),data=[];
  for(const row of rows){if(row.length!==3)return {error:'Every row must contain exactly three columns.'};const [label,value,unit]=row.map(v=>v.trim());if(!label)return {error:'Every row needs a label.'};if(seen.has(label))return {error:`Duplicate label: ${label}.`};seen.add(label);data.push({label,value,unit});}
  return {data};
}

// Comparison is between two supplied sources; neither is established as true.
export function compareSources(chart, table){
  if(!Array.isArray(chart)||!Array.isArray(table))return [];
  const chartMap=new Map(),tableMap=new Map(),duplicates=new Set(),missing=[];
  for(const [rows,map,source] of [[chart,chartMap,'Chart'],[table,tableMap,'Table']])for(const row of rows){const label=typeof row?.label==='string'?row.label.trim():'';if(!label){missing.push({label:`Unnamed ${source.toLowerCase()} row`,status:'uncertain',evidence:'This row has no label and cannot be matched.'});continue;}if(map.has(label))duplicates.add(label);map.set(label,row);}
  return [...[...new Set([...chartMap.keys(),...tableMap.keys()])].map(label=>{
    if(duplicates.has(label))return {label,status:'uncertain',evidence:'The label is duplicated in a source.'};
    const a=chartMap.get(label),b=tableMap.get(label);if(!a||!b)return {label,status:'uncertain',evidence:'This label is missing from one source.'};
    const r=evaluateClaim([{label:'Chart',value:a.value,unit:a.unit},{label:'Table',value:b.value,unit:b.unit}],{kind:'compare',left:'Chart',operator:'=',right:'Table'});
    return {label,...r};
  }),...missing];
}
