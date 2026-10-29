/** Pure, bigint-only planner matching MiniDEX.sol's non-initial deposit rule. */
export type DepositInputs = {
  reserveA: bigint;
  reserveB: bigint;
  totalShares: bigint;
  amountA: bigint;
  amountB: bigint;
  balanceA: bigint;
  balanceB: bigint;
  allowanceA: bigint;
  allowanceB: bigint;
};

export type DepositPlan = {
  amountA: bigint;
  amountB: bigint;
  expectedMintedShares: bigint;
  projectedReserveA: bigint;
  projectedReserveB: bigint;
  projectedTotalShares: bigint;
  needApproveA: boolean;
  needApproveB: boolean;
  maximumNewTransactions: number;
};

export function planNonInitialDeposit(input: DepositInputs): DepositPlan {
  const {
    reserveA, reserveB, totalShares, amountA, amountB,
    balanceA, balanceB, allowanceA, allowanceB,
  } = input;
  if (reserveA <= 0n || reserveB <= 0n || totalShares <= 0n) {
    throw new Error("Pool must have nonzero reserves and existing LP shares");
  }
  if (amountA <= 0n || amountB <= 0n) {
    throw new Error("Deposit amounts must both be positive");
  }
  if (amountA * reserveB !== amountB * reserveA) {
    throw new Error("Deposit ratio does not exactly match current reserves");
  }
  if (balanceA < amountA || balanceB < amountB) {
    throw new Error("Insufficient token balance");
  }
  const expectedMintedShares = (amountA * totalShares) / reserveA;
  if (expectedMintedShares <= 0n) {
    throw new Error("Deposit would mint zero shares");
  }
  const needApproveA = allowanceA < amountA;
  const needApproveB = allowanceB < amountB;
  return {
    amountA,
    amountB,
    expectedMintedShares,
    projectedReserveA: reserveA + amountA,
    projectedReserveB: reserveB + amountB,
    projectedTotalShares: totalShares + expectedMintedShares,
    needApproveA,
    needApproveB,
    maximumNewTransactions: Number(needApproveA) + Number(needApproveB) + 1,
  };
}
