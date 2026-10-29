/**
 * Historical Pool 2 10 TKA + 10 TKC write path, now locked after completion.
 * The exported write gate is false; no future UI click can send a transaction.
 * One invocation can send at most ONE transaction; never automatically continue.
 * There is deliberately NO removeLiquidity path in this module.
 */
import { BrowserProvider, Contract, Interface } from "ethers";
import type { Eip1193Provider, TransactionReceipt } from "ethers";
import { ERC20_ABI, MINIDEX_ABI } from "../abi";
import { AWARE_COIL } from "../config/deployments";
import { readTestDepositSnapshot } from "./testDepositRead";

export const ENABLE_TEST_DEPOSIT_WRITES = false; // Historical 10+10 operation is complete; future real writes stay locked
export type TestDepositStep = "approveTKA" | "approveTKC" | "addLiquidity";
export type StepReceipt = {
  action: TestDepositStep;
  transactionHash: string;
  mintedNftId?: bigint;
};

const keyFor = (step: TestDepositStep) =>
  `minidex:1337:aware-coil:test10+10:${step}:attempt`;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function requireSeparateAuthorization(): void {
  if (!ENABLE_TEST_DEPOSIT_WRITES) {
    throw new Error("10+10 real transactions are LOCKED; no separate user authorization");
  }
}

async function verifySigner(provider: BrowserProvider, address: string): Promise<void> {
  const network = await provider.getNetwork();
  if (network.chainId !== AWARE_COIL.chainId) throw new Error("Network changed");
  const accounts = (await provider.send("eth_accounts", [])) as string[];
  if (!accounts[0] || !same(accounts[0], address)) {
    throw new Error("MetaMask active account changed");
  }
  const signer = await provider.getSigner();
  if (!same(await signer.getAddress(), address)) {
    throw new Error("Signer changed");
  }
}

function mintedIdFromReceipt(receipt: TransactionReceipt): bigint {
  const iface = new Interface(MINIDEX_ABI);
  const candidates: bigint[] = [];
  for (const log of receipt.logs) {
    if (!same(log.address, AWARE_COIL.dex)) continue;
    try {
      const event = iface.parseLog({ topics: [...log.topics], data: log.data });
      if (event?.name === "LiquidityNFTMinted" &&
          BigInt(String(event.args.poolId)) === AWARE_COIL.existingPool2 &&
          same(String(event.args.owner), AWARE_COIL.account0)) {
        candidates.push(BigInt(String(event.args.tokenId)));
      }
    } catch { /* unrelated event */ }
  }
  if (candidates.length !== 1) {
    throw new Error("Confirmed tx but exactly one mint event not found. NEVER resend");
  }
  return candidates[0];
}

/**
 * NOT wired to any React button. Gate checked at the FIRST instruction.
 * UI exposes three separate, individually confirmed buttons.
 * Never call actions in a loop; always re-inspect before the NEXT user-confirmed step.
 */
export async function executeTestDepositStep(
  step: TestDepositStep,
  injected: Eip1193Provider,
): Promise<StepReceipt> {
  requireSeparateAuthorization();
  const attemptKey = keyFor(step);
  if (window.localStorage.getItem(attemptKey) !== null) {
    throw new Error("Existing attempt marker: inspect receipts and chain before retry");
  }
  const provider = new BrowserProvider(injected);
  const snapshot = await readTestDepositSnapshot(provider);
  await verifySigner(provider, AWARE_COIL.account0);
  const signer = await provider.getSigner();
  const a = new Contract(AWARE_COIL.tokenA, ERC20_ABI, signer);
  const c = new Contract(AWARE_COIL.tokenC, ERC20_ABI, signer);
  const dex = new Contract(AWARE_COIL.dex, MINIDEX_ABI, signer);
  const { plan } = snapshot;

  // An action triggers at most ONE MetaMask prompt, receipt, and verification.
  let submit: () => Promise<{ hash: string; wait: () => Promise<TransactionReceipt | null> }>;
  if (step === "approveTKA" || step === "approveTKC") {
    const isA = step === "approveTKA";
    if (!(isA ? plan.needApproveA : plan.needApproveB)) {
      throw new Error("Allowance already sufficient; no approval is needed");
    }
    const token = isA ? a : c;
    const raw = isA ? plan.amountA : plan.amountB;
    // ALWAYS approve the exact deposit amount (10 tokens); never MaxUint256.
    const method = token.getFunction("approve(address,uint256)");
    await method.staticCall(AWARE_COIL.dex, raw);
    submit = () => method(AWARE_COIL.dex, raw);
  } else {
    if (plan.needApproveA || plan.needApproveB) {
      throw new Error("Both token allowances must be ready before addLiquidity");
    }
    const method = dex.getFunction("addLiquidity(uint256,uint256,uint256)");
    const simulatedShares = BigInt(String(await method.staticCall(
      AWARE_COIL.existingPool2, plan.amountA, plan.amountB,
    )));
    if (simulatedShares !== plan.expectedMintedShares) {
      throw new Error("Expected shares and contract staticCall disagree");
    }
    await method.estimateGas(AWARE_COIL.existingPool2, plan.amountA, plan.amountB);
    submit = () => method(AWARE_COIL.existingPool2, plan.amountA, plan.amountB);
  }
  await verifySigner(provider, AWARE_COIL.account0);
  // Set BEFORE MetaMask popup; ambiguous wallet/broadcast states MUST NOT auto-retry.
  window.localStorage.setItem(attemptKey, "PENDING_WALLET_CONFIRMATION");
  const tx = await submit();
  window.localStorage.setItem(attemptKey, tx.hash);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error("Missing/failed receipt; saved hash or attempt marker; NEVER retry blindly");
  }

  if (step === "approveTKA" || step === "approveTKC") {
    const token = step === "approveTKA" ? a : c;
    const amount = step === "approveTKA" ? plan.amountA : plan.amountB;
    const allowance = BigInt(String(await token.allowance(AWARE_COIL.account0, AWARE_COIL.dex)));
    if (allowance < amount) {
      throw new Error("Approval receipt succeeded but allowance not confirmed; do not retry");
    }
    return { action: step, transactionHash: receipt.hash };
  }
  // The ID below is learned from the *receipt event* only; it is never guessed.
  const mintedNftId = mintedIdFromReceipt(receipt);
  const dexRead = new Contract(AWARE_COIL.dex, MINIDEX_ABI, provider);
  const [owner, position, pool, owner4, owner5] = await Promise.all([
    dexRead.ownerOf(mintedNftId), dexRead.positions(mintedNftId),
    dexRead.pools(AWARE_COIL.existingPool2),
    dexRead.ownerOf(AWARE_COIL.protectedNfts[0]),
    dexRead.ownerOf(AWARE_COIL.protectedNfts[1]),
  ]);
  if (!same(String(owner), AWARE_COIL.account0) ||
      BigInt(String(position.poolId)) !== AWARE_COIL.existingPool2 ||
      BigInt(String(position.amountA)) !== plan.amountA ||
      BigInt(String(position.amountB)) !== plan.amountB ||
      BigInt(String(position.shares)) !== plan.expectedMintedShares ||
      BigInt(String(pool.reserveA)) !== plan.projectedReserveA ||
      BigInt(String(pool.reserveB)) !== plan.projectedReserveB ||
      BigInt(String(pool.totalShares)) !== plan.projectedTotalShares ||
      !same(String(owner4), AWARE_COIL.account0) ||
      !same(String(owner5), AWARE_COIL.account0)) {
    throw new Error("Confirmed tx but post-state mismatch; save receipt, NEVER resend");
  }
  return { action: step, transactionHash: receipt.hash, mintedNftId };
}
