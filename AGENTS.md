# AGENTS.md — 本仓库的 AI 协作规则

本文件是本仓库 AI 编程规则的**唯一权威来源**，适用于 Codex、Claude Code、Trae、Cursor、Gemini CLI、GitHub Copilot、Qoder 等所有 AI 客户端。
`CLAUDE.md`、`GEMINI.md`、`.trae/rules/`、`.cursor/rules/`、`.github/copilot-instructions.md`、`.qoder/rules/` 等入口文件只是指向本文件的引用，不含独立规则。**修改规则只改本文件**，并保证各入口文件始终指向这里。

开始任何任务前：先读完本文件，再按需阅读 `README.md` 的相关章节。

## 1. 项目概览

「一见 · 微信公众号排版工作台」：跑在本机的公众号写作排版工具。左侧写 Markdown，右侧实时预览公众号最终效果，一键复制或写入公众号草稿箱。

- 运行时：Node.js ≥ 18（依赖内置 `fetch` / `FormData` / `Blob`）。**零 npm 运行时依赖、无构建步骤、无需 `npm install`**。
- 后端：`server.js` + `lib/`，CommonJS + 原生 `http` 模块，不使用 Express 等任何框架。
- 前端：`public/` 下原生 HTML / CSS / JS，浏览器原生 ES Modules，无框架、无打包器。
- 第三方浏览器库（Turndown、DOMPurify、Mammoth 等）本地内置于 `public/vendor/`，运行时不访问 CDN。
- 数据为本机 JSON 文件（`data/`）与图片文件（`uploads/`），无数据库。

## 2. 常用命令与验证

```bash
npm start      # 等价于 node server.js，服务地址 http://127.0.0.1:5188
npm run dev    # node --watch，改代码自动重启
```

- 项目**没有测试框架和 lint 配置**。验证方式 = 启动服务 + 浏览器实际打开页面操作确认。
- 排版类改动必须额外验证：复制到公众号 / 发布草稿后的 HTML 仍为内联样式、格式不掉。
- 端口默认 5188（可用 `PORT` 环境变量覆盖）；监听地址固定 `127.0.0.1`。

## 3. 目录职责

```text
server.js                 零依赖本地服务与全部 API（大文件，先定位再改，勿整文件重写）
lib/wechat.js             微信凭证、图片上传、素材、草稿与发布记录接口
lib/ai.js                 OpenAI 兼容模型调用、美化与续写提示词
public/index.html         工作台页面
public/css/style.css      界面样式
public/js/app.js          交互、自动保存、复制/发布、弹窗（大文件，先定位再改）
public/js/markdown.js     Markdown / 样式组件 → 内联样式 HTML
public/js/themes.js       6 套原创模板与主题合并入口
public/js/imported-themes.js  20 套花生编辑器开源主题（MIT）
public/js/components.js   17 个原创样式组件
public/js/import.js       富文本、DOCX、HTML 安全转换
public/js/cover.js        Canvas 封面生成与裁剪
public/js/api.js          前端 API 封装
public/js/icons.js        线性图标
public/vendor/            本地浏览器转换库；licenses/ 保留第三方许可证
data/                     本机数据（articles / uploads / settings），已 gitignore
uploads/                  上传图片与生成封面，已 gitignore
```

## 4. 硬性约束（红线，任何任务都不得违反）

1. **保持零依赖**：不引入 npm 运行时依赖、构建工具、前端框架、CDN 链接。确需新的浏览器第三方库时，下载放入 `public/vendor/` 并在 `public/vendor/licenses/` 保留许可证。
2. **排版输出必须内联样式**：微信编辑器会清洗 class 与外部样式。`markdown.js` / `themes.js` / `components.js` 生成的 HTML 必须全部携带 inline style；正文背景色依赖双层 section 兜底，不得改成单层。
3. **微信侧限制不得放宽**（代码中已有校验）：正文 HTML ≤ 20,000 字符且 ≤ 1MB；正文图片仅 JPG/PNG、单张 ≤ 1MB；封面 2.35:1（1080×460）；标题 ≤ 64、作者 ≤ 8、摘要 ≤ 120；贴图（newspic）标题 ≤ 32、文案 ≤ 1000 字、图片 1–20 张。
4. **微信线上资源只读**：公众号图库、草稿箱、发布记录均为只读读取，不得新增对线上素材 / 草稿 / 已发布文章的修改或删除操作；发布只写入草稿箱（`draft/add`），不得调用 `freepublish/submit` 自动群发。
5. **纯本机运行**：服务绑定 `127.0.0.1`，不得改为 `0.0.0.0`；不得加入任何遥测、统计或向第三方上传内容的逻辑。
6. **服务端抓图白名单**：只允许下载微信 CDN（`*.qpic.cn`、`*.wx.qq.com`）的 HTTPS 图片，≤ 10MB 且校验 JPG/PNG 内容；不得抓取其他网站的外链图片。

## 5. 安全与隐私

- AppSecret 与 AI API Key 只保存在本机 `data/settings.json`（权限 600）。接口响应只返回 `hasSecret` / `hasAiKey` 等脱敏字段；**密钥绝不回传浏览器、绝不写入日志、绝不提交 git**。
- `data/`、`uploads/`、`vibe_images/`、`*.log` 已被 `.gitignore` 排除。不得提交用户草稿、图片、配置；不得修改 `.gitignore` 把它们纳入版本控制。
- 富文本 / DOCX / HTML 导入必须走 `public/js/import.js` 的 DOMPurify 清洗管线，不得绕过；脚本、表单、iframe、危险链接必须清除。
- AI 功能只把待处理正文发送到用户自行配置的模型接口，不得发往其他服务。

## 6. 代码风格

- 服务端 CommonJS + `'use strict'`；前端原生 ES Modules（`import` / `export`）。
- 2 空格缩进、单引号、语句带分号；注释与 UI 文案使用中文。
- 服务端错误统一走 `ApiError`（server.js）/ `WxError`（lib/wechat.js）；微信 errcode（40164 / 40001 / 40013 / 48001 等）要透传给前端并附可操作的中文提示。
- 新功能优先在现有职责模块内扩展（见第 3 节），不要另起平行体系；限制值等常量集中定义，不散落魔法数字。
- 界面视觉与交互保持现有风格：改动 UI 时沿用 `style.css` 的设计语言，不引入新组件库。

## 7. 数据与品牌兼容

- **多账号模型**：`data/settings.json` 结构为 `{ accounts: [{id, accountName, author, appId, appSecret}], activeAccountId, aiBaseUrl, aiModel, aiApiKey }`；每篇文章带 `accountId` 绑定账号，前端列表按当前账号过滤。微信调用一律走 `activeAccount()`，access_token 按 AppID 独立缓存；AI 配置全局共用。贴图图库图片带来源 `accountId`，仅同账号发布才复用 media_id。
- localStorage 键（`mojian.current`、`mojian.preview`、`mojian.style-favorites` 等）是历史遗留标识，**改名会导致用户丢失本机草稿与收藏，禁止改动**。
- `package.json` 的 `name`（mojian-wechat-studio）同为历史标识；面向用户的品牌名统一为「一见」。
- 用户要求品牌 / 名称改动时：必须全量覆盖 UI 文案、README、package.json、favicon、示例署名等所有出现位置，并实际打开页面核对，不得只改一半。
- `data/*.json` 结构变更必须向后兼容：读取旧数据时自动补默认值，不得要求用户手动清空数据。

## 8. 协作与沟通约定

- 与用户交流使用中文。
- **修复 bug / 排查问题类任务**：先给出根因分析与修复方案选项，经用户确认后再改代码；不要直接大改。新功能开发类任务可直接实施。
- 解释技术决策时按「原理 + 示例 + 本项目中的做法」展开（用户偏后端背景，喜欢追问原理）。
- 不主动 `git commit` / `push`，仅在用户明确要求时提交。
- 提交身份使用仓库级配置（naffan2014 / naffan2014@users.noreply.github.com），不得使用公司邮箱，不得修改 git config。
- 远程仓库的创建 / 删除由用户本人在网页操作，不代为执行。
- 交付前说明实际验证了什么、哪些没验证；不得把未运行的检查描述为已通过。

## 9. 动手前快速自检

- 是否引入依赖 / CDN / 框架？→ 不允许。
- 是否触碰密钥回传、线上素材写操作、监听地址？→ 红线。
- 排版输出是否仍为内联样式？双层 section 是否保留？
- 旧数据与 localStorage 键是否兼容？
- 是否已启动服务并在浏览器实际验证？