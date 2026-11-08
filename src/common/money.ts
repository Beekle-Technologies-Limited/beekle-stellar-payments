import Decimal from 'decimal.js';

/**
 * Stellar amounts are fixed-point with at most 7 decimal places (stroops).
 * Values stay as decimal strings. They are never converted through JS numbers.
 */
const STROOP_SCALE = 7;
const STROOPS_PER_UNIT = 10_000_000n;
const MAX_STROOPS = 9223372036854775807n;

Decimal.set({ precision: 40, rounding: Decimal.ROUND_DOWN });

export class AmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AmountError';
  }
}

export function parseStellarAmount(
  input: string,
  options?: { allowZero?: boolean },
): Decimal {
  if (typeof input !== 'string') {
    throw new AmountError('amount must be a decimal string');
  }
  const trimmed = input.trim();
  if (trimmed !== input) {
    throw new AmountError('amount must not contain surrounding space');
  }
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(trimmed)) {
    throw new AmountError(
      'amount must be a base-10 decimal string without exponents or signs',
    );
  }
  const fraction = trimmed.split('.')[1] ?? '';
  if (fraction.length > STROOP_SCALE) {
    throw new AmountError(
      `amount supports at most ${STROOP_SCALE} decimal places`,
    );
  }
  const parsed = new Decimal(trimmed);
  if (parsed.isNeg()) {
    throw new AmountError('amount must be positive');
  }
  if (!options?.allowZero && parsed.isZero()) {
    throw new AmountError('amount must be greater than zero');
  }
  const stroops = toStroops(parsed);
  if (stroops > MAX_STROOPS) {
    throw new AmountError('amount exceeds the Stellar int64 stroop maximum');
  }
  return parsed;
}

function toStroops(value: Decimal): bigint {
  const scaled = value.mul(STROOPS_PER_UNIT.toString());
  if (!scaled.isInteger()) {
    throw new AmountError('amount is not an integer number of stroops');
  }
  return BigInt(scaled.toFixed(0));
}

export function stroops(input: string): bigint {
  return toStroops(parseStellarAmount(input, { allowZero: true }));
}

export function formatStellarAmount(value: Decimal | string): string {
  const parsed =
    typeof value === 'string'
      ? parseStellarAmount(value, { allowZero: true })
      : value;
  return parsed.toFixed(STROOP_SCALE);
}

/** SEP-7 display form: strip trailing zeros without using binary floats. */
export function formatUriAmount(canonical: string): string {
  const normalized = formatStellarAmount(canonical);
  const [whole, fraction] = normalized.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return trimmed.length > 0 ? `${whole}.${trimmed}` : whole;
}

export function addAmounts(left: string, right: string): string {
  const sum = parseStellarAmount(left, { allowZero: true }).plus(
    parseStellarAmount(right, { allowZero: true }),
  );
  if (toStroops(sum) > MAX_STROOPS) {
    throw new AmountError('sum exceeds the Stellar int64 stroop maximum');
  }
  return formatStellarAmount(sum);
}

export function compareAmounts(left: string, right: string): -1 | 0 | 1 {
  const delta = stroops(left) - stroops(right);
  if (delta === 0n) return 0;
  return delta > 0n ? 1 : -1;
}

export function amountsEqual(left: string, right: string): boolean {
  return compareAmounts(left, right) === 0;
}

export function subtractAmounts(left: string, right: string): string {
  const result = stroops(left) - stroops(right);
  if (result < 0n) {
    throw new AmountError('subtraction would go negative');
  }
  const whole = result / STROOPS_PER_UNIT;
  const fraction = (result % STROOPS_PER_UNIT)
    .toString()
    .padStart(STROOP_SCALE, '0');
  return `${whole.toString()}.${fraction}`;
}
