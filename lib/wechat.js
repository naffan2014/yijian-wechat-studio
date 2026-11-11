'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const API = 'https://api.weixin.qq.com/cgi-bin';
const CONTENT_IMAGE_LIMIT = 1024 * 1024; // uploadimg 接口限制 1MB
const COVER_IMAGE_LIMIT = 10 * 1024 * 1024; // 永久图片素材限制 10MB

let tokenCache = { appId: '', token: '', expiresAt: 0 };

class WxError extends Error {
  constructor(errcode, errmsg, extra = {}) {
    super(errmsg || `微信接口错误 ${errcode}`);
    this.name = 'WxError';
    this.errcode = errcode;
    this.errmsg = errmsg || '';
    this.ip = extra.ip || '';
  }
}

function mimeOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

function assertSupportedImage(file) {
  const ext = path.extname(file).toLowerCase();
  if (!['.jpg', '.jpeg', '.png'].includes(ext)) {
    throw new WxError('LOCAL_FORMAT', `微信正文图片仅支持 JPG / PNG，${path.basename(file)} 需要先转换格式`);
  }
}

async function requestJson(url, options = {}, timeout = 30000) {
  let res;
  try {
    res = await fetch(url, { ...options, signal: AbortSignal.timeout(timeout) });
  } catch (err) {
    if (err.name === 'TimeoutError') {
      throw new WxError('TIMEOUT', '连接微信服务器超时，请检查网络后重试');
    }
    throw new WxError('NETWORK', `无法连接微信服务器：${err.message}`);
  }
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new WxError('BAD_RESPONSE', `微信接口返回了无法解析的内容（HTTP ${res.status}）`);
  }
  if (data.errcode) {
    throw new WxError(data.errcode, data.errmsg, { ip: data.ip });
  }
  if (!res.ok) {
    throw new WxError('HTTP_' + res.status, `微信接口返回 HTTP ${res.status}`);
  }
  return data;
}

async function getToken(settings, force = false) {
  if (!settings.appId || !settings.appSecret) {
    throw new WxError('NO_CREDENTIALS', '尚未配置公众号 AppID / AppSecret');
  }
  if (!force && tokenCache.appId === settings.appId && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }
  const url = `${API}/token?grant_type=client_credential&appid=${encodeURIComponent(settings.appId)}&secret=${encodeURIComponent(settings.appSecret)}`;
  const data = await requestJson(url);
  if (!data.access_token) {
    throw new WxError('NO_TOKEN', '未能获取 access_token，请检查公众号接口权限');
  }
  tokenCache = {
    appId: settings.appId,
    token: data.access_token,
    expiresAt: Date.now() + Math.max(60, (data.expires_in || 7200) - 300) * 1000,
  };
  return tokenCache.token;
}

async function uploadContentImage(token, filePath) {
  assertSupportedImage(filePath);
  const stat = await fsp.stat(filePath);
  if (stat.size > CONTENT_IMAGE_LIMIT) {
    throw new WxError('IMAGE_TOO_LARGE', `图片 ${path.basename(filePath)} 超过 1MB，微信无法上传`);
  }
  const buffer = await fsp.readFile(filePath);
  const form = new FormData();
  form.append('media', new Blob([buffer], { type: mimeOf(filePath) }), path.basename(filePath));
  const data = await requestJson(`${API}/media/uploadimg?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    body: form,
  }, 60000);
  if (!data.url) throw new WxError('NO_URL', '微信未返回图片地址');
  return data.url;
}

async function uploadPermanentImage(token, filePath) {
  assertSupportedImage(filePath);
  const buffer = await fsp.readFile(filePath);
  return uploadPermanentImageBuffer(token, buffer, path.basename(filePath));
}

function isWeChatImageUrl(value) {
  try {
    const url = new URL(String(value == null ? '' : value).trim());
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    if (url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    return host === 'qpic.cn' || host.endsWith('.qpic.cn') || host.endsWith('.wx.qq.com');
  } catch {
    return false;
  }
}

function sniffImageMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return '';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  return '';
}

// 正文里的公众号图库图片是微信 CDN 地址，不能直接作为 thumb_media_id。
// 下载后按永久素材重新上传，拿到本账号可用的 media_id。
async function downloadWeChatImage(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!isWeChatImageUrl(raw)) {
    throw new WxError('COVER_URL', '图片地址不是公众号图片，请重新选择');
  }
  const url = new URL(raw);
  url.protocol = 'https:';

  let res;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Accept: 'image/jpeg,image/png,image/*;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    const reason = err && err.name === 'TimeoutError' ? '下载超时' : err.message;
    throw new WxError('COVER_DOWNLOAD', `无法下载公众号图片：${reason}`);
  }

  if (!res.ok) {
    throw new WxError('COVER_DOWNLOAD', `下载公众号图片失败（HTTP ${res.status}）`);
  }
  if (res.url && !isWeChatImageUrl(res.url)) {
    throw new WxError('COVER_DOWNLOAD', '公众号图片跳转到了非微信地址，已停止下载');
  }

  const length = Number(res.headers.get('content-length') || 0);
  if (length > COVER_IMAGE_LIMIT) {
    throw new WxError('COVER_TOO_LARGE', '封面图片超过 10MB，微信无法上传');
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new WxError('COVER_EMPTY', '公众号图片内容为空，请重新选择');
  if (buffer.length > COVER_IMAGE_LIMIT) {
    throw new WxError('COVER_TOO_LARGE', '封面图片超过 10MB，微信无法上传');
  }
  const mime = sniffImageMime(buffer);
  if (!mime) {
    throw new WxError('COVER_FORMAT', '公众号图片不是 JPG / PNG 格式，无法作为封面');
  }
  return { buffer, mime, name: `wx-cover-${Date.now()}.${mime === 'image/png' ? 'png' : 'jpg'}` };
}

async function uploadPermanentImageBuffer(token, buffer, filename) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new WxError('COVER_EMPTY', '封面图片内容为空，请重新选择');
  }
  if (buffer.length > COVER_IMAGE_LIMIT) {
    throw new WxError('COVER_TOO_LARGE', '封面图片超过 10MB，微信无法上传');
  }
  const mime = sniffImageMime(buffer);
  if (!mime) {
    throw new WxError('COVER_FORMAT', '封面图片仅支持 JPG / PNG');
  }
  const safeName = /\.(?:jpe?g|png)$/i.test(filename || '')
    ? filename
    : `cover.${mime === 'image/png' ? 'png' : 'jpg'}`;
  const form = new FormData();
  form.append('media', new Blob([buffer], { type: mime }), safeName);
  const data = await requestJson(
    `${API}/material/add_material?access_token=${encodeURIComponent(token)}&type=image`,
    { method: 'POST', body: form },
    60000
  );
  if (!data.media_id) throw new WxError('NO_MEDIA_ID', '微信未返回封面素材 ID');
  return data;
}

async function listPermanentImages(token, { offset = 0, count = 20 } = {}) {
  const data = await requestJson(`${API}/material/batchget_material?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ type: 'image', offset, count }),
  });
  if (!Array.isArray(data.item)) {
    throw new WxError('BAD_RESPONSE', '微信素材接口未返回图片列表');
  }
  return data;
}

async function listPublished(token, { offset = 0, count = 20 } = {}) {
  const data = await requestJson(`${API}/freepublish/batchget?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ offset, count, no_content: 1 }),
  });
  if (!Array.isArray(data.item)) {
    throw new WxError('BAD_RESPONSE', '微信发布记录接口未返回文章列表');
  }
  return data;
}

async function listDrafts(token, { offset = 0, count = 10 } = {}) {
  const data = await requestJson(`${API}/draft/batchget?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ offset, count, no_content: 1 }),
  });
  if (!Array.isArray(data.item)) {
    throw new WxError('BAD_RESPONSE', '微信草稿接口未返回草稿列表');
  }
  return data;
}

async function addDraft(token, article) {
  const data = await requestJson(`${API}/draft/add?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ articles: [article] }),
  });
  if (!data.media_id) throw new WxError('NO_DRAFT_ID', '微信未返回草稿 ID');
  return data;
}

/** 从 /uploads/xxx 或 http://127.0.0.1:5188/uploads/xxx 里取出本地文件名 */
function localNameFromUrl(url) {
  if (!url) return null;
  let pathname = url;
  try {
    if (/^https?:\/\//i.test(url)) {
      const u = new URL(url);
      if (!['127.0.0.1', 'localhost'].includes(u.hostname)) return null;
      pathname = u.pathname;
    }
  } catch {
    return null;
  }
  const m = pathname.match(/^\/uploads\/([^/?#]+)$/);
  if (!m) return null;
  const name = decodeURIComponent(m[1]);
  if (name.includes('..') || name.includes('/') || name.includes('\\')) return null;
  return name;
}

function resolveUpload(uploadDir, name) {
  const file = path.join(uploadDir, name);
  if (!file.startsWith(uploadDir + path.sep)) return null;
  return fs.existsSync(file) ? file : null;
}

/**
 * 把正文中的本地图片上传到微信，替换成微信可访问的地址。
 * 返回 { content, uploaded, skipped }
 */
async function prepareContentWithToken(content, uploadDir, token) {
  const urls = [...new Set([...content.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((url) => localNameFromUrl(url)))];

  let uploaded = 0;
  const skipped = [];
  const map = new Map();

  for (const url of urls) {
    const name = localNameFromUrl(url);
    const file = name && resolveUpload(uploadDir, name);
    if (!file) {
      skipped.push({ url, reason: '文件不存在' });
      continue;
    }
    try {
      const wxUrl = await uploadContentImage(token, file);
      map.set(url, wxUrl);
      uploaded += 1;
    } catch (err) {
      skipped.push({ url, reason: err.message });
    }
  }

  let output = content;
  for (const [from, to] of map) {
    output = output.split(from).join(to);
  }
  return { content: output, uploaded, skipped };
}

module.exports = {
  WxError,
  getToken,
  uploadContentImage,
  uploadPermanentImage,
  uploadPermanentImageBuffer,
  downloadWeChatImage,
  isWeChatImageUrl,
  listPermanentImages,
  listPublished,
  listDrafts,
  addDraft,
  localNameFromUrl,
  resolveUpload,
  prepareContentWithToken,
};
