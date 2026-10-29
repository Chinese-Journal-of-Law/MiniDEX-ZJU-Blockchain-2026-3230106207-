// deploy-tkc-aware-coil-once.mjs
// One explicitly authorized deployment: Token C / TKC to existing Ganache 1337.
// Do not rerun after any ambiguity. No MiniDEX / Pool 2 / NFT writes.
import { readFileSync } from "node:fs";
import {
  JsonRpcProvider, ContractFactory, Contract,
  formatEther, getAddress, getCreateAddress, parseUnits
} from "ethers";

const RPC = "http://127.0.0.1:8545";
const ACCOUNT0 = getAddress("0xa9256D5500Dbd83C84eFa948039089Ec95d02795");
const DEX_ADDRESS = getAddress("0x14c9500A454aBE10F12c3f0FA571c84823650982");
const TKA_ADDRESS = getAddress("0x1B484d1856213BC74dDC546C6D7CC3354d69564c");
const TKB_ADDRESS = getAddress("0x8848A080616E8661Bdb08C5517495f8eb8ABa8a3");
const EXPECTED_NONCE = 23;
const EXPECTED_NFT_OWNER = ACCOUNT0;
const ABI_PATH = new URL("../artifacts/contracts/MockToken.sol/MockToken.json", import.meta.url);

let broadcastHash = null;

async function main() {
  const provider = new JsonRpcProvider(RPC);
  try {
    const network = await provider.getNetwork();
    if (network.chainId !== 1337n) throw new Error("错误网络：必须是现有 Ganache 1337");

    const accounts = await provider.send("eth_accounts", []);
    if (!accounts.some(a => a.toLowerCase() === ACCOUNT0.toLowerCase())) {
      throw new Error("Ganache 未解锁 Account 0；停止，不要导入或提供私钥");
    }

    for (const [label, address] of [
      ["MiniDEX", DEX_ADDRESS], ["TKA", TKA_ADDRESS], ["TKB", TKB_ADDRESS]
    ]) {
      if (await provider.getCode(address) === "0x") throw new Error(`${label} 合约不存在，停止`);
    }

    const dex = new Contract(DEX_ADDRESS, [
      "function poolCount() view returns (uint256)",
      "function ownerOf(uint256) view returns (address)",
      "function pools(uint256) view returns (address tokenA,address tokenB,uint256 reserveA,uint256 reserveB,uint256 createdTimestamp,uint256 totalShares)"
    ], provider);
    const [count, owner, pool] = await Promise.all([
      dex.poolCount(), dex.ownerOf(4n), dex.pools(1n)
    ]);
    if (count !== 1n ||
        owner.toLowerCase() !== EXPECTED_NFT_OWNER.toLowerCase() ||
        pool.tokenA.toLowerCase() !== TKA_ADDRESS.toLowerCase() ||
        pool.tokenB.toLowerCase() !== TKB_ADDRESS.toLowerCase()) {
      throw new Error("Pool 1 / NFT #4 与授权前状态不符，停止");
    }

    const [latestNonce, pendingNonce] = await Promise.all([
      provider.getTransactionCount(ACCOUNT0, "latest"),
      provider.getTransactionCount(ACCOUNT0, "pending")
    ]);
    if (latestNonce !== EXPECTED_NONCE || pendingNonce !== EXPECTED_NONCE) {
      throw new Error(
        `Nonce 已变化：latest=${latestNonce}, pending=${pendingNonce}；期望23；停止并人工核对，禁止直接重跑`
      );
    }

    const predictedAddress = getCreateAddress({ from: ACCOUNT0, nonce: EXPECTED_NONCE });
    if (await provider.getCode(predictedAddress) !== "0x") {
      throw new Error("预计部署地址已有合约代码，停止");
    }

    const artifact = JSON.parse(readFileSync(ABI_PATH, "utf8"));
    if (!Array.isArray(artifact.abi) ||
        typeof artifact.bytecode !== "string" ||
        !/^0x(?:[0-9a-fA-F]{2})+$/.test(artifact.bytecode)) {
      throw new Error("MockToken 编译产物无效");
    }

    const signer = await provider.getSigner(ACCOUNT0);
    const factory = new ContractFactory(artifact.abi, artifact.bytecode, signer);
    const txRequest = await factory.getDeployTransaction("Token C", "TKC");
    const gas = await provider.estimateGas({ from: ACCOUNT0, data: txRequest.data });
    const balance = await provider.getBalance(ACCOUNT0);
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice ?? parseUnits("20", "gwei");
    const gasLimit = gas * 120n / 100n;
    if (balance < gasLimit * gasPrice) throw new Error("部署 Gas 预算超过余额");
    console.log("Chain ID: 1337");
    console.log("Account 0:", ACCOUNT0);
    console.log("Nonce:", latestNonce);
    console.log("Predicted TKC address:", predictedAddress);
    console.log("Estimated gas:", gas.toString());
    console.log("ETH balance:", formatEther(balance));
    console.log("部署目标仅 Token C (TKC)，不操作其他合约。");

    // SINGLE WRITE: ContractFactory.deploy sends exactly one contract creation transaction.
    const tkc = await factory.deploy("Token C", "TKC", { gasLimit, nonce: EXPECTED_NONCE });
    const tx = tkc.deploymentTransaction();
    if (!tx) throw new Error("找不到部署交易；停止并检查 Ganache");
    broadcastHash = tx.hash;
    console.log("BROADCAST TX HASH:", broadcastHash);
    console.log("不得再次运行本脚本。正在等待当前交易回执...");
    const receipt = await tx.wait(1);
    if (!receipt || receipt.status !== 1) throw new Error("交易回执失败或不存在；先人工检查交易");
    if (!receipt.contractAddress ||
        receipt.contractAddress.toLowerCase() !== predictedAddress.toLowerCase()) {
      throw new Error("合约地址与预期不符；先人工检查交易");
    }
    const code = await provider.getCode(receipt.contractAddress);
    if (code === "0x") throw new Error("交易后目标地址没有代码；先人工检查交易");
    const verifiedTkc = new Contract(receipt.contractAddress, artifact.abi, provider);
    const [name, symbol, decimals, totalSupply, afterCount, afterOwner] = await Promise.all([
      verifiedTkc.name(), verifiedTkc.symbol(), verifiedTkc.decimals(),
      verifiedTkc.totalSupply(), dex.poolCount(), dex.ownerOf(4n)
    ]);
    if (name !== "Token C" || symbol !== "TKC" || decimals !== 18n || totalSupply !== 0n) {
      throw new Error("部署成功但 TKC 元数据不符；不要重新部署");
    }
    if (afterCount !== 1n || afterOwner.toLowerCase() !== ACCOUNT0.toLowerCase()) {
      throw new Error("部署后池/NFT 状态异常；不要重新部署");
    }
    console.log("=== DEPLOYMENT VERIFIED ===");
    console.log("TKC_ADDRESS =", receipt.contractAddress);
    console.log("TX_HASH =", receipt.hash);
    console.log("BLOCK =", receipt.blockNumber);
    console.log("GAS_USED =", receipt.gasUsed.toString());
    console.log("SYMBOL =", symbol, "DECIMALS =", decimals.toString());
    console.log("Pool count =", afterCount.toString());
    console.log("NFT #4 owner =", afterOwner);
    console.log("未创建 Pool 2；未领取 TKC；未赎回 NFT #4。");
    console.log("保存 TKC_ADDRESS 与 TX_HASH；禁止再次执行本部署脚本。");
  } finally {
    provider.destroy();
  }
}
main().catch(e => {
  console.error("STOP:", e instanceof Error ? e.message : String(e));
  if (broadcastHash) console.error("已广播：", broadcastHash, "——切勿重复执行，先核对回执。");
  process.exitCode = 1;
});
