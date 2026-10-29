import { BrowserProvider, Contract, Interface } from "ethers";
import type { Eip1193Provider, TransactionReceipt } from "ethers";
import { AWARE_COIL } from "../config/deployments";
import { MINIDEX_ABI } from "../abi";
import { readRedeemPreview } from "./redeemRead";
import { quoteRedeem } from "../features/liquidity/redeemMath";

// Separate user approval applies ONLY to NFT #6 on aware-coil 1337.
// Does not authorize #4/#5, a second redemption, or any other transaction.
export const ENABLE_NFT6_REAL_REDEEM = false; // NFT #6 redemption is complete; no further real redemption authorized
export const NFT6_MINT_TX =
  "0xff609f30b8ab2471f3e394d008305aac4f38f7e413082c3b4715b7a98cebd9b9";
export const NFT6_REDEEM_ATTEMPT_KEY = `minidex:1337:nft6:redeem:${NFT6_MINT_TX}`;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function assertTarget(tokenId: bigint): void {
  if (!ENABLE_NFT6_REAL_REDEEM || tokenId !== 6n) {
    throw new Error("Only the separately authorized NFT #6 can be redeemed");
  }
}

export type RedeemReceipt = {
  txHash: string; nftId: bigint; amountA: bigint; amountB: bigint;
  blockNumber: number;
};

export async function executeNft6Redemption(injected: Eip1193Provider): Promise<RedeemReceipt> {
  assertTarget(6n);
  // Guard is written before opening the wallet, including if the wallet rejects.
  if (window.localStorage.getItem(NFT6_REDEEM_ATTEMPT_KEY) !== null) {
    throw new Error("Previous redeem attempt recorded. Inspect chain receipt; NEVER retry blindly");
  }
  const provider = new BrowserProvider(injected);
  const before = await readRedeemPreview(provider, 6n);
  if (before.tokenId !== 6n || before.poolId !== 2n || before.shares !== 10n * 10n ** 18n) {
    throw new Error("Unexpected test position, aborting");
  }
  const network = await provider.getNetwork();
  if (network.chainId !== AWARE_COIL.chainId) throw new Error("Unexpected network");
  const accounts = await provider.send("eth_accounts", []) as string[];
  if (!accounts[0] || !same(accounts[0], AWARE_COIL.account0)) {
    throw new Error("Unexpected wallet account");
  }
  const signer = await provider.getSigner();
  if (!same(await signer.getAddress(), AWARE_COIL.account0)) {
    throw new Error("Signer changed");
  }
  // Re-check protected NFTs, pool state, and updated share ratio from the live chain.
  const dexRead = new Contract(AWARE_COIL.dex, MINIDEX_ABI, provider);
  const [owner4, owner5, owner6, p6, pool] = await Promise.all([
    dexRead.ownerOf(4n), dexRead.ownerOf(5n), dexRead.ownerOf(6n),
    dexRead.positions(6n), dexRead.pools(2n),
  ]);
  if (![owner4, owner5, owner6].every(x => same(String(x), AWARE_COIL.account0)) ||
      BigInt(p6.poolId) !== 2n || BigInt(p6.shares) !== before.shares) {
    throw new Error("Ownership or position changed before signing");
  }
  const q = quoteRedeem(
    BigInt(p6.shares), BigInt(pool.totalShares),
    BigInt(pool.reserveA), BigInt(pool.reserveB),
  );
  if (q.amountA !== before.amountA || q.amountB !== before.amountB) {
    throw new Error("Pool changed since preview; rerun read-only preview first");
  }
  const dexWrite = new Contract(AWARE_COIL.dex, MINIDEX_ABI, signer);
  const redeem = dexWrite.getFunction("removeLiquidity(uint256,uint256,uint256)");
  const simulated = await redeem.staticCall(6n, q.minA, q.minB);
  if (BigInt(simulated[0]) !== q.amountA || BigInt(simulated[1]) !== q.amountB) {
    throw new Error("Fresh staticCall differs from expected redemption");
  }
  await redeem.estimateGas(6n, q.minA, q.minB);
  // No NFT approval needed: the actual owner calls removeLiquidity directly.
  // This is the ONLY transaction-sending statement in the entire module.
  window.localStorage.setItem(NFT6_REDEEM_ATTEMPT_KEY, "PENDING_WALLET_CONFIRMATION");
  const tx = await redeem(6n, q.minA, q.minB);
  window.localStorage.setItem(NFT6_REDEEM_ATTEMPT_KEY, tx.hash);
  const receipt: TransactionReceipt | null = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error("Redeem receipt not confirmed; check saved hash and chain; NEVER retry blindly");
  }
  const iface = new Interface(MINIDEX_ABI);
  const found: Array<{a: bigint; b: bigint}> = [];
  for (const log of receipt.logs) {
    if (!same(log.address, AWARE_COIL.dex)) continue;
    try {
      const parsed = iface.parseLog({topics: [...log.topics], data: log.data});
      if (parsed?.name === "LiquidityRemoved" &&
          BigInt(parsed.args.poolId) === 2n &&
          BigInt(parsed.args.tokenId) === 6n &&
          same(String(parsed.args.owner), AWARE_COIL.account0)) {
        found.push({ a: BigInt(parsed.args.amountA), b: BigInt(parsed.args.amountB) });
      }
    } catch { /* ignore other event signatures */ }
  }
  if (found.length !== 1 || found[0].a < q.minA || found[0].b < q.minB) {
    throw new Error("Tx confirmed but redemption event mismatch: do NOT resend; inspect chain");
  }
  const [after4, after5, afterPool, afterPosition] = await Promise.all([
    dexRead.ownerOf(4n), dexRead.ownerOf(5n),
    dexRead.pools(2n), dexRead.positions(6n),
  ]);
  if (!same(String(after4), AWARE_COIL.account0) ||
      !same(String(after5), AWARE_COIL.account0) ||
      BigInt(afterPool.reserveA) !== BigInt(pool.reserveA) - found[0].a ||
      BigInt(afterPool.reserveB) !== BigInt(pool.reserveB) - found[0].b ||
      BigInt(afterPool.totalShares) !== BigInt(pool.totalShares) - before.shares ||
      BigInt(afterPosition.shares) !== 0n) {
    throw new Error("Tx confirmed but post-state mismatch; do NOT resend");
  }
  try {
    await dexRead.ownerOf(6n);
    throw new Error("Tx confirmed but NFT #6 ownerOf still exists; do NOT resend");
  } catch (error) {
    // Only successful ownerOf is a failure. Any provider/contract error must
    // be reviewed alongside the confirmed receipt in case RPC is unavailable.
    if (error instanceof Error && error.message.includes("still exists")) throw error;
  }
  return {txHash: receipt.hash, nftId: 6n, amountA: found[0].a,
    amountB: found[0].b, blockNumber: receipt.blockNumber};
}
