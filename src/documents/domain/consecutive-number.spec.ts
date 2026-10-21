import { formatConsecutive } from './consecutive-number';

describe('formatConsecutive', () => {
  it('pads branch, terminal and sequence to 20 digits', () => {
    expect(
      formatConsecutive({
        branchCode: '1',
        terminalCode: '1',
        documentType: '01',
        number: 42n,
      }),
    ).toBe('00100001010000000042');
  });

  it('rejects numbers outside 1..9999999999', () => {
    const base = {
      branchCode: '001',
      terminalCode: '00001',
      documentType: '04',
    };
    expect(() => formatConsecutive({ ...base, number: 0n })).toThrow();
    expect(() =>
      formatConsecutive({ ...base, number: 10_000_000_000n }),
    ).toThrow();
    expect(formatConsecutive({ ...base, number: 9_999_999_999n })).toBe(
      '00100001049999999999',
    );
  });
});
