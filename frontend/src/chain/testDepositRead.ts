import { BrowserProvider, Contract, formatUnits, parseUnits } from "ethers";
import { ERC20_ABI, MINIDEX_ABI } from "../abi";
import { AWARE_COIL } from "../config/deployments";
import { planNonInitialDeposit } from "../features/liquidity/depositMath";
import type { DepositPlan } from "../features/liquidity/depositMath";

export type TestDepositSnapshot = {
  blockNumber: number;
  account: string;
  nextTokenId: bigint; // anticipated only; not an existing NFT
  reserveA: bigint;
  reserveB: bigint;
  totalShares: bigint;
  balanceA: bigint;
  balanceB: bigint;
  allowanceA: bigint;
  allowanceB: bigint;
  decimalsA: number;
  decimalsB: number;
  plan: DepositPlan;
  simulation: string;
  gasEstimate: string;
};

const asBigInt = (x: unknown): bigint => BigInt(String(x));
const sameAddress = (a: unknown, b: string): boolean =>
  String(a).toLowerCase() === b.toLowerCase();

/** No signer, no account request popup, no state-changing RPC calls. */
export async function readTestDepositSnapshot(
  provider: BrowserProvider,
): Promise<TestDepositSnapshot> {
  const cfg = AWARE_COIL;
  const network = await provider.getNetwork();
  if (network.chainId !== cfg.chainId) {
    throw new Error("Wrong network: select existing aware-coil / Chain ID 1337");
  }
  const accounts = (await provider.send("eth_accounts", [])) as string[];
  if (!accounts.length || !sameAddress(accounts[0], cfg.account0)) {
    throw new Error("Connect/select the existing Ganache Account 0 first");
  }
  // Chain ID alone cannot distinguish a reset workspace from this historical one.
  const knownReceipt = await provider.getTransactionReceipt(cfg.pool2SeedTx);
  if (!knownReceipt || knownReceipt.status !== 1 ||
      !sameAddress(knownReceipt.to, cfg.dex)) {
    throw new Error("Historical Pool 2 seed receipt missing: wrong/reset workspace");
  }
  const blockNumber = await provider.getBlockNumber();
  for (const [name, address] of [
    ["MiniDEX", cfg.dex], ["TKA", cfg.tokenA], ["TKC", cfg.tokenC],
  ] as const) {
    if ((await provider.getCode(address, blockNumber)) === "0x") {
      throw new Error(`${name} is missing at its recorded deployed address`);
    }
  }

  const atBlock = { blockTag: blockNumber };
  const dex = new Contract(cfg.dex, MINIDEX_ABI, provider);
  const tokenA = new Contract(cfg.tokenA, ERC20_ABI, provider);
  const tokenB = new Contract(cfg.tokenC, ERC20_ABI, provider);
  const [poolCount, pool1, pool2, nextId, owner4, owner5, pos4, pos5,
    decimalsARaw, decimalsBRaw, symbolA, symbolB,
    balanceARaw, balanceBRaw, allowanceARaw, allowanceBRaw] = await Promise.all([
    dex.poolCount(atBlock), dex.pools(cfg.existingPool1, atBlock),
    dex.pools(cfg.existingPool2, atBlock), dex.nextTokenId(atBlock),
    dex.ownerOf(cfg.protectedNfts[0], atBlock),
    dex.ownerOf(cfg.protectedNfts[1], atBlock),
    dex.positions(cfg.protectedNfts[0], atBlock),
    dex.positions(cfg.protectedNfts[1], atBlock),
    tokenA.decimals(atBlock), tokenB.decimals(atBlock),
    tokenA.symbol(atBlock), tokenB.symbol(atBlock),
    tokenA.balanceOf(cfg.account0, atBlock), tokenB.balanceOf(cfg.account0, atBlock),
    tokenA.allowance(cfg.account0, cfg.dex, atBlock),
    tokenB.allowance(cfg.account0, cfg.dex, atBlock),
  ]);
  if (asBigInt(poolCount) !== 2n ||
      !sameAddress(pool1.tokenA, cfg.tokenA) ||
      !sameAddress(pool1.tokenB, cfg.tokenB) ||
      !sameAddress(pool2.tokenA, cfg.tokenA) ||
      !sameAddress(pool2.tokenB, cfg.tokenC)) {
    throw new Error("Pool list or TKA/TKB/TKC ordering differs from the known deployment");
  }
  if (!sameAddress(owner4, cfg.account0) || !sameAddress(owner5, cfg.account0) ||
      asBigInt(pos4.poolId) !== cfg.existingPool1 ||
      asBigInt(pos5.poolId) !== cfg.existingPool2) {
    throw new Error("Protected NFT #4 or #5 ownership/position changed; stop");
  }
  if (asBigInt(nextId) !== cfg.archivedNextTokenId) {
    throw new Error("Next NFT ID changed from archived preflight: re-audit before proceeding");
  }
  const decimalsA = Number(decimalsARaw);
  const decimalsB = Number(decimalsBRaw);
  if (String(symbolA) !== "TKA" || String(symbolB) !== "TKC" ||
      decimalsA !== 18 || decimalsB !== 18) {
    throw new Error("Unexpected token symbols/decimals for the 10+10 test");
  }
  const amountA = parseUnits(cfg.depositAmount, decimalsA);
  const amountB = parseUnits(cfg.depositAmount, decimalsB);
  const reserveA = asBigInt(pool2.reserveA);
  const reserveB = asBigInt(pool2.reserveB);
  const totalShares = asBigInt(pool2.totalShares);
  // The user has approved NO change to this previously observed 100/100 baseline.
  if (reserveA !== parseUnits("100", decimalsA) ||
      reserveB !== parseUnits("100", decimalsB) ||
      totalShares !== parseUnits("100", 18)) {
    throw new Error("Pool 2 baseline changed since 100+100: stop and re-plan");
  }
  const balanceA = asBigInt(balanceARaw);
  const balanceB = asBigInt(balanceBRaw);
  const allowanceA = asBigInt(allowanceARaw);
  const allowanceB = asBigInt(allowanceBRaw);
  const plan = planNonInitialDeposit({
    reserveA, reserveB, totalShares, amountA, amountB,
    balanceA, balanceB, allowanceA, allowanceB,
  });
  let simulation = "Skipped: allowances insufficient. NO eth_call for addLiquidity.";
  let gasEstimate = "Not estimated: allowances insufficient.";
  if (!plan.needApproveA && !plan.needApproveB) {
    // A static RPC call only. Even here there is no transaction method invocation.
    const method = dex.getFunction("addLiquidity(uint256,uint256,uint256)");
    const simulatedShares = asBigInt(await method.staticCall(
      cfg.existingPool2, amountA, amountB,
      { from: cfg.account0, blockTag: blockNumber },
    ));
    if (simulatedShares !== plan.expectedMintedShares) {
      throw new Error("Contract staticCall result disagrees with expected shares");
    }
    const gas = await method.estimateGas(
      cfg.existingPool2, amountA, amountB, { from: cfg.account0 },
    );
    simulation = `Read-only eth_call succeeded: ${formatUnits(simulatedShares, 18)} shares.`;
    gasEstimate = String(gas);
  }
  return {
    blockNumber, account: cfg.account0, nextTokenId: asBigInt(nextId),
    reserveA, reserveB, totalShares, balanceA, balanceB,
    allowanceA, allowanceB, decimalsA, decimalsB,
    plan, simulation, gasEstimate,
  };
}
