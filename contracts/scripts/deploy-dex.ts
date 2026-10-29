import hre from "hardhat";

async function main() {
  const { ethers } = await hre.network.create();

  console.log("Deploying MiniDEX...");

  const dex = await ethers.deployContract("MiniDEX");

  await dex.waitForDeployment();

  const dexAddress = await dex.getAddress();

  console.log("MiniDEX deployed to:", dexAddress);
  console.log("Deployment successful!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});