import { useState } from "react";
import { BrowserProvider, Contract, formatUnits } from "ethers";
import type { Eip1193Provider } from "ethers";
import { DEX_ADDRESS } from "./contracts";
import { MINIDEX_ABI, ERC20_ABI } from "./abi";

type PositionItem = {
  id: string;
  owner: string;
  poolId: string;
  amountA: string;
  amountB: string;
  shares: string;
  created: string;
};

type PoolItem = {
  id: string;
  tokenA: string;
  tokenB: string;
  symbolA: string;
  symbolB: string;
  reserveA: string;
  reserveB: string;
  totalShares: string;
  positions: PositionItem[];
};

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export default function PoolSources() {
  const [items, setItems] = useState<PoolItem[]>([]);
  const [status, setStatus] = useState("尚未读取 LP 来源");
  const [busy, setBusy] = useState(false);
  const [burned, setBurned] = useState<string[]>([]);

  async function loadSources() {
    setBusy(true);
    setItems([]);
    setBurned([]);
    setStatus("正在只读查询所有池和 NFT 持仓...");
    try {
      const ethereum = (window as Window & { ethereum?: Eip1193Provider }).ethereum;
      if (!ethereum) throw new Error("未检测到 MetaMask");
      const provider = new BrowserProvider(ethereum);
      const network = await provider.getNetwork();
      if (network.chainId !== 1337n) throw new Error("网络不是 Ganache 1337");
      if ((await provider.getCode(DEX_ADDRESS)) === "0x") {
        throw new Error("MiniDEX 合约代码不存在");
      }
      const dex = new Contract(DEX_ADDRESS, MINIDEX_ABI, provider);
      const count = BigInt((await dex.poolCount()).toString());
      const nextId = BigInt((await dex.nextTokenId()).toString());
      if (count > 100n || nextId > 501n) {
        throw new Error("池或 NFT 数量超过本页查询上限，请先分页");
      }

      const pools: PoolItem[] = [];
      for (let id = 1n; id <= count; id++) {
        const record = await dex.pools(id);
        const a = new Contract(record.tokenA, ERC20_ABI, provider);
        const b = new Contract(record.tokenB, ERC20_ABI, provider);
        const [sa, sb, da, db] = await Promise.all([
          a.symbol(), b.symbol(), a.decimals(), b.decimals()
        ]);
        const decA = Number(da);
        const decB = Number(db);
        pools.push({
          id: id.toString(),
          tokenA: `${sa} (${record.tokenA})`,
          tokenB: `${sb} (${record.tokenB})`,
          symbolA: sa,
          symbolB: sb,
          reserveA: `${formatUnits(record.reserveA, decA)} ${sa}`,
          reserveB: `${formatUnits(record.reserveB, decB)} ${sb}`,
          totalShares: record.totalShares.toString(),
          positions: [],
        });
      }

      const destroyed: string[] = [];
      for (let id = 1n; id < nextId; id++) {
        let owner: string;
        try {
          owner = await dex.ownerOf(id);
        } catch {
          // ownerOf reverts for destroyed/non-existing ERC721 tokens.
          destroyed.push(id.toString());
          continue;
        }
        const pos = await dex.positions(id);
        const poolId = BigInt(pos.poolId.toString());
        if (poolId < 1n || poolId > count) {
          throw new Error(`NFT #${id} 的 Pool ID 异常，请人工核对`);
        }
        const pool = pools[Number(poolId - 1n)];
        const addresses = [
          (await dex.pools(poolId)).tokenA,
          (await dex.pools(poolId)).tokenB,
        ];
        const tokenA = new Contract(addresses[0], ERC20_ABI, provider);
        const tokenB = new Contract(addresses[1], ERC20_ABI, provider);
        const [da, db] = await Promise.all([tokenA.decimals(), tokenB.decimals()]);
        pool.positions.push({
          id: id.toString(),
          owner,
          poolId: poolId.toString(),
          amountA: formatUnits(pos.amountA, Number(da)),
          amountB: formatUnits(pos.amountB, Number(db)),
          shares: pos.shares.toString(),
          created: new Date(Number(pos.createdTimestamp) * 1000).toLocaleString("zh-CN"),
        });
      }
      setItems(pools);
      setBurned(destroyed);
      setStatus(`只读完成：${count} 个池、${nextId - 1n} 个历史 NFT 编号；没有发送交易。`);
    } catch (e) {
      setItems([]);
      setStatus(`查询失败：${message(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ border: "1px solid #ddd", borderRadius: 12, padding: 18, marginTop: 18 }}>
      <h2>各池流动性来源（只读）</h2>
      <p>按当前有效 LP NFT 追踪持有人、原始投入、份额与时间。原始投入不等于当前池储备或个人当前可赎回金额。</p>
      <button type="button" disabled={busy} onClick={loadSources}>
        {busy ? "读取中..." : "读取各池 LP 来源"}
      </button>
      <p role="status">{status}</p>
      {items.map(pool => (
        <div key={pool.id} style={{ background: "#f6f7f8", padding: 12, marginTop: 12 }}>
          <h3>Pool {pool.id}</h3>
          <p>Token A：{pool.tokenA}</p>
          <p>Token B：{pool.tokenB}</p>
          <p>当前储备：{pool.reserveA} / {pool.reserveB}</p>
          <p>池总份额（原始单位）：{pool.totalShares}</p>
          {pool.positions.length === 0 ? (
            <p>当前未发现有效 LP NFT。</p>
          ) : pool.positions.map(pos => (
            <div key={pos.id} style={{ borderTop: "1px solid #ccc", paddingTop: 8 }}>
              <strong>NFT #{pos.id} — 当前持有人 {pos.owner}</strong>
              <p>原始投入：{pos.amountA} {pool.symbolA} + {pos.amountB} {pool.symbolB}</p>
              <p>份额（原始单位）：{pos.shares}；创建时间：{pos.created}</p>
            </div>
          ))}
        </div>
      ))}
      {burned.length > 0 && (
        <p>不能查询当前所有权的历史 NFT 编号：{burned.join(", ")}。可能已销毁；不计入当前有效 LP 来源。</p>
      )}
      <p style={{ color: "#555" }}>本页面不调用 approve、swap、addLiquidity 或 removeLiquidity。</p>
    </section>
  );
}
