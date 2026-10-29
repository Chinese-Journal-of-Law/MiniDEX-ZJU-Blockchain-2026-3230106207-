/** Pure arithmetic; no RPC and no transaction execution. */
export const BPS = 10_000n;
export const SLIPPAGE_BPS = 100n;
export const REDEEM_WRITE_ENABLED = false as boolean;
export const PROTECTED_NFTS = [4n, 5n] as const;
export const TEST_NFT = 6n;

export function quoteRedeem(shares: bigint, totalShares: bigint, reserveA: bigint, reserveB: bigint) {
  if (shares <= 0n || totalShares <= 0n || shares > totalShares ||
      reserveA <= 0n || reserveB <= 0n) throw new Error("Invalid pool/position state");
  const amountA = shares * reserveA / totalShares;
  const amountB = shares * reserveB / totalShares;
  if (amountA <= 0n || amountB <= 0n) throw new Error("Redemption rounds to zero");
  return {
    amountA, amountB,
    minA: amountA * (BPS - SLIPPAGE_BPS) / BPS,
    minB: amountB * (BPS - SLIPPAGE_BPS) / BPS,
  };
}

/** Intentionally no executable withdrawal path in this package. */
export function assertRedeemWritePermission(tokenId: bigint): never {
  if (PROTECTED_NFTS.some(id => id === tokenId))
    throw new Error("Protected NFT #4/#5: redemption permanently prohibited in this test flow");
  if (tokenId !== TEST_NFT) throw new Error("Only NFT #6 may be considered");
  throw new Error("NFT #6 real redemption LOCKED: separate burn authorization required");
}
