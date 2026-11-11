'use strict';

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const wechat = require('./lib/wechat');
const ai = require('./lib/ai');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const ARTICLES_FILE = path.join(DATA_DIR, 'articles.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const UPLOADS_META_FILE = path.join(DATA_DIR, 'uploads.json');
const SAMPLE_DIR = path.join(PUBLIC_DIR, 'assets');

const PORT = Number(process.env.PORT || 5188);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const SAMPLE_IMAGES = [
  { file: 'sample-desk.jpg', displayName: '午后书桌.jpg', width: 1400, height: 933 },
  { file: 'sample-window.jpg', displayName: '雨天窗边.jpg', width: 1400, height: 933 },
];

const PIC_MAX_IMAGES = 20;
const PIC_MAX_COPY = 1000;
const PIC_MAX_TITLE = 32;
const PIC_IMAGE_LIMIT = 1024 * 1024; // 贴图按公众号图片消息的保守上限做校验

let articles = [];
let settings = {};
let uploadMeta = {};

class ApiError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/* ---------------------------------- store --------------------------------- */

async function readJson(file, fallback) {
  try {
    const raw = await fsp.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(file, value, mode) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  if (mode) await fsp.chmod(tmp, mode);
  await fsp.rename(tmp, file);
}

async function persistArticles() {
  await writeJson(ARTICLES_FILE, articles);
}

async function persistSettings() {
  await writeJson(SETTINGS_FILE, settings, 0o600);
}

async function persistUploadMeta() {
  await writeJson(UPLOADS_META_FILE, uploadMeta);
}

function seedArticle() {
  const now = new Date().toISOString();
  const markdown = `> 有些时刻，我们需要的不是更多信息，而是一张能安放思绪的桌子。

窗外的光慢慢斜过来，落在摊开的纸页上。杯子里的茶已经温了，笔尖停在半空——这样的停顿，最近变得越来越奢侈。

我们习惯了把一天切成很多块：消息、会议、通勤、回复。可真正留下来的东西，往往诞生于那些没有被切碎的片刻。

## 为什么我们需要一张书桌

书桌不只是一件家具，它更像一个边界。坐下来的那一刻，世界被暂时放在门外，你终于可以只面对一件事。

![午后，光落在纸页上](/uploads/sample-desk.jpg)

:::tip 一个小练习
每天给自己留出二十分钟，不处理消息，只写下一件此刻真正在意的事。不用写得好看，只要诚实。
:::

## 让空间替你说话

- **光线要柔和**：自然光最好，桌面避免直射的强光。
- **视线要留白**：正前方不要堆满东西，留一块空白给思绪。
- **触感要具体**：一支顺手的笔、一只喜欢的杯子，都是进入状态的开关。

### 关于工具的一点偏见

我不再追求「最完美」的工具。纸和笔、一个干净的编辑器、一台能随时合上的电脑，足够开始了。真正重要的，是你愿意坐下来。

> 写作不是把想法倒出来，而是借着写字，把想法慢慢想清楚。

![雨落下来的时候，窗外的绿意更深了一层](/uploads/sample-window.jpg)

雨落下来的时候，书页合上，茶凉了也没关系。明天，这张桌子还会在这里。

---

*本文由「一见」排版 · 模板「纸间」*`;

  return {
    id: crypto.randomUUID(),
    kind: 'article',
    title: '在喧闹世界里，留一张安静的书桌',
    markdown,
    themeId: 'paper',
    options: { fontSize: 16, lineHeight: 1.9, accent: '' },
    cover: '/uploads/sample-desk.jpg',
    author: '一见',
    digest: '关于书桌、注意力，以及把想法慢慢想清楚的片刻。',
    sourceUrl: '',
    createdAt: now,
    updatedAt: now,
  };
}

async function init() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });

  articles = await readJson(ARTICLES_FILE, []);
  if (Array.isArray(articles)) {
    // 旧数据没有 kind 字段，统一按图文处理，避免读取时出现第三种状态
    articles = articles.map((article) => ({
      ...article,
      kind: article.kind === 'pic' ? 'pic' : 'article',
    }));
  }
  settings = await readJson(SETTINGS_FILE, {});
  uploadMeta = await readJson(UPLOADS_META_FILE, {});

  let changedMeta = false;
  for (const sample of SAMPLE_IMAGES) {
    const src = path.join(SAMPLE_DIR, sample.file);
    const dest = path.join(UPLOAD_DIR, sample.file);
    if (fs.existsSync(src) && !fs.existsSync(dest)) {
      await fsp.copyFile(src, dest);
    }
    if (fs.existsSync(dest) && !uploadMeta[sample.file]) {
      const stat = await fsp.stat(dest);
      uploadMeta[sample.file] = {
        name: sample.displayName,
        width: sample.width,
        height: sample.height,
        size: stat.size,
        createdAt: new Date().toISOString(),
        sample: true,
      };
      changedMeta = true;
    }
  }

  if (!Array.isArray(articles) || articles.length === 0) {
    articles = [seedArticle()];
    await persistArticles();
  }

  if (!settings.accountName) settings.accountName = '我的公众号';
  if (typeof settings.author !== 'string') settings.author = '';
  if (typeof settings.appId !== 'string') settings.appId = '';
  if (typeof settings.appSecret !== 'string') settings.appSecret = '';
  if (typeof settings.aiBaseUrl !== 'string') settings.aiBaseUrl = '';
  if (settings.aiBaseUrl) {
    try {
      settings.aiBaseUrl = ai.normalizeBaseUrl(settings.aiBaseUrl);
    } catch {
      /* 保留原值，等用户下次保存时再校验 */
    }
  }
  if (typeof settings.aiModel !== 'string') settings.aiModel = '';
  if (typeof settings.aiApiKey !== 'string') settings.aiApiKey = '';

  await persistSettings();
  if (changedMeta) await persistUploadMeta();
}

/* --------------------------------- helpers -------------------------------- */

function publicSettings() {
  return {
    appId: settings.appId || '',
    hasSecret: Boolean(settings.appSecret),
    accountName: settings.accountName || '我的公众号',
    author: settings.author || '',
    aiBaseUrl: settings.aiBaseUrl || '',
    aiModel: settings.aiModel || '',
    hasAiKey: Boolean(settings.aiApiKey),
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req, limit = 30 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new ApiError(413, '请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new ApiError(400, '请求数据不是合法的 JSON'));
      }
    });
    req.on('error', reject);
  });
}

function cleanText(value, max = 200) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function httpUrl(value) {
  const text = String(value == null ? '' : value).trim();
  return /^https?:\/\//i.test(text) ? text.slice(0, 1000) : '';
}


function findArticle(id) {
  return articles.find((item) => item.id === id);
}

function normalizePicImage(value) {
  if (!value || typeof value !== 'object') return null;
  const url = String(value.url || '').trim().slice(0, 1000);
  if (!url) return null;
  return {
    url,
    name: cleanText(value.name, 120) || '图片.jpg',
    width: Number(value.width) || 0,
    height: Number(value.height) || 0,
    source: value.source === 'wechat' ? 'wechat' : 'local',
    mediaId: cleanText(value.mediaId, 256),
  };
}

function normalizePicImages(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizePicImage).filter(Boolean).slice(0, PIC_MAX_IMAGES);
}

function htmlToPlain(markdown) {
  return String(markdown || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*`~=|\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uploadList() {
  const files = fs.readdirSync(UPLOAD_DIR).filter((name) => !name.startsWith('.'));
  const items = files.map((file) => {
    const stat = fs.statSync(path.join(UPLOAD_DIR, file));
    const meta = uploadMeta[file] || {};
    return {
      file,
      url: `/uploads/${encodeURIComponent(file)}`,
      name: meta.name || file,
      width: meta.width || 0,
      height: meta.height || 0,
      size: meta.size || stat.size,
      createdAt: meta.createdAt || stat.birthtime.toISOString(),
      sample: Boolean(meta.sample),
    };
  });
  return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function countImageReferences(file) {
  const url = `/uploads/${file}`;
  let count = 0;
  for (const article of articles) {
    if ((article.markdown || '').includes(url)) count += 1;
    if (article.cover === url) count += 1;
    if (Array.isArray(article.images) && article.images.some((image) => image?.url === url)) count += 1;
  }
  return count;
}

/* -------------------------------- static ---------------------------------- */

function serveStatic(req, res, pathname) {
  let baseDir = PUBLIC_DIR;
  let rel = pathname;

  if (pathname.startsWith('/uploads/')) {
    baseDir = UPLOAD_DIR;
    rel = pathname.slice('/uploads'.length);
  }

  let decoded;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return sendText(res, 400, 'Bad request');
  }
  if (decoded === '/' || decoded === '') decoded = '/index.html';

  const filePath = path.resolve(baseDir, `.${decoded}`);
  if (!filePath.startsWith(path.resolve(baseDir) + path.sep)) {
    return sendText(res, 403, 'Forbidden');
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return sendText(res, 404, 'Not found');
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': ext === '.html' ? 'no-store' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(text);
}

/* -------------------------------- wechat ---------------------------------- */

function friendlyWxError(err) {
  if (!(err instanceof wechat.WxError)) return null;
  const code = err.errcode;
  if (code === 40164) {
    return `当前出口 IP 不在公众号白名单中${err.ip ? `（${err.ip}）` : ''}。请到公众号后台「设置与开发 → 基本配置 → IP 白名单」添加后重试。`;
  }
  if (code === 40001 || code === 40014 || code === 42001) {
    return 'AppSecret 不正确，或 access_token 已失效。请重新检查接口配置后重试。';
  }
  if (code === 40013) return 'AppID 不正确，请检查公众号接口配置。';
  if (code === 48001) return '当前公众号没有调用该接口的权限，请确认公众号已认证，并具备素材管理、草稿箱或发布记录等相应接口权限。';
  if (code === 45009) return '微信接口调用频率超限，请稍后再试。';
  if (code === 40007) return '图片素材无效或已失效（media_id 不存在），请重新选择或上传图片后重试。';
  if (code === 40009) return '图片格式或大小不符合微信要求，请使用 1MB 以内的 JPG / PNG 图片。';
  if (code === 'NO_CREDENTIALS') return '尚未配置公众号 AppID / AppSecret。';
  if (code === 'IMAGE_TOO_LARGE') return err.message;
  if (code === 'NETWORK' || code === 'TIMEOUT') return err.message;
  return `微信接口错误（${code}）：${err.errmsg}`;
}

async function handlePublish(body) {
  return body.kind === 'pic' ? handlePicDraft(body) : handleArticlePublish(body);
}

async function handlePicDraft(body) {
  const title = cleanText(body.title, 200);
  const copy = String(body.copy == null ? '' : body.copy);
  const rawImages = Array.isArray(body.images) ? body.images : [];
  let author = cleanText(body.author, 40);
  const warnings = [];

  if (!title) throw new ApiError(400, '请先填写贴图标题');
  if (title.length > PIC_MAX_TITLE) {
    throw new ApiError(400, `贴图标题最多 ${PIC_MAX_TITLE} 个字符，当前 ${title.length} 个`);
  }
  if (!rawImages.length) throw new ApiError(400, '贴图至少需要 1 张图片');
  if (rawImages.length > PIC_MAX_IMAGES) {
    throw new ApiError(400, `贴图最多 ${PIC_MAX_IMAGES} 张图片，当前 ${rawImages.length} 张`);
  }
  if (!copy.trim()) throw new ApiError(400, '请填写贴图文案');
  if (copy.length > PIC_MAX_COPY) {
    throw new ApiError(400, `贴图文案最多 ${PIC_MAX_COPY} 个字符，当前 ${copy.length} 个`);
  }

  const images = rawImages.map((value, index) => {
    const image = normalizePicImage(value);
    if (!image) throw new ApiError(400, `第 ${index + 1} 张图片缺少有效地址，请重新添加`);
    return image;
  });

  if (author.length > 8) {
    author = author.slice(0, 8);
    warnings.push('作者名超过 8 个字符，已按微信限制截断');
  }

  const token = await wechat.getToken(settings);
  const mediaIds = [];
  let uploaded = 0;
  let reused = 0;

  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    try {
      // 公众号图库图片本身就是永久素材，能直接复用 media_id 时不再重复上传
      if (image.source === 'wechat' && image.mediaId) {
        mediaIds.push(image.mediaId);
        reused += 1;
        continue;
      }
      const localName = wechat.localNameFromUrl(image.url);
      if (localName) {
        const file = wechat.resolveUpload(UPLOAD_DIR, localName);
        if (!file) throw new Error('本机图片不存在，请重新选择');
        const stat = await fsp.stat(file);
        if (stat.size > PIC_IMAGE_LIMIT) throw new Error('图片超过 1MB，请先压缩后重试');
        const uploadedImage = await wechat.uploadPermanentImage(token, file);
        mediaIds.push(uploadedImage.media_id);
        uploaded += 1;
        continue;
      }
      if (wechat.isWeChatImageUrl(image.url)) {
        const remote = await wechat.downloadWeChatImage(image.url);
        if (remote.buffer.length > PIC_IMAGE_LIMIT) throw new Error('图片超过 1MB，请先压缩后重试');
        const uploadedImage = await wechat.uploadPermanentImageBuffer(token, remote.buffer, remote.name);
        mediaIds.push(uploadedImage.media_id);
        uploaded += 1;
        continue;
      }
      throw new Error('图片地址无法识别，请从本机素材或公众号图库重新选择');
    } catch (err) {
      if (err instanceof ApiError) throw err;
      // 永久素材上传复用了封面接口，按贴图语境替换掉“封面”措辞
      const reason = err instanceof wechat.WxError && err.errcode === 'COVER_FORMAT'
        ? '仅支持 JPG / PNG 图片'
        : err.message;
      throw new ApiError(400, `第 ${index + 1} 张图片处理失败：${reason}`);
    }
  }

  const draft = await wechat.addDraft(token, {
    article_type: 'newspic',
    title,
    author,
    content: copy,
    need_open_comment: body.needOpenComment === false ? 0 : 1,
    only_fans_can_comment: body.onlyFansCanComment ? 1 : 0,
    image_info: {
      image_list: mediaIds.map((mediaId) => ({ image_media_id: mediaId })),
    },
  });

  return {
    kind: 'pic',
    mediaId: draft.media_id,
    imageCount: mediaIds.length,
    uploadedImages: uploaded,
    reusedImages: reused,
    warnings,
  };
}

async function handleArticlePublish(body) {
  const title = cleanText(body.title, 200);
  const content = String(body.content || '');
  const digest = cleanText(body.digest, 300);
  const sourceUrl = cleanText(body.sourceUrl, 500);
  let author = cleanText(body.author, 40);
  const warnings = [];

  if (!title) throw new ApiError(400, '请先填写文章标题');
  if (title.length > 64) throw new ApiError(400, `公众号标题最多 64 个字符，当前 ${title.length} 个`);
  if (!content.trim()) throw new ApiError(400, '正文为空，无法发布');
  if (content.length > 20000) {
    throw new ApiError(400, `正文 HTML 有 ${content.length} 个字符，超过公众号草稿 20000 字符的限制，请精简排版或拆分文章`);
  }
  if (Buffer.byteLength(content, 'utf8') > 1024 * 1024) {
    throw new ApiError(400, '正文 HTML 超过 1MB，请精简图片或拆分文章');
  }

  if (author.length > 8) {
    author = author.slice(0, 8);
    warnings.push('作者名超过 8 个字符，已按微信限制截断');
  }

  // 前端发布表单使用 cover 字段，旧接口/脚本可能使用 coverUrl，两者都兼容
  const coverUrl = body.cover || body.coverUrl;
  const coverName = wechat.localNameFromUrl(coverUrl);
  const coverFile = coverName ? wechat.resolveUpload(UPLOAD_DIR, coverName) : null;
  const coverIsWeChat = !coverFile && wechat.isWeChatImageUrl(coverUrl);
  if (!coverFile && !coverIsWeChat) {
    throw new ApiError(400, '发布前需要一张封面图，请从本机素材或正文里的公众号图片中选择');
  }

  const token = await wechat.getToken(settings);

  const prepared = await wechat.prepareContentWithToken(content, UPLOAD_DIR, token);
  if (prepared.skipped.length) {
    const detail = prepared.skipped.slice(0, 3).map((item) => `${item.url}（${item.reason}）`).join('；');
    throw new ApiError(400, `有 ${prepared.skipped.length} 张正文图片无法上传到微信：${detail}`);
  }

  let cover;
  if (coverFile) {
    cover = await wechat.uploadPermanentImage(token, coverFile);
  } else {
    const remote = await wechat.downloadWeChatImage(coverUrl);
    cover = await wechat.uploadPermanentImageBuffer(token, remote.buffer, remote.name);
  }

  const draft = await wechat.addDraft(token, {
    title,
    author,
    digest: digest.slice(0, 120),
    content: prepared.content,
    content_source_url: sourceUrl,
    thumb_media_id: cover.media_id,
    need_open_comment: body.needOpenComment ? 1 : 0,
    only_fans_can_comment: body.onlyFansCanComment ? 1 : 0,
  });

  return {
    mediaId: draft.media_id,
    uploadedImages: prepared.uploaded,
    coverUrl: cover.url || '',
    warnings,
  };
}

/* ---------------------------------- api ----------------------------------- */

async function handleApi(req, res, pathname, url) {
  if (req.method === 'GET' && pathname === '/api/bootstrap') {
    return sendJson(res, 200, {
      ok: true,
      articles,
      uploads: uploadList(),
      settings: publicSettings(),
    });
  }

  if (req.method === 'POST' && pathname === '/api/articles') {
    const body = await readBody(req);
    const now = new Date().toISOString();
    const kind = body.kind === 'pic' ? 'pic' : 'article';
    const article = {
      id: crypto.randomUUID(),
      kind,
      title: cleanText(body.title, 200) || (kind === 'pic' ? '未命名贴图' : '未命名文章'),
      markdown: kind === 'pic' ? '' : String(body.markdown || ''),
      themeId: kind === 'pic' ? 'paper' : body.themeId || 'paper',
      options: {
        fontSize: 16,
        lineHeight: 1.9,
        accent: '',
        ...(body.options && typeof body.options === 'object' ? body.options : {}),
      },
      cover: '',
      author: cleanText(body.author, 40),
      digest: kind === 'pic' ? '' : cleanText(body.digest, 300),
      sourceUrl: '',
      createdAt: now,
      updatedAt: now,
    };
    if (kind === 'pic') {
      article.images = normalizePicImages(body.images);
      article.copy = cleanText(body.copy, PIC_MAX_COPY);
      article.needOpenComment = body.needOpenComment !== false;
    }
    articles.unshift(article);
    await persistArticles();
    return sendJson(res, 200, { ok: true, article });
  }

  const articleMatch = pathname.match(/^\/api\/articles\/([0-9a-fA-F-]+)$/);
  if (articleMatch) {
    const article = findArticle(articleMatch[1]);
    if (!article) return sendJson(res, 404, { ok: false, error: { message: '文章不存在' } });

    if (req.method === 'PUT') {
      const body = await readBody(req);
      if (typeof body.title === 'string') article.title = body.title.slice(0, 200);
      if (typeof body.markdown === 'string') article.markdown = body.markdown;
      if (typeof body.themeId === 'string') article.themeId = body.themeId;
      if (body.options && typeof body.options === 'object') {
        article.options = {
          fontSize: Number(body.options.fontSize) || 16,
          lineHeight: Number(body.options.lineHeight) || 1.9,
          accent: typeof body.options.accent === 'string' ? body.options.accent : '',
        };
      }
      if (typeof body.cover === 'string') article.cover = body.cover;
      if (typeof body.author === 'string') article.author = body.author.slice(0, 40);
      if (typeof body.digest === 'string') article.digest = body.digest.slice(0, 300);
      if (typeof body.sourceUrl === 'string') article.sourceUrl = body.sourceUrl.slice(0, 500);
      if (article.kind === 'pic') {
        if (Array.isArray(body.images)) article.images = normalizePicImages(body.images);
        if (typeof body.copy === 'string') article.copy = body.copy.slice(0, PIC_MAX_COPY);
        if (typeof body.needOpenComment === 'boolean') article.needOpenComment = body.needOpenComment;
      }
      article.updatedAt = new Date().toISOString();
      await persistArticles();
      return sendJson(res, 200, { ok: true, article });
    }

    if (req.method === 'DELETE') {
      articles = articles.filter((item) => item.id !== article.id);
      await persistArticles();
      return sendJson(res, 200, { ok: true });
    }
  }

  if (req.method === 'GET' && pathname === '/api/uploads') {
    return sendJson(res, 200, { ok: true, uploads: uploadList() });
  }

  // 公众号图库图片在微信 CDN 上，浏览器 canvas 直接读取会被跨域污染。
  // 这里只代理微信域名、只读、限 10MB 的 JPG/PNG，裁剪后仍会存回本机素材。
  if (req.method === 'GET' && pathname === '/api/wechat/image') {
    const target = url.searchParams.get('url') || '';
    if (!wechat.isWeChatImageUrl(target)) {
      throw new ApiError(400, '只能读取公众号图库里的图片');
    }
    const remote = await wechat.downloadWeChatImage(target);
    res.writeHead(200, {
      'Content-Type': remote.mime,
      'Content-Length': remote.buffer.length,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(remote.buffer);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/upload') {
    const body = await readBody(req);
    const dataUrl = String(body.dataUrl || '');
    const match = dataUrl.match(/^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=\s]+)$/);
    if (!match) throw new ApiError(400, '只支持 PNG / JPG / WebP / GIF 图片');
    const ext = match[1] === 'jpeg' ? 'jpg' : match[1] === 'jpg' ? 'jpg' : match[1];
    const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
    if (!buffer.length) throw new ApiError(400, '图片内容为空');
    if (buffer.length > 12 * 1024 * 1024) throw new ApiError(400, '图片不能超过 12MB');

    const displayName = cleanText(body.name, 80) || `图片.${ext}`;
    const base = path
      .basename(displayName, path.extname(displayName))
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'image';
    const file = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}-${base}.${ext}`;
    await fsp.writeFile(path.join(UPLOAD_DIR, file), buffer);
    uploadMeta[file] = {
      name: displayName,
      width: Number(body.width) || 0,
      height: Number(body.height) || 0,
      size: buffer.length,
      createdAt: new Date().toISOString(),
    };
    await persistUploadMeta();

    return sendJson(res, 200, {
      ok: true,
      file: {
        file,
        url: `/uploads/${encodeURIComponent(file)}`,
        ...uploadMeta[file],
      },
    });
  }

  const uploadMatch = pathname.match(/^\/api\/uploads\/([^/]+)$/);
  if (uploadMatch && req.method === 'DELETE') {
    const file = decodeURIComponent(uploadMatch[1]);
    if (file.includes('..') || file.includes('/') || file.includes('\\')) {
      throw new ApiError(400, '文件名不合法');
    }
    const filePath = path.join(UPLOAD_DIR, file);
    if (!fs.existsSync(filePath)) throw new ApiError(404, '图片不存在');
    const refs = countImageReferences(file);
    if (refs > 0 && !url.searchParams.get('force')) {
      throw new ApiError(409, `这张图片正被 ${refs} 篇文章引用，请先从文章中移除后再删除`);
    }
    await fsp.unlink(filePath).catch(() => {});
    delete uploadMeta[file];
    await persistUploadMeta();
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && pathname === '/api/settings') {
    return sendJson(res, 200, { ok: true, settings: publicSettings() });
  }

  if (req.method === 'PUT' && pathname === '/api/settings') {
    const body = await readBody(req);
    if (typeof body.appId === 'string') settings.appId = body.appId.trim();
    if (typeof body.appSecret === 'string' && body.appSecret.trim()) {
      settings.appSecret = body.appSecret.trim();
    }
    if (body.clearSecret) settings.appSecret = '';
    if (typeof body.accountName === 'string') settings.accountName = body.accountName.trim().slice(0, 40) || '我的公众号';
    if (typeof body.author === 'string') settings.author = body.author.trim().slice(0, 40);
    if (typeof body.aiBaseUrl === 'string') {
      const baseUrl = body.aiBaseUrl.trim();
      if (baseUrl) {
        try {
          // 统一存成 Base URL：去掉结尾斜杠和误贴的 /chat/completions
          settings.aiBaseUrl = ai.normalizeBaseUrl(baseUrl);
        } catch (err) {
          throw new ApiError(400, err.message);
        }
      } else {
        settings.aiBaseUrl = '';
      }
    }
    if (typeof body.aiModel === 'string') settings.aiModel = body.aiModel.trim().slice(0, 120);
    if (typeof body.aiApiKey === 'string' && body.aiApiKey.trim()) {
      settings.aiApiKey = body.aiApiKey.trim().slice(0, 400);
    }
    if (body.clearAiKey) settings.aiApiKey = '';
    await persistSettings();
    return sendJson(res, 200, { ok: true, settings: publicSettings() });
  }

  if (req.method === 'POST' && pathname === '/api/ai/models') {
    const body = await readBody(req);
    const result = await ai.listModels(settings, { baseUrl: body.baseUrl, apiKey: body.apiKey });
    return sendJson(res, 200, { ok: true, ...result });
  }

  if (req.method === 'POST' && pathname === '/api/ai/beautify') {
    const body = await readBody(req);
    const result = await ai.beautify(settings, body);
    return sendJson(res, 200, { ok: true, ...result });
  }

  if (req.method === 'POST' && pathname === '/api/ai/continue') {
    const body = await readBody(req);
    const result = await ai.continueWriting(settings, body);
    return sendJson(res, 200, { ok: true, ...result });
  }

  if (req.method === 'GET' && pathname === '/api/wechat/materials') {
    const offset = Number(url.searchParams.get('offset') || 0);
    const count = Number(url.searchParams.get('count') || 20);
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(count) || count < 1 || count > 20) {
      throw new ApiError(400, '图库分页参数不正确：offset 需不小于 0，count 范围为 1–20');
    }
    const token = await wechat.getToken(settings);
    const data = await wechat.listPermanentImages(token, { offset, count });
    const items = data.item.map((item) => ({
      mediaId: cleanText(item.media_id, 256),
      name: cleanText(item.name, 200) || '公众号图片',
      updateTime: Number(item.update_time) || 0,
      url: /^https?:\/\//i.test(String(item.url || '')) ? String(item.url) : '',
    })).filter((item) => item.mediaId && item.url);
    const total = Math.max(0, Number(data.total_count) || 0);
    const itemCount = Math.max(0, Number(data.item_count) || data.item.length);
    return sendJson(res, 200, {
      ok: true,
      items,
      offset,
      count,
      total,
      hasMore: offset + itemCount < total,
    });
  }

  if (req.method === 'GET' && pathname === '/api/wechat/published') {
    const offset = Number(url.searchParams.get('offset') || 0);
    const count = Number(url.searchParams.get('count') || 20);
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(count) || count < 1 || count > 20) {
      throw new ApiError(400, '发布记录分页参数不正确：offset 需不小于 0，count 范围为 1–20');
    }
    const token = await wechat.getToken(settings);
    const data = await wechat.listPublished(token, { offset, count });
    const items = data.item.flatMap((record) => {
      const news = Array.isArray(record.content?.news_item) ? record.content.news_item : [];
      const articleId = cleanText(record.article_id, 256);
      const timestamp = Number(record.update_time || record.content?.update_time || record.content?.create_time) || 0;
      return news.map((article, index) => {
        const url = String(article.url || '');
        const thumbUrl = String(article.thumb_url || '');
        return {
          id: `${articleId}:${index}`,
          articleId,
          title: cleanText(article.title, 200) || '未命名文章',
          author: cleanText(article.author, 40),
          digest: cleanText(article.digest, 300),
          url: /^https?:\/\//i.test(url) ? url : '',
          thumbUrl: /^https?:\/\//i.test(thumbUrl) ? thumbUrl : '',
          sourceUrl: cleanText(article.content_source_url, 500),
          publishedAt: timestamp > 0 ? new Date(timestamp * 1000).toISOString() : '',
          position: index + 1,
          groupSize: news.length,
          deleted: Boolean(article.is_deleted),
        };
      }).filter((article) => article.articleId && !article.deleted);
    });
    const total = Math.max(0, Number(data.total_count) || 0);
    const itemCount = Math.max(0, Number(data.item_count) || data.item.length);
    return sendJson(res, 200, {
      ok: true,
      items,
      offset,
      count,
      total,
      hasMore: offset + itemCount < total,
    });
  }

  if (req.method === 'GET' && pathname === '/api/wechat/drafts') {
    const offset = Number(url.searchParams.get('offset') || 0);
    const count = Number(url.searchParams.get('count') || 10);
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(count) || count < 1 || count > 20) {
      throw new ApiError(400, '草稿箱分页参数不正确：offset 需不小于 0，count 范围为 1–20');
    }
    const token = await wechat.getToken(settings);
    const data = await wechat.listDrafts(token, { offset, count });
    const items = data.item.map((record) => {
      const news = Array.isArray(record.content?.news_item) ? record.content.news_item : [];
      const articles = news.map((article, index) => {
        const imageList = Array.isArray(article.image_info?.image_list) ? article.image_info.image_list : [];
        const articleType = article.article_type === 'newspic' ? 'newspic' : 'news';
        return {
          title: cleanText(article.title, 200) || '未命名文章',
          author: cleanText(article.author, 40),
          digest: cleanText(article.digest, 300),
          thumbUrl: httpUrl(article.thumb_url),
          url: httpUrl(article.url),
          position: index + 1,
          deleted: Boolean(article.is_deleted),
          articleType,
          imageCount: articleType === 'newspic' ? imageList.length : 0,
        };
      }).filter((article) => !article.deleted);
      const timestamp = Number(record.update_time) || 0;
      return {
        mediaId: cleanText(record.media_id, 256),
        updateTime: timestamp,
        updatedAt: timestamp > 0 ? new Date(timestamp * 1000).toISOString() : '',
        articles,
      };
    }).filter((item) => item.mediaId && item.articles.length);
    const total = Math.max(0, Number(data.total_count) || 0);
    const itemCount = Math.max(0, Number(data.item_count) || data.item.length);
    return sendJson(res, 200, {
      ok: true,
      items,
      offset,
      count,
      total,
      hasMore: offset + itemCount < total,
    });
  }

  if (req.method === 'POST' && pathname === '/api/wechat/test') {
    await wechat.getToken(settings, true);
    return sendJson(res, 200, {
      ok: true,
      message: '连接成功，接口凭证有效',
    });
  }

  if (req.method === 'POST' && pathname === '/api/wechat/prepare') {
    const body = await readBody(req);
    const content = String(body.content || '');
    if (!content.trim()) throw new ApiError(400, '内容为空');
    const token = await wechat.getToken(settings);
    const result = await wechat.prepareContentWithToken(content, UPLOAD_DIR, token);
    return sendJson(res, 200, {
      ok: true,
      content: result.content,
      uploaded: result.uploaded,
      skipped: result.skipped,
    });
  }

  if (req.method === 'POST' && pathname === '/api/wechat/publish') {
    const body = await readBody(req);
    const result = await handlePublish(body);
    return sendJson(res, 200, { ok: true, ...result });
  }

  return sendJson(res, 404, { ok: false, error: { message: '接口不存在' } });
}

/* --------------------------------- server --------------------------------- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return sendText(res, 400, 'Bad request');
  }

  if (!pathname.startsWith('/api/')) {
    return serveStatic(req, res, pathname);
  }

  try {
    await handleApi(req, res, pathname, url);
  } catch (err) {
    if (res.headersSent) return;
    if (err instanceof wechat.WxError) {
      const message = friendlyWxError(err) || err.message;
      return sendJson(res, 400, {
        ok: false,
        error: {
          message,
          code: err.errcode,
          ip: err.ip,
          detail: err.errmsg,
        },
      });
    }
    if (err instanceof ai.AiError) {
      return sendJson(res, 400, {
        ok: false,
        error: { message: err.message, code: err.code, detail: err.detail },
      });
    }
    if (err instanceof ApiError) {
      return sendJson(res, err.status, { ok: false, error: { message: err.message, ...err.extra } });
    }
    console.error('[server]', err);
    return sendJson(res, 500, { ok: false, error: { message: '服务器内部错误：' + err.message } });
  }
});

init()
  .then(() => {
    server.listen(PORT, HOST, () => {
      console.log('');
      console.log('  一见 · 微信公众号排版工作台');
      console.log(`  http://${HOST}:${PORT}`);
      console.log('');
      console.log('  数据目录：data/    图片目录：uploads/');
      console.log('  按 Ctrl+C 停止');
      console.log('');
    });
  })
  .catch((err) => {
    console.error('启动失败：', err);
    process.exit(1);
  });

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用，可换一个端口启动：PORT=5189 npm start`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
