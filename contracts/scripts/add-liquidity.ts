import hre from "hardhat";

async function main() {
  const { ethers } = await hre.network.create();
  const [user] = await ethers.getSigners();
  const userAddress = await user.getAddress();

  // 之前部署的三个合约地址
  const dexAddress =
  "0x14c9500A454aBE10F12c3f0FA571c84823650982";

  const tokenAAddress =
  "0x1B484d1856213BC74dDC546C6D7CC3354d69564c";

  const tokenBAddress =
  "0x8848A080616E8661Bdb08C5517495f8eb8ABa8a3";

  // 第一个交易池
  const poolId = 1;

  // 准备存入 100 TKA 和 100 TKB
  const amountA = ethers.parseUnits("100", 18);
  const amountB = ethers.parseUnits("100", 18);

  // 连接已经部署的合约
  const dex = await ethers.getContractAt(
    "MiniDEX",
    dexAddress
  );

  const tokenA = await ethers.getContractAt(
    "MockToken",
    tokenAAddress
  );

  const tokenB = await ethers.getContractAt(
    "MockToken",
    tokenBAddress
  );

  // 检查交易池
  const poolBefore = await dex.pools(poolId);

  if (
    poolBefore.tokenA.toLowerCase() !==
      tokenAAddress.toLowerCase() ||
    poolBefore.tokenB.toLowerCase() !==
      tokenBAddress.toLowerCase()
  ) {
    throw new Error(
      "Pool 1 is not the expected TKA/TKB pool"
    );
  }

  // 防止误操作导致重复添加
  if (
    poolBefore.reserveA !== 0n ||
    poolBefore.reserveB !== 0n
  ) {
    throw new Error(
      "Pool already has liquidity; stop to avoid adding twice"
    );
  }

  // 查询用户当前代币余额
  const balanceA = await tokenA.balanceOf(userAddress);
  const balanceB = await tokenB.balanceOf(userAddress);

  console.log("User:", userAddress);
  console.log(
    "Before TKA:",
    ethers.formatUnits(balanceA, 18)
  );
  console.log(
    "Before TKB:",
    ethers.formatUnits(balanceB, 18)
  );

  if (balanceA < amountA || balanceB < amountB) {
    throw new Error(
      "Not enough tokens; check your Ganache account"
    );
  }

  // 第一步：授权 TKA
  if (
    (await tokenA.allowance(userAddress, dexAddress)) <
    amountA
  ) {
    console.log("Approving TKA...");

    const txA = await tokenA.approve(
      dexAddress,
      amountA
    );

    await txA.wait();
  }

  // 第二步：授权 TKB
  if (
    (await tokenB.allowance(userAddress, dexAddress)) <
    amountB
  ) {
    console.log("Approving TKB...");

    const txB = await tokenB.approve(
      dexAddress,
      amountB
    );

    await txB.wait();
  }

  // 第三步：添加流动性
  console.log("Adding liquidity...");

  const tx = await dex.addLiquidity(
    poolId,
    amountA,
    amountB
  );

  await tx.wait();

  // 第四步：检查结果
  const poolAfter = await dex.pools(poolId);

// 查询本次添加流动性铸造的 NFT
const tokenId = (await dex.nextTokenId()) - 1n;

// 查询 NFT 当前持有人
const nftOwner = await dex.ownerOf(tokenId);

// 查询 NFT 对应的流动性仓位
const position = await dex.positions(tokenId);

// 从 NFT 仓位中读取流动性份额
const shares = position.shares;

console.log("NFT Token ID:", tokenId.toString());
console.log("NFT Owner:", nftOwner);
console.log("NFT Pool ID:", position.poolId.toString());
console.log(
  "NFT Liquidity Shares:",
  ethers.formatUnits(shares, 18)
);

  const walletA = await tokenA.balanceOf(userAddress);
  const walletB = await tokenB.balanceOf(userAddress);

  const contractA = await tokenA.balanceOf(dexAddress);
  const contractB = await tokenB.balanceOf(dexAddress);

  console.log(
    "Wallet TKA:",
    ethers.formatUnits(walletA, 18)
  );

  console.log(
    "Wallet TKB:",
    ethers.formatUnits(walletB, 18)
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
    "DEX actual TKA:",
    ethers.formatUnits(contractA, 18)
  );

  console.log(
    "DEX actual TKB:",
    ethers.formatUnits(contractB, 18)
  );

  console.log(
    "Your liquidity shares:",
    ethers.formatUnits(shares, 18)
  );

  console.log("Liquidity added successfully!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});