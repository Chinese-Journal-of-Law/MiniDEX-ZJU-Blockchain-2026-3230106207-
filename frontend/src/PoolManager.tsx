import { useRef, useState } from "react";
import {
  AbiCoder,
  BrowserProvider,
  Contract,
  formatUnits,
  getAddress,
  isAddress,
  keccak256,
} from "ethers";
import type { Eip1193Provider } from "ethers";

import { DEX_ADDRESS, TKA_ADDRESS, TKB_ADDRESS } from "./contracts";
import { ERC20_ABI, MINIDEX_ABI } from "./abi";

// 本阶段仅允许只读查询。没有用户明确授权前，保持 false。
const ENABLE_REAL_POOL_CREATION = false;
const APPROVED_TKC_ADDRESS = "0xa795c6C7E7bBb05F1Ef32aDEbD83076d30da9689";
const APPROVED_LP_ADDRESS = "0xa9256D5500Dbd83C84eFa948039089Ec95d02795";
const EXPECTED_CHAIN_ID = 1337n;
const MAX_DISPLAY_POOLS = 100n;

type TokenInfo = {
  address: string;
  symbol: string;
  decimals: number | null;
};

type PoolRow = {
  id: string;
  tokenA: TokenInfo;
  tokenB: TokenInfo;
  reserveA: bigint;
  reserveB: bigint;
  totalShares: bigint;
  createdAt: string;
};

type PoolPreview = {
  tokenA: string;
  tokenB: string;
  pairKey: string;
  symbolA: string;
  symbolB: string;
  predictedId: bigint;
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}

function getBrowserProvider(): BrowserProvider {
  const ethereum = (
    window as Window & { ethereum?: Eip1193Provider }
  ).ethereum;

  if (!ethereum) {
    throw new Error("没有检测到 MetaMask，请先安装或启用钱包。");
  }
  return new BrowserProvider(ethereum);
}

async function verifiedProvider(): Promise<BrowserProvider> {
  const provider = getBrowserProvider();
  const network = await provider.getNetwork();

  if (network.chainId !== EXPECTED_CHAIN_ID) {
    throw new Error("当前不是 Ganache Chain ID 1337，请先切换网络。");
  }

  if ((await provider.getCode(DEX_ADDRESS)) === "0x") {
    throw new Error("当前网络上找不到已知 MiniDEX 合约；不要重新部署或猜地址。");
  }
  return provider;
}

// Solidity 使用 keccak256(abi.encode(sortedToken0, sortedToken1))。
// 注意这里是 abi.encode，而不是 solidityPacked。
function makePairKey(tokenA: string, tokenB: string): string {
  const [token0, token1] =
    BigInt(tokenA) < BigInt(tokenB)
      ? [tokenA, tokenB]
      : [tokenB, tokenA];

  return keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ["address", "address"],
      [token0, token1]
    )
  );
}

async function tokenInfo(
  provider: BrowserProvider,
  address: string,
  requireValid = false
): Promise<TokenInfo> {
  const code = await provider.getCode(address);

  if (code === "0x") {
    throw new Error(`地址 ${address} 没有合约代码，不是已部署的 ERC20。`);
  }

  const token = new Contract(address, ERC20_ABI, provider);

  // 与 MiniDEX._isERC20 的实际检查保持一致：合约代码 + totalSupply()。
  try {
    await token.totalSupply();
  } catch {
    throw new Error(`${address} 无法读取 totalSupply()，不能用于建池。`);
  }

  let symbol = "未知符号";
  try {
    symbol = String(await token.symbol());
  } catch {
    // symbol 是可选的展示信息，不用它推断代币有效性。
  }

  let decimals: number | null = null;
  try {
    const readDecimals = Number(await token.decimals());
    if (Number.isInteger(readDecimals) && readDecimals >= 0 && readDecimals <= 255) {
      decimals = readDecimals;
    }
  } catch {
    // 无 decimals 时仅显示原始单位，避免默认按 18 位误导用户。
  }

  if (requireValid && !isAddress(address)) {
    throw new Error("代币地址格式错误。");
  }

  return { address, symbol, decimals };
}

function amountLabel(amount: bigint, token: TokenInfo): string {
  return token.decimals === null
    ? `${amount.toString()}（原始单位）`
    : `${formatUnits(amount, token.decimals)} ${token.symbol}`;
}

function PoolManager() {
  const [poolRows, setPoolRows] = useState<PoolRow[]>([]);
  const [listStatus, setListStatus] = useState("尚未读取池列表");
  const [tokenAInput, setTokenAInput] = useState<string>(TKA_ADDRESS);
  const [tokenBInput, setTokenBInput] = useState<string>(TKB_ADDRESS);
  const [preview, setPreview] = useState<PoolPreview | null>(null);
  const [previewStatus, setPreviewStatus] = useState("尚未预检");
  const [transactionStatus, setTransactionStatus] = useState(
    "正式建池交易已锁定，未发送任何交易。"
  );
  const [busy, setBusy] = useState(false);
  const createLock = useRef(false);

  function changeTokenA(value: string) {
    setTokenAInput(value);
    setPreview(null);
    setPreviewStatus("地址已修改，请重新预检。");
  }

  function changeTokenB(value: string) {
    setTokenBInput(value);
    setPreview(null);
    setPreviewStatus("地址已修改，请重新预检。");
  }

  async function readPools() {
    setBusy(true);
    setListStatus("正在只读查询所有池...");
    try {
      const provider = await verifiedProvider();
      const dex = new Contract(DEX_ADDRESS, MINIDEX_ABI, provider);
      const count: bigint = await dex.poolCount();

      if (count > MAX_DISPLAY_POOLS) {
        throw new Error(
          `当前共有 ${count.toString()} 个池，超过本页一次读取的上限 100；请停止并告知我。`
        );
      }

      const rows: PoolRow[] = [];
      for (let id = 1n; id <= count; id++) {
        const pool = await dex.pools(id);
        if (pool.tokenA === "0x0000000000000000000000000000000000000000") {
          throw new Error(`Pool ${id.toString()} 不存在，停止显示。`);
        }

        const [a, b] = await Promise.all([
          tokenInfo(provider, pool.tokenA),
          tokenInfo(provider, pool.tokenB),
        ]);

        rows.push({
          id: id.toString(),
          tokenA: a,
          tokenB: b,
          reserveA: pool.reserveA,
          reserveB: pool.reserveB,
          totalShares: pool.totalShares,
          createdAt: new Date(
            Number(pool.createdTimestamp) * 1000
          ).toLocaleString("zh-CN"),
        });
      }

      setPoolRows(rows);
      setListStatus(`只读完成：共 ${count.toString()} 个池。未发送交易。`);
    } catch (error) {
      setPoolRows([]);
      setListStatus(`读取失败：${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function checkPoolCreation() {
    setBusy(true);
    setPreview(null);
    setPreviewStatus("正在验证地址、ERC20 接口与重复币对...");
    try {
      const provider = await verifiedProvider();
      const aRaw = tokenAInput.trim();
      const bRaw = tokenBInput.trim();

      if (!isAddress(aRaw) || !isAddress(bRaw)) {
        throw new Error("两个输入都必须是合法的 0x ERC20 合约地址。");
      }

      const a = getAddress(aRaw);
      const b = getAddress(bRaw);
      if (a.toLowerCase() === b.toLowerCase()) {
        throw new Error("两种代币地址不能相同。");
      }

      const [infoA, infoB] = await Promise.all([
        tokenInfo(provider, a, true),
        tokenInfo(provider, b, true),
      ]);

      const dex = new Contract(DEX_ADDRESS, MINIDEX_ABI, provider);
      const pairKey = makePairKey(a, b);
      const existingId: bigint = await dex.poolIdByPair(pairKey);
      if (existingId !== 0n) {
        setPreviewStatus(
          `该币对已存在：Pool ${existingId.toString()}。反向输入也属于同一币对，不能重复创建。未发送交易。`
        );
        return;
      }

      const count: bigint = await dex.poolCount();
      const predictedId = count + 1n;

      // eth_call 静态模拟：执行 createPool 的检查，但绝不会写入链上状态。
      const staticId: bigint =
        await dex.getFunction("createPool(address,address)").staticCall(a, b);

      if (staticId !== predictedId) {
        throw new Error("模拟结果与 poolCount 不一致；请停止，勿发交易。");
      }

      setPreview({
        tokenA: a,
        tokenB: b,
        pairKey,
        symbolA: infoA.symbol,
        symbolB: infoB.symbol,
        predictedId,
      });

      setPreviewStatus(
        `预检通过：${infoA.symbol} / ${infoB.symbol} 可创建新池；` +
        `当前预计新池编号为 ${predictedId.toString()}。` +
        ` 仅执行 eth_call 模拟，未创建池、未发送交易。`
      );
    } catch (error) {
      setPreviewStatus(`预检未通过：${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  }

  // 此函数在代码中预先完成，但本阶段的禁用开关阻止进入钱包/交易流程。
  async function createPoolAfterAuthorization() {
    if (!ENABLE_REAL_POOL_CREATION) {
      setTransactionStatus("正式建池仍锁定：本轮只做只读预检。");
      return;
    }
    if (createLock.current || !preview) return;
    if (
      preview.tokenA.toLowerCase() !== TKA_ADDRESS.toLowerCase() ||
      preview.tokenB.toLowerCase() !== APPROVED_TKC_ADDRESS.toLowerCase() ||
      preview.predictedId !== 2n
    ) {
      setTransactionStatus("Only the authorized TKA/TKC Pool 2 is permitted.");
      return;
    }

    createLock.current = true;
    setBusy(true);
    let txHash: string | null = null;
    try {
      const provider = await verifiedProvider();
      const accounts: string[] = await provider.send("eth_requestAccounts", []);
      if (accounts.length === 0) throw new Error("未连接钱包账户。");

      const signer = await provider.getSigner();
      const wallet = await signer.getAddress();
      if (wallet.toLowerCase() !== APPROVED_LP_ADDRESS.toLowerCase()) {
        throw new Error("Only Ganache Account 0 may create this pool.");
      }
      if (wallet.toLowerCase() !== accounts[0].toLowerCase()) {
        throw new Error("当前钱包账户发生变化。");
      }

      // 重新核验，不能把过时的前端预览当作链上现状。
      if (
        tokenAInput.trim().toLowerCase() !== preview.tokenA.toLowerCase() ||
        tokenBInput.trim().toLowerCase() !== preview.tokenB.toLowerCase()
      ) {
        throw new Error("代币输入已变化，请重新预检。");
      }

      const dex = new Contract(DEX_ADDRESS, MINIDEX_ABI, signer);
      const oldId: bigint = await dex.poolIdByPair(preview.pairKey);
      const newCount: bigint = await dex.poolCount();

      if (oldId !== 0n || newCount + 1n !== preview.predictedId) {
        throw new Error("链上币对或池数量发生变化，请重新预检。");
      }

      const method = dex.getFunction("createPool(address,address)");
      const staticId: bigint = await method.staticCall(
        preview.tokenA,
        preview.tokenB
      );
      if (staticId !== preview.predictedId) {
        throw new Error("发送前静态模拟编号不一致。");
      }
      await method.estimateGas(preview.tokenA, preview.tokenB);

      const confirmed = window.confirm(
        `将真实创建 AMM 池（会产生链上交易）\n` +
        `网络：Ganache 1337\n` +
        `钱包：${wallet}\n` +
        `Token A：${preview.tokenA}\n` +
        `Token B：${preview.tokenB}\n` +
        `预计 Pool ID：${preview.predictedId.toString()}\n` +
        `请确认是否发送真实交易。`
      );
      if (!confirmed) {
        setTransactionStatus("已取消，没有发送创建池交易。");
        return;
      }

      // MetaMask 打开期间如果切换了账户/网络，停止。
      const current = await verifiedProvider();
      if (
        (await (await current.getSigner()).getAddress()).toLowerCase() !==
        wallet.toLowerCase()
      ) {
        throw new Error("钱包账户已切换，未发送交易。");
      }
      if ((await dex.poolIdByPair(preview.pairKey)) !== 0n) {
        throw new Error("该币对刚刚被创建，请刷新池列表，不能重试。");
      }

      const tx = await method(preview.tokenA, preview.tokenB);
      txHash = tx.hash;
      setTransactionStatus(`已广播交易 ${txHash}，不要重复点击。`);

      const receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) {
        throw new Error("未取得成功回执，请核对交易哈希，切勿盲目重试。");
      }

      const createdId: bigint = await dex.poolIdByPair(preview.pairKey);
      if (createdId === 0n) {
        throw new Error("回执成功，但池映射仍为零，请人工核对交易。");
      }

      setTransactionStatus(
        `建池回执成功；Pool ${createdId.toString()}；交易：${receipt.hash}。`
      );
      setPreview(null);
      await readPools();
    } catch (error) {
      setTransactionStatus(
        `${txHash ? `已有交易哈希 ${txHash}；` : ""}` +
        `${errorText(error)}。${txHash ? "不要重发，先检查回执。" : "未确认成功，请核对钱包/链上状态。"}`
      );
    } finally {
      createLock.current = false;
      setBusy(false);
    }
  }

  return (
    <section style={{ border: "1px solid #d7d7d7", borderRadius: 12, padding: 18 }}>
      <h2>AMM 交易池管理（新增）</h2>
      <p>
        本模块只读浏览所有池，预检新 ERC20 币对。
        现阶段真实建池按钮锁定；不会影响 Pool 1 或 NFT #4。
      </p>

      <h3>1. 查看已有交易池</h3>
      <button type="button" disabled={busy} onClick={readPools}>
        {busy ? "正在处理…" : "读取所有池（只读）"}
      </button>
      <p role="status">{listStatus}</p>

      {poolRows.map((pool) => (
        <div key={pool.id} style={{ padding: 12, marginBottom: 12, background: "#f6f7f8" }}>
          <strong>Pool {pool.id} — {pool.tokenA.symbol} / {pool.tokenB.symbol}</strong>
          <div>Token A：{pool.tokenA.address}</div>
          <div>Token B：{pool.tokenB.address}</div>
          <div>Reserve A：{amountLabel(pool.reserveA, pool.tokenA)}</div>
          <div>Reserve B：{amountLabel(pool.reserveB, pool.tokenB)}</div>
          <div>Total shares（原始单位）：{pool.totalShares.toString()}</div>
          <div>创建时间（本地时区）：{pool.createdAt}</div>
        </div>
      ))}

      <hr />

      <h3>2. 输入代币地址并预检创建</h3>
      <p>示例默认是已有的 TKA/TKB；预检应提示它已经是 Pool 1。</p>
      <label style={{ display: "block", marginBottom: 10 }}>
        ERC20 Token A 地址
        <input
          type="text"
          value={tokenAInput}
          onChange={(e) => changeTokenA(e.target.value)}
          disabled={busy}
          style={{ display: "block", width: "100%", boxSizing: "border-box" }}
        />
      </label>

      <label style={{ display: "block", marginBottom: 10 }}>
        ERC20 Token B 地址
        <input
          type="text"
          value={tokenBInput}
          onChange={(e) => changeTokenB(e.target.value)}
          disabled={busy}
          style={{ display: "block", width: "100%", boxSizing: "border-box" }}
        />
      </label>

      <button type="button" disabled={busy} onClick={checkPoolCreation}>
        {busy ? "预检中…" : "检查 ERC20 与重复池（只读）"}
      </button>
      <p role="status">{previewStatus}</p>

      {preview && (
        <p>
          已通过模拟：{preview.symbolA} / {preview.symbolB}；
          预计 Pool {preview.predictedId.toString()}。
          这不是已完成的创建交易。
        </p>
      )}

      <button
        type="button"
        disabled={
          !ENABLE_REAL_POOL_CREATION ||
          !preview ||
          busy ||
          preview.tokenA.toLowerCase() !== TKA_ADDRESS.toLowerCase() ||
          preview.tokenB.toLowerCase() !== APPROVED_TKC_ADDRESS.toLowerCase() ||
          preview.predictedId !== 2n
        }
        onClick={createPoolAfterAuthorization}
      >
        创建新 AMM 池（当前锁定，不发送交易）
      </button>
      <p role="status">{transactionStatus}</p>
      <p style={{ color: "#555" }}>
        注意：即使将来新建池成功，新池也最初为零储备；
        旧的 Pool 1 专用 Swap / 添加流动性按钮不会自动切换到新池。
      </p>
    </section>
  );
}

export default PoolManager;
