# MiniDEX — AMM DEX & Atomic Arbitrage

> 浙江大学《区块链与数字货币》第二次作业｜`学号【待填】` · `姓名【待填】`  
> **公开仓库地址：**【待填】｜**演示视频：**【待录制】

MiniDEX 是基于 Solidity AMM 的本地去中心化交易所实验，展示 **ERC20领币 → 创建池 → Swap → LP NFT铸造与赎回 → 20用户持续模拟 → 双DEX原子套利Bonus** 的完整流程。项目采用 React + TypeScript + Vite 前端、Hardhat 3 + ethers v6 智能合约测试，以及 Ganache/MetaMask 历史网页演示。

![MiniDEX overview](docs/images/ui_01_dashboard_connected.png)

## 主要功能

- ERC20模拟币TKA/TKB/TKC；每地址领取1000枚且限制重复领取。
- 网页创建AMM池，防止重复Token对；Pool1 = TKA/TKB，Pool2 = TKA/TKC。
- Swap使用`997/1000`扣除0.3%输入费，并支持最小输出/滑点保护。
- LP初次加池按`floor(sqrt(amountA * amountB))`铸份额；后续加池要求严格比例。
- 每笔新增流动性产生 ERC721 LP NFT，记录池、原投入、份额和时间；支持按最新份额赎回、销毁NFT、返还两币。
- 美化前端有总览、代币兑换、交易池、流动性、LP NFT仓位、验证与安全6个区块。
- 20地址60秒持续模拟，最新报告为**674成功交易、554 Swap、0失败**。
- Bonus：双DEX交易产生价差，比较两方向含费报价，选出获利路线，在同一笔交易内完成两次Swap；不足收益时整体revert。

## 网络区分（重要）

| 环境 | Chain ID | 用途 | 约束 |
|---|---:|---|---|
| Ganache `aware-coil` | 1337 | 已有网页真实历史演示，Pool1/2、NFT #4/#5 | **禁止Reset、重部署或重复历史交易** |
| Hardhat EDR | 31337 | 自动化测试、20用户、Bonus | 临时独立测试链，测试交易哈希不能当作Ganache历史哈希 |

历史NFT #6已真实铸造并赎回，不再是活跃仓位；NFT #4/#5保留。真实网页操作需要连接原先的Ganache工作区，**不能凭本README在全新节点上直接访问同样的部署地址和历史回执**。

## 依赖与启动

Node.js请选择兼容两个子项目`package.json`中`engines`的版本（推荐满足`^22.13.0`的Node 22）。Windows PowerShell从仓库根目录开始。

```powershell
# 前端
Set-Location .\frontend
npm install
npm test
npm run typecheck
npm run build
npm run dev
```

终端显示的Vite本地地址打开网页，MetaMask选择Ganache现有Chain 1337，并核对钱包和部署地址；按页面提示只读刷新池和NFT。若没连接原Ganache工作区，不要尝试复现历史交易哈希。

```powershell
# 合约与Bonus（隔离Hardhat EDR 31337，不访问Ganache）
Set-Location ..\contracts
npm install
npx hardhat compile
npx hardhat test mocha test/bonus-atomic-arbitrage.test.mjs test/bonus-rubric-coverage.test.mjs --network hardhat
```

```powershell
# 20用户60秒模拟（独立测试链）
$env:SIMULATION_DURATION_MS = '60000'
$env:SIMULATION_INTERVAL_MS = '100'
npx hardhat test mocha test/simulation-20-users.test.mjs --network hardhat
```

报告输出到`contracts/simulation/reports/`。重新运行Hardhat测试会产生新的临时链交易哈希，因此本仓库另附归档JSON用于核对本次课程实验。

## 测试和结果

| 模块 | 已记录验收结果 |
|---|---|
| 前端回归 | 视觉升级前5个Vitest文件、12项通过；升级V2后仍需最终本机回归 |
| 20用户持续测试 | 20个地址、60.065秒、674成功交易、554次Swap、0失败 |
| 手续费与LP | 0.0831 TKA与0.0831 TKB估算输入费；LP总提取数量变化+0.071034 TKA/+0.095125 TKB |
| Bonus基础套利 | 10 TKA本金，返回11.939557080075225734 TKA，毛利1.939557080075225734 TKA |
| Bonus增强 | 8用户20笔交易形成价差；5 TKA本金，毛利3.043361852507376573 TKA；同一笔交易两Swap及失败回滚通过 |

> LP收益数值是“提取数量－原投入”的资产数量变化；不等同纯手续费分红。Bonus毛利未按ETH/Gas兑换率调整，不能直接称净利润。

## 实验报告、截图与证据

- **[完整可编辑Markdown实验报告](实验报告.md)**（含设计、原理、操作过程、收益分析与Bonus验证）
- **[操作截图索引](docs/EVIDENCE_INDEX.md)**：本次美化前端截图与此前真实链回执分类归档
- **[90–110秒视频分镜](docs/VIDEO_SCRIPT.md)**
- **[提交清单及风险项](docs/SUBMISSION_CHECKLIST.md)**
- JSON原始报告：`evidence/reports/`；历史截图：`docs/images/`；统计图：`docs/figures/`

## 架构与代码位置

```text
frontend/src/App.tsx, App.css       # 主工作台页面与样式
frontend/src/PoolExplorer.tsx       # 跨池只读报价
frontend/src/PoolManager.tsx        # 创建池相关页面
frontend/src/Pool2Liquidity.tsx     # 历史流动性流程
frontend/src/Pool2Redeem.tsx        # NFT #6历史赎回只读校验
frontend/src/PoolSources.tsx        # LP来源
contracts/contracts/MiniDEX.sol    # AMM、NFT、Swap
contracts/contracts/MockToken.sol  # 测试ERC20
contracts/contracts/BonusAtomicArbitrage.sol
contracts/test/*.mjs               # 隔离测试
```

## 安全与限制

- 多个已完成的历史写入路径保持关闭或锁定。演示时只做链上**读取**与展示既有回执，不要重复建池、领币、加池或赎回。
- `Hardhat`的`localhost`默认Chain 31337不应与Ganache 1337混淆；不要临时改网络名来解决部署地址错误。
- 首次从零部署Ganache演示环境的脚本步骤、地址重配及钱包充值因本地旧数据依赖尚未经过一键复现验收，必须针对干净环境独立验证；当前README只保证提供已验证的独立Hardhat测试命令。
- 作为课程实验，本地数据并非主网生产审计，不作“已进行完整安全审计”或“可用于真实资产”的保证。

## 提交

课程PPT要求：仓库根目录完整README、源码、操作和钱包链交互截图，以及**1–2分钟清晰压缩视频**。将公开GitHub链接与压缩视频按要求邮件提交至`hinsliu@zju.edu.cn`，邮件主题和视频文件名使用`学号_姓名_作业2`，课件截止为2026-11-06（以课程最新通知为准）。允许AI辅助学习与实现，但应如实核验、避免抄袭。

提交之前检查`.env`、私钥、助记词、`node_modules`及历史`.bak`或临时补丁是否误入远端，建议只提交稳定源代码、必要依赖锁文件、README、报告及有代表性的证据。
