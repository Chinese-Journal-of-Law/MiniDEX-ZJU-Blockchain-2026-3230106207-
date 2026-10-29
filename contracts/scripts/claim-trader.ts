
import hre from "hardhat";

async function main() {
  const { ethers } = await hre.network.create();

  // 使用第二个 Ganache 账户
  const signers = await ethers.getSigners();
  const trader = signers[1];

  if (!trader) {
    throw new Error("Ganache Account 1 not found");
  }

  const traderAddress = await trader.getAddress();

  // 确保使用的是之前确认的交易者账户
  const expectedTrader =
    "0xAd5D0A23Aaf8184B841406065f8ecb6ACaF6B171";

  if (
    traderAddress.toLowerCase() !==
    expectedTrader.toLowerCase()
  ) {
    throw new Error("Wrong trader account");
  }

  // 当前 Ganache 上部署的 ERC20 代币
  const tokenAAddress =
    "0x1B484d1856213BC74dDC546C6D7CC3354d69564c";

  const tokenBAddress =
    "0x8848A080616E8661Bdb08C5517495f8eb8ABa8a3";

  // 使用第二个账户连接代币合约
  const tokenA = await ethers.getContractAt(
    "MockToken",
    tokenAAddress,
    trader
  );

  const tokenB = await ethers.getContractAt(
    "MockToken",
    tokenBAddress,
    trader
  );

  console.log("Trader address:", traderAddress);

  async function claimToken(token: any, name: string) {
    const claimed = await token.hasClaimed(traderAddress);

    if (!claimed) {
      console.log("Claiming", name);

      const tx = await token.claim();
      await tx.wait();

      console.log(name, "claim successful!");
    } else {
      console.log(name, "already claimed, skipping.");
    }

    const balance = await token.balanceOf(traderAddress);

    console.log(
      name,
      "balance:",
      ethers.formatUnits(balance, 18)
    );
  }

  await claimToken(tokenA, "TKA");
  await claimToken(tokenB, "TKB");

  console.log("Trader token setup completed!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});