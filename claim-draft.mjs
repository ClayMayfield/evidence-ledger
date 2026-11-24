// Read a model-generated *draft*, never a verdict. Keep numeric JSON tokens as
// text before parsing so long decimal values cannot be silently rounded.
function parseNumbersAsText(text) {
  const original = JSON.parse(text);
  let out = '', inString = false, escaped = false;
  for (let i = 0; i < text.length;) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      i++;
    } else if (ch === '"') { inString = true; out += ch; i++; }
    else if (ch === '-' || (ch >= '0' && ch <= '9')) {
      const match = text.slice(i).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
      if (!match) throw new Error('Invalid JSON number');
      out += JSON.stringify(match[0]); i += match[0].length;
    } else { out += ch; i++; }
  }
  return {original, textValues: JSON.parse(out)};
}

const FIELDS = {
  value: ['kind', 'label', 'value', 'unit'],
  compare: ['kind', 'left', 'operator', 'right'],
  ratio: ['kind', 'left', 'factor', 'right'],
  trend: ['kind', 'labels', 'direction']
};
const invalid = () => new Error('The claim draft was not usable. Review the response and enter the claim manually.');
function plainText(value, maxLength, {allowComma = true} = {}) {
  if (typeof value !== 'string') throw invalid();
  const s = value.trim();
  if (!s || s.length > maxLength || /[\u0000-\u001f\u007f]/.test(s) || (!allowComma && s.includes(','))) throw invalid();
  return s;
}
function decimal(value, original) {
  if (typeof original !== 'string' && typeof original !== 'number') throw invalid();
  const s = plainText(value, 128);
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(s)) throw invalid();
  const [mantissa, exponent='0'] = s.toLowerCase().split('e');
  if (mantissa.replace(/[^0-9]/g, '').length > 100 || Math.abs(Number(exponent)) > 1000) throw invalid();
  return s;
}

// This is a conservative spelling check, not a semantic validation: a matching
// substring may still be the wrong entity or relationship. People must review.
export function assertClaimLabelsInStatement(draft, statement) {
  if (typeof statement !== 'string' || !draft || typeof draft !== 'object') throw invalid();
  const labels = draft.kind === 'value' ? [draft.label]
    : draft.kind === 'compare' || draft.kind === 'ratio' ? [draft.left, draft.right]
    : draft.kind === 'trend' && Array.isArray(draft.labels) ? draft.labels : [];
  const normalize = s => s.trim().replace(/\s+/gu, ' ').toLowerCase();
  const normalizedStatement = normalize(statement);
  if (!labels.length || labels.some(label => typeof label !== 'string' || !normalize(label) || !normalizedStatement.includes(normalize(label)))) {
    throw new Error('The draft contains a label not found in the statement. Enter the claim manually.');
  }
}

// Conservative token checks only: a number and unit occurring together may
// still refer to a different entity. This does not validate sentence meaning.
function canonicalNumber(value) {
  const match = String(value).match(/^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:e([+-]?\d+))?$/i);
  if (!match) return null;
  const fraction = match[3] ?? match[4] ?? '', integer = match[2] ?? '0';
  const exponent = Number(match[5] ?? 0);
  if (!Number.isFinite(exponent) || Math.abs(exponent) > 1000 || integer.length + fraction.length > 100) return null;
  let digits = (integer + fraction).replace(/^0+/, '');
  if (!digits) return '0';
  const trailing = digits.match(/0*$/)[0].length;
  if (trailing) digits = digits.slice(0, -trailing);
  return `${match[1] === '-' ? '-' : ''}${digits}e${exponent - fraction.length + trailing}`;
}
const numericToken = /(?<![\p{L}\p{N}_.,+\-−])([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(?![\p{L}\p{N}_.,])/giu;
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const unitVariants = unit => {
  // Unit symbols can be case-sensitive. Only spelled-out English aliases are
  // case-insensitive; do not turn e.g. G into the mass symbol g.
  if (unit === 'g') return [['grams', true], ['gram', true], ['g', false]];
  if (unit === 'kg') return [['kilograms', true], ['kilogram', true], ['kg', false]];
  return [[unit, false]];
};

export function assertClaimEvidenceInStatement(draft, statement) {
  assertClaimLabelsInStatement(draft, statement);
  const normalized = statement.trim().replace(/\s+/gu, ' ');
  // Unsupported qualifiers can change the truth conditions. Do not guess.
  if (/(?:\b(?:not|no|never|neither|nor|without|approximately|approx|about|around|roughly|nearly|almost|estimated|estimate|at\s+least|at\s+most|between|up\s+to)\b|\b\w+n['’]t\b|[~≈≤≥≠±]|\d\s*[-–—]\s*\d|[-−]\s+\d|\d\s+(?:to|through)\s+[+-]?\d)/iu.test(normalized) ||
      ((draft.kind === 'value' || draft.kind === 'ratio') && /(?:[<>]|\b(?:under|over|above|below)\b|\b(?:less|more|greater|higher|lower)\s+than\b)/iu.test(normalized))) {
    throw new Error('The statement contains a qualifier that needs manual review. Enter the claim manually.');
  }
  if (draft.kind !== 'value' && draft.kind !== 'ratio') return;
  if (/\d,\d/u.test(normalized)) throw new Error('The numeric format needs manual review. Enter the claim manually.');
  const labels = draft.kind === 'value' ? [draft.label] : [draft.left, draft.right];
  let remaining = normalized;
  for (const label of labels) {
    const literal = escapeRegExp(label.trim().replace(/\s+/gu, ' '));
    remaining = remaining.replace(new RegExp(`(?<![\\p{L}\\p{N}_])${literal}(?![\\p{L}\\p{N}_])`, 'giu'), match => ' '.repeat(match.length));
  }
  const target = canonicalNumber(draft.kind === 'value' ? draft.value : draft.factor);
  const matches = [...remaining.matchAll(numericToken)];
  const evidence = matches.some(match => {
    if (canonicalNumber(match[1]) !== target || target === null) return false;
    const suffix = remaining.slice(match.index + match[0].length);
    if (draft.kind === 'ratio') return /^\s*(?:times|x|×)(?![\p{L}\p{N}_])/iu.test(suffix);
    return unitVariants(draft.unit).some(([unit, ignoreCase]) => {
      const match = new RegExp(`^\\s*${escapeRegExp(unit)}(?![\\p{L}\\p{N}_])`, ignoreCase ? 'iu' : 'u').exec(suffix);
      if (!match) return false;
      // A numerator alone is not the complete unit in e.g. g/L or kg per day.
      const rest = suffix.slice(match[0].length);
      return !/^\s*(?:[/⁄∕·⋅*^%]|(?:per)\b|[-−–—]\s*(?:per\b|[\p{L}\p{N}]))/iu.test(rest) &&
        !/^\s+[\p{L}µμΩ]{1,12}\s*(?:\^|[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]|[-−]\d)/u.test(rest);
    });
  });
  if (!evidence) throw new Error('The number or unit could not be matched to the statement. Enter the claim manually.');
}

// Returns the same field names as the form. Trend labels remain an array;
// the UI can join them with commas (embedded commas are disallowed here).
export function parseClaimDraft(text) {
  if (typeof text !== 'string' || text.length > 16000) throw invalid();
  let values, original;
  try {
    ({original, textValues: values} = parseNumbersAsText(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')));
  } catch { throw invalid(); }
  if (!original || typeof original !== 'object' || Array.isArray(original) || typeof original.kind !== 'string' || !Object.hasOwn(FIELDS, original.kind)) throw invalid();
  const fields = FIELDS[original.kind];
  if (Object.keys(original).length !== fields.length || fields.some(key => !Object.hasOwn(original, key))) throw invalid();
  const label = v => plainText(v, 120, {allowComma: false});
  switch (original.kind) {
    case 'value': return {kind:'value', label:label(original.label), value:decimal(values.value, original.value), unit:plainText(original.unit, 32)};
    case 'compare': {
      if (!['>', '<', '='].includes(original.operator)) throw invalid();
      return {kind:'compare', left:label(original.left), operator:original.operator, right:label(original.right)};
    }
    case 'ratio': return {kind:'ratio', left:label(original.left), factor:decimal(values.factor, original.factor), right:label(original.right)};
    case 'trend': {
      if (!Array.isArray(original.labels) || original.labels.length < 2 || original.labels.length > 30 || !['increasing', 'decreasing'].includes(original.direction)) throw invalid();
      const labels = original.labels.map(label);
      if (new Set(labels).size !== labels.length) throw invalid();
      return {kind:'trend', labels, direction:original.direction};
    }
  }
}
