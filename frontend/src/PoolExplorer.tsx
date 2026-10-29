import { useState } from "react";
import { BrowserProvider, Contract, formatUnits, parseUnits } from "ethers";
import type { Eip1193Provider } from "ethers";
import { DEX_ADDRESS } from "./contracts";
import { ERC20_ABI, MINIDEX_ABI } from "./abi";

// 此组件只有读取与数学计算，没有 signer、approve、swap 或交易发送。
const EXPECTED_CHAIN_ID = 1337n;
const MAX_POOLS = 50n;

type Token = {
  address: string;
  symbol: string;
  decimals: number | null;
};

type Pool = {
  id: bigint;
  a: Token;
  b: Token;
  reserveA: bigint;
  reserveB: bigint;
  shares: bigint;
  createdTimestamp: bigint;
};

function getError(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}

async function readProvider(): Promise<BrowserProvider> {
  const injected = (window as Window & { ethereum?: Eip1193Provider }).ethereum;
  if (!injected) throw new Error("未检测到 MetaMask。");

  const provider = new BrowserProvider(injected);
  const { chainId } = await provider.getNetwork();
  if (chainId !== EXPECTED_CHAIN_ID) {
    throw new Error("请切换到 Ganache 1337，当前不执行任何交易。");
  }
  if ((await provider.getCode(DEX_ADDRESS)) === "0x") {
    throw new Error("当前链上未找到已知的 MiniDEX 合约。");
  }
  return provider;
}

async function readToken(provider: BrowserProvider, address: string): Promise<Token> {
  const token = new Contract(address, ERC20_ABI, provider);

  let symbol = `${address.slice(0, 6)}…${address.slice(-4)}`;
  let decimals: number | null = null;
  try { symbol = String(await token.symbol()); } catch { /* 展示名可选 */ }
  try {
    const d = Number(await token.decimals());
    if (Number.isInteger(d) && d >= 0 && d <= 255) decimals = d;
  } catch { /* 不猜精度 */ }

  return { address, symbol, decimals };
}

function showAmount(amount: bigint, token: Token): string {
  if (token.decimals === null) return `${amount.toString()} (raw units)`;
  return `${formatUnits(amount, token.decimals)} ${token.symbol}`;
}

export default function PoolExplorer() {
  const [options, setOptions] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState("1");
  const [pool, setPool] = useState<Pool | null>(null);
  const [direction, setDirection] = useState<"AtoB" | "BtoA">("AtoB");
  const [inputAmount, setInputAmount] = useState("1");
  const [status, setStatus] = useState("尚未读取池列表");
  const [busy, setBusy] = useState(false);

  async function listPools() {
    setBusy(true);
    setPool(null);
    try {
      const provider = await readProvider();
      const dex = new Contract(DEX_ADDRESS, MINIDEX_ABI, provider);
      const count: bigint = await dex.poolCount();
      if (count > MAX_POOLS) throw new Error("池数量超过50，本页停止批量读取。");

      const ids = Array.from({ length: Number(count) }, (_, i) => String(i + 1));
      setOptions(ids);
      setSelectedId(ids[0] ?? "");
      setStatus(
        `找到 ${count.toString()} 个池。请选择池编号，然后点击“读取选中池”。只读完成。`
      );
    } catch (error) {
      setOptions([]);
      setSelectedId("");
      setStatus(`池列表读取失败：${getError(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function readSelected() {
    setBusy(true);
    setPool(null);
    try {
      const provider = await readProvider();
      const dex = new Contract(DEX_ADDRESS, MINIDEX_ABI, provider);
      const id = BigInt(selectedId);
      const count: bigint = await dex.poolCount();
      if (id < 1n || id > count) throw new Error("池编号不在链上范围内。");

      const record = await dex.pools(id);
      const [a, b] = await Promise.all([
        readToken(provider, record.tokenA),
        readToken(provider, record.tokenB),
      ]);

      setPool({
        id,
        a,
        b,
        reserveA: record.reserveA,
        reserveB: record.reserveB,
        shares: record.totalShares,
        createdTimestamp: record.createdTimestamp,
      });
      setDirection("AtoB");
      setStatus(`Pool ${id.toString()} 已只读加载。未发送交易。`);
    } catch (error) {
      setStatus(`池数据读取失败：${getError(error)}`);
    } finally {
      setBusy(false);
    }
  }

  function quote(): string {
    if (!pool) return "请先读取选中池。";

    const inputToken = direction === "AtoB" ? pool.a : pool.b;
    const outputToken = direction === "AtoB" ? pool.b : pool.a;
    const reserveIn = direction === "AtoB" ? pool.reserveA : pool.reserveB;
    const reserveOut = direction === "AtoB" ? pool.reserveB : pool.reserveA;

    if (reserveIn === 0n || reserveOut === 0n) {
      return "该池目前没有流动性，无法兑换。新池创建后需要先添加流动性。";
    }
    if (inputToken.decimals === null || outputToken.decimals === null) {
      return "代币 decimals 不可读，为避免金额计算错误，本页不提供报价。";
    }

    try {
      const amountIn = parseUnits(inputAmount.trim(), inputToken.decimals);
      if (amountIn <= 0n) return "输入数量必须大于 0。";

      // 与 MiniDEX.sol 的 0.3% 手续费公式一致
      const feeAdjusted = amountIn * 997n;
      const output = feeAdjusted * reserveOut / (reserveIn * 1000n + feeAdjusted);
      if (output <= 0n || output >= reserveOut) {
        return "输出金额太小或报价无效，请调整输入数量。";
      }
      const minOut = output * 99n / 100n;
      return (
        `预计收到：${showAmount(output, outputToken)}；` +
        `1% 滑点下最低接收：${showAmount(minOut, outputToken)}。` +
        `仅本地报价，未授权、未发送 Swap；交易前必须重新读取储备。`
      );
    } catch (error) {
      return `输入金额无效：${getError(error)}`;
    }
  }

  return (
    <section className="pool-quote-workspace">
      <div className="pool-quote-heading">
        <div>
          <span className="pool-quote-kicker">MARKET EXPLORER / READ ONLY</span>
          <h2>跨池选择与双向报价</h2>
          <p>Pool 1 与 Pool 2 均可按链上实际状态查询。可切换交易方向，所有报价仅用于演示与核验。</p>
        </div>
        <span className="pool-quote-lock">只读模式</span>
      </div>

      <div className="pool-quote-toolbar">
        <button type="button" onClick={listPools} disabled={busy}>
          {busy ? "正在读取…" : "刷新链上池列表"}
        </button>
        <label className="pool-quote-select">
          <span>选择交易池</span>
          <select
            value={selectedId}
            onChange={(event) => {
              setSelectedId(event.target.value);
              setPool(null);
              setStatus("已切换池编号，请点击读取选中池。");
            }}
            disabled={busy || options.length === 0}
          >
            {options.length === 0 && <option value="">请先刷新列表</option>}
            {options.map((id) => <option key={id} value={id}>Pool {id}</option>)}
          </select>
        </label>
        <button type="button" onClick={readSelected} disabled={busy || !selectedId}>
          读取选中池
        </button>
      </div>

      <div className="pool-quote-feedback" role="status">{status}</div>

      {pool ? (
        <div className="pool-quote-details">
          <div className="pool-quote-details-top">
            <div><span className="pool-quote-kicker">POOL {pool.id.toString()}</span><h3>{pool.a.symbol} <span>/</span> {pool.b.symbol}</h3></div>
            <span className="pool-quote-tag">链上已读取</span>
          </div>
          <div className="pool-quote-reserves">
            <div><small>{pool.a.symbol} 储备</small><strong>{showAmount(pool.reserveA, pool.a)}</strong></div>
            <div><small>{pool.b.symbol} 储备</small><strong>{showAmount(pool.reserveB, pool.b)}</strong></div>
          </div>
          <details className="pool-quote-metadata">
            <summary>查看Token地址与池元数据</summary>
            <p>Token A：{pool.a.address}</p>
            <p>Token B：{pool.b.address}</p>
            <p>流动性份额（原始单位）：{pool.shares.toString()}</p>
            <p>创建时间：{new Date(Number(pool.createdTimestamp) * 1000).toLocaleString("zh-CN")}</p>
          </details>
          <div className="pool-quote-controls">
            <label>报价方向
              <select value={direction} onChange={(event) => setDirection(event.target.value as "AtoB" | "BtoA")}>
                <option value="AtoB">{pool.a.symbol} → {pool.b.symbol}</option>
                <option value="BtoA">{pool.b.symbol} → {pool.a.symbol}</option>
              </select>
            </label>
            <label>输入数量
              <input type="text" value={inputAmount} onChange={(event) => setInputAmount(event.target.value)} inputMode="decimal" />
            </label>
          </div>
          <div className="pool-quote-output" role="status"><span>AMM 只读报价</span><p>{quote()}</p></div>
          <p className="pool-quote-footnote">0.3% 手续费 · 1% 滑点示例 · 不发送交易。此面板不会改变左侧Pool 1的Swap交易目标。</p>
        </div>
      ) : (
        <div className="pool-quote-empty">
          <div className="pool-quote-empty-icon" aria-hidden="true">◈</div>
          <strong>探索已部署的流动性池</strong>
          <p>刷新链上池列表，再选择 Pool 1 或 Pool 2，即可看到储备和双向兑换报价。</p>
          <div className="pool-quote-empty-chips"><span>Pool 1 · TKA / TKB</span><span>Pool 2 · TKA / TKC</span></div>
          <small>以上仅为已知实验币对名称，不代表刚读取的最新储备。</small>
        </div>
      )}
    </section>
  );
}
