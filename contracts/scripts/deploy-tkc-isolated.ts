
import hre from "hardhat";

async function main() {
  // 仅允许 Hardhat 内存模拟网络。
  const config = hre.config.networks.hardhat;

  if (!config || config.type !== "edr-simulated") {
    throw new Error("安全停止：不是 Hardhat 隔离网络");
  }

  const { ethers } = await hre.network.create("hardhat");

  const network = await ethers.provider.getNetwork();

  if (network.chainId !== 31337n) {
    throw new Error("安全停止：Chain ID 不是 31337");
  }

  console.log("Network: Hardhat isolated");
  console.log("Chain ID:", network.chainId.toString());

  // 只部署 TKC，不部署 TKA、TKB、MiniDEX。
  const tkc = await ethers.deployContract(
    "MockToken",
    ["Token C", "TKC"]
  );

  await tkc.waitForDeployment();

  const address = await tkc.getAddress();

  console.log("TKC temporary address:", address);
  console.log("Name:", await tkc.name());
  console.log("Symbol:", await tkc.symbol());
  console.log("Decimals:", await tkc.decimals());

  // 通过只读调用验证 claim 接口。
  const signer = (await ethers.getSigners())[0];

  await tkc.connect(signer).claim.staticCall();

  console.log("Claim staticCall: PASSED");
  console.log("No real Ganache transactions submitted.");
  console.log("Temporary address must not be used in frontend.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});