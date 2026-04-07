# Deribit APR Calculator

Chrome 扩展，在 Tibired 期权交易页面实时计算并显示 APR（年化收益率）。

专为 **期权卖方** 设计，只显示 **虚值期权** 的 APR，帮助您快速发现最佳卖出机会。

## 功能特性

- 在期权链的买价、卖价旁实时显示 APR
- 同时支持 **BTC** 和 **ETH** 期权
- **仅显示虚值期权 APR**：
  - 虚值 Call (OTM)：行权价 > 标价现价 → 显示 APR
  - 虚值 Put (OTM)：行权价 < 标价现价 → 显示 APR
  - 实值期权不显示 APR（卖方风险更高）
- 实时更新：价格变化时自动重新计算 APR
- 一键开关：可随时开启/关闭 APR 显示
- 颜色区分：
  - Put APR：蓝色（BTC）/ 紫色（ETH）
  - Call APR：橙色（BTC）/ 黄色（ETH）

## APR 计算公式

### Put (Cash-Secured Put)
```
APR = (期权权利金 / 行权价) × (365 / 剩余天数) × 100%
```
本金基数 = 行权价（卖出 Put 需锁定的现金）

### Call (Covered Call)
```
APR = (期权权利金 / 标的现价) × (365 / 剩余天数) × 100%
```
本金基数 = 标的资产现价（持有资产卖出 Call）

## 安装方法

1. **下载扩展文件**
   ```bash
   git clone <repo-url>
   cd deribit-apr
   ```

2. **加载到 Chrome**
   - 打开 Chrome，访问 `chrome://extensions/`
   - 开启右上角 "开发者模式"
   - 点击 "加载已解压的扩展程序"
   - 选择 `deribit-apr` 目录

3. **使用扩展**
   - 访问 [Tibired](https://tibired.com) 期权页面
   - 扩展会自动在买价、卖价旁显示 APR
   - 点击扩展图标可开启/关闭 APR 显示

## 文件结构

```
deribit-apr/
├── manifest.json      # Chrome 扩展配置 (Manifest V3)
├── content.js         # 核心脚本 - DOM 操作和 APR 计算
├── styles.css         # 样式文件
├── popup.html         # 扩展弹窗界面
├── popup.js           # 弹窗交互逻辑
├── background.js      # Service Worker
├── icons/             # 扩展图标
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## 技术实现

### 页面适配
扩展通过以下方式识别期权数据：
- 期权行：`data-id="BTC_USDC-24APR26-66000-C"` 格式
- 买价列：`data-colid="best_bid_price"`
- 卖价列：`data-colid="best_ask_price"`

### 实时更新
使用 MutationObserver 监听价格变化，配合防抖机制（200ms）避免频繁计算。

### 价格获取
从页面上的 "标的期货" 标签获取当前 BTC/ETH 价格。

## 注意事项

- 仅显示有买价或卖价的期权，无报价的期权不显示 APR
- APR 仅供参考，实际收益取决于多种因素
- 页面结构变化可能导致扩展失效，需要更新选择器

## License

MIT