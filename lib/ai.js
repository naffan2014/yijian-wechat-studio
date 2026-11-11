'use strict';

/**
 * OpenAI 兼容的模型调用层。
 * 只依赖 Node 18+ 内置 fetch，不引入任何第三方 SDK。
 */

const MAX_INPUT_CHARS = 20000;
const MAX_OUTPUT_CHARS = 60000;
const CHAT_TIMEOUT = 300000;
const MODELS_TIMEOUT = 20000;

const MODES = {
  layout: {
    label: '排版美化',
    temperature: 0.35,
    instruction:
      '只调整结构与排版：分段、断句、添加小标题、列表、引用、提示卡片、关键句高亮。尽量保留原句措辞，不增删事实与观点。',
  },
  polish: {
    label: '文字润色',
    temperature: 0.5,
    instruction:
      '在不改变原意与作者语气的前提下润色文字：修正错别字和语病，让句子更顺、更有节奏，同时适度优化排版结构。',
  },
  condense: {
    label: '精简提炼',
    temperature: 0.4,
    instruction:
      '把文章压缩到原文约 60%–70% 的篇幅，保留核心观点、关键细节和全部图片，删除重复表达与空话。',
  },
};

class AiError extends Error {
  constructor(code, message, detail = '') {
    super(message);
    this.name = 'AiError';
    this.code = code;
    this.detail = detail;
  }
}

function clean(value, max = 2000) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function normalizeBaseUrl(value) {
  let raw = clean(value, 500);
  if (!raw) throw new AiError('NO_CONFIG', '还没有配置 AI 接口地址');
  raw = raw.replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new AiError('BAD_URL', 'AI 接口地址不是合法的 URL，请填写形如 https://api.example.com/v1 的地址');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new AiError('BAD_URL', 'AI 接口地址只支持 http / https');
  }
  if (!url.hostname) throw new AiError('BAD_URL', 'AI 接口地址缺少主机名');
  return raw;
}

// 用户经常只填域名，而 OpenAI 兼容服务通常挂在 /v1 下。
// 先按原地址请求，404 时自动补一次 /v1，减少配置踩坑。
function baseCandidates(value) {
  const baseUrl = normalizeBaseUrl(value);
  const list = [baseUrl];
  try {
    const url = new URL(baseUrl);
    if (!url.search && (url.pathname === '' || url.pathname === '/')) {
      const withV1 = `${baseUrl}/v1`;
      if (!list.includes(withV1)) list.push(withV1);
    }
  } catch {
    /* normalizeBaseUrl 已校验过 URL，这里不会触发 */
  }
  return list;
}

async function requestWithFallback(value, path, options) {
  const candidates = baseCandidates(value);
  let lastError;
  for (const baseUrl of candidates) {
    try {
      const data = await requestJson(`${baseUrl}${path}`, options);
      return { data, baseUrl };
    } catch (err) {
      if (err instanceof AiError && err.code === 'NOT_FOUND') {
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

function upstreamMessage(data) {
  if (!data || typeof data !== 'object') return '';
  const error = data.error;
  if (typeof error === 'string') return error;
  if (error && typeof error.message === 'string') return error.message;
  if (typeof data.message === 'string') return data.message;
  return '';
}

async function requestJson(url, { apiKey = '', method = 'GET', body, timeout = MODELS_TIMEOUT } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new AiError('TIMEOUT', `AI 接口响应超时（${Math.round(timeout / 1000)} 秒），请检查网络或换一个模型`);
    }
    const cause = err.cause && err.cause.message ? `：${err.cause.message}` : '';
    throw new AiError('NETWORK', `无法连接 AI 接口${cause}`);
  }

  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      if (!response.ok) {
        throw new AiError('HTTP', `AI 接口返回异常（HTTP ${response.status}），请检查接口地址`, text.slice(0, 300));
      }
      throw new AiError('BAD_RESPONSE', 'AI 接口返回的不是 JSON，请确认填写的是 OpenAI 兼容接口地址');
    }
  }

  if (!response.ok) {
    const detail = upstreamMessage(data);
    if (response.status === 401 || response.status === 403) {
      throw new AiError('AUTH', `AI 接口鉴权失败，请检查 API Key 与模型权限${detail ? `（${detail}）` : ''}`);
    }
    if (response.status === 404) {
      throw new AiError(
        'NOT_FOUND',
        `AI 接口不存在（HTTP 404）${detail ? `：${detail}` : '，请检查 Base URL 是否包含 /v1 等路径前缀，以及模型名是否正确'}`
      );
    }
    if (response.status === 429) {
      throw new AiError('RATE_LIMIT', 'AI 接口限流或额度不足，请稍后重试或更换模型');
    }
    if (response.status >= 500) {
      throw new AiError('UPSTREAM', `AI 服务暂时不可用（HTTP ${response.status}）${detail ? `：${detail}` : ''}`);
    }
    throw new AiError('HTTP', `AI 接口请求失败（HTTP ${response.status}）${detail ? `：${detail}` : ''}`);
  }

  return data;
}

function contentToText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part.text === 'string') return part.text;
        return '';
      })
      .join('');
  }
  return '';
}

function stripOuterFence(text) {
  const value = String(text || '').replace(/^\uFEFF/, '').trim();
  const match = value.match(/^```(?:markdown|md|text)?[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/i);
  if (match) return match[1].trim();
  return value;
}

function collectUploadUrls(markdown) {
  const urls = new Set();
  const regex = /\/uploads\/[^\s)"'<>]+/g;
  let match;
  while ((match = regex.exec(markdown))) urls.add(match[0]);
  return urls;
}

function buildMessages({ title, markdown, mode, instruction, scope }) {
  const system = [
    '你是一位资深中文公众号编辑，擅长把文章整理成适合手机阅读的版面。',
    '你的输出会被直接写回一个 Markdown 编辑器，所以必须严格遵守以下规则：',
    '1. 只输出 Markdown 正文，不要输出解释、前言、结语，也不要用代码围栏包住整篇内容。',
    '2. 只使用这些语法：## / ### 标题、**加粗**、*斜体*、==高亮==、> 引用、- 无序列表、1. 有序列表、![图注](图片地址)、--- 分割线、:::tip / :::note / :::warn 提示卡片（必须成对闭合）、表格、三个反引号代码块。',
    '3. 禁止输出 HTML、<style>、class 或任何内联样式；不要使用 Markdown 不支持的花哨语法。',
    '4. 原文中的所有图片语法必须原样保留，图片地址和图注都不能修改、删除或重排到无关位置。',
    '5. 禁止编造原文没有的事实、数据、人物、引语；不要写“希望对你有帮助”这类套话。',
    '6. 不要输出文章大标题（标题由系统单独管理），直接从正文开始。',
    '7. 段落之间留一个空行；单段尽量不超过 4 行；小标题要具体、克制，不要每段都加标题。',
    '8. 提示卡片正文不超过 3 行，类型只用 tip / note / warn。',
  ].join('\n');

  const modeInfo = MODES[mode] || MODES.layout;
  const scopeText =
    scope === 'selection'
      ? '下面是一篇文章中被选中的片段。只处理这个片段，输出同样只包含处理后的片段，不要补写前后文，也不要添加文章大标题。'
      : '下面是一篇完整文章，请处理全文。';

  const user = [
    title ? `文章标题：${title}` : '',
    `处理模式：${modeInfo.label}`,
    `处理要求：${modeInfo.instruction}`,
    scopeText,
    instruction ? `额外要求：${instruction}` : '',
    '',
    '原文开始',
    '<<<ARTICLE',
    markdown,
    'ARTICLE>>>',
    '原文结束',
  ]
    .filter((line) => line !== '')
    .join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function resolveConfig(settings, override = {}) {
  const baseUrl = normalizeBaseUrl(override.baseUrl || settings.aiBaseUrl);
  const apiKey = clean(override.apiKey, 400) || clean(settings.aiApiKey, 400);
  return { baseUrl, apiKey };
}

async function listModels(settings, override = {}) {
  const { baseUrl, apiKey } = resolveConfig(settings, override);
  const candidates = baseCandidates(baseUrl);
  let response;
  try {
    response = await requestWithFallback(baseUrl, '/models', { apiKey });
  } catch (err) {
    // 不少网关只开放对话接口，没有 /models；这不影响正常美化
    if (err instanceof AiError && err.code === 'NOT_FOUND') {
      return { models: [], baseUrl: candidates[candidates.length - 1], unsupported: true };
    }
    throw err;
  }
  const items = Array.isArray(response.data.data)
    ? response.data.data
    : Array.isArray(response.data.models)
    ? response.data.models
    : [];
  const models = items
    .map((item) => (typeof item === 'string' ? item : item && (item.id || item.name)))
    .filter((id) => typeof id === 'string' && id.trim())
    .map((id) => id.trim());
  return {
    models: [...new Set(models)].sort((a, b) => a.localeCompare(b)).slice(0, 300),
    baseUrl: response.baseUrl,
  };
}

async function completeChat(baseUrl, apiKey, requestBody) {
  const requestChat = () =>
    requestWithFallback(baseUrl, '/chat/completions', {
      apiKey,
      method: 'POST',
      timeout: CHAT_TIMEOUT,
      body: requestBody,
    });
  const stripped = new Set();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await requestChat();
    } catch (err) {
      if (!(err instanceof AiError)) throw err;
      const detail = `${err.message} ${err.detail}`;
      // 部分推理模型（如 o1 系列）不接受自定义 temperature，去掉后重试一次
      if (!stripped.has('temperature') && /temperature/i.test(detail)) {
        delete requestBody.temperature;
        stripped.add('temperature');
        continue;
      }
      // 个别网关不认“关闭思考”的参数，去掉后再试一次，避免功能不可用
      if (
        !stripped.has('thinking') &&
        err.code === 'HTTP' &&
        (requestBody.thinking !== undefined ||
          requestBody.enable_thinking !== undefined ||
          requestBody.reasoning_effort !== undefined) &&
        /thinking|reasoning|unsupported|unexpected|unknown|unrecogni[sz]ed|invalid.*(parameter|argument|field)/i.test(detail)
      ) {
        delete requestBody.thinking;
        delete requestBody.enable_thinking;
        delete requestBody.reasoning_effort;
        stripped.add('thinking');
        continue;
      }
      throw err;
    }
  }
  throw new AiError('HTTP', 'AI 接口连续拒绝请求参数，请检查模型是否支持当前调用方式');
}

// 尽量让模型跳过“思考/推理”阶段，直接给出最终文案。
// 各家开关不统一：Qwen 用 enable_thinking，MiniMax / GLM / Kimi / 豆包用 thinking。
// 无法关闭的推理模型保持默认；网关若不认这些字段，completeChat 会自动去掉后重试。
function disableThinking(body, model) {
  const id = String(model || '').toLowerCase();

  if (/gpt-5/.test(id) || /(^|[/_.-])o[134]([-_.]|$)/.test(id)) {
    body.reasoning_effort = /gpt-5/.test(id) ? 'minimal' : 'low';
    return body;
  }
  if (/deepseek-(reasoner|r1)\b|(^|[/_.-])qwq/.test(id)) {
    return body;
  }
  if (/^(gpt-|chatgpt|claude|gemini|grok|deepseek-chat|deepseek-v3)/.test(id)) {
    return body;
  }
  if (/qwen/.test(id)) {
    body.enable_thinking = false;
    return body;
  }
  body.thinking = { type: 'disabled' };
  return body;
}

async function beautify(settings, payload = {}) {
  const markdown = String(payload.markdown || '').trim();
  if (!markdown) throw new AiError('EMPTY', '没有可美化的内容');
  if (markdown.length > MAX_INPUT_CHARS) {
    throw new AiError(
      'TOO_LONG',
      `正文有 ${markdown.length} 个字符，超过单次美化上限 ${MAX_INPUT_CHARS}。建议先选中一段处理，或拆成多篇。`
    );
  }

  const { baseUrl, apiKey } = resolveConfig(settings, payload);
  const model = clean(payload.model || settings.aiModel, 120);
  if (!model) throw new AiError('NO_MODEL', '还没有填写模型名，例如 deepseek-chat 或 gpt-4o-mini');

  const mode = MODES[payload.mode] ? payload.mode : 'layout';
  const scope = payload.scope === 'selection' ? 'selection' : 'full';
  const messages = buildMessages({
    title: clean(payload.title, 200),
    markdown,
    mode,
    instruction: clean(payload.instruction, 800),
    scope,
  });

  const requestBody = disableThinking(
    {
      model,
      messages,
      temperature: MODES[mode].temperature,
      stream: false,
    },
    model
  );
  const response = await completeChat(baseUrl, apiKey, requestBody);
  const data = response.data;

  const choice = Array.isArray(data.choices) ? data.choices[0] : null;
  const content = contentToText(choice && choice.message ? choice.message.content : choice && choice.text);
  let output = stripOuterFence(content);
  if (!output) {
    throw new AiError('EMPTY_OUTPUT', '模型没有返回内容，请重试或换一个模型');
  }
  if (output.length > MAX_OUTPUT_CHARS) {
    throw new AiError('OUTPUT_TOO_LONG', '模型返回的内容过长，请缩短原文后重试');
  }

  const warnings = [];
  if (choice && choice.finish_reason === 'length') {
    warnings.push('模型输出达到长度上限，结果可能不完整。建议缩短正文或更换支持更长输出的模型。');
  }

  const before = collectUploadUrls(markdown);
  const after = collectUploadUrls(output);
  const missingImages = [...before].filter((url) => !after.has(url));
  if (missingImages.length) {
    warnings.push(`AI 结果遗漏了 ${missingImages.length} 张图片，应用前请检查。`);
  }

  return {
    markdown: output,
    model,
    mode,
    scope,
    baseUrl: response.baseUrl,
    warnings,
    missingImages,
    usage: data.usage || null,
  };
}

async function continueWriting(settings, payload = {}) {
  const plain = payload.format === 'plain';
  const selection = String(payload.selection || '').trim();
  const context = String(payload.context || '').trim();
  if (!selection) {
    throw new AiError('EMPTY', plain ? '请先选中一段文案，再让 AI 扩写' : '请先在正文里选中一句话，再让 AI 续写');
  }
  if (selection.length > 5000) {
    throw new AiError('TOO_LONG', plain ? '选中的文案太长，请只选一段再扩写' : '选中的内容太长，请只选一句话再续写');
  }

  const { baseUrl, apiKey } = resolveConfig(settings, payload);
  const model = clean(payload.model || settings.aiModel, 120);
  if (!model) throw new AiError('NO_MODEL', '还没有填写模型名，例如 deepseek-chat 或 gpt-4o-mini');

  const system = (
    plain
      ? [
          '你是一位中文公众号作者，正在帮作者扩写一条图片消息的文案。',
          '只输出新增的文案，不要解释、不要标题、不要“接上文”之类的提示。',
          '扩写长度约 60–140 个汉字，写成 1–2 个自然段。',
          '沿用原文的人称、语气和文风，可以补充画面、感受和细节；不要重复已写内容，不编造具体数据、人物或引语。',
          '输出纯文本，不要使用 Markdown 标记（如 **、*、#、列表、引用、代码块）。',
        ]
      : [
          '你是一位中文公众号作者，正在帮作者把文章自然地写下去。',
          '只输出续写的正文，不要解释、不要标题、不要“接上文”之类的提示。',
          '续写长度约 80–160 个汉字，写成 1–2 个自然段。',
          '沿用原文的人称、语气和文风，不重复已写内容，不编造具体数据、人物或引语。',
          '不要使用标题、列表、代码块、图片或提示卡片；行内只允许 **加粗** 和 *斜体*。',
        ]
  ).join('\n');

  const title = clean(payload.title, 200);
  const instruction = clean(payload.instruction, 300);
  const user = [
    title ? `文章标题：${title}` : '',
    instruction ? `额外要求：${instruction}` : '',
    '',
    '已写内容（节选，最后一段是续写起点）：',
    '<<<TEXT',
    context.slice(-2600),
    'TEXT>>>',
    '',
    '请从下面这句之后继续写，只输出新增的内容，不要重复这句：',
    '<<<SELECTION',
    selection.slice(-1800),
    'SELECTION>>>',
  ]
    .filter((line) => line !== '')
    .join('\n');

  const requestBody = disableThinking(
    {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.75,
      stream: false,
    },
    model
  );

  const response = await completeChat(baseUrl, apiKey, requestBody);
  const data = response.data;
  const choice = Array.isArray(data.choices) ? data.choices[0] : null;
  const content = contentToText(choice && choice.message ? choice.message.content : choice && choice.text);
  let output = stripOuterFence(content);
  if (!output) throw new AiError('EMPTY_OUTPUT', '模型没有返回内容，请重试或换一个模型');
  if (output.length > 2000) output = output.slice(0, 2000).trim();

  return {
    markdown: output,
    model,
    baseUrl: response.baseUrl,
    usage: data.usage || null,
  };
}

module.exports = {
  AiError,
  MODES,
  MAX_INPUT_CHARS,
  normalizeBaseUrl,
  listModels,
  beautify,
  continueWriting,
};
