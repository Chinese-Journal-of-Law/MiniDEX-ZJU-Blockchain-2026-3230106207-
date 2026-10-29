import { useRef, useState } from "react";
import {
  BrowserProvider, Contract, formatUnits, parseUnits
} from "ethers";
import type { Eip1193Provider } from "ethers";
import { DEX_ADDRESS, TKA_ADDRESS, TKC_ADDRESS } from "./contracts";
import { ERC20_ABI, MINIDEX_ABI } from "./abi";

const CHAIN_ID = 1337n;
const POOL_ID = 2n;
const LP = "0xa9256D5500Dbd83C84eFa948039089Ec95d02795";

// Both transactions stay DISABLED until the user explicitly authorizes each.
const ENABLE_TKC_CLAIM = false;
const ENABLE_POOL2_ADD = false;
const APPROVED_AMOUNT = 100n * 10n ** 18n;
const POOL2_DEPOSIT_ATTEMPT_KEY = "minidex:1337:pool2:100TKA100TKC:attempt";

type Snapshot = {
  account: string;
  tkaBalance: bigint;
  tkcBalance: bigint;
  tkaAllowance: bigint;
  tkcAllowance: bigint;
  tkcClaimed: boolean;
  reserveA: bigint;
  reserveB: bigint;
  totalShares: bigint;
  nextNftId: bigint;
};

function errMessage(e: unknown) {
  return e instanceof Error ? e.message : "Unknown error";
}

async function connect() {
  const ethereum = (window as Window & { ethereum?: Eip1193Provider }).ethereum;
  if (!ethereum) throw new Error("MetaMask not found");
  const provider = new BrowserProvider(ethereum);
  const network = await provider.getNetwork();
  if (network.chainId !== CHAIN_ID) throw new Error("Select Ganache Chain ID 1337");
  const accounts: string[] = await provider.send("eth_accounts", []);
  if (accounts.length === 0) throw new Error("Connect Account 0 in MetaMask first");
  const account = accounts[0];
  if (account.toLowerCase() !== LP.toLowerCase()) {
    throw new Error("Read-only Pool 2 LP view requires Account 0");
  }
  return { provider, account };
}

export default function Pool2Liquidity() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState("尚未读取");
  const [amountA, setAmountA] = useState("100");
  const [amountC, setAmountC] = useState("100");
  const [nftIdInput, setNftIdInput] = useState("");
  const [nftInfo, setNftInfo] = useState("尚未查询 NFT");
  const [busy, setBusy] = useState(false);
  const claimLock = useRef(false);
  const depositLock = useRef(false);
  const [depositStatus, setDepositStatus] = useState("尚未授权添加流动性");
  const [claimStatus, setClaimStatus] = useState("尚未发起领取交易");

  async function refresh() {
    setBusy(true);
    setStatus("正在只读读取 Pool 2...");
    setSnapshot(null);
    try {
      const { provider, account } = await connect();
      const dex = new Contract(DEX_ADDRESS, MINIDEX_ABI, provider);
      const a = new Contract(TKA_ADDRESS, ERC20_ABI, provider);
      const c = new Contract(TKC_ADDRESS, ERC20_ABI, provider);
      const [pool, nextId, balA, balC, allowanceA, allowanceC, claimedC] =
        await Promise.all([
          dex.pools(POOL_ID), dex.nextTokenId(),
          a.balanceOf(account), c.balanceOf(account),
          a.allowance(account, DEX_ADDRESS),
          c.allowance(account, DEX_ADDRESS),
          c.hasClaimed(account),
        ]);
      if (pool.tokenA.toLowerCase() !== TKA_ADDRESS.toLowerCase() ||
          pool.tokenB.toLowerCase() !== TKC_ADDRESS.toLowerCase()) {
        throw new Error("Pool 2 tokens do not match TKA/TKC");
      }
      setSnapshot({
        account,
        tkaBalance: balA, tkcBalance: balC,
        tkaAllowance: allowanceA, tkcAllowance: allowanceC,
        tkcClaimed: claimedC,
        reserveA: pool.reserveA, reserveB: pool.reserveB,
        totalShares: pool.totalShares, nextNftId: nextId,
      });
      setStatus("Pool 2 链上数据读取成功。未发送交易。");
    } catch (e) {
      setStatus(`读取失败：${errMessage(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function previewDeposit(): string {
    if (!snapshot) return "请先读取 Pool 2 数据";
    try {
      const rawA = parseUnits(amountA.trim(), 18);
      const rawC = parseUnits(amountC.trim(), 18);
      if (rawA <= 0n || rawC <= 0n) return "存入数量必须大于 0";
      if (snapshot.totalShares !== 0n ||
          snapshot.reserveA !== 0n || snapshot.reserveB !== 0n) {
        return "此页面暂只预览空池首次注入；池状态已变化时停止";
      }
      const missing: string[] = [];
      if (rawA > snapshot.tkaBalance) missing.push("TKA 余额不足");
      if (rawC > snapshot.tkcBalance) missing.push("TKC 余额不足");
      if (rawA > snapshot.tkaAllowance) missing.push("TKA 授权不足");
      if (rawC > snapshot.tkcAllowance) missing.push("TKC 授权不足");
      return `Pool 2 首次投入：${amountA} TKA + ${amountC} TKC。` +
        (missing.length ? ` 当前条件：${missing.join("；")}。` : " 当前余额及授权充足。") +
        " 这里只读预览，没有发送领取/授权/添加流动性交易。";
    } catch {
      return "输入金额无效，请使用普通十进制数字（最多18位小数）";
    }
  }

  async function readNft() {
    setBusy(true);
    setNftInfo("正在只读读取 NFT...");
    try {
      const { provider, account } = await connect();
      const id = BigInt(nftIdInput.trim());
      if (id < 1n) throw new Error("NFT 编号必须大于 0");
      const dex = new Contract(DEX_ADDRESS, MINIDEX_ABI, provider);
      const [nextId, owner, pos] = await Promise.all([
        dex.nextTokenId(), dex.ownerOf(id), dex.positions(id)
      ]);
      if (id >= nextId) throw new Error("尚未铸造到该 NFT 编号");
      if (pos.poolId !== POOL_ID) throw new Error("该 NFT 不属于 Pool 2");
      if (owner.toLowerCase() !== account.toLowerCase()) {
        throw new Error("该 NFT 当前不属于 Account 0");
      }
      const stamp = new Date(Number(pos.createdTimestamp) * 1000).toLocaleString("zh-CN");
      setNftInfo(
        `NFT #${id.toString()}，Pool 2，所有者 ${owner}；` +
        `原始存入 ${formatUnits(pos.amountA, 18)} TKA + ` +
        `${formatUnits(pos.amountB, 18)} TKC；` +
        `份额 ${formatUnits(pos.shares, 18)}；时间 ${stamp}。`
      );
    } catch (e) {
      setNftInfo(`NFT 查询失败：${errMessage(e)}。未发送交易。`);
    } finally {
      setBusy(false);
    }
  }

  async function claimTkcOnce() {
    if (!ENABLE_TKC_CLAIM || claimLock.current || busy) return;
    claimLock.current = true;
    setBusy(true);
    let txHash: string | null = null;
    try {
      const { provider, account } = await connect();
      const token = new Contract(TKC_ADDRESS, ERC20_ABI, provider);
      if ((await provider.getCode(TKC_ADDRESS)) === "0x") {
        throw new Error("TKC contract code not found");
      }
      const [name, symbol, decimals, claimed, before] = await Promise.all([
        token.name(), token.symbol(), token.decimals(),
        token.hasClaimed(account), token.balanceOf(account),
      ]);
      if (name !== "Token C" || symbol !== "TKC" || decimals !== 18n) {
        throw new Error("TKC token metadata mismatch");
      }
      if (claimed) {
        setClaimStatus("Already claimed on chain. Do not send another claim.");
        return;
      }
      const signer = await provider.getSigner();
      if ((await signer.getAddress()).toLowerCase() !== LP.toLowerCase()) {
        throw new Error("Account changed. Stop.");
      }
      const writeToken = new Contract(TKC_ADDRESS, ERC20_ABI, signer);
      const method = writeToken.getFunction("claim()");
      await method.staticCall();
      const estimatedGas = await method.estimateGas();
      const confirmed = window.confirm(
        `Authorize ONE TKC claim transaction on Ganache 1337?\n` +
        `Account: ${account}\nToken: ${TKC_ADDRESS}\n` +
        `Balance before: ${formatUnits(before, 18)} TKC\n` +
        `Expected mint: 1000 TKC\nEstimated gas: ${estimatedGas}\n` +
        `No liquidity addition or NFT redemption.`
      );
      if (!confirmed) {
        setClaimStatus("Cancelled before transaction. No claim sent.");
        return;
      }
      const check = await connect();
      if (check.account.toLowerCase() !== account.toLowerCase()) {
        throw new Error("Account changed before send");
      }
      if (await token.hasClaimed(account)) {
        throw new Error("Claim already completed on chain. Do not retry.");
      }
      const tx = await method();
      txHash = tx.hash;
      setClaimStatus(`Claim broadcast: ${txHash}. Do not resend.`);
      const receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) {
        throw new Error("Receipt not successful. Inspect transaction before any retry.");
      }
      const [afterClaim, afterBalance] = await Promise.all([
        token.hasClaimed(account), token.balanceOf(account)
      ]);
      // Explicitly normalize ethers dynamic-contract results to bigint.
      const beforeRaw: bigint = BigInt(before.toString());
      const afterRaw: bigint = BigInt(afterBalance.toString());
      const expectedMint: bigint = 1000n * 10n ** 18n;
      if (!afterClaim || afterRaw - beforeRaw !== expectedMint) {
        throw new Error("Receipt succeeded but claim/balance verification differed.");
      }
      setClaimStatus(
        `TKC CLAIM VERIFIED: +1000 TKC; TX_HASH ${receipt.hash}. ` +
        `Balance ${formatUnits(afterBalance, 18)} TKC.`
      );
      await refresh();
    } catch (e) {
      setClaimStatus(
        `${txHash ? `Broadcast TX ${txHash}. Do NOT resend. ` : ""}` +
        `Stopped: ${errMessage(e)}`
      );
    } finally {
      setBusy(false);
      claimLock.current = false;
    }
  }

  async function depositPool2Once() {
    if (!ENABLE_POOL2_ADD || depositLock.current || busy) return;
    depositLock.current = true;
    setBusy(true);
    let pendingHash: string | null = null;
    try {
      const { provider, account } = await connect();
      const signer = await provider.getSigner();
      const dexRead = new Contract(DEX_ADDRESS, MINIDEX_ABI, provider);
      const aRead = new Contract(TKA_ADDRESS, ERC20_ABI, provider);
      const cRead = new Contract(TKC_ADDRESS, ERC20_ABI, provider);
      const rawA = parseUnits(amountA.trim(), 18);
      const rawC = parseUnits(amountC.trim(), 18);
      if (rawA !== APPROVED_AMOUNT || rawC !== APPROVED_AMOUNT) {
        throw new Error("This authorization permits only 100 TKA + 100 TKC.");
      }
      if (window.localStorage.getItem(POOL2_DEPOSIT_ATTEMPT_KEY) !== null) {
        throw new Error("An earlier deposit attempt is recorded. Check chain receipts before any retry.");
      }
      const nft4Owner = await dexRead.ownerOf(4n);
      if (nft4Owner.toLowerCase() !== LP.toLowerCase()) {
        throw new Error("NFT #4 owner mismatch; no transaction allowed.");
      }
      if ((await signer.getAddress()).toLowerCase() !== LP.toLowerCase()) {
        throw new Error("Account changed");
      }
      const pool = await dexRead.pools(POOL_ID);
      if (pool.tokenA.toLowerCase() !== TKA_ADDRESS.toLowerCase() ||
          pool.tokenB.toLowerCase() !== TKC_ADDRESS.toLowerCase() ||
          pool.totalShares !== 0n || pool.reserveA !== 0n || pool.reserveB !== 0n) {
        throw new Error("Pool 2 is no longer the expected empty pool");
      }
      const [balanceA, balanceC] = await Promise.all([
        aRead.balanceOf(account), cRead.balanceOf(account)
      ]);
      if (BigInt(balanceA.toString()) < rawA || BigInt(balanceC.toString()) < rawC) {
        throw new Error("Insufficient token balances");
      }
      const a = new Contract(TKA_ADDRESS, ERC20_ABI, signer);
      const c = new Contract(TKC_ADDRESS, ERC20_ABI, signer);
      for (const [symbol, token] of [["TKA", a], ["TKC", c]] as const) {
        const required = symbol === "TKA" ? rawA : rawC;
        const allowance = BigInt((await token.allowance(account, DEX_ADDRESS)).toString());
        if (allowance < required) {
          const approved = window.confirm(
            `Authorize exactly ${formatUnits(required, 18)} ${symbol} to MiniDEX?`
          );
          if (!approved) throw new Error("User cancelled approval");
          const approveMethod = token.getFunction("approve(address,uint256)");
          await approveMethod.staticCall(DEX_ADDRESS, required);
          const tx = await approveMethod(DEX_ADDRESS, required);
          pendingHash = tx.hash;
          setDepositStatus(`${symbol} approval broadcast ${tx.hash}. Do not retry.`);
          const receipt = await tx.wait();
          if (!receipt || receipt.status !== 1) throw new Error("Approval receipt not successful");
          pendingHash = null;
        }
      }
      const recheckPool = await dexRead.pools(POOL_ID);
      if (recheckPool.reserveA !== 0n || recheckPool.reserveB !== 0n ||
          recheckPool.totalShares !== 0n) {
        throw new Error("Pool changed after approvals");
      }
      const nextId = BigInt((await dexRead.nextTokenId()).toString());
      const dexWrite = new Contract(DEX_ADDRESS, MINIDEX_ABI, signer);
      const method = dexWrite.getFunction("addLiquidity(uint256,uint256,uint256)");
      await method.staticCall(POOL_ID, rawA, rawC);
      const gas = await method.estimateGas(POOL_ID, rawA, rawC);
      const confirmed = window.confirm(
        `Add ${formatUnits(rawA,18)} TKA + ${formatUnits(rawC,18)} TKC ` +
        `to Pool 2? Estimated gas: ${gas}. A new NFT will be minted.`
      );
      if (!confirmed) {
        setDepositStatus("Deposit cancelled. ERC20 approvals (if any) remain on-chain.");
        return;
      }
      if ((await signer.getAddress()).toLowerCase() !== LP.toLowerCase()) {
        throw new Error("Account changed");
      }
      // Store before opening MetaMask. Never auto-retry if wallet/broadcast status is ambiguous.
      window.localStorage.setItem(POOL2_DEPOSIT_ATTEMPT_KEY, "PENDING_WALLET_CONFIRMATION");
      const tx = await method(POOL_ID, rawA, rawC);
      pendingHash = tx.hash;
      window.localStorage.setItem(POOL2_DEPOSIT_ATTEMPT_KEY, tx.hash);
      setDepositStatus(`Liquidity tx broadcast ${tx.hash}. Do not resend.`);
      const receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) throw new Error("Liquidity receipt not successful");

      let mintedId: bigint | null = null;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== DEX_ADDRESS.toLowerCase()) continue;
        try {
          const parsed = dexWrite.interface.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed?.name === "LiquidityNFTMinted" &&
              BigInt(parsed.args.poolId.toString()) === POOL_ID &&
              String(parsed.args.owner).toLowerCase() === account.toLowerCase()) {
            mintedId = BigInt(parsed.args.tokenId.toString());
          }
        } catch { /* unrelated event */ }
      }
      if (mintedId === null) {
        throw new Error("Transaction succeeded but mint event not found; check receipt, never retry");
      }
      const [owner, position] = await Promise.all([
        dexRead.ownerOf(mintedId), dexRead.positions(mintedId)
      ]);
      if (owner.toLowerCase() !== account.toLowerCase() ||
          position.poolId !== POOL_ID ||
          BigInt(position.amountA.toString()) !== rawA ||
          BigInt(position.amountB.toString()) !== rawC) {
        throw new Error("Minted position differs from expectation; do not retry");
      }
      if ((await dexRead.ownerOf(4n)).toLowerCase() !== LP.toLowerCase()) {
        throw new Error("NFT #4 owner changed. Deposit hash was retained; investigate.");
      }
      setNftIdInput(mintedId.toString());
      setDepositStatus(
        `LIQUIDITY VERIFIED: NFT #${mintedId}, TX_HASH ${receipt.hash}, ` +
        `${formatUnits(rawA,18)} TKA + ${formatUnits(rawC,18)} TKC.`
      );
      await refresh();
    } catch (e) {
      setDepositStatus(`${pendingHash ? `Broadcast hash ${pendingHash}; DO NOT RETRY. ` : ""}${errMessage(e)}`);
    } finally {
      depositLock.current = false;
      setBusy(false);
    }
  }

  // All live deposit transaction code is locked unless separately authorized.
  // ENABLE_TKC_CLAIM and ENABLE_POOL2_ADD are future authorization markers only.
  return (
    <section style={{ border: "1px solid #d4d4d4", borderRadius: 12, padding: 18, marginTop: 20 }}>
      <h2>Pool 2 · TKA/TKC 流动性与 NFT</h2>
      <p>本模块当前仅用于读取 Pool 2 余额、授权与 NFT 信息。历史 100+100 加池已完成；领取和加池写入入口均锁定，不会发送交易。</p>
      <button type="button" disabled={busy} onClick={refresh}>读取 Pool 2 余额、授权和持仓状态（只读）</button>
      <p role="status">{status}</p>
      {snapshot && (
        <div style={{ background: "#f6f7f8", padding: 12 }}>
          <p>Account：{snapshot.account}</p>
          <p>TKA 余额：{formatUnits(snapshot.tkaBalance, 18)}；授权：{formatUnits(snapshot.tkaAllowance, 18)}</p>
          <p>TKC 余额：{formatUnits(snapshot.tkcBalance, 18)}；授权：{formatUnits(snapshot.tkcAllowance, 18)}</p>
          <p>TKC 已领取：{snapshot.tkcClaimed ? "是" : "否"}</p>
          <p>池储备：{formatUnits(snapshot.reserveA, 18)} TKA / {formatUnits(snapshot.reserveB, 18)} TKC</p>
          <p>总份额：{formatUnits(snapshot.totalShares, 18)}；下一枚 NFT 编号：{snapshot.nextNftId.toString()}（尚未铸造）</p>
        </div>
      )}
      <h3>1. 领取 TKC</h3>
      <p>MockToken.claim() 每个账户只能领取一次，领取数量为 1000 TKC。</p>
      <button type="button" disabled={!ENABLE_TKC_CLAIM || busy || !snapshot || snapshot.tkcClaimed} onClick={claimTkcOnce}>领取一次 1000 TKC（MetaMask 确认）</button>
      <p role="status">{claimStatus}</p>
      <h3>2. 历史首次加池输入预览（写入已锁定）</h3>
      <label>投入 TKA：<input value={amountA} onChange={e => setAmountA(e.target.value)} disabled={busy}/></label>
      <p><label>投入 TKC：<input value={amountC} onChange={e => setAmountC(e.target.value)} disabled={busy}/></label></p>
      <p role="status">{previewDeposit()}</p>
      <button type="button" disabled={!ENABLE_POOL2_ADD || busy || !snapshot || snapshot.totalShares !== 0n} onClick={depositPool2Once}>仅本次授权：100 TKA + 100 TKC（最多两次授权与一次加池）</button>
      <p role="status">{depositStatus}</p>
      <h3>3. 查询 Pool 2 的 NFT（只读）</h3>
      <p>请以链上回执和 NFT #4/#5/#6 当前状态为准；已销毁的 NFT 不再是活跃仓位。</p>
      <label>NFT ID：<input value={nftIdInput} onChange={e => setNftIdInput(e.target.value)} disabled={busy} placeholder="例如 5"/></label>
      <button type="button" disabled={busy || !nftIdInput.trim()} onClick={readNft}>读取 NFT 原始投入与时间</button>
      <p role="status">{nftInfo}</p>
    </section>
  );
}
