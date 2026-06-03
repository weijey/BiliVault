# BiliVault — B站视频字幕 → Obsidian 知识库摄取系统

Chrome MV3 扩展。从 B站 抓取视频字幕，输出结构化 Markdown 到 Obsidian，为 LLM 知识库编译做准备。

## 功能

**单视频**
- B站视频页一键抓取字幕（自动识别分P）
- 字幕预览、复制 Markdown、下载 SRT/TXT
- 一键写入 Obsidian（Local REST API）

**批量摄取**
- 收藏夹导入（支持 medialist 和 favlist URL 格式，自动分页）
- UP主空间导入（排序：最新/最多播放/最多收藏，数量可调）
- 手动 BV 号列表导入
- 筛选管道：字幕类型 → 去重 → 时长 → 关键词 → 发布时间
- 串行队列消费（自动限速、错误恢复、进度持久化）
- 完成报告 + 知识库编译缺口提醒

**架构**
- `core/` 共享库：B站API (fetchFn 依赖注入)、字幕解析、Markdown 生成、WBI签名 (MD5)
- `batch/` 批量摄取独立页面（5步流程）
- 24 个 Playwright 浏览器集成测试

## 安装

1. `git clone` 或下载 ZIP 解压
2. Chrome → `chrome://extensions` → 开启「开发者模式」
3. 「加载已解压的扩展程序」→ 选择 `extension/` 目录
4. 右键扩展图标 → 选项 → 填写 Obsidian Local REST API 信息

## Obsidian 配置

1. 安装 `Local REST API with MCP` 插件
2. 勾选 `Enable Non-encrypted (HTTP) Server`
3. 复制 API Key → 填入扩展设置页
4. 点击「测试连接」确认连通

## 使用

**单视频**：打开 B站视频页 → 点击扩展图标 → 刷新抓取 → 复制/下载/写入 Obsidian

**批量**：点击扩展图标 → 批量抓取 → 选择来源 → 筛选 → 预览 → 执行

## 项目结构

```
extension/
├── core/           # 纯逻辑，BOC.* 命名空间
│   ├── utils.js        # 格式化、MD5、结构化日志
│   ├── bilibili-api.js # B站 API (fetchFn 注入)
│   ├── subtitle-fetcher.js  # 字幕排序/解析/校验
│   ├── markdown-builder.js  # Markdown/SRT/TXT 生成
│   ├── obsidian-client.js   # Obsidian API
│   └── subtitle-cache.js    # chrome.storage 缓存
├── content/        # 视频页 UI 壳
├── batch/          # 批量摄取独立页
├── popup/          # 弹出面板
├── options/        # 设置页
├── background.js   # Service Worker
└── manifest.json
tests/              # Playwright 集成测试
docs/               # 设计文档、实现计划
```

## 设计理念

遵循 [Karpathy LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) 的三层架构：

- **raw/** ← BiliVault 输出的 Markdown 源文件
- **wiki/** ← LLM 编译后的结构化知识
- **CLAUDE.md** ← 知识库组织规则

不只是一个下载器——是知识摄取管道的入口。

## License

MIT
