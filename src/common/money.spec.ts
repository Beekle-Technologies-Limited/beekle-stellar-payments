import { addAmounts, formatUriAmount, parseStellarAmount } from './money';
import { AmountError } from './money';

describe('stellar amounts', () => {
  it('accepts a fixed-scale decimal and rejects binary-float syntax', () => {
    expect(parseStellarAmount('10.5000000').toFixed(7)).toBe('10.5000000');
    expect(parseStellarAmount('0.0000001').toFixed(7)).toBe('0.0000001');
    expect(parseStellarAmount('922337203685.4775807').toFixed(7)).toBe(
      '922337203685.4775807',
    );
    expect(() => parseStellarAmount('0.00000001')).toThrow(AmountError);
    expect(() => parseStellarAmount('1e-7')).toThrow(AmountError);
    expect(() => parseStellarAmount('0.3000000 ')).toThrow(AmountError);
    expect(() => parseStellarAmount('01.0')).toThrow(AmountError);
    expect(() => parseStellarAmount('-1')).toThrow(AmountError);
    expect(() => parseStellarAmount('0')).toThrow(AmountError);
    expect(() => parseStellarAmount('922337203685.4775808')).toThrow(
      AmountError,
    );
  });

  it('adds in stroops so 0.1 + 0.2 is exactly 0.3', () => {
    expect(addAmounts('0.1000000', '0.2000000')).toBe('0.3000000');
    expect(formatUriAmount('10.5000000')).toBe('10.5');
    expect(formatUriAmount('10.0000000')).toBe('10');
  });

  it('does not accept a JavaScript number at runtime', () => {
    expect(() => parseStellarAmount(0.1 as unknown as string)).toThrow(
      AmountError,
    );
  });
});
