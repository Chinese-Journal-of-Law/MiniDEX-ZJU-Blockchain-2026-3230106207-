import { useState } from "react";
import { BrowserProvider, Contract, Interface } from "ethers";
import type { Eip1193Provider, TransactionReceipt } from "ethers";
import { AWARE_COIL } from "./config/deployments";
import { MINIDEX_ABI } from "./abi";

const NFT6_MINT_TX =
  "0xff609f30b8ab2471f3e394d008305aac4f38f7e413082c3b4715b7a98cebd9b9";
const NFT6_REDEEM_TX =
  "0xba5f375f3cc9efd4e8fc0b9442af7570adf0ab979b911416356bfb69cdab1c55";
const E18 = 10n ** 18n;
const same = (a: unknown, b: string) => String(a).toLowerCase() === b.toLowerCase();

function getWallet(): Eip1193Provider {
  const ethereum = (window as Window & { ethereum?: Eip1193Provider }).ethereum;
  if (!ethereum) throw new Error("未检测到 MetaMask；本页面只读核验，不会请求签名");
  return ethereum;
}

function isCallException(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error && (error as { code?: unknown }).code === "CALL_EXCEPTION";
}

function parseEvent(receipt: TransactionReceipt, iface: Interface, eventName: string) {
  const found: Array<{ tokenId: bigint; poolId: bigint; owner: string; amountA?: bigint; amountB?: bigint }> = [];
  for (const log of receipt.logs) {
    if (!same(log.address, AWARE_COIL.dex)) continue;
    try {
      const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
      if (!parsed || parsed.name !== eventName) continue;
      if (eventName === "LiquidityNFTMinted") {
        found.push({
          tokenId: BigInt(parsed.args.tokenId),
          poolId: BigInt(parsed.args.poolId),
          owner: String(parsed.args.owner),
        });
      } else if (eventName === "LiquidityRemoved") {
        found.push({
          tokenId: BigInt(parsed.args.tokenId),
          poolId: BigInt(parsed.args.poolId),
          owner: String(parsed.args.owner),
          amountA: BigInt(parsed.args.amountA),
          amountB: BigInt(parsed.args.amountB),
        });
      }
    } catch {
      // Ignore unrelated events in the same transaction receipt.
    }
  }
  return found;
}

async function confirmedReceipt(
  provider: BrowserProvider,
  hash: string,
  label: string,
): Promise<TransactionReceipt> {
  const receipt = await provider.getTransactionReceipt(hash);
  if (!receipt || receipt.status !== 1 || !same(receipt.to, AWARE_COIL.dex)) {
    throw new Error(`${label} 回执不存在、失败或目标合约不符；不能据此判断 NFT 状态`);
  }
  return receipt;
}

/**
 * Read-only historical verification. No signer, no transaction method calls,
 * no approve/removeLiquidity and no localStorage attempt flags.
 */
export default function Pool2Redeem() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("待核验。此页面仅读取历史回执与链上状态，不发送交易。");
  const [details, setDetails] = useState<string[]>([]);

  async function verify() {
    if (busy) return;
    setBusy(true);
    setDetails([]);
    setStatus("正在只读核验 Chain 1337、铸造回执、赎回回执及 NFT #4/#5...");
    try {
      const provider = new BrowserProvider(getWallet());
      const network = await provider.getNetwork();
      if (network.chainId !== AWARE_COIL.chainId) {
        throw new Error("网络不符：请切换到现有 aware-coil / Chain ID 1337");
      }
      const accounts = await provider.send("eth_accounts", []) as string[];
      if (!accounts.length || !same(accounts[0], AWARE_COIL.account0)) {
        throw new Error("当前已连接账户不是记录中的 Account 0");
      }
      const iface = new Interface(MINIDEX_ABI);
      const [mintReceipt, redeemReceipt] = await Promise.all([
        confirmedReceipt(provider, NFT6_MINT_TX, "NFT #6 铸造"),
        confirmedReceipt(provider, NFT6_REDEEM_TX, "NFT #6 赎回"),
      ]);
      const mintEvents = parseEvent(mintReceipt, iface, "LiquidityNFTMinted")
        .filter(e => e.tokenId === 6n && e.poolId === 2n && same(e.owner, AWARE_COIL.account0));
      const redeemEvents = parseEvent(redeemReceipt, iface, "LiquidityRemoved")
        .filter(e => e.tokenId === 6n && e.poolId === 2n && same(e.owner, AWARE_COIL.account0));
      if (mintEvents.length !== 1) throw new Error("铸造回执未能唯一确认 Pool 2 的 NFT #6");
      if (redeemEvents.length !== 1 || redeemEvents[0].amountA !== 10n * E18 ||
          redeemEvents[0].amountB !== 10n * E18) {
        throw new Error("赎回回执未能唯一确认 NFT #6 返还 10 TKA + 10 TKC");
      }

      const dex = new Contract(AWARE_COIL.dex, MINIDEX_ABI, provider);
      const [poolCount, pool1, pool2, owner4, owner5, pos4, pos5, pos6] = await Promise.all([
        dex.poolCount(), dex.pools(1n), dex.pools(2n),
        dex.ownerOf(4n), dex.ownerOf(5n),
        dex.positions(4n), dex.positions(5n), dex.positions(6n),
      ]);
      if (BigInt(poolCount) !== 2n ||
          !same(pool1.tokenA, AWARE_COIL.tokenA) || !same(pool1.tokenB, AWARE_COIL.tokenB) ||
          !same(pool2.tokenA, AWARE_COIL.tokenA) || !same(pool2.tokenB, AWARE_COIL.tokenC)) {
        throw new Error("交易池数量或代币地址与既有工作区记录不符");
      }
      if (!same(owner4, AWARE_COIL.account0) || !same(owner5, AWARE_COIL.account0) ||
          BigInt(pos4.poolId) !== 1n || BigInt(pos5.poolId) !== 2n ||
          BigInt(pos4.shares) !== 100n * E18 || BigInt(pos5.shares) !== 100n * E18) {
        throw new Error("NFT #4/#5 所有权或份额异常，停止验收");
      }
      if (BigInt(pool2.reserveA) !== 100n * E18 ||
          BigInt(pool2.reserveB) !== 100n * E18 ||
          BigInt(pool2.totalShares) !== 100n * E18 ||
          BigInt(pos6.shares) !== 0n) {
        throw new Error("Pool 2 储备/份额或 NFT #6 仓位记录与赎回后的预期不符");
      }

      let burned = false;
      try {
        await dex.ownerOf(6n);
      } catch (error) {
        if (!isCallException(error)) {
          throw new Error(
            `ownerOf(6) 查询失败但不是明确合约调用回退（${String(error)}）；` +
            "RPC/网络错误不能证明 NFT 已销毁",
          );
        }
        burned = true;
      }
      if (!burned) throw new Error("ownerOf(6) 仍返回所有者；NFT #6 尚未被确认销毁");

      setDetails([
        `铸造回执：${mintReceipt.hash}（区块 ${mintReceipt.blockNumber}）`,
        `赎回回执：${redeemReceipt.hash}（区块 ${redeemReceipt.blockNumber}）`,
        "赎回事件：Pool 2 / NFT #6 / 10 TKA + 10 TKC",
        "Pool 2 储备：100 TKA / 100 TKC；总份额：100",
        `NFT #4：Account 0 持有，Pool 1，份额 ${String(pos4.shares)}`,
        `NFT #5：Account 0 持有，Pool 2，份额 ${String(pos5.shares)}`,
        "NFT #6：赎回事件、仓位清零及 ownerOf(6) 回退均已核验",
      ]);
      setStatus("只读核验通过。未发送交易、未授权、未调用 removeLiquidity。");
    } catch (error) {
      setStatus(`未能完成核验：${error instanceof Error ? error.message : String(error)}。未发送交易。`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ marginTop: 18, padding: 18, border: "1px solid #cbd5e1", borderRadius: 12 }}>
      <h2>Pool 2 · NFT #6 赎回验收（只读）</h2>
      <p>NFT #6 已完成历史赎回。本模块只核验固定交易回执和当前链状态；不再提供任何赎回或授权按钮。</p>
      <p><strong>网络：</strong>现有 aware-coil / Chain 1337 · Account 0</p>
      <button type="button" disabled={busy} onClick={() => void verify()}>
        {busy ? "正在只读核验..." : "核验NFT #6赎回与NFT #4/#5保护状态"}
      </button>
      <p role="status"><strong>{status}</strong></p>
      {details.length > 0 && (
        <ul>
          {details.map((line) => <li key={line} style={{ overflowWrap: "anywhere" }}>{line}</li>)}
        </ul>
      )}
    </section>
  );
}
