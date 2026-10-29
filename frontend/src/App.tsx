
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import "./App.css";
import {
  BrowserProvider,
  Contract,
  formatUnits,
  parseUnits,
  isError,
} from "ethers";
import type { Eip1193Provider } from "ethers";
import { DEX_ADDRESS, TKA_ADDRESS, TKB_ADDRESS, TKC_ADDRESS, POOL_ID } from "./contracts";
import { ERC20_ABI, MINIDEX_ABI } from "./abi";
import PoolManager from "./PoolManager";
import PoolExplorer from "./PoolExplorer";
import Pool2Liquidity from "./Pool2Liquidity";
import PoolSources from "./PoolSources";
import Pool2Redeem from "./Pool2Redeem";

const LP_ADDRESS = "0xa9256D5500Dbd83C84eFa948039089Ec95d02795";
const EXPECTED_CHAIN_ID = 1337n;

// 安全开关：本轮保持 false，不允许通过网页发送赎回交易。
// 后续确认准备就绪后，才考虑单独解锁。
const ENABLE_REAL_REDEEM = false;
const REDEEM_TX_KEY = "minidex:1337:pool1:nft4:redeemTx";
const TRADER_ADDRESS = "0xAd5D0A23Aaf8184B841406065f8ecb6ACaF6B171";

type View = {
  balanceA: string;
  balanceB: string;
  reserveA: string;
  reserveB: string;
};


type WorkspaceView = "overview" | "swap" | "pools" | "liquidity" | "nfts" | "evidence";
type IconName = "grid" | "arrows" | "layers" | "droplet" | "hex" | "shield" | "wallet" | "arrow" | "refresh" | "sparkles";

function WorkspaceIcon({ name, size = 19 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  const shapes: Record<IconName, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/></>,
    arrows: <><path d="M4 7h16m-5-4 5 4-5 4"/><path d="M20 17H4m5-4-5 4 5 4"/></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>,
    droplet: <path d="M12 3C10 7 5 12 5 16a7 7 0 0 0 14 0c0-4-5-9-7-13Z"/>,
    hex: <><path d="m12 2 8.5 5v10L12 22l-8.5-5V7L12 2Z"/><path d="m8 9 4-2 4 2v5l-4 2-4-2V9Z"/></>,
    shield: <><path d="m12 2 9 4v6c0 5-3.5 8-9 10-5.5-2-9-5-9-10V6l9-4Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/></>,
    wallet: <><rect x="3" y="6" width="18" height="15" rx="3"/><path d="M4 9V6a3 3 0 0 1 3-3h12"/><path d="M16 13h5v4h-5a2 2 0 0 1 0-4Z"/></>,
    arrow: <><path d="M4 12h16m-6-6 6 6-6 6"/></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5 9a8 8 0 0 1 14-2l1 5M4 12l1 5a8 8 0 0 0 14-2"/></>,
    sparkles: <><path d="m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2ZM19 17l.7 2.3L22 20l-2.3.7L19 23l-.7-2.3L16 20l2.3-.7L19 17Z"/></>,
  };
  return <svg {...common}>{shapes[name]}</svg>;
}

function shorten(value: string, start = 7, end = 5) {
  return value.length > start + end + 3 ? `${value.slice(0, start)}…${value.slice(-end)}` : value;
}

function conciseAmount(value: string | undefined) {
  if (!value) return "—";
  const [integer, decimal] = value.split(".");
  return decimal && decimal.replace(/0/g, "") ? `${integer}.${decimal.slice(0, 4)}` : integer;
}

const NAV_ITEMS: { id: WorkspaceView; title: string; caption: string; icon: IconName }[] = [
  { id: "overview", title: "总览仪表盘", caption: "Overview", icon: "grid" },
  { id: "swap", title: "代币兑换", caption: "Swap & quotes", icon: "arrows" },
  { id: "pools", title: "交易池", caption: "Pool explorer", icon: "layers" },
  { id: "liquidity", title: "流动性", caption: "Liquidity", icon: "droplet" },
  { id: "nfts", title: "LP NFT 仓位", caption: "Positions & audit", icon: "hex" },
  { id: "evidence", title: "验证与安全", caption: "Lab evidence", icon: "shield" },
];

function App() {
  const [activeView, setActiveView] = useState<WorkspaceView>("overview");
  const [address, setAddress] = useState("");
  const [chainId, setChainId] = useState("");
  const [status, setStatus] = useState("尚未连接钱包");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<View | null>(null);
  const [amountA, setAmountA] = useState("100");
  const [amountB, setAmountB] = useState("100");
  const [nftInfo, setNftInfo] = useState("");
  const [positionInfo, setPositionInfo] = useState("尚未查询");
  const [redeemCheck, setRedeemCheck] = useState("尚未检查");
  const [redeemBusy, setRedeemBusy] = useState(false);
  const redeemLock = useRef(false);
  const [swapAmount, setSwapAmount] = useState("10");
  const [swapResult, setSwapResult] = useState("");
  const [swapPoolId, setSwapPoolId] = useState<1 | 2>(1);
  const [swapReverse, setSwapReverse] = useState(false);
  const [swapQuote, setSwapQuote] = useState("");
  const swapPair = swapPoolId === 1
    ? { a: "TKA", b: "TKB", aAddress: TKA_ADDRESS, bAddress: TKB_ADDRESS }
    : { a: "TKA", b: "TKC", aAddress: TKA_ADDRESS, bAddress: TKC_ADDRESS };
  const swapInSymbol = swapReverse ? swapPair.b : swapPair.a;
  const swapOutSymbol = swapReverse ? swapPair.a : swapPair.b;
  const swapInAddress = swapReverse ? swapPair.bAddress : swapPair.aAddress;
  const swapOutAddress = swapReverse ? swapPair.aAddress : swapPair.bAddress;

  async function previewSwap() {
    setSwapQuote("");
    try {
      const provider = getProvider();
      const network = await provider.getNetwork();
      if (network.chainId !== EXPECTED_CHAIN_ID) throw new Error("请切换到 Ganache 1337");
      const dex = new Contract(DEX_ADDRESS, MINIDEX_ABI, provider);
      const pool = await dex.pools(BigInt(swapPoolId));
      if (pool.tokenA.toLowerCase() !== swapPair.aAddress.toLowerCase() ||
          pool.tokenB.toLowerCase() !== swapPair.bAddress.toLowerCase()) {
        throw new Error("交易池代币地址不匹配");
      }
      const amountIn = parseUnits(swapAmount, 18);
      if (amountIn <= 0n) throw new Error("兑换数量必须大于0");
      const reserveIn: bigint = swapReverse ? pool.reserveB : pool.reserveA;
      const reserveOut: bigint = swapReverse ? pool.reserveA : pool.reserveB;
      if (reserveIn <= 0n || reserveOut <= 0n) throw new Error("交易池流动性不足");
      const feeIn = amountIn * 997n;
      const expected = feeIn * reserveOut / (reserveIn * 1000n + feeIn);
      if (expected <= 0n) throw new Error("预计输出为0");
      setSwapQuote(`预计收到 ${formatUnits(expected, 18)} ${swapOutSymbol}；1%滑点下限 ${formatUnits(expected * 99n / 100n, 18)} ${swapOutSymbol}（只读报价）`);
    } catch (e) {
      setSwapQuote(e instanceof Error ? `报价失败：${e.message}` : "报价失败");
    }
  }

  function getProvider() {
    const ethereum = (
      window as Window & { ethereum?: Eip1193Provider }
    ).ethereum;

    if (!ethereum) throw new Error("未检测到 MetaMask");
    return new BrowserProvider(ethereum);
  }

  async function connectedAccount() {
    const provider = getProvider();
    await provider.send("eth_requestAccounts", []);

    const network = await provider.getNetwork();

    if (network.chainId !== EXPECTED_CHAIN_ID) {
      throw new Error(
        "请先在 MetaMask 切换到 Ganache（Chain ID 1337）"
      );
    }

    const signer = await provider.getSigner();

    return {
      provider,
      signer,
      wallet: await signer.getAddress(),
      network,
    };
  }

  async function readData() {
    setLoading(true);
    setData(null);
    setPositionInfo("正在读取 NFT #4 的最新链上状态…");
    setRedeemCheck("请针对当前钱包重新执行只读安全检查。");

    try {
      const { provider, wallet, network } =
        await connectedAccount();

      setAddress(wallet);
      setChainId(network.chainId.toString());

      const a = new Contract(
        TKA_ADDRESS, ERC20_ABI, provider
      );
      const b = new Contract(
        TKB_ADDRESS, ERC20_ABI, provider
      );
      const dex = new Contract(
        DEX_ADDRESS, MINIDEX_ABI, provider
      );

      const [balA, balB, pool] = await Promise.all([
        a.balanceOf(wallet),
        b.balanceOf(wallet),
        dex.pools(POOL_ID),
      ]);

      if (
        pool.tokenA.toLowerCase() !==
        TKA_ADDRESS.toLowerCase() ||
        pool.tokenB.toLowerCase() !==
        TKB_ADDRESS.toLowerCase()
      ) {
        throw new Error("Pool 1 的代币地址不匹配");
      }

      setData({
        balanceA: formatUnits(balA, 18),
        balanceB: formatUnits(balB, 18),
        reserveA: formatUnits(pool.reserveA, 18),
        reserveB: formatUnits(pool.reserveB, 18),
      });

      // 只读查询 NFT #4，不执行任何链上交易
      try {
        const owner: string = await dex.ownerOf(4n);
        const position = await dex.positions(4n);

        // 判断 NFT #4 是否属于 Account 0
        const isLP =
          owner.toLowerCase() === LP_ADDRESS.toLowerCase();

        // 检查 NFT 是否属于 Pool 1
        if (position.poolId !== POOL_ID) {
          throw new Error("NFT #4 不属于 Pool 1");
        }

        // 检查交易池是否有流动性
        if (pool.totalShares === 0n) {
          throw new Error("交易池总份额为零，无法计算赎回数量");
        }

        // 按流动性份额比例计算预计赎回数量
        const estimatedA =
          (pool.reserveA * position.shares) / pool.totalShares;

        const estimatedB =
          (pool.reserveB * position.shares) / pool.totalShares;

        // 在页面显示 NFT 信息及赎回预估
        setPositionInfo(
          `NFT #4 | 持有人：${owner} | ` +
          `所属池：${position.poolId.toString()} | ` +
          `流动性份额：${formatUnits(position.shares, 18)} | ` +
          `预计赎回 TKA：${formatUnits(estimatedA, 18)} | ` +
          `预计赎回 TKB：${formatUnits(estimatedB, 18)} | ` +
          (isLP
            ? "持有人与 Account 0 一致"
            : "注意：持有人不是 Account 0")
        );
      } catch (err) {
        // 识别 OpenZeppelin ERC721 的 NFT 不存在错误
        const isNonexistentToken =
          isError(err, "CALL_EXCEPTION") &&
          (
            (
              err.revert?.name === "ERC721NonexistentToken" &&
              BigInt(err.revert.args[0].toString()) === 4n
            ) ||
            (
              typeof err.data === "string" &&
              /^0x7e273289[0-9a-fA-F]{64}$/.test(err.data) &&
              BigInt("0x" + err.data.slice(10)) === 4n
            )
          );

        if (isNonexistentToken) {
          setPositionInfo(
            "NFT #4 当前不存在（可能已被销毁）。请核对链上交易记录。"
          );
        } else {
          setPositionInfo(
            `NFT #4 查询失败，请检查网络、合约或其他错误：${err instanceof Error ? err.message : "未知错误"
            }`
          );
        }
      }

      setStatus("链上数据读取成功");
    } catch (e) {
      setStatus(
        e instanceof Error ? e.message : "读取失败"
      );
    } finally {
      setLoading(false);
    }
  }

  async function addLiquidity() {
    setLoading(true);
    setNftInfo("");

    try {
      const { signer, wallet } = await connectedAccount();

      if (
        wallet.toLowerCase() !== LP_ADDRESS.toLowerCase()
      ) {
        throw new Error(
          "请切换到 Ganache Account 0（LP）后再操作"
        );
      }

      const rawA = parseUnits(amountA, 18);
      const rawB = parseUnits(amountB, 18);

      if (rawA <= 0n || rawB <= 0n) {
        throw new Error("输入数量必须大于 0");
      }

      const dex = new Contract(
        DEX_ADDRESS, MINIDEX_ABI, signer
      );
      const a = new Contract(
        TKA_ADDRESS, ERC20_ABI, signer
      );
      const b = new Contract(
        TKB_ADDRESS, ERC20_ABI, signer
      );

      const pool = await dex.pools(POOL_ID);

      if (
        pool.tokenA.toLowerCase() !==
        TKA_ADDRESS.toLowerCase() ||
        pool.tokenB.toLowerCase() !==
        TKB_ADDRESS.toLowerCase()
      ) {
        throw new Error("交易池的代币地址不匹配");
      }

      if (
        pool.reserveA !== 0n ||
        pool.reserveB !== 0n ||
        pool.totalShares !== 0n
      ) {
        throw new Error(
          "本次仅测试空池首次添加；当前池子非空，已停止"
        );
      }

      const [balA, balB] = await Promise.all([
        a.balanceOf(wallet),
        b.balanceOf(wallet),
      ]);

      if (balA < rawA || balB < rawB) {
        throw new Error("代币余额不足");
      }

      // 授权 TKA
      if (
        (await a.allowance(wallet, DEX_ADDRESS)) < rawA
      ) {
        setStatus("请在 MetaMask 中确认 TKA 授权");

        const tx = await a.approve(DEX_ADDRESS, rawA);
        const receipt = await tx.wait();

        if (!receipt || receipt.status !== 1) {
          throw new Error("TKA 授权失败");
        }
      }

      // 授权 TKB
      if (
        (await b.allowance(wallet, DEX_ADDRESS)) < rawB
      ) {
        setStatus("请在 MetaMask 中确认 TKB 授权");

        const tx = await b.approve(DEX_ADDRESS, rawB);
        const receipt = await tx.wait();

        if (!receipt || receipt.status !== 1) {
          throw new Error("TKB 授权失败");
        }
      }

      // 添加流动性并铸造 NFT
      setStatus("请在 MetaMask 中确认添加流动性交易");

      const tokenId = await dex.nextTokenId();

      const tx = await dex.addLiquidity(
        POOL_ID, rawA, rawB
      );
      const receipt = await tx.wait();

      if (!receipt || receipt.status !== 1) {
        throw new Error("添加流动性交易失败");
      }

      // 检查 NFT
      const owner = await dex.ownerOf(tokenId);
      const position = await dex.positions(tokenId);

      if (
        owner.toLowerCase() !== wallet.toLowerCase() ||
        position.poolId !== POOL_ID
      ) {
        throw new Error(
          "交易已确认，但 NFT 验证未通过，请先检查链上状态，不要重复添加"
        );
      }

      setNftInfo(
        `NFT #${tokenId.toString()}，份额 ${formatUnits(position.shares, 18)}，持有人 ${owner}`
      );

      setStatus(
        "流动性添加成功，NFT 已铸造！请点击刷新数据查看余额"
      );
    } catch (e) {
      setStatus(
        e instanceof Error
          ? `操作停止：${e.message}`
          : "操作失败"
      );
    } finally {
      setLoading(false);
    }
  }

  async function swapTokens() {
    setLoading(true);
    setSwapResult("");
    setSwapQuote("");
    try {
      const { signer, wallet } = await connectedAccount();
      if (wallet.toLowerCase() !== TRADER_ADDRESS.toLowerCase()) {
        throw new Error("请切换到 Ganache Account 1（Trader）后再兑换");
      }
      const amountIn = parseUnits(swapAmount, 18);
      if (amountIn <= 0n) throw new Error("兑换数量必须大于0");
      const dex = new Contract(DEX_ADDRESS, MINIDEX_ABI, signer);
      const inputToken = new Contract(swapInAddress, ERC20_ABI, signer);
      const outputToken = new Contract(swapOutAddress, ERC20_ABI, signer);
      const pool = await dex.pools(BigInt(swapPoolId));
      if (pool.tokenA.toLowerCase() !== swapPair.aAddress.toLowerCase() ||
          pool.tokenB.toLowerCase() !== swapPair.bAddress.toLowerCase()) {
        throw new Error("交易池代币地址不匹配，拒绝交易");
      }
      const reserveIn: bigint = swapReverse ? pool.reserveB : pool.reserveA;
      const reserveOut: bigint = swapReverse ? pool.reserveA : pool.reserveB;
      if (reserveIn <= 0n || reserveOut <= 0n) throw new Error("交易池没有流动性");
      if ((await inputToken.balanceOf(wallet)) < amountIn) {
        throw new Error(`${swapInSymbol} 余额不足`);
      }
      const feeIn = amountIn * 997n;
      const expectedOut = feeIn * reserveOut / (reserveIn * 1000n + feeIn);
      const minAmountOut = expectedOut * 99n / 100n;
      if (minAmountOut <= 0n) throw new Error("最低输出数量为零");
      setStatus(`预计收到 ${formatUnits(expectedOut, 18)} ${swapOutSymbol}`);
      if ((await inputToken.allowance(wallet, DEX_ADDRESS)) < amountIn) {
        setStatus(`请在 MetaMask 中确认 ${swapInSymbol} 授权`);
        const approveTx = await inputToken.approve(DEX_ADDRESS, amountIn);
        const approveReceipt = await approveTx.wait();
        if (!approveReceipt || approveReceipt.status !== 1) throw new Error("代币授权失败");
      }
      const latestPool = await dex.pools(BigInt(swapPoolId));
      if (latestPool.tokenA.toLowerCase() !== swapPair.aAddress.toLowerCase() ||
          latestPool.tokenB.toLowerCase() !== swapPair.bAddress.toLowerCase() ||
          latestPool.reserveA !== pool.reserveA || latestPool.reserveB !== pool.reserveB) {
        throw new Error("池配置或储备已变化，请重新报价");
      }
      const balanceBefore: bigint = await outputToken.balanceOf(wallet);
      setStatus(`请在 MetaMask 中确认 Pool ${swapPoolId} Swap`);
      const tx = await dex.swap(BigInt(swapPoolId), swapInAddress, amountIn, minAmountOut);
      const receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) throw new Error("Swap交易失败");
      const balanceAfter: bigint = await outputToken.balanceOf(wallet);
      setSwapResult(`兑换成功！实际收到 ${formatUnits(balanceAfter - balanceBefore, 18)} ${swapOutSymbol}。交易哈希：${receipt.hash}`);
      await readData();
    } catch (e) {
      setStatus(e instanceof Error ? `Swap 停止：${e.message}` : "Swap 操作失败");
    } finally {
      setLoading(false);
    }
  }

  async function checkRedeemSafety() {
    setRedeemCheck("正在读取链上状态…");

    try {
      const { provider, signer, wallet } = await connectedAccount();

      // 1. 必须使用 Account 0
      if (wallet.toLowerCase() !== LP_ADDRESS.toLowerCase()) {
        throw new Error("当前钱包不是 Account 0（LP）");
      }

      const dex = new Contract(
        DEX_ADDRESS,
        MINIDEX_ABI,
        provider
      );

      // 2. 读取 NFT 和交易池状态
      const [owner, position, pool] = await Promise.all([
        dex.ownerOf(4n),
        dex.positions(4n),
        dex.pools(POOL_ID),
      ]);

      // 3. 验证 NFT 所有权
      if (owner.toLowerCase() !== wallet.toLowerCase()) {
        throw new Error("NFT #4 不属于当前钱包");
      }

      // 4. 验证 NFT 所属交易池
      if (position.poolId !== POOL_ID) {
        throw new Error("NFT #4 所属池不匹配");
      }

      // 5. 验证交易池代币
      if (
        pool.tokenA.toLowerCase() !== TKA_ADDRESS.toLowerCase() ||
        pool.tokenB.toLowerCase() !== TKB_ADDRESS.toLowerCase()
      ) {
        throw new Error("交易池代币地址不匹配");
      }

      // 6. 验证流动性份额
      if (
        pool.totalShares <= 0n ||
        position.shares <= 0n ||
        position.shares > pool.totalShares
      ) {
        throw new Error("流动性份额不合理");
      }

      // 7. 计算当前预计赎回数量
      // 将智能合约返回的整数统一转换为 bigint
      const reserveA = BigInt(pool.reserveA.toString());
      const reserveB = BigInt(pool.reserveB.toString());
      const shares = BigInt(position.shares.toString());
      const totalShares = BigInt(pool.totalShares.toString());

      // 防止除以零
      if (totalShares === 0n) {
        throw new Error("交易池总份额为零");
      }

      // 计算预计赎回数量
      const amountA = (reserveA * shares) / totalShares;
      const amountB = (reserveB * shares) / totalShares;

      // 1% 滑点保护：最低接收数量
      const minAmountA = (amountA * 99n) / 100n;
      const minAmountB = (amountB * 99n) / 100n;

      if (amountA <= 0n || amountB <= 0n) {
        throw new Error("预计赎回数量不能为零");
      }
      // 使用当前 LP 账户模拟赎回
      // staticCall 不会发送真实交易，也不会销毁 NFT
      const dexAsLP = new Contract(
        DEX_ADDRESS,
        MINIDEX_ABI,
        signer
      );

      // 检查 ABI 是否包含 removeLiquidity
      const redeemMethod = dexAsLP.getFunction(
        "removeLiquidity(uint256,uint256,uint256)"
      );

      // 只读模拟 NFT #4 的赎回
      await redeemMethod.staticCall(
        4n,
        minAmountA,
        minAmountB
      );

      // 只估算 Gas，不发送交易
      const estimatedGas = await redeemMethod.estimateGas(
        4n,
        minAmountA,
        minAmountB
      );

      setRedeemCheck(
        `只读检查通过：NFT #4 属于 LP。` +
        `预计赎回 ${formatUnits(amountA, 18)} TKA 和 ` +
        `${formatUnits(amountB, 18)} TKB。` +
        `滑点容忍度：1%。` +
        `最低接收 ${formatUnits(minAmountA, 18)} TKA 和 ` +
        `${formatUnits(minAmountB, 18)} TKB。` +
        `合约模拟赎回通过。` +
        `预计 Gas：${estimatedGas.toString()}。` +
        `未发起任何交易。`
      );
    } catch (error) {
      setRedeemCheck(
        `检查未通过：${error instanceof Error ? error.message : "未知错误"
        }`
      );
    }
  }


  // 赎回交易准备：全程保持锁定。只有经独立审查并明确授权后才能启用。
  // 浏览器记录用于提醒与辅助阻止重试，不是链上交易完成的证据。
  async function redeemLiquidity() {
    if (!ENABLE_REAL_REDEEM) {
      setRedeemCheck("正式赎回仍锁定；NFT #4 未发生赎回交易。");
      return;
    }
    if (redeemLock.current) return;
    redeemLock.current = true;
    setRedeemBusy(true);
    setRedeemCheck("正在重新检查链上状态…");

    let submittedHash: string | null = null;
    try {
      const { provider, signer, wallet, network } = await connectedAccount();
      if (wallet.toLowerCase() !== LP_ADDRESS.toLowerCase() ||
          network.chainId !== EXPECTED_CHAIN_ID) {
        throw new Error("仅允许 Ganache 1337 上的 Account 0（LP）操作");
      }
      // 只要存在历史记录（含钱包确认阶段），就需要先人工核查。
      if (window.localStorage.getItem(REDEEM_TX_KEY) !== null) {
        throw new Error("存在赎回尝试记录；先核对回执和链上 NFT，不允许重试");
      }

      const dex = new Contract(DEX_ADDRESS, MINIDEX_ABI, signer);
      const [owner, position, pool] = await Promise.all([
        dex.ownerOf(4n), dex.positions(4n), dex.pools(POOL_ID),
      ]);
      if (owner.toLowerCase() !== wallet.toLowerCase() ||
          position.poolId !== POOL_ID ||
          pool.tokenA.toLowerCase() !== TKA_ADDRESS.toLowerCase() ||
          pool.tokenB.toLowerCase() !== TKB_ADDRESS.toLowerCase()) {
        throw new Error("NFT 所有权、池编号或代币地址不匹配");
      }
      const shares = BigInt(position.shares.toString());
      const totalShares = BigInt(pool.totalShares.toString());
      const reserveA = BigInt(pool.reserveA.toString());
      const reserveB = BigInt(pool.reserveB.toString());
      if (shares <= 0n || totalShares <= 0n || shares > totalShares) {
        throw new Error("流动性份额异常");
      }
      const amountA = reserveA * shares / totalShares;
      const amountB = reserveB * shares / totalShares;
      if (amountA <= 0n || amountB <= 0n) {
        throw new Error("预计赎回数量异常");
      }
      const minAmountA = amountA * 99n / 100n;
      const minAmountB = amountB * 99n / 100n;
      const method = dex.getFunction("removeLiquidity(uint256,uint256,uint256)");
      await method.staticCall(4n, minAmountA, minAmountB);
      await method.estimateGas(4n, minAmountA, minAmountB);

      const confirmed = window.confirm(
        "危险：正式赎回将销毁 NFT #4。\n" +
        `账户：${wallet}\n` +
        `预计收到：${formatUnits(amountA,18)} TKA、${formatUnits(amountB,18)} TKB\n` +
        `最低收到：${formatUnits(minAmountA,18)} TKA、${formatUnits(minAmountB,18)} TKB\n` +
        "只有明确允许销毁 NFT #4，才能确认。"
      );
      if (!confirmed) {
        setRedeemCheck("用户取消，未发送赎回交易。");
        return;
      }
      const latestWallet = await (await provider.getSigner()).getAddress();
      const latestNetwork = await provider.getNetwork();
      if (latestWallet.toLowerCase() !== wallet.toLowerCase() ||
          latestNetwork.chainId !== EXPECTED_CHAIN_ID ||
          (await signer.getAddress()).toLowerCase() !== wallet.toLowerCase()) {
        throw new Error("钱包或网络在确认期间发生变化");
      }

      const [lastOwner, lastPool, lastPosition] = await Promise.all([
        dex.ownerOf(4n), dex.pools(POOL_ID), dex.positions(4n),
      ]);
      if (lastOwner.toLowerCase() !== wallet.toLowerCase() ||
          lastPosition.poolId !== POOL_ID ||
          BigInt(lastPosition.shares.toString()) !== shares ||
          BigInt(lastPool.totalShares.toString()) !== totalShares ||
          BigInt(lastPool.reserveA.toString()) !== reserveA ||
          BigInt(lastPool.reserveB.toString()) !== reserveB ||
          lastPool.tokenA.toLowerCase() !== TKA_ADDRESS.toLowerCase() ||
          lastPool.tokenB.toLowerCase() !== TKB_ADDRESS.toLowerCase()) {
        throw new Error("最新链上状态已变化，请重新检查");
      }
      if (window.localStorage.getItem(REDEEM_TX_KEY) !== null) {
        throw new Error("发现已有赎回尝试记录");
      }

      // 进入钱包阶段后，状态不明时保留记录，禁止自动重试。
      window.localStorage.setItem(REDEEM_TX_KEY, "PENDING_WALLET_CONFIRMATION");
      const tx = await method(4n, minAmountA, minAmountB);
      submittedHash = tx.hash;
      window.localStorage.setItem(REDEEM_TX_KEY, tx.hash);
      setRedeemCheck(`交易已广播：${submittedHash}。请勿再次提交。`);

      const receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) {
        throw new Error("没有成功回执，请人工复查交易状态");
      }
      // 不先宣告“已销毁”：再次读取链上 NFT 状态才能确认。
      const dexRead = new Contract(DEX_ADDRESS, MINIDEX_ABI, provider);
      let missingConfirmed = false;
      try {
        await dexRead.ownerOf(4n);
      } catch (e) {
        missingConfirmed =
          isError(e, "CALL_EXCEPTION") &&
          typeof e.data === "string" &&
          /^0x7e273289[0-9a-fA-F]{64}$/i.test(e.data) &&
          BigInt("0x" + e.data.slice(10)) === 4n;
      }
      // 刷新失败不抹去成功回执；交易记录永久保留，人工核查。
      try {
        await readData();
      } catch {
        // readData 自行报告错误
      }
      setRedeemCheck(
        `交易回执成功：${receipt.hash}。` +
        (missingConfirmed
          ? "链上确认 NFT #4 已不存在。"
          : "NFT #4 销毁状态尚不能确认，请人工核查。") +
        " 已保留交易哈希；禁止重复赎回。"
      );
    } catch (error) {
      const saved = window.localStorage.getItem(REDEEM_TX_KEY);
      const reason = error instanceof Error ? error.message : "未知错误";
      setRedeemCheck(
        submittedHash
          ? `已获得交易哈希 ${submittedHash}，后续处理异常：${reason}。切勿重试。`
          : saved !== null
            ? `存在赎回尝试记录（${saved}），状态不明：${reason}。请核对 MetaMask、Ganache 和链上 NFT；切勿重试。`
            : `未发现提交记录：${reason}。如钱包曾弹窗，请仍先核对链上状态。`
      );
    } finally {
      setRedeemBusy(false);
      redeemLock.current = false;
    }
  }

  // 只读查询记录：特殊值是未知状态，不是错误哈希，更不能自动清除。
  async function checkRedeemReceipt() {
    try {
      const record = window.localStorage.getItem(REDEEM_TX_KEY);
      if (record === null) {
        setRedeemCheck("本浏览器没有赎回记录；不能据此证明链上没有交易。");
        return;
      }
      if (record === "PENDING_WALLET_CONFIRMATION") {
        setRedeemCheck(
          "发现钱包确认阶段记录，无法判断交易是否广播。" +
          "请人工检查 MetaMask、Ganache 与 NFT #4；不要清除记录或重新提交。"
        );
        return;
      }
      if (!/^0x[0-9a-fA-F]{64}$/.test(record)) {
        setRedeemCheck(
          "发现未知格式的赎回记录。为安全起见保留记录，请人工核查。"
        );
        return;
      }
      const { provider } = await connectedAccount();
      const receipt = await provider.getTransactionReceipt(record);
      if (!receipt) {
        setRedeemCheck(`交易 ${record} 暂无回执（状态不明），请勿重试。`);
        return;
      }
      setRedeemCheck(
        receipt.status === 1
          ? `交易 ${record} 回执成功；还需核对 NFT #4 当前链上状态，不要重试。`
          : `交易 ${record} 回执显示失败；请核对 NFT #4，不要自动重试。`
      );
    } catch (error) {
      setRedeemCheck(
        `回执查询异常：${error instanceof Error ? error.message : "未知错误"}。保留记录，禁止盲目重试。`
      );
    }
  }

  // 查询指定 NFT 是否存在，只读，不发送交易
  async function checkRedeemOnChain(tokenId: bigint = 4n) {
    try {
      const { provider, network } = await connectedAccount();

      if (network.chainId !== EXPECTED_CHAIN_ID) {
        throw new Error("网络不匹配");
      }

      const dex = new Contract(
        DEX_ADDRESS,
        MINIDEX_ABI,
        provider
      );

      const owner: string = await dex.ownerOf(tokenId);

      if (owner.toLowerCase() === LP_ADDRESS.toLowerCase()) {
        setRedeemCheck(
          `链上核对成功：NFT #${tokenId} 仍存在，` +
          `持有人是 Account 0（LP）：${owner}。` +
          `未发送交易。`
        );
      } else {
        setRedeemCheck(
          `NFT #${tokenId} 仍存在，持有人：${owner}，` +
          `不是 Account 0。未发送交易。`
        );
      }
    } catch (err) {
      // 精确识别 ERC721NonexistentToken(uint256)
      const encoded =
        isError(err, "CALL_EXCEPTION") &&
          typeof err.data === "string"
          ? err.data
          : null;

      const isMissing =
        encoded !== null &&
        /^0x7e273289[0-9a-fA-F]{64}$/i.test(encoded) &&
        BigInt("0x" + encoded.slice(10)) === tokenId;

      if (isMissing) {
        setRedeemCheck(
          `链上确认：NFT #${tokenId} 不存在` +
          `（已销毁或从未铸造）。未发送交易。`
        );
      } else {
        setRedeemCheck(
          `NFT #${tokenId} 查询异常：${err instanceof Error ? err.message : "未知错误"
          }。不能凭此判断 NFT 已销毁。`
        );
      }
    }
  }

  const isConnected = Boolean(data && address && chainId === "1337");
  const activeTitle = NAV_ITEMS.find((item) => item.id === activeView)?.title ?? "总览仪表盘";

  return (
    <div className="dex-dashboard">
      <aside className="dex-sidebar" aria-label="MiniDEX 主导航">
        <div className="sidebar-brand">
          <div className="brand-mark"><span>M</span><span className="brand-mark-dot" /></div>
          <div className="brand-title"><strong>MiniDEX</strong><span>ON-CHAIN LAB</span></div>
        </div>

        <div className="sidebar-kicker">工作空间 / WORKSPACE</div>
        <nav className="sidebar-nav" aria-label="工作空间导航">
          {NAV_ITEMS.map((item) => (
            <button key={item.id} className={`sidebar-link ${activeView === item.id ? "is-active" : ""}`}
              aria-current={activeView === item.id ? "page" : undefined}
              type="button" onClick={() => setActiveView(item.id)}>
              <span className="sidebar-link-icon"><WorkspaceIcon name={item.icon} /></span>
              <span className="sidebar-link-text"><strong>{item.title}</strong><small>{item.caption}</small></span>
              {activeView === item.id && <span className="nav-active-dot" />}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-network"><span className="pulse-dot" /><span><strong>Ganache 本地网络</strong><small>Chain ID 1337 · 演示环境</small></span></div>
          <p>浙江大学 · 区块链与数字货币<br />第二次课程作业</p>
          <span className="sidebar-version">v1.0 · Demo workspace</span>
        </div>
      </aside>

      <div className="dex-main">
        <header className="dex-topbar">
          <div className="topbar-breadcrumb"><span>MiniDEX</span><span className="crumb-slash">/</span><strong>{activeTitle}</strong></div>
          <div className="topbar-actions">
            <span className="topbar-chain"><span className="tiny-dot" />Local Testnet <b>1337</b></span>
            <span className={`topbar-wallet ${isConnected ? "connected" : ""}`}><WorkspaceIcon name="wallet" size={17}/>{isConnected ? shorten(address) : "钱包未连接"}</span>
          </div>
        </header>

        <main className="dex-content">
          <div className={`connection-feedback ${isConnected ? "is-ready" : ""}`} role="status">
            <span className="connection-bullet" />
            <strong>{isConnected ? "链上读取已就绪" : "钱包 / 网络状态"}</strong>
            <span>{status}</span>
            {address && <span className="connection-address" title={address}>{shorten(address, 10, 7)}</span>}
          </div>
          {activeView === "overview" && <>
            <div className="hero-panel">
              <div className="hero-copy">
                <span className="eyebrow"><WorkspaceIcon name="sparkles" size={16} /> THE DECENTRALIZED LAB</span>
                <h1>MiniDEX 去中心化交易所</h1>
                <p>从代币兑换到 LP NFT，每一步链上操作都有据可查。<br className="desktop-break" />在一个清晰、有序的工作台里探索 AMM。</p>
                <div className="hero-cta">
                  <button className="button-white" type="button" disabled={loading} onClick={readData}>
                    <WorkspaceIcon name="refresh" size={17}/>{loading ? "正在读取…" : "连接钱包并刷新"}
                  </button>
                  <button className="button-ghost-light" type="button" onClick={() => setActiveView("swap")}>
                    开始兑换 <WorkspaceIcon name="arrow" size={17}/>
                  </button>
                </div>
              </div>
              <div className="hero-art" aria-hidden="true"><div className="hero-art-orbit orbit-one"/><div className="hero-art-orbit orbit-two"/><div className="hero-art-inner">M<span>✦</span></div><div className="hero-art-chip chip-a">TKA</div><div className="hero-art-chip chip-b">TKB</div></div>
              <div className="hero-noise" />
            </div>

            <div className="intro-row">
              <div><span className="section-kicker">YOUR PORTFOLIO</span><h2>链上资产概览</h2><p>数据来自当前连接的钱包和 Pool 1；未连接时不展示虚拟余额。</p></div>
              <span className={`snapshot-pill ${isConnected ? "ready" : ""}`}><span className="tiny-dot" />{isConnected ? "已读取链上数据" : "等待钱包连接"}</span>
            </div>

            <div className="metrics-grid">
              <div className="metric-card"><span className="metric-icon mint">₮</span><div className="metric-label">我的 TKA 余额</div><div className="metric-value" title={data?.balanceA}>{conciseAmount(data?.balanceA)} <small>TKA</small></div><div className="metric-foot">Account · Wallet</div></div>
              <div className="metric-card"><span className="metric-icon lavender">◈</span><div className="metric-label">我的 TKB 余额</div><div className="metric-value" title={data?.balanceB}>{conciseAmount(data?.balanceB)} <small>TKB</small></div><div className="metric-foot">Account · Wallet</div></div>
              <div className="metric-card"><span className="metric-icon pale">↗</span><div className="metric-label">Pool 1 · TKA 储备</div><div className="metric-value" title={data?.reserveA}>{conciseAmount(data?.reserveA)} <small>TKA</small></div><div className="metric-foot">Live reserve · Chain 1337</div></div>
              <div className="metric-card"><span className="metric-icon peach">◇</span><div className="metric-label">Pool 1 · TKB 储备</div><div className="metric-value" title={data?.reserveB}>{conciseAmount(data?.reserveB)} <small>TKB</small></div><div className="metric-foot">Live reserve · Chain 1337</div></div>
            </div>

            <div className="overview-grid">
              <section className="info-card journey-card">
                <div className="card-header"><div><span className="section-kicker">EXPLORE MINIDEX</span><h2>探索功能</h2></div><span className="decor-orbit">✳</span></div>
                <div className="quick-links">
                  <button type="button" onClick={() => setActiveView("swap")}><span className="quick-icon indigo"><WorkspaceIcon name="arrows"/></span><span><strong>Swap · 代币兑换</strong><small>查看报价、滑点及链上兑换</small></span><WorkspaceIcon name="arrow" size={17}/></button>
                  <button type="button" onClick={() => setActiveView("pools")}><span className="quick-icon teal"><WorkspaceIcon name="layers"/></span><span><strong>Pool Explorer · 交易池</strong><small>池储备、币对和创建预检</small></span><WorkspaceIcon name="arrow" size={17}/></button>
                  <button type="button" onClick={() => setActiveView("liquidity")}><span className="quick-icon orange"><WorkspaceIcon name="droplet"/></span><span><strong>Liquidity · 流动性</strong><small>查看授权、余额及LP仓位</small></span><WorkspaceIcon name="arrow" size={17}/></button>
                  <button type="button" onClick={() => setActiveView("nfts")}><span className="quick-icon lilac"><WorkspaceIcon name="hex"/></span><span><strong>LP NFT · 仓位凭证</strong><small>持有人、原始投入、事件核验</small></span><WorkspaceIcon name="arrow" size={17}/></button>
                </div>
              </section>
              <section className="info-card overview-guide">
                <div className="card-header"><div><span className="section-kicker">SAFETY FIRST</span><h2>当前工作区</h2></div><WorkspaceIcon name="shield" size={22}/></div>
                <div className="guide-stat"><span>网络</span><strong>aware-coil · 1337</strong></div>
                <div className="guide-stat"><span>手续费</span><strong>0.3% <small>Swap</small></strong></div>
                <div className="guide-stat"><span>滑点保护</span><strong>1% <small>预设</small></strong></div>
                <div className="safety-note"><WorkspaceIcon name="shield" size={18}/><div><strong>历史危险操作保持锁定</strong><p>旧建池、领币、NFT #4 赎回等入口未因界面更新而解锁。操作前始终核对 MetaMask。</p></div></div>
                <button className="text-action" type="button" onClick={() => setActiveView("evidence")}>查看验证记录 <WorkspaceIcon name="arrow" size={16}/></button>
              </section>
            </div>
          </>}

          {activeView === "swap" && <>
            <div className="page-heading"><span className="section-kicker">TRADE / SWAP</span><h1>代币兑换</h1><p>使用恒定乘积 AMM 交换代币。这里的交易与报价均以连接的本地链为准。</p></div>
            <div className="two-column-main">
              <section className="form-card trade-card">
                <div className="module-title-row"><h2>Swap {swapInSymbol} → {swapOutSymbol}</h2><span className="mini-tag">Pool {swapPoolId}</span></div>
                <p className="field-hint">请选择交易池和兑换方向。只读报价不会发送交易；真实交易需 Ganache Account 1（Trader）在 MetaMask 确认。</p>
                <label className="amount-label" htmlFor="swap-pool">选择交易池</label>
                <select id="swap-pool" value={swapPoolId} disabled={loading} onChange={(e) => {setSwapPoolId(e.target.value === "2" ? 2 : 1); setSwapReverse(false); setSwapQuote(""); setSwapResult("");}}>
                  <option value={1}>Pool 1 · TKA / TKB</option>
                  <option value={2}>Pool 2 · TKA / TKC</option>
                </select>
                <label className="amount-label" htmlFor="swap-amount">支付数量 <span>{swapInSymbol}</span></label>
                <div className="amount-field"><input id="swap-amount" type="number" min="0" step="any" value={swapAmount} onChange={(e) => {setSwapAmount(e.target.value);setSwapQuote("");}} disabled={loading}/><span className="token-bubble">{swapInSymbol}</span></div>
                <button type="button" className="swap-direction-icon" aria-label="切换兑换方向" onClick={() => {setSwapReverse(v=>!v);setSwapQuote("");setSwapResult("");}} disabled={loading}><WorkspaceIcon name="arrows" size={18}/></button>
                <div className="receive-preview"><span>接收代币</span><strong>{swapOutSymbol} <small>以实际回执为准</small></strong></div>
                <button type="button" className="button-ghost-light" onClick={previewSwap} disabled={loading}>只读获取当前报价（不发送交易）</button>
                {swapQuote && <p role="status" className="inline-result">{swapQuote}</p>}
                <div className="fee-row"><span>交易手续费</span><strong>0.3%</strong></div>
                <div className="fee-row"><span>最大滑点保护</span><strong>1%</strong></div>
                <button className="button-primary full-button" type="button" onClick={swapTokens} disabled={loading || !data}>{loading ? "正在处理…" : `授权并兑换 ${swapInSymbol} → ${swapOutSymbol}`}<WorkspaceIcon name="arrow" size={18}/></button>
                {swapResult && <p className="inline-result" role="status"><strong>兑换结果：</strong>{swapResult}</p>}
                {!data && <p className="form-footnote">请先在「总览仪表盘」连接钱包并读取数据。</p>}
              </section>
              <div className="module-card explorer-module"><PoolExplorer /></div>
            </div>
          </>}

          {activeView === "pools" && <>
            <div className="page-heading"><span className="section-kicker">MARKETS / POOLS</span><h1>交易池管理</h1><p>查阅所有AMM池与代币地址，进行只读建池预检；历史建池交易入口保持锁定。</p></div>
            <div className="module-card"><PoolManager /></div>
          </>}

          {activeView === "liquidity" && <>
            <div className="page-heading"><span className="section-kicker">PROVIDE / LIQUIDITY</span><h1>流动性工作台</h1><p>查看 Pool 2 的实际储备与LP凭证，同时保留历史操作的安全限制。</p></div>
            <div className="module-card"><Pool2Liquidity /></div>
            <details className="legacy-details">
              <summary><span><WorkspaceIcon name="layers" size={18}/>Pool 1 · 历史首次加池工具</span><small>仅供回顾 / 需要空池才可执行</small></summary>
              <div className="legacy-body">
                <h2>添加流动性 · 铸造 NFT</h2>
                <p>此功能仅适用于 Pool 1 为零储备时的首次添加；当前已有资金的池会被合约校验拒绝。请勿用于重复历史交易。</p>
                <div className="form-grid"><label>存入 TKA<input value={amountA} onChange={(e) => setAmountA(e.target.value)} disabled={loading} /></label><label>存入 TKB<input value={amountB} onChange={(e) => setAmountB(e.target.value)} disabled={loading} /></label></div>
                <button className="button-secondary" onClick={addLiquidity} disabled={loading || !data}>{loading ? "处理中…" : "授权并添加流动性（仅空池）"}</button>
                {nftInfo && <p className="inline-result"><strong>铸造结果：</strong>{nftInfo}</p>}
                <p className="form-footnote">仅限本地 Ganache。MetaMask 可能分别弹出授权和加池确认。</p>
              </div>
            </details>
          </>}

          {activeView === "nfts" && <>
            <div className="page-heading"><span className="section-kicker">POSITIONS / NFT</span><h1>LP NFT 仓位</h1><p>每枚NFT代表一份独立的流动性来源，可核验原始投入、创建时间与当前归属。</p></div>
            <div className="module-card"><PoolSources /></div>
            <div className="module-card"><Pool2Redeem /></div>
            <section className="form-card nft-audit-card">
              <div className="module-title-row"><h2>NFT #4 · 当前仓位与安全核查</h2><span className="mini-tag soft">只读 · 受保护</span></div>
              <p className="field-hint">所有查询均只读；历史 NFT #4 的真实赎回入口默认关闭。</p>
              <div className="readout-box"><span>NFT #4 仓位信息</span><p>{positionInfo}</p></div>
              <div className="actions-wrap"><button type="button" className="button-secondary" onClick={checkRedeemSafety}>账户及NFT安全检查</button><button type="button" className="button-secondary" onClick={checkRedeemReceipt}>读取已记录回执</button><button type="button" className="button-secondary" onClick={() => checkRedeemOnChain(4n)}>链上核验NFT #4</button><button type="button" className="button-secondary" onClick={() => checkRedeemOnChain(1n)}>查询已销毁测试NFT #1</button></div>
              <p className="inline-result" role="status">{redeemCheck}</p>
              <div className="locked-action"><WorkspaceIcon name="shield" size={17}/><div><strong>真实赎回已锁定</strong><small>仅在单独授权后才可能更改执行代码</small></div><button type="button" onClick={redeemLiquidity} disabled={!ENABLE_REAL_REDEEM || redeemBusy || loading}>{redeemBusy ? "处理中…" : "赎回NFT #4（不可用）"}</button></div>
            </section>
          </>}

          {activeView === "evidence" && <>
            <div className="page-heading"><span className="section-kicker">PROOF / SECURITY</span><h1>验证记录与安全</h1><p>便于课堂展示的功能验收摘要。历史测试结果不代表当前链上的实时状态。</p></div>
            <div className="evidence-banner"><div><span>ISOLATED TESTNET</span><h2>实验过程有据可查</h2><p>Ganache 1337 保留真实本地历史；Hardhat EDR 31337 负责独立模拟与Bonus验收。</p></div><WorkspaceIcon name="shield" size={46}/></div>
            <div className="evidence-grid">
              <div className="evidence-card"><span>01 / 20 USERS</span><strong>20</strong><p>模拟用户 · 历史已验证</p><small>Hardhat EDR 31337</small></div>
              <div className="evidence-card"><span>02 / SUSTAINED TEST</span><strong>60s+</strong><p>持续模拟 · 历史已验证</p><small>674笔确认交易 / 554次Swap</small></div>
              <div className="evidence-card"><span>03 / ATOMIC ARBITRAGE</span><strong>2 DEX</strong><p>跨DEX原子套利 · 历史已验证</p><small>价差选路 / 整体回滚</small></div>
            </div>
            <section className="info-card proof-explainer"><h2>数据边界说明</h2><div className="proof-row"><span className="proof-dot green"/><div><strong>Ganache · aware-coil / 1337</strong><p>网页读取、Swap、流动性与NFT仓位；最新状态需要点击读取才可确认。</p></div></div><div className="proof-row"><span className="proof-dot purple"/><div><strong>Hardhat · EDR / 31337</strong><p>20用户持续模拟、手续费核算、双DEX与原子套利；只在独立测试链中执行。</p></div></div><div className="proof-row"><span className="proof-dot orange"/><div><strong>交易安全</strong><p>本次更新仅调整布局、样式和展示文案，不改变合约地址、ABI、交易校验和安全开关。</p></div></div></section>
          </>}

          <footer className="dex-footer"><span>© 2026 MiniDEX · Zhejiang University Blockchain Course</span><span>Local testnet only <span className="footer-separator">·</span> Built for learning</span></footer>
        </main>
      </div>
    </div>
  );
}

export default App;
