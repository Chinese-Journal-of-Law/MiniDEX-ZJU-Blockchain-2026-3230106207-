import { BrowserProvider, Contract, Interface, formatUnits } from "ethers";
import { AWARE_COIL } from "../config/deployments";
import { MINIDEX_ABI } from "../abi";
import { quoteRedeem } from "../features/liquidity/redeemMath";

const goodAddress = (value: unknown, expected: string) =>
  String(value).toLowerCase() === expected.toLowerCase();

export type RedeemPreview = {
  blockNumber: number;
  tokenId: bigint;
  account: string;
  poolId: bigint;
  reserveA: bigint;
  reserveB: bigint;
  totalShares: bigint;
  shares: bigint;
  initialA: bigint;
  initialB: bigint;
  timestamp: bigint;
  amountA: bigint;
  amountB: bigint;
  minA: bigint;
  minB: bigint;
  simulationA: bigint;
  simulationB: bigint;
  gasEstimate: bigint;
  transactionFingerprint: string;
  formatted: { expectedA: string; expectedB: string };
};

// Read-only by construction: provider only, no signer or .send() transactions.
export async function readRedeemPreview(provider: BrowserProvider, tokenId: 5n | 6n = 6n): Promise<RedeemPreview> {
  const cfg = AWARE_COIL;
  const network = await provider.getNetwork();
  if (network.chainId !== cfg.chainId) throw new Error("Wrong chain: expected aware-coil 1337");
  const accounts = await provider.send("eth_accounts", []) as string[];
  if (!accounts.length || !goodAddress(accounts[0], cfg.account0))
    throw new Error("Select existing Account0 before preview");

  const fingerprint = await provider.getTransactionReceipt(cfg.pool2SeedTx);
  if (!fingerprint || fingerprint.status !== 1 || !goodAddress(fingerprint.to, cfg.dex))
    throw new Error("Historical Pool2 transaction missing: wrong workspace");
  if ((await provider.getCode(cfg.dex)) === "0x") throw new Error("MiniDEX contract missing");

  // New NFT #6 is confirmed only when the actual addLiquidity receipt exists.
  const mintTx = "0xff609f30b8ab2471f3e394d008305aac4f38f7e413082c3b4715b7a98cebd9b9";
  const mintReceipt = await provider.getTransactionReceipt(mintTx);
  if (!mintReceipt || mintReceipt.status !== 1 || !goodAddress(mintReceipt.to, cfg.dex))
    throw new Error("NFT #6 mint transaction receipt not found in current workspace");

  const blockNumber = await provider.getBlockNumber();
  const block = { blockTag: blockNumber };
  const dex = new Contract(cfg.dex, MINIDEX_ABI, provider);
  const [poolCount, pool1, pool2, owner4, owner5, owner6, pos4, pos5, pos6, nextId] =
    await Promise.all([
      dex.poolCount(block), dex.pools(cfg.existingPool1, block),
      dex.pools(cfg.existingPool2, block), dex.ownerOf(4n, block),
      dex.ownerOf(5n, block), dex.ownerOf(6n, block),
      dex.positions(4n, block), dex.positions(5n, block),
      dex.positions(6n, block), dex.nextTokenId(block),
    ]);
  if (BigInt(poolCount) !== 2n || BigInt(nextId) < 7n)
    throw new Error("Unexpected pool count or NFT sequence");
  if (!goodAddress(pool1.tokenA, cfg.tokenA) || !goodAddress(pool1.tokenB, cfg.tokenB) ||
      !goodAddress(pool2.tokenA, cfg.tokenA) || !goodAddress(pool2.tokenB, cfg.tokenC))
    throw new Error("Unexpected pool/token mapping");
  if (![owner4, owner5, owner6].every(owner => goodAddress(owner, cfg.account0)))
    throw new Error("NFT #4/#5/#6 ownership changed; stop");
  if (BigInt(pos4.poolId) !== 1n || BigInt(pos5.poolId) !== 2n || BigInt(pos6.poolId) !== 2n ||
      BigInt(pos6.shares) !== 10n * 10n ** 18n ||
      BigInt(pos6.amountA) !== 10n * 10n ** 18n ||
      BigInt(pos6.amountB) !== 10n * 10n ** 18n)
    throw new Error("Protected positions or NFT #6 minted position mismatch");

  const pos = tokenId === 5n ? pos5 : pos6;
  const reserveA = BigInt(pool2.reserveA), reserveB = BigInt(pool2.reserveB);
  const totalShares = BigInt(pool2.totalShares), shares = BigInt(pos.shares);
  const q = quoteRedeem(shares, totalShares, reserveA, reserveB);
  const iface = new Interface(MINIDEX_ABI);
  const data = iface.encodeFunctionData("removeLiquidity", [tokenId, q.minA, q.minB]);
  const tx = { to: cfg.dex, from: cfg.account0, data };
  const rawResult = await provider.call({ ...tx, blockTag: blockNumber });
  const values = iface.decodeFunctionResult("removeLiquidity", rawResult);
  const simulationA = BigInt(values[0]), simulationB = BigInt(values[1]);
  if (simulationA !== q.amountA || simulationB !== q.amountB)
    throw new Error("staticCall differs from expected proportional redemption");
  const gasEstimate = await provider.estimateGas(tx);
  return {
    blockNumber, tokenId, account: cfg.account0, poolId: 2n, reserveA, reserveB,
    totalShares, shares, initialA: BigInt(pos.amountA), initialB: BigInt(pos.amountB),
    timestamp: BigInt(pos.createdTimestamp),
    ...q, simulationA, simulationB, gasEstimate,
    transactionFingerprint: mintTx,
    formatted: { expectedA: formatUnits(q.amountA, 18), expectedB: formatUnits(q.amountB, 18) },
  };
}
