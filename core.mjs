import Decimal from './node_modules/decimal.js/decimal.mjs';
const Exact = Decimal.clone({precision:256, minE:-10000, maxE:10000});
// Deterministic checks for explicitly structured claims. This module does not
// infer a claim from prose or establish that the supplied observations are true.
const uncertain = evidence => ({ status: 'uncertain', evidence });
const verdict = (ok, evidence) => ({ status: ok ? 'consistent' : 'inconsistent', evidence });

// Treat only explicitly entered, finite decimal numbers as numbers. In
// particular, Number('') and Number(null) would incorrectly turn blanks into 0.
function number(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return null;
  if (text.length>128) return null;
  const [mantissa, exponent='0']=text.toLowerCase().split('e');
  if(mantissa.replace(/[^0-9]/g,'').length>100 || Math.abs(Number(exponent))>1000)return null;
  try{return new Exact(text);}catch{return null;}
}

function unit(value) {
  if (typeof value !== 'string') return null;
  const u = value.trim();
  if (!u || u.length>32 || /[\u0000-\u001f\u007f]/.test(u)) return null;
  if (u === 'unitless') return { name: '', dimension: 'unitless', scale: 1 };
  if (u === 'g') return { name: 'g', dimension: 'mass', scale: 1 };
  if (u === 'kg') return { name: 'kg', dimension: 'mass', scale: 1000 };
  // Other explicit units can be compared only when their spelling and case
  // match exactly; no conversion or semantic equivalence is inferred.
  return { name:u, dimension:`literal:${u}`, scale:1 };
}

const equal = (a, b) => a.eq(b);
const show = (n, u) => `${n.toString()}${u ? ` ${u}` : ' (unitless)'}`;
const labelOf = value => typeof value === 'string' ? value.trim() : '';

export function evaluateClaim(data, claim) {
  if (!Array.isArray(data) || !claim || typeof claim !== 'object' || Array.isArray(claim)) {
    return uncertain('Provide observations and a structured claim.');
  }
  const rows = new Map();
  for (const row of data) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return uncertain('An observation is invalid.');
    const label = labelOf(row.label);
    if (!label) return uncertain('An observation is missing a label.');
    if (rows.has(label)) return uncertain(`The label “${label}” occurs more than once; resolve the ambiguity.`);
    rows.set(label, row);
  }

  function read(label) {
    label = labelOf(label);
    if (!label || !rows.has(label)) return { error: `Observation “${label || '(blank)'}” is missing.` };
    const row = rows.get(label);
    const value = number(row.value);
    const parsedUnit = unit(row.unit);
    if (value === null) return { error: `Observation “${label}” has a missing or invalid number.` };
    if (!parsedUnit) return { error: `Observation “${label}” has a missing or unsupported unit.` };
    const base = value.mul(parsedUnit.scale);
    return { label, value, unit: parsedUnit, base };
  }

  if (claim.kind === 'value') {
    const row = read(claim.label);
    if (row.error) return uncertain(row.error);
    const value = number(claim.value), claimUnit = unit(claim.unit);
    if (value === null) return uncertain('The claimed value is missing or invalid.');
    if (!claimUnit) return uncertain('The claimed unit is missing or unsupported.');
    if (row.unit.dimension !== claimUnit.dimension) return uncertain('The observation and claim have incompatible units.');
    const expectedBase = value.mul(claimUnit.scale);
    return verdict(equal(row.base, expectedBase), `${row.label}: observation ${show(row.value, row.unit.name)}; claim ${show(value, claimUnit.name)}.`);
  }

  if (claim.kind === 'compare' || claim.kind === 'ratio') {
    const left = read(claim.left), right = read(claim.right);
    if (left.error || right.error) return uncertain(left.error || right.error);
    if (left.unit.dimension !== right.unit.dimension) return uncertain('The observations have incompatible units.');
    const description = `${left.label}: ${show(left.value, left.unit.name)}; ${right.label}: ${show(right.value, right.unit.name)}.`;
    if (claim.kind === 'compare') {
      if (!['>', '<', '='].includes(claim.operator)) return uncertain('The comparison operator is unsupported.');
      const same = equal(left.base, right.base);
      const ok = claim.operator === '=' ? same : claim.operator === '>' ? left.base.gt(right.base) : left.base.lt(right.base);
      return verdict(ok, `${description} Claimed relation: ${left.label} ${claim.operator} ${right.label}.`);
    }
    const factor = number(claim.factor);
    if (factor === null) return uncertain('The ratio factor is missing or invalid.');
    if (right.base.isZero()) return uncertain('The reference value is zero, so a ratio is undefined.');
    const expected=right.base.mul(factor);
    return verdict(equal(left.base, expected), `${description} Claimed relation: ${left.label} = ${factor.toString()} × ${right.label}.`);
  }

  if (claim.kind === 'trend') {
    if (!Array.isArray(claim.labels) || claim.labels.length < 2 || !['increasing', 'decreasing'].includes(claim.direction)) {
      return uncertain('A trend needs at least two ordered labels and a supported direction.');
    }
    const names = claim.labels.map(labelOf);
    if (names.some(name => !name) || new Set(names).size !== names.length) return uncertain('Trend labels must be present and unique.');
    const selected = names.map(read);
    const invalid = selected.find(row => row.error);
    if (invalid) return uncertain(invalid.error);
    if (selected.some(row => row.unit.dimension !== selected[0].unit.dimension)) return uncertain('Trend observations have incompatible units.');
    const checks = selected.slice(1).map((row, i) => {
      const previous = selected[i].base;
      return claim.direction === 'increasing' ? row.base.gt(previous) : row.base.lt(previous);
    });
    const description = selected.map(row => `${row.label}: ${show(row.value, row.unit.name)}`).join('; ');
    return verdict(checks.every(Boolean), `${description}. Claimed strictly ${claim.direction} in the given order.`);
  }
  return uncertain('The claim type is unsupported.');
}
