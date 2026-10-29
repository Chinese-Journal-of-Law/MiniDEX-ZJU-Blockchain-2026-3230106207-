import { useRef, useState } from "react";
import { BrowserProvider, formatUnits } from "ethers";
import type { Eip1193Provider } from "ethers";
import { AWARE_COIL } from "../../config/deployments";
import { readTestDepositSnapshot } from "../../chain/testDepositRead";
import type { TestDepositSnapshot } from "../../chain/testDepositRead";
import {
  ENABLE_TEST_DEPOSIT_WRITES,
  executeTestDepositStep,
} from "../../chain/testDepositWrite";
import type { TestDepositStep, StepReceipt } from "../../chain/testDepositWrite";

const getError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const format = (value: bigint, decimals = 18) => formatUnits(value, decimals);

function wallet(): Eip1193Provider {
  const ethereum = (window as Window & { ethereum?: Eip1193Provider }).ethereum;
  if (!ethereum) throw new Error("MetaMask 未安装");
  return ethereum;
}

/** One button = at most one transaction. No chained approve/add calls. */
export default function TestDepositPanel() {
  const [snapshot, setSnapshot] = useState<TestDepositSnapshot | null>(null);
  const [status, setStatus] = useState("请先只读预检，再逐笔手动确认10+10交易。");
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<StepReceipt | null>(null);
  const [completed, setCompleted] = useState(false);
  const inFlight = useRef(false);

  async function inspect() {
    if (inFlight.current || completed) return;
    inFlight.current = true;
    setBusy(true);
    setSnapshot(null);
    setReceipt(null);
    setStatus("正在只读核对网络、历史回执、NFT #4/#5 及池储备...");
    try {
      const result = await readTestDepositSnapshot(new BrowserProvider(wallet()));
      setSnapshot(result);
      setStatus("预检通过。请逐笔点击所需操作，在MetaMask中确认；不会自动发送下一笔。");
    } catch (error) {
      setStatus("停止：" + getError(error) + "。没有从本操作发送交易。");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function submit(step: TestDepositStep) {
    if (inFlight.current || !snapshot || completed || !ENABLE_TEST_DEPOSIT_WRITES) return;
    inFlight.current = true;
    setBusy(true);
    setReceipt(null);
    setSnapshot(null); // prevent stale buttons from staying enabled
    setStatus(`执行 ${step}：等待MetaMask单笔确认；不要重复点击或刷新页面。`);
    try {
      // This function itself re-reads the live chain baseline and checks allowances.
      const result = await executeTestDepositStep(step, wallet());
      setReceipt(result);
      if (step === "addLiquidity") {
        setCompleted(true);
        setStatus(`加池成功！链上事件铸造 NFT #${String(result.mintedNftId)}。不得重复加池。`);
      } else {
        const latest = await readTestDepositSnapshot(new BrowserProvider(wallet()));
        setSnapshot(latest);
        setStatus(`${step} 已在链上确认。请检查哈希，手动决定是否进行下一笔。`);
      }
    } catch (error) {
      setStatus(
        `已停止：${getError(error)}。如果钱包弹窗被取消、卡住或结果不明，` +
        "请保留页面和交易尝试记录，先查链上回执；不得盲目重试。"
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <section style={{ border: "1px solid #94a3b8", borderRadius: 12, padding: 18, marginTop: 18 }}>
      <h2>Pool 2 · 独立10+10测试仓位</h2>
      <p>目标：10 TKA + 10 TKC。仅授权生成<strong>新的NFT</strong>；
        NFT #4/#5 均不得赎回或转移。</p>
      <p><strong>网络：</strong>现有 aware-coil / Chain 1337 · Account0</p>
      <p><strong>交易模式：</strong>
        {ENABLE_TEST_DEPOSIT_WRITES ? "已按本轮授权启用（每次点击最多一笔交易）" : "完全锁定"}
      </p>
      <button type="button" disabled={busy || completed} onClick={() => void inspect()}>
        {busy ? "操作处理中..." : "重新只读预检（不发送交易）"}
      </button>

      <p role="status" style={{ fontWeight: 600 }}>{status}</p>
      {receipt && (
        <div style={{ border: "1px solid #64748b", padding: 12, borderRadius: 8 }}>
          <p>已确认步骤：{receipt.action}</p>
          <p style={{ overflowWrap: "anywhere" }}>交易哈希：<code>{receipt.transactionHash}</code></p>
          {receipt.mintedNftId !== undefined &&
            <p>回执铸造的真实NFT编号：#{String(receipt.mintedNftId)}</p>}
        </div>
      )}

      {snapshot && (
        <div style={{ background: "#f5f7fa", padding: 12, borderRadius: 8 }}>
          <p>已核验链：1337；Account0：{snapshot.account}；读取区块：{snapshot.blockNumber}</p>
          <p>储备：{format(snapshot.reserveA, snapshot.decimalsA)} TKA /
            {format(snapshot.reserveB, snapshot.decimalsB)} TKC；
            总份额：{format(snapshot.totalShares)}</p>
          <p>计划投入：{format(snapshot.plan.amountA, snapshot.decimalsA)} TKA +
            {format(snapshot.plan.amountB, snapshot.decimalsB)} TKC</p>
          <p>预计新增份额：{format(snapshot.plan.expectedMintedShares)}；
            加池后储备：{format(snapshot.plan.projectedReserveA, snapshot.decimalsA)} /
            {format(snapshot.plan.projectedReserveB, snapshot.decimalsB)}；
            总份额：{format(snapshot.plan.projectedTotalShares)}</p>
          <p>预计下一可用编号 #{String(snapshot.nextTokenId)}（仅预测；以回执事件为准）</p>
          <p>钱包余额：{format(snapshot.balanceA, snapshot.decimalsA)} TKA /
            {format(snapshot.balanceB, snapshot.decimalsB)} TKC</p>
          <p>当前授权额度：{format(snapshot.allowanceA, snapshot.decimalsA)} TKA /
            {format(snapshot.allowanceB, snapshot.decimalsB)} TKC</p>
          <p>只读模拟：{snapshot.simulation}；Gas：{snapshot.gasEstimate}</p>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 16 }}>
            <button type="button"
              disabled={busy || !ENABLE_TEST_DEPOSIT_WRITES || !snapshot.plan.needApproveA}
              onClick={() => void submit("approveTKA")}>
              {snapshot.plan.needApproveA ? "第1笔：精确授权10 TKA" : "TKA授权已满足"}
            </button>
            <button type="button"
              disabled={busy || !ENABLE_TEST_DEPOSIT_WRITES || !snapshot.plan.needApproveB}
              onClick={() => void submit("approveTKC")}>
              {snapshot.plan.needApproveB ? "第2笔：精确授权10 TKC" : "TKC授权已满足"}
            </button>
            <button type="button"
              disabled={busy || !ENABLE_TEST_DEPOSIT_WRITES ||
                snapshot.plan.needApproveA || snapshot.plan.needApproveB}
              onClick={() => void submit("addLiquidity")}>
              第3笔：加池10+10并铸造新NFT
            </button>
          </div>
        </div>
      )}
      <p>三笔操作均需单独点击、单独确认，没有连续自动交易。
        页面不包含 removeLiquidity，不会销毁 NFT #4/#5。</p>
      <p>出现错误、钱包拒签、回执不明时，<strong>不要重复发送</strong>；
        保存交易哈希或错误文本以便只读核对。</p>
    </section>
  );
}
