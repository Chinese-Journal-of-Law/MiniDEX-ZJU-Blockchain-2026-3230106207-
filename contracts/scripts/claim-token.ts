import hre from "hardhat";

async function main() {
  const { ethers } = await hre.network.create();

  const [user] = await ethers.getSigners();
  const address = await user.getAddress();

  console.log("Current user:", address);

  const tokenA = await ethers.getContractAt(
  "MockToken",
  "0x1B484d1856213BC74dDC546C6D7CC3354d69564c"
  );

  const tokenB = await ethers.getContractAt(
  "MockToken",
  "0x8848A080616E8661Bdb08C5517495f8eb8ABa8a3"
  );

  async function claimToken(token: any, name: string) {
    const claimed = await token.hasClaimed(address);

    if (!claimed) {
      console.log("Claiming", name);
      const tx = await token.claim();
      await tx.wait();
      console.log(name, "claim successful!");
    } else {
      console.log(name, "already claimed, skipping.");
    }

    const balance = await token.balanceOf(address);
    console.log(name, "balance:", ethers.formatUnits(balance, 18));
  }

  await claimToken(tokenA, "TKA");
  await claimToken(tokenB, "TKB");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});