
import hre from "hardhat";

async function main() {
  const { ethers } = await hre.network.create();
  const [user] = await ethers.getSigners();
  const userAddress = await user.getAddress();

  // 当前 Ganache 上的三个合约地址
  const dexAddress =
    "0x14c9500A454aBE10F12c3f0FA571c84823650982";

  const tokenAAddress =
    "0x1B484d1856213BC74dDC546C6D7CC3354d69564c";

  const tokenBAddress =
    "0x8848A080616E8661Bdb08C5517495f8eb8ABa8a3";

  // 准备销毁的流动性 NFT
  const tokenId = 3n;

  const dex = await ethers.getContractAt(
    "MiniDEX", dexAddress
  );
  const tokenA = await ethers.getContractAt(
    "MockToken", tokenAAddress
  );
  const tokenB = await ethers.getContractAt(
    "MockToken", tokenBAddress
  );

  // 检查 NFT 是否属于当前账户
  const owner = await dex.ownerOf(tokenId);

  if (owner.toLowerCase() !== userAddress.toLowerCase()) {
    throw new Error("Stop: current user is not NFT owner");
  }

  // 检查 NFT 的流动性仓位
  const position = await dex.positions(tokenId);

  if (position.poolId !== 1n || position.shares === 0n) {
    throw new Error("Stop: unexpected NFT position");
  }

  // 验证交易池中的代币地址
  const poolBefore = await dex.pools(position.poolId);

  if (
    poolBefore.tokenA.toLowerCase() !==
      tokenAAddress.toLowerCase() ||
    poolBefore.tokenB.toLowerCase() !==
      tokenBAddress.toLowerCase()
  ) {
    throw new Error("Stop: pool tokens do not match");
  }

  // 记录赎回前余额
  const beforeA = await tokenA.balanceOf(userAddress);
  const beforeB = await tokenB.balanceOf(userAddress);

  console.log("NFT ID:", tokenId.toString());
  console.log("NFT Owner:", owner);
  console.log(
    "NFT Shares:",
    ethers.formatUnits(position.shares, 18)
  );
  console.log("Before TKA:", ethers.formatUnits(beforeA, 18));
  console.log("Before TKB:", ethers.formatUnits(beforeB, 18));

  // 销毁 NFT，赎回流动性
  // 最低赎回量暂设为 0，仅用于本地教学测试
  const tx = await dex.removeLiquidity(tokenId, 0n, 0n);
  const receipt = await tx.wait();

  if (!receipt || receipt.status !== 1) {
    throw new Error("Redemption transaction failed");
  }

  // 查询赎回后的余额和仓位
  const afterA = await tokenA.balanceOf(userAddress);
  const afterB = await tokenB.balanceOf(userAddress);
  const poolAfter = await dex.pools(position.poolId);
  const cleared = await dex.positions(tokenId);

  // 已销毁的 NFT 再查询 ownerOf 应当失败
  let burned = false;

  try {
    await dex.ownerOf(tokenId);
  } catch {
    burned = true;
  }

  console.log(
    "Returned TKA:",
    ethers.formatUnits(afterA - beforeA, 18)
  );
  console.log(
    "Returned TKB:",
    ethers.formatUnits(afterB - beforeB, 18)
  );
  console.log(
    "Pool TKA remaining:",
    ethers.formatUnits(poolAfter.reserveA, 18)
  );
  console.log(
    "Pool TKB remaining:",
    ethers.formatUnits(poolAfter.reserveB, 18)
  );
  console.log("NFT burned:", burned);
  console.log("Position cleared:", cleared.shares === 0n);

   // 验证 NFT 已销毁、仓位已清除、代币返还正确
  if (
    !burned ||
    cleared.shares !== 0n ||
    afterA - beforeA !==
      poolBefore.reserveA - poolAfter.reserveA ||
    afterB - beforeB !==
      poolBefore.reserveB - poolAfter.reserveB
  ) {
    throw new Error("Redemption verification failed");
  }

  console.log("Liquidity removed and verified!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});