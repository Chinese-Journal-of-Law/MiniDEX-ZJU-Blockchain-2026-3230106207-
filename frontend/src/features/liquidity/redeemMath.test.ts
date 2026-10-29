import { describe, expect, it } from "vitest";
import { assertRedeemWritePermission, quoteRedeem, REDEEM_WRITE_ENABLED } from "./redeemMath";
describe("NFT #6 redemption locked by default", () => {
  it("computes 10+10 for 10/110 shares", () => {
    const e18 = 10n ** 18n;
    const q = quoteRedeem(10n*e18, 110n*e18, 110n*e18, 110n*e18);
    expect(q.amountA).toBe(10n*e18);
    expect(q.amountB).toBe(10n*e18);
    expect(q.minA).toBe(99n*e18/10n);
    expect(q.minB).toBe(99n*e18/10n);
  });
  it("rejects invalid shares", () => {
    expect(() => quoteRedeem(111n, 110n, 110n, 110n)).toThrow();
    expect(() => quoteRedeem(0n, 110n, 110n, 110n)).toThrow();
  });
  it("protects NFT #4/#5 and blocks NFT #6", () => {
    expect(REDEEM_WRITE_ENABLED).toBe(false);
    for (const id of [4n,5n,6n,7n]) expect(() => assertRedeemWritePermission(id)).toThrow();
  });
});
