# MiniDEX：基于 AMM 的去中心化交易所

浙江大学《区块链与数字货币》第二次作业
学号：**3230106207**　姓名：**唐洪强**

这是我在课程作业中实现的一个简单 DEX。最开始主要是想把 ERC20、恒定乘积交易池和网页 Swap 串起来，后来又补充了 LP NFT、流动性撤出、20 用户模拟以及跨 DEX 套利测试。项目不连接真实资产，交易演示使用本地 Ganache，自动化测试使用独立的 Hardhat 网络。

![MiniDEX 首页](report/docs/images/ui_01_dashboard_connected.png)

## 实现的功能

项目使用三种测试代币 TKA、TKB、TKC，主要做了以下内容：

- **测试币领取**：使用 ERC20 测试合约，限制同一地址重复领取。
- **交易池和 Swap**：前端可以查看、创建交易池，按照恒定乘积公式计算交易输出，Swap 收取 0.3% 输入手续费。已经建立的两个池分别是 TKA/TKB（Pool 1）和 TKA/TKC（Pool 2）。
- **添加和撤出流动性**：加池时创建 ERC721 LP NFT，记录所属池、原始投入、份额和创建时间；赎回时按份额取回资产并销毁对应 NFT。
- **仓位查看**：可以查询各池 LP 来源、NFT 持有人和仓位数据，也能做只读的赎回预览。
- **模拟测试**：在 Hardhat 隔离链中测试多个地址领取、授权、Swap、加池和撤池。
- **Bonus**：使用两个独立 DEX，模拟用户交易造成价格差；比较两条套利路线，在同一笔交易里完成两次 Swap，收益不满足条件时整笔回滚。

前端主要分为总览、代币兑换、交易池、流动性、LP NFT 仓位和验证与安全六个页面。有些历史操作入口在测试完成后已锁定，避免重复领取或误操作已有 NFT。

## AMM 和 LP 的处理

这里采用的是比较基础的恒定乘积模型：

`x · y = k`

假设输入量为 `amountIn`，扣除 0.3% 手续费后，输出量按下面的整数公式计算：

```text
amountInWithFee = amountIn × 997
amountOut = (amountInWithFee × reserveOut) /
            (reserveIn × 1000 + amountInWithFee)
```

LP 在首次加池时按投入量的几何平均数铸造份额；后续加池要求两种代币按照当前储备的比例投入。手续费保留在池内，通过储备及份额变化影响 LP 可赎回的资产，不是单独给 LP 发放一笔代币。

## 本地运行

需要 Node.js、npm、MetaMask，以及用于网页演示的 Ganache。项目使用 React + TypeScript + Vite、Solidity、ethers v6 和 Hardhat 3。

**1. 安装合约依赖并编译**

```powershell
cd contracts
npm install
npx hardhat compile
```

**2. 启动前端**

另开一个终端：

```powershell
cd frontend
npm install
npm run dev
```

打开 Vite 输出的本地网址，在 MetaMask 中连接所需的本地网络。

> **注意：** 我实验中保存的真实操作发生在 Ganache 的 `aware-coil` 工作区（Chain ID 1337）。仓库代码不包含那份本地链数据库。直接克隆仓库并不能恢复相同的部署地址、交易回执或 NFT 编号；如果要在新环境演示，需要自行启动测试链、部署合约，并核对前端部署配置。不要在原有 Ganache 工作区重置或重复发送历史交易。

## 测试方法与结果

前端检查：

```powershell
cd frontend
npm test
npm run typecheck
npm run build
```

合约测试（均使用独立的 Hardhat EDR 31337，不操作 Ganache 1337）：

```powershell
cd contracts
npx hardhat test mocha test/bonus-atomic-arbitrage.test.mjs test/bonus-rubric-coverage.test.mjs --network hardhat
```

20 用户持续模拟：

```powershell
cd contracts
$env:SIMULATION_DURATION_MS = '60000'
$env:SIMULATION_INTERVAL_MS = '100'
npx hardhat test mocha test/simulation-20-users.test.mjs --network hardhat
```

我在本地保存的一轮测试结果如下。不同机器或重新运行时，持续模拟的交易次数可能变化。

| 测试内容 | 本地记录 |
| --- | --- |
| 前端测试 | 5 个测试文件，12 项通过（视觉改造前记录） |
| 20 用户持续模拟 | 60.065 秒 |
| 持续模拟交易 | 674 笔成功，其中 554 次 Swap |
| 基础 Bonus 套利 | 本金 10 TKA，毛利润约 1.939557 TKA |
| 增强 Bonus 测试 | 20 笔模拟交易后自动选路，毛利润约 3.043362 TKA |
| 原子回滚 | 不满足利润条件时，测试验证两池状态保持不变 |

Bonus 利润是 **Hardhat 隔离测试中的代币毛利润**，尚未将原生币 Gas 成本换算为 TKA；它不能当作真实链上的净收益。LP 的代币数量变化也不直接等于手续费收入。

## 我遇到的几个问题

做 Pool 2 的时候，我发现非首次加池不能沿用首次建池的计算方式，必须按当前储备比例投入。后来专门用 10 TKA + 10 TKC 做了一次独立测试，铸造了 NFT #6，并在网页上赎回，确认流程可走通。原有的 NFT #4 和 #5 没有参与这次赎回。

在 Bonus 编译时还遇到过 `Stack too deep`，最后通过调整 Hardhat 的 Solidity 编译设置（启用 optimizer 与 `viaIR`）解决。测试代码里也出现过 ethers 引用错误，修正后才完成持续模拟。这些问题和结果在实验报告中有更详细的记录。

## 实验报告和截图

- [Markdown 实验报告](report/实验报告.md)
- [Bonus 说明](BONUS_README.md)
- [首页截图](report/docs/images/ui_01_dashboard_connected.png)

实验报告包含主要操作的截图、NFT #6 的历史加池及赎回记录、20 用户模拟和 Bonus 数据。报告引用的部分交易截图属于之前保存的 Ganache 历史操作，Hardhat 31337 的模拟结果与之分开说明。

## 参考资料

- 课程提供的 [DApp 参考项目](https://github.com/LBruyne/ZJU-blockchain-course-2026)
- [Solidity 文档](https://docs.soliditylang.org/)
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts/)
- [Hardhat 文档](https://hardhat.org/docs)

---

这份项目主要用于课程学习和本地测试，不应直接部署为管理真实资产的交易所。
