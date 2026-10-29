import hre from "hardhat";

async function main() {
  const { ethers } = await hre.network.create();

  const [, user] = await ethers.getSigners();
  const userAddress = await user.getAddress();

// NFT 版 MiniDEX
const dexAddress =
  "0x14c9500A454aBE10F12c3f0FA571c84823650982";

// 新部署的 TKA
const tokenAAddress =
  "0x1B484d1856213BC74dDC546C6D7CC3354d69564c";

// 新部署的 TKB
const tokenBAddress =
  "0x8848A080616E8661Bdb08C5517495f8eb8ABa8a3";

  const poolId = 1;

  // 本次使用 10 TKA 兑换 TKB
  const amountIn = ethers.parseUnits("10", 18);

  // 连接合约
  const dex = await ethers.getContractAt(
    "MiniDEX",
    dexAddress,
    user
  );

  const tokenA = await ethers.getContractAt(
    "MockToken",
    tokenAAddress,
    user
  );

  const tokenB = await ethers.getContractAt(
    "MockToken",
    tokenBAddress,
    user
  );

  // 获取当前交易池信息
  const poolBefore = await dex.pools(poolId);

  // 检查代币地址
  if (
    poolBefore.tokenA.toLowerCase() !==
      tokenAAddress.toLowerCase() ||
    poolBefore.tokenB.toLowerCase() !==
      tokenBAddress.toLowerCase()
  ) {
    throw new Error("Wrong token pair");
  }

  // 本次实验只在初始 100/100 储备下执行
  const expectedReserve = ethers.parseUnits("100", 18);

  if (
    poolBefore.reserveA !== expectedReserve ||
    poolBefore.reserveB !== expectedReserve
  ) {
    throw new Error(
      "Pool reserves changed. Do not repeat this test."
    );
  }

  // 查询交易前的余额
  const balanceABefore = await tokenA.balanceOf(userAddress);
  const balanceBBefore = await tokenB.balanceOf(userAddress);

  console.log("=== Before Swap ===");
  console.log("User:", userAddress);

  console.log(
    "Wallet TKA:",
    ethers.formatUnits(balanceABefore, 18)
  );

  console.log(
    "Wallet TKB:",
    ethers.formatUnits(balanceBBefore, 18)
  );

  if (balanceABefore < amountIn) {
    throw new Error("Not enough TKA");
  }

  // 按 AMM 公式计算预计输出
  const reserveIn = poolBefore.reserveA;
  const reserveOut = poolBefore.reserveB;

  const amountInWithFee = amountIn * 997n;

  const expectedOut =
    amountInWithFee * reserveOut /
    (reserveIn * 1000n + amountInWithFee);

  // 允许最多 1% 的输出滑点
  const minAmountOut = expectedOut * 99n / 100n;

  console.log(
    "Expected TKB:",
    ethers.formatUnits(expectedOut, 18)
  );

  // 检查授权
  const allowance = await tokenA.allowance(
    userAddress,
    dexAddress
  );

  if (allowance < amountIn) {
    console.log("Approving TKA...");

    const approveTx = await tokenA.approve(
      dexAddress,
      amountIn
    );

    await approveTx.wait();

    console.log("TKA approved!");
  }

  // 执行 Swap
  console.log("Swapping 10 TKA for TKB...");

  const swapTx = await dex.swap(
    poolId,
    tokenAAddress,
    amountIn,
    minAmountOut
  );

  const receipt = await swapTx.wait();

  if (!receipt || receipt.status !== 1) {
    throw new Error("Swap transaction failed");
  }

  console.log("Swap transaction confirmed!");

  // 查询交易后的状态
  const poolAfter = await dex.pools(poolId);

  const balanceAAfter = await tokenA.balanceOf(userAddress);
  const balanceBAfter = await tokenB.balanceOf(userAddress);

  console.log("=== After Swap ===");

  console.log(
    "Wallet TKA:",
    ethers.formatUnits(balanceAAfter, 18)
  );

  console.log(
    "Wallet TKB:",
    ethers.formatUnits(balanceBAfter, 18)
  );

  console.log(
    "Pool reserve TKA:",
    ethers.formatUnits(poolAfter.reserveA, 18)
  );

  console.log(
    "Pool reserve TKB:",
    ethers.formatUnits(poolAfter.reserveB, 18)
  );

  console.log(
    "Actual TKB received:",
    ethers.formatUnits(
      balanceBAfter - balanceBBefore,
      18
    )
  );

  console.log("Transaction hash:", receipt.hash);

  console.log("Swap completed successfully!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});