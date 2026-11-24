// Validate original JSON, then quote its number tokens before parsing them for
// use. Direct JSON.parse would round large or precise numbers before review.
function parseLosslessNumbers(text) {
  JSON.parse(text); // Syntax validation only; discard the parsed values.
  let converted = '', inString = false, escaped = false;
  for (let i = 0; i < text.length;) {
    const c = text[i];
    if (inString) {
      converted += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      i++;
    } else if (c === '"') {
      inString = true; converted += c; i++;
    } else if (c === '-' || (c >= '0' && c <= '9')) {
      const match = text.slice(i).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
      if (!match) throw new Error('Invalid number');
      converted += JSON.stringify(match[0]);
      i += match[0].length;
    } else {
      converted += c; i++;
    }
  }
  return JSON.parse(converted);
}

export function parseSuggestions(text){
  let parsed;try{parsed=parseLosslessNumbers(text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));}catch{throw new Error('The suggestion was not valid JSON. Read the response and enter observations manually.');}
  if(!parsed || !Array.isArray(parsed.observations)||parsed.observations.length>30)throw new Error('The suggestion format was not usable. Enter observations manually.');
  let rejectedNumeric=false;const rows=[];
  for(const row of parsed.observations){if(row&&typeof row==='object'&&!Array.isArray(row)){if(row.value!=null&&typeof row.value!=='string')rejectedNumeric=true;rows.push({label:String(row.label??''),value:typeof row.value==='string'?row.value:'',unit:String(row.unit??'')});}}
  return {rows,rejectedNumeric};
}
