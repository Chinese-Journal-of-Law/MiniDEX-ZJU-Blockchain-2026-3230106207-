import { describe, expect, it } from "vitest";
import { parseUnits } from "ethers";
import { planNonInitialDeposit } from "./depositMath";

const e = (value: string) => parseUnits(value, 18);
const original = () => ({
  reserveA: e("100"), reserveB: e("100"), totalShares: e("100"),
  amountA: e("10"), amountB: e("10"),
  balanceA: e("810"), balanceB: e("900"),
  allowanceA: 0n, allowanceB: 0n,
});

describe("non-initial 10+10 bigint plan", () => {
  it("projects 110/110 and 10 new shares without claiming an NFT exists", () => {
    const plan = planNonInitialDeposit(original());
    expect(plan.expectedMintedShares).toBe(e("10"));
    expect(plan.projectedReserveA).toBe(e("110"));
    expect(plan.projectedReserveB).toBe(e("110"));
    expect(plan.projectedTotalShares).toBe(e("110"));
    expect(plan.maximumNewTransactions).toBe(3);
    expect(plan.needApproveA).toBe(true);
    expect(plan.needApproveB).toBe(true);
  });
  it("does not request a redundant approval if allowances suffice", () => {
    const plan = planNonInitialDeposit({ ...original(), allowanceA: e("10"), allowanceB: e("11") });
    expect(plan.maximumNewTransactions).toBe(1);
    expect(plan.needApproveA).toBe(false);
    expect(plan.needApproveB).toBe(false);
  });
  it("rejects a changed pool ratio, even with a rounding-friendly price", () => {
    expect(() => planNonInitialDeposit({ ...original(), reserveB: e("101") }))
      .toThrow(/ratio/);
    expect(() => planNonInitialDeposit({ ...original(), amountB: e("11") }))
      .toThrow(/ratio/);
  });
  it("rejects empty pools and insufficient balances", () => {
    expect(() => planNonInitialDeposit({ ...original(), totalShares: 0n })).toThrow(/Pool/);
    expect(() => planNonInitialDeposit({ ...original(), balanceA: e("9") })).toThrow(/Insufficient/);
    expect(() => planNonInitialDeposit({ ...original(), balanceB: e("9") })).toThrow(/Insufficient/);
  });
  it("rejects deposits that would round shares down to zero", () => {
    expect(() => planNonInitialDeposit({
      reserveA: 10000n, reserveB: 10000n, totalShares: 1n,
      amountA: 1n, amountB: 1n,
      balanceA: 2n, balanceB: 2n,
      allowanceA: 0n, allowanceB: 0n,
    })).toThrow(/zero shares/);
  });
});
