import { icon } from './icons.js';
import { THEMES, ACCENT_PRESETS, getTheme } from './themes.js';
import { renderArticle, plainText } from './markdown.js';
import { COVER_STYLES, drawCover, coverToDataUrl, inferCoverStyle } from './cover.js';
import { api } from './api.js';
import { STYLE_COMPONENTS, STYLE_CATEGORIES } from './components.js';
import { htmlToMarkdown, docxToMarkdown } from './import.js';
import {
  GLYPH_GROUPS,
  GLYPH_LIST,
  GLYPH_COUNT,
  DEFAULT_GLYPH_STYLE,
  getGlyph,
  searchGlyphs,
  glyphSyntax,
  renderGlyph,
  resolveGlyphColor,
} from './glyphs.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const CURRENT_KEY = 'mojian.current';
const PREVIEW_KEY = 'mojian.preview';
const STYLE_FAVORITES_KEY = 'mojian.style-favorites';
const ICON_STUDIO_KEY = 'mojian.icon-studio';
// 与 server.js 的草稿校验保持一致
const HTML_CHAR_LIMIT = 20000;

const state = {
  articles: [],
  current: null,
  uploads: [],
  settings: { appId: '', hasSecret: false, accountName: '我的公众号', author: '', aiBaseUrl: '', aiModel: '', hasAiKey: false, accounts: [], activeAccountId: '' },
  lastRender: null,
  editSeq: 0,
  saveTimer: null,
  previewTimer: null,
  listTimer: null,
  tab: 'themes',
  articleView: 'local',
  published: { items: [], offset: 0, total: 0, hasMore: false, loaded: false, loading: false, error: '', requestId: 0 },
  drafts: { items: [], offset: 0, total: 0, hasMore: false, loaded: false, loading: false, error: '', errorCode: '', requestId: 0 },
  themeGroup: 'original',
  styleCategory: '全部',
  styleQuery: '',
  styleFavorites: loadStyleFavorites(),
  styleMode: 'components',
  iconQuery: '',
  iconGroup: '常用',
  iconSelected: 'star',
  iconStyle: loadIconStudio(),
  iconGridSignature: '',
};

const modalStack = [];

const aiContinueBubble = {
  visible: false,
  mode: 'article',
  field: null,
  selection: null,
  anchorX: 0,
  anchorY: 0,
  result: '',
  error: '',
  loading: false,
  model: '',
  requestId: 0,
};

const AI_PRESETS = [
  { id: 'custom', name: '自定义 / 其他', baseUrl: '', model: '' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'qwen', name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { id: 'zhipu', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { id: 'moonshot', name: 'Moonshot', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-32k' },
  { id: 'siliconflow', name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct' },
  { id: 'ollama', name: 'Ollama（本机）', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b' },
];

const AI_MODES = [
  { id: 'layout', name: '排版美化', desc: '只调整结构与排版，尽量不改原句', icon: 'list' },
  { id: 'polish', name: '文字润色', desc: '修语病、顺句子，并优化排版', icon: 'sparkles' },
  { id: 'condense', name: '精简提炼', desc: '压缩到约六七成，保留重点与图片', icon: 'divider' },
];

const TOOLBAR = [
  { action: 'h2', label: 'H2', cls: 'text', title: '二级标题' },
  { action: 'h3', label: 'H3', cls: 'text', title: '三级标题' },
  { sep: true },
  { action: 'bold', icon: 'bold', title: '加粗（⌘B）' },
  { action: 'italic', icon: 'italic', title: '斜体（⌘I）' },
  { action: 'highlight', icon: 'highlight', title: '荧光标记' },
  { sep: true },
  { action: 'quote', icon: 'quote', title: '引用' },
  { action: 'ul', icon: 'list', title: '无序列表' },
  { action: 'ol', icon: 'ordered', title: '有序列表' },
  { sep: true },
  { action: 'image', icon: 'image', title: '插入图片' },
  { action: 'link', icon: 'link', title: '插入链接（⌘K）' },
  { action: 'divider', icon: 'divider', title: '分割线' },
  { sep: true },
  { action: 'code', icon: 'code', title: '代码块' },
  { action: 'callout', icon: 'callout', title: '提示卡片' },
  { action: 'glyph', icon: 'shapes', title: '图标工坊（115 个图标）' },
  { action: 'timeline', icon: 'timeline', title: '插入时间线' },
  { action: 'help', icon: 'help', title: '格式说明' },
];

/* --------------------------------- boot ---------------------------------- */

init();

async function init() {
  injectStaticIcons();
  buildToolbar();
  bindStaticEvents();

  const storedPreview = localStorage.getItem(PREVIEW_KEY);
  const previewOpen = storedPreview ? storedPreview === '1' : window.innerWidth > 1150;
  document.body.classList.toggle('preview-open', previewOpen);

  try {
    const data = await api.bootstrap();
    state.articles = data.articles || [];
    state.uploads = data.uploads || [];
    state.settings = data.settings || state.settings;

    if (!state.articles.length) {
      const res = await api.createArticle({ title: '未命名文章', themeId: 'paper' });
      state.articles = [res.article];
    }

    await ensureCurrentForAccount();
    renderAssets();
    updateAccountUI();
    setSave('saved', '已保存');
  } catch (err) {
    toast(`初始化失败：${err.message}`, 'error', 6000);
  }
}

/* ------------------------------ 多账号数据流 ------------------------------ */

function visibleArticles() {
  const accountId = state.settings.activeAccountId;
  if (!accountId) return state.articles;
  return state.articles.filter((article) => article.accountId === accountId);
}

function activeAccountInfo() {
  const accounts = state.settings.accounts || [];
  return accounts.find((acc) => acc.id === state.settings.activeAccountId) || accounts[0] || null;
}

// 当前账号下选出要打开的文章：优先上次编辑的，其次最近更新的一篇；
// 账号下还没有文章时自动新建一篇，保持画布始终可用。
async function ensureCurrentForAccount({ kind = 'article' } = {}) {
  const visible = visibleArticles();
  const lastId = localStorage.getItem(CURRENT_KEY);
  const current = visible.find((item) => item.id === lastId) || visible[0];
  if (current) {
    setCurrent(current);
    return;
  }
  const pic = kind === 'pic';
  const res = await api.createArticle({
    kind,
    title: pic ? '未命名贴图' : '未命名文章',
    themeId: 'paper',
    images: pic ? [] : undefined,
    copy: pic ? '' : undefined,
  });
  state.articles.unshift(res.article);
  setCurrent(res.article);
}

// 切换账号后，发布记录 / 草稿箱等账号级面板要清空重读
function resetAccountScopedState() {
  state.published = { items: [], offset: 0, total: 0, hasMore: false, loaded: false, loading: false, error: '', errorCode: '', requestId: state.published.requestId + 1 };
  state.drafts = { items: [], offset: 0, total: 0, hasMore: false, loaded: false, loading: false, error: '', errorCode: '', requestId: state.drafts.requestId + 1 };
  if (state.articleView === 'drafts') {
    renderDraftList();
    loadDrafts(true);
  }
  if (state.articleView === 'published') {
    renderPublishedList();
    loadPublished(true);
  }
}

async function switchAccount(id) {
  if (!id || id === state.settings.activeAccountId) return;
  await saveNow();
  try {
    const res = await api.activateAccount(id);
    state.settings = res.settings;
    resetAccountScopedState();
    updateAccountUI();
    await ensureCurrentForAccount();
    renderAssets();
    toast(`已切换到「${state.settings.accountName || '我的公众号'}」`, 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function injectStaticIcons() {
  $$('[data-icon]').forEach((el) => {
    el.innerHTML = icon(el.dataset.icon, 16);
  });
}

function buildToolbar() {
  const toolbar = $('#toolbar');
  toolbar.innerHTML = TOOLBAR.map((item) => {
    if (item.sep) return '<span class="tb-sep"></span>';
    const cls = `tb-btn ${item.cls || ''}`.trim();
    const content = item.icon ? icon(item.icon, 16) : item.label;
    return `<button class="${cls}" data-action="${item.action}" title="${item.title || ''}" type="button">${content}</button>`;
  }).join('');
}

/* ------------------------------- data flow -------------------------------- */

function setCurrent(article) {
  if (!article) return;
  hideAiContinue();
  state.current = article;
  if (article.kind === 'pic') {
    if (!Array.isArray(article.images)) article.images = [];
    if (typeof article.copy !== 'string') article.copy = '';
  }
  if (!article.options || typeof article.options !== 'object') {
    article.options = { fontSize: 16, lineHeight: 1.9, accent: '' };
  }
  state.themeGroup = getTheme(article.themeId).imported ? 'imported' : 'original';
  localStorage.setItem(CURRENT_KEY, article.id);

  $('#titleInput').value = article.title || '';
  const authorInput = $('#authorInput');
  authorInput.value = article.author || '';
  authorInput.placeholder = state.settings.author ? `默认：${state.settings.author}` : '未署名';
  $('#editor').value = article.markdown || '';
  $('#picCopy').value = article.copy || '';
  renderThemeGrid();
  renderStyleCenter();
  renderOptions();
  renderEditorMode();
  renderArticleList();
  renderPreview({ resetScroll: true });
  renderCoverPanel();
  setSave('saved', '已保存');
}

function isPic(article = state.current) {
  return article?.kind === 'pic';
}

function activateSideTab(tab) {
  state.tab = tab;
  $$('.side-tab').forEach((item) => item.classList.toggle('active', item.dataset.tab === tab));
  $$('.side-panel').forEach((panel) => {
    panel.hidden = panel.dataset.panel !== tab;
  });
}

function renderEditorMode() {
  const article = state.current;
  if (!article) return;
  const pic = isPic(article);
  document.body.classList.toggle('pic-mode', pic);

  $('#editor').hidden = pic;
  $('#picEditor').hidden = !pic;
  $('#toolbar').hidden = pic;
  $('#picToolbar').hidden = !pic;
  $('#btnCopy').hidden = pic;

  const aiButton = $('#btnAiBeautify');
  aiButton.title = pic ? '选中一句或直接扩写整段文案' : '用 AI 润色文字并优化排版';
  $('.ai-label', aiButton).textContent = pic ? 'AI 扩写' : 'AI 美化';

  $('#editorEyebrow').childNodes[0].textContent = pic ? '贴图 · 图片消息 ' : '文章 · Markdown ';
  const titleCount = $('#titleCount');
  titleCount.hidden = !pic;
  titleCount.textContent = pic ? `${(article.title || '').length} / 32` : '';

  const titleInput = $('#titleInput');
  titleInput.maxLength = pic ? 32 : 64;
  titleInput.placeholder = pic ? '输入贴图标题' : '输入文章标题';

  $('#editorThemePill').textContent = pic ? '图片消息' : getTheme(article.themeId).name;
  $('#editorHint').textContent = pic ? '首图即封面 · 1–20 张 · 单张 ≤ 1MB' : 'Markdown · 富文本粘贴 · 截图上传';
  $('#editorBudget').hidden = pic;
  $('#assetFootnote').textContent = pic
    ? '点击本机素材即可添加到贴图；公众号图库支持分页、多选。首图会成为封面。'
    : '点击本机素材即可插入正文；公众号图库支持分页、多选，且不会修改线上素材。';

  $$('.side-tab').forEach((tab) => {
    const blocked = pic && ['themes', 'styles', 'cover'].includes(tab.dataset.tab);
    tab.disabled = blocked;
    tab.title = blocked ? '贴图不使用文章模板与 2.35:1 封面' : '';
  });
  if (pic && ['themes', 'styles', 'cover'].includes(state.tab)) activateSideTab('assets');

  renderAssets();
  if (pic) renderPicEditor();
}

function renderPicEditor() {
  const article = state.current;
  if (!article || !isPic(article)) return;
  const images = article.images || [];
  $('#picCount').textContent = `${images.length} / 20`;
  $('#picToolbarCount').textContent = `${images.length} / 20 张`;
  $('#picGrid').innerHTML = images.map((image, index) => `
    <div class="pic-card ${index === 0 ? 'is-cover' : ''}" draggable="true" data-pic-index="${index}" title="拖动调整顺序">
      <img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.name || '贴图图片')}" loading="lazy" referrerpolicy="no-referrer">
      ${index === 0 ? '<span class="pic-cover-badge">封面</span>' : `<span class="pic-order">${index + 1}</span>`}
      <button class="pic-remove" data-pic-remove="${index}" type="button" title="移除这张图片">${icon('x', 13)}</button>
    </div>`).join('')
    + `<button class="pic-add" data-pic-add type="button" ${images.length >= 20 ? 'disabled' : ''}>
        ${icon('plus', 20)}<span>${images.length ? '继续添加' : '添加图片'}</span><em>1–20 张 · 首图为封面</em>
      </button>`;

  const copy = article.copy || '';
  const copyField = $('#picCopy');
  if (copyField.value !== copy) copyField.value = copy;
  $('#picCopyCount').textContent = `${copy.length} / 1000`;
  $('#picCopyCount').classList.toggle('warn', copy.length >= 900);
  fitPicCopy();
}

function fitPicCopy() {
  const field = $('#picCopy');
  if (!field || field.hidden || !isPic()) return;
  field.style.height = 'auto';
  field.style.height = `${Math.max(150, field.scrollHeight)}px`;
}

function normalizeOptions(options = {}) {
  return {
    fontSize: Number(options.fontSize) || 16,
    lineHeight: Number(options.lineHeight) || 1.9,
    accent: typeof options.accent === 'string' ? options.accent : '',
  };
}

function currentRender() {
  const article = state.current;
  return renderArticle(article.markdown || '', getTheme(article.themeId), normalizeOptions(article.options));
}

function onEditorInput() {
  if (!state.current) return;
  hideAiContinue();
  state.current.markdown = $('#editor').value;
  state.editSeq += 1;
  setSave('dirty', '有未保存更改');
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveNow, 900);
  queuePreview();
  clearTimeout(state.listTimer);
  state.listTimer = setTimeout(renderArticleList, 500);
}

function onArticleMetaInput(field, value) {
  if (!state.current) return;
  state.current[field] = value;
  state.editSeq += 1;
  setSave('dirty', '有未保存更改');
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveNow, 900);
  queuePreview();
  clearTimeout(state.listTimer);
  state.listTimer = setTimeout(renderArticleList, 400);
}

function onPicCopyInput() {
  if (!isPic()) return;
  hideAiContinue();
  const value = $('#picCopy').value;
  state.current.copy = value;
  $('#picCopyCount').textContent = `${value.length} / 1000`;
  $('#picCopyCount').classList.toggle('warn', value.length >= 900);
  fitPicCopy();
  state.editSeq += 1;
  setSave('dirty', '有未保存更改');
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveNow, 900);
  queuePreview();
  clearTimeout(state.listTimer);
  state.listTimer = setTimeout(renderArticleList, 400);
}

function queuePreview() {
  clearTimeout(state.previewTimer);
  state.previewTimer = setTimeout(() => renderPreview(), 110);
}

async function saveNow() {
  if (!state.current) return;
  // 当前文章可能刚被删除，避免向不存在的草稿发保存请求
  if (!state.articles.some((item) => item.id === state.current.id)) return;
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  const article = state.current;
  const seq = state.editSeq;
  setSave('saving', '保存中…');
  try {
    const res = await api.saveArticle(article.id, {
      kind: article.kind,
      title: article.title,
      markdown: article.markdown,
      themeId: article.themeId,
      options: normalizeOptions(article.options),
      cover: article.cover,
      author: article.author,
      digest: article.digest,
      sourceUrl: article.sourceUrl,
      images: article.kind === 'pic' ? article.images : undefined,
      copy: article.kind === 'pic' ? article.copy : undefined,
      needOpenComment: article.kind === 'pic' ? article.needOpenComment !== false : undefined,
    });
    const target = state.articles.find((item) => item.id === article.id);
    if (target) Object.assign(target, res.article);
    if (state.current && state.current.id === article.id) {
      if (seq === state.editSeq) setSave('saved', `已保存 ${formatClock(res.article.updatedAt)}`);
    }
    renderArticleList();
  } catch (err) {
    if (state.current && state.current.id === article.id) setSave('error', '保存失败');
    toast(err.message, 'error', 5000);
  }
}

function setSave(mode, text) {
  const el = $('#saveState');
  el.className = `save-state ${mode === 'saved' ? '' : mode}`.trim();
  $('#saveText').textContent = text;
}

/* ------------------------------- rendering -------------------------------- */

function renderPreview({ resetScroll = false } = {}) {
  if (!state.current) return;
  const article = state.current;
  document.title = article.title?.trim() ? `${article.title.trim()} · 一见` : '一见 · 公众号排版工作台';

  const content = $('#wxContent');
  const scroll = $('#wxScroll');
  const top = scroll.scrollTop;
  $('#wxTitle').textContent = article.title || (isPic(article) ? '未命名贴图' : '未命名文章');
  $('#wxDate').textContent = formatDate(article.updatedAt || new Date().toISOString());
  $('#wxAvatar').textContent = (state.settings.accountName || '我的公众号').slice(0, 1);
  $('#wxAccountName').textContent = state.settings.accountName || '我的公众号';

  if (isPic(article)) {
    state.lastRender = null;
    content.innerHTML = picPreviewHtml(article);
    scroll.scrollTop = resetScroll ? 0 : top;
    const gallery = $('.wx-pic-gallery', content);
    if (gallery) {
      gallery.addEventListener('scroll', () => updatePicDots(content), { passive: true });
    }
    const images = article.images || [];
    const copy = article.copy || '';
    $('#wxMeta').textContent = `${article.author || state.settings.author || '一见'} · ${images.length} 张图片`;
    $('#editorStats').textContent = `${copy.length} 字`;
    $('#editorReading').textContent = '图片消息';
    $('#editorImages').textContent = `${images.length} 张图片`;
    $('#editorThemePill').textContent = '图片消息';
    return;
  }

  const theme = getTheme(article.themeId);
  const result = currentRender();
  state.lastRender = result;
  content.innerHTML = result.html;
  if (resetScroll) {
    scroll.scrollTop = 0;
  } else {
    scroll.scrollTop = top;
  }

  $('#wxMeta').textContent = `${article.author || state.settings.author || '一见'} · 约 ${result.stats.reading} 分钟`;

  $('#editorStats').textContent = `${formatNumber(result.stats.chars)} 字`;
  $('#editorReading').textContent = `约 ${result.stats.reading} 分钟`;
  $('#editorImages').textContent = `${result.stats.images} 张图片`;
  renderHtmlBudget(result.html.length);
  $('#editorThemePill').textContent = theme.name;
  $('#themeName').textContent = theme.name;
}

/** 图标组件比较占字符，这里实时显示草稿接口的 20000 字符余量 */
function renderHtmlBudget(length) {
  const chip = $('#editorBudget');
  const ratio = length / HTML_CHAR_LIMIT;
  chip.textContent = `HTML ${length > 999 ? `${(length / 1000).toFixed(1)}k` : length} / 20k`;
  chip.classList.toggle('warn', ratio > 0.8 && ratio <= 1);
  chip.classList.toggle('over', ratio > 1);
  chip.title = ratio > 1
    ? `正文 HTML ${length} 字符，已超过草稿接口 20000 上限，发布前请精简组件或拆分文章`
    : `发布草稿时正文 HTML 上限 20000 字符，当前已用 ${Math.round(ratio * 100)}%`;
}

function picPreviewHtml(article) {
  const images = article.images || [];
  const copy = article.copy || '';
  const meta = `${article.author || state.settings.author || '一见'} · ${formatDate(article.updatedAt || new Date().toISOString())}`;
  return `<div class="wx-pic">
    <div class="wx-pic-gallery">
      ${images.length ? images.map((image) => `<div class="wx-pic-slide"><img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.name || '贴图图片')}" referrerpolicy="no-referrer"></div>`).join('') : '<div class="wx-pic-empty">还没有图片，先从素材库添加</div>'}
    </div>
    ${images.length > 1 ? `<div class="wx-pic-dots">${images.map((_, index) => `<i class="${index === 0 ? 'active' : ''}"></i>`).join('')}</div>` : ''}
    <h2 class="wx-pic-title">${escapeHtml(article.title || '未命名贴图')}</h2>
    <div class="wx-pic-copy">${copy ? escapeHtml(copy).replace(/\n/g, '<br>') : '<span class="wx-pic-placeholder">写一段文案，发布后会显示在图片下方。</span>'}</div>
    <div class="wx-pic-meta">${escapeHtml(meta)}</div>
  </div>`;
}

function updatePicDots(content) {
  const gallery = $('.wx-pic-gallery', content);
  const dots = $$('.wx-pic-dots i', content);
  if (!gallery || !dots.length) return;
  const width = gallery.clientWidth || 1;
  const index = Math.max(0, Math.min(dots.length - 1, Math.round(gallery.scrollLeft / width)));
  dots.forEach((dot, position) => dot.classList.toggle('active', position === index));
}

function renderThemeGrid() {
  const currentId = state.current?.themeId || 'paper';
  const imported = state.themeGroup === 'imported';
  const themes = THEMES.filter((theme) => Boolean(theme.imported) === imported);
  $$('[data-theme-group]').forEach((button) => {
    button.classList.toggle('active', button.dataset.themeGroup === state.themeGroup);
  });
  $('#themeSourceNote').textContent = imported
    ? '来自花生公众号排版器的 MIT 开源主题，已保留原始块级样式与许可证。'
    : '一见原创主题，适合日常写作与长文阅读。';
  $('#themeGrid').innerHTML = themes.map((theme, index) => {
    const active = theme.id === currentId ? 'active' : '';
    return `<button class="theme-card ${active}" data-theme="${theme.id}" type="button" aria-pressed="${theme.id === currentId}" title="${escapeHtml(theme.tagline)}">
      <span class="theme-thumb" style="background:${theme.bg};color:${theme.text}">
        <span class="mini-kicker" style="color:${theme.muted}">${String(index + 1).padStart(2, '0')} / ${escapeHtml(theme.short)}</span>
        <span class="mini-title" style="font-family:${escapeHtml(theme.headingFont)};color:${theme.heading}">一张安静的书桌</span>
        <span class="mini-lines"><i style="background:${theme.text}"></i><i style="background:${theme.text}"></i><i style="background:${theme.text}"></i></span>
        <span class="mini-accent" style="background:${theme.accent}"></span>
      </span>
      <span class="theme-meta">
        <span class="theme-name">${escapeHtml(theme.name)}</span>
        <span class="theme-short">${escapeHtml(theme.short)}</span>
        <span class="theme-check">✓</span>
      </span>
    </button>`;
  }).join('');
}

function renderStyleCenter() {
  const theme = getTheme(state.current?.themeId || 'paper');
  const icons = state.styleMode === 'icons';
  $('#styleComponentView').hidden = icons;
  $('#styleIconView').hidden = !icons;
  // 图标工坊靠模式切换条当标题，收起面板大标题，把高度让给图标网格
  $('.side-panel[data-panel="styles"]').classList.toggle('icons-mode', icons);
  $('#styleModeComponentCount').textContent = String(STYLE_COMPONENTS.length);
  $('#styleModeIconCount').textContent = String(GLYPH_COUNT);
  $$('[data-style-mode]').forEach((button) => {
    const active = button.dataset.styleMode === state.styleMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  const search = $('#styleSearch');
  search.placeholder = icons ? '搜索图标：星、时间、箭头、star……' : '搜索标题、卡片、步骤……';
  search.value = icons ? state.iconQuery : state.styleQuery;
  $('#stylePanelDesc').textContent = icons
    ? '调好样式后点图标即插入，跟随模板强调色，不占素材配额。'
    : '点击插入到光标处，再替换占位文字。组件会继承当前模板和强调色。';

  if (icons) {
    renderIconStudio();
    return;
  }

  $('#styleCategories').innerHTML = STYLE_CATEGORIES.map((category) =>
    `<button class="${state.styleCategory === category ? 'active' : ''}" data-style-category="${category}" type="button">${category}</button>`
  ).join('');
  const query = state.styleQuery.trim().toLowerCase();
  const components = STYLE_COMPONENTS.filter((component) => {
    if (state.styleCategory === '收藏' && !state.styleFavorites.has(component.id)) return false;
    if (!['全部', '收藏'].includes(state.styleCategory) && component.category !== state.styleCategory) return false;
    if (!query) return true;
    return `${component.name} ${component.category} ${component.description} ${component.keywords || ''}`.toLowerCase().includes(query);
  });
  $('#styleList').innerHTML = components.length ? components.map((component) => {
    const favorite = state.styleFavorites.has(component.id);
    const preview = renderArticle(component.sample, theme, {
      fontSize: 13,
      lineHeight: 1.65,
      accent: normalizeOptions(state.current?.options).accent,
    }).html;
    return `<article class="style-card" data-style="${component.id}">
      <button class="style-favorite ${favorite ? 'active' : ''}" data-style-favorite="${component.id}" type="button" title="${favorite ? '取消收藏' : '收藏'}">${icon('star', 13)}</button>
      <div class="style-card-preview"><div class="style-preview-inner">${preview}</div><span class="style-card-category">${component.category}</span></div>
      <div class="style-card-body"><strong>${component.name}</strong><p>${component.description}</p><button class="style-insert" data-style-insert="${component.id}" type="button">${icon('plus', 12)}插入到正文</button></div>
    </article>`;
  }).join('') : '<p class="empty">没有找到匹配的样式，换个关键词试试。</p>';
}

/* ------------------------------- icon studio ------------------------------- */

/** 图标预览用的调色板，和正文渲染保持同一套取色规则 */
function iconPalette() {
  const theme = getTheme(state.current?.themeId || 'paper');
  const options = normalizeOptions(state.current?.options);
  const accent = /^#[0-9a-f]{6}$/i.test(options.accent || '') ? options.accent : theme.accent;
  return { accent, text: theme.text, muted: theme.muted, heading: theme.heading, line: theme.line, bg: theme.bg };
}

function loadIconStudio() {
  try {
    const saved = JSON.parse(localStorage.getItem(ICON_STUDIO_KEY) || '{}');
    const style = { ...DEFAULT_GLYPH_STYLE };
    Object.keys(style).forEach((key) => {
      if (saved[key] != null && saved[key] !== '') style[key] = saved[key];
    });
    ['size', 'tint', 'weight', 'gap', 'opacity'].forEach((key) => {
      const value = Number(style[key]);
      style[key] = Number.isFinite(value) ? value : DEFAULT_GLYPH_STYLE[key];
    });
    if (!['none', 'circle', 'square', 'outline'].includes(style.shape)) style.shape = 'none';
    if (!['middle', 'baseline', 'text-bottom', 'top'].includes(style.align)) style.align = 'middle';
    if (!/^(accent|text|muted|heading|line|#[0-9a-f]{6})$/i.test(String(style.color))) style.color = 'accent';
    return style;
  } catch {
    return { ...DEFAULT_GLYPH_STYLE };
  }
}

function saveIconStudio() {
  localStorage.setItem(ICON_STUDIO_KEY, JSON.stringify(state.iconStyle));
}

function openIconStudio() {
  if (isPic()) {
    toast('贴图不支持图标排版，切换到文章后再使用', 'error');
    return;
  }
  state.styleMode = 'icons';
  activateSideTab('styles');
  renderStyleCenter();
  if (window.innerWidth <= 900) document.body.classList.add('sidebar-open');
  revealIconGrid();
}

function renderIconStudio() {
  const palette = iconPalette();
  const style = state.iconStyle;
  const glyph = getGlyph(state.iconSelected) || GLYPH_LIST[0];
  state.iconSelected = glyph.id;
  const color = resolveGlyphColor(style.color, palette);
  const art = (size) => renderGlyph(glyph.id, { ...style, size, color });

  // 预览台底色跟随模板，深色模板下也能看清图标
  const stage = $('#iconStage');
  stage.style.background = palette.bg;
  stage.style.borderColor = palette.line;
  $('#iconStageSolo').innerHTML = art(Math.min(48, Math.max(12, Number(style.size) || 18)));
  const line = $('#iconStageLine');
  line.style.color = palette.text;
  line.style.background = palette.bg;
  line.innerHTML = `${art(Number(style.size) || 18)}<span style="color:${palette.text}">图标和正文排在一起</span>`;
  const name = $('#iconStageName');
  name.textContent = `${glyph.name} · ${glyph.group}`;
  name.style.color = palette.heading;
  const syntax = glyphSyntax(glyph.id, style);
  const chip = $('#iconStageSyntax');
  chip.textContent = syntax;
  chip.title = `${syntax}（点击复制）`;

  const readouts = { iconSize: 'size', iconTint: 'tint', iconWeight: 'weight', iconGap: 'gap', iconOpacity: 'opacity' };
  Object.entries(readouts).forEach(([id, key]) => {
    const input = $(`#${id}`);
    input.value = String(style[key]);
    $(`#${id}Out`).textContent = String(style[key]);
  });
  $('#iconShape').value = style.shape;
  $('#iconAlign').value = style.align;
  $('#iconColorPick').value = /^#/.test(String(style.color)) ? style.color : palette.accent;
  $('#btnIconColorFollow').textContent = style.color === 'accent' ? '已跟随强调色' : '跟随强调色';

  const swatches = [
    { value: 'accent', name: '跟随强调色', color: palette.accent, auto: true },
    { value: 'heading', name: '标题色', color: palette.heading },
    { value: 'text', name: '正文色', color: palette.text },
    { value: 'muted', name: '辅助色', color: palette.muted },
    ...[
      { value: '#b5432a', name: '朱砂' },
      { value: '#1d4ed8', name: '群青' },
      { value: '#0f766e', name: '松绿' },
      { value: '#b45309', name: '琥珀' },
      { value: '#7c3aed', name: '紫藤' },
    ].map((item) => ({ ...item, color: item.value })),
  ];
  $('#iconSwatches').innerHTML = swatches.map((swatch) => {
    const active = String(style.color).toLowerCase() === swatch.value;
    return `<button class="icon-swatch ${swatch.auto ? 'auto' : ''} ${active ? 'active' : ''}"
      data-icon-color="${swatch.value}" style="background:${swatch.color}" type="button" title="${swatch.name}" aria-label="${swatch.name}" aria-pressed="${active}"></button>`;
  }).join('');

  const groups = ['全部', ...GLYPH_GROUPS];
  $('#iconGroups').innerHTML = groups.map((group) =>
    `<button class="${state.iconGroup === group ? 'active' : ''}" data-icon-group="${group}" type="button">${group}</button>`
  ).join('');

  renderIconGrid();
}

function renderIconGrid() {
  const palette = iconPalette();
  const style = state.iconStyle;
  const color = resolveGlyphColor(style.color, palette);
  const list = searchGlyphs(state.iconQuery, state.iconGroup);
  // 网格里的图标固定 22px，只有影响外观的参数变化才重画，拖动尺寸滑杆不卡
  const signature = [color, style.shape, style.tint, style.weight, style.opacity, state.iconGroup, state.iconQuery].join('|');
  if (signature !== state.iconGridSignature || !$('#iconGrid').children.length) {
    state.iconGridSignature = signature;
    $('#iconGrid').innerHTML = list.length ? list.map((glyph) => `
      <button class="icon-cell ${glyph.id === state.iconSelected ? 'active' : ''}" data-icon-id="${glyph.id}" type="button"
        title="${escapeHtml(glyph.name)} · :${glyph.id}:">
        <span class="icon-cell-art">${renderGlyph(glyph.id, { ...style, size: 22, gap: 0, color })}</span>
        <span class="icon-cell-name">${escapeHtml(glyph.name)}</span>
      </button>`).join('') : '<p class="icon-empty">没有找到匹配的图标，试试「星」「箭头」「时间」。</p>';
  } else {
    $$('.icon-cell').forEach((cell) => cell.classList.toggle('active', cell.dataset.iconId === state.iconSelected));
  }
  $('#iconFootnote').textContent = `共 ${GLYPH_COUNT} 个图标，当前显示 ${list.length} 个。点击即插入到光标处，Shift + 点击只选中不插入。图标由字符与 CSS 图形绘制，不使用图片与 SVG，复制到公众号不掉格式，也不占素材配额。`;
}

function setIconStyle(patch, { persist = true } = {}) {
  state.iconStyle = { ...state.iconStyle, ...patch };
  if (persist) saveIconStudio();
  renderIconStudio();
}

/** 换分组或搜索后，把网格起点滚回吸顶卡片下方，免得停在列表末尾的空白处 */
function revealIconGrid() {
  const grid = $('#iconGrid');
  const studio = $('.icon-studio');
  const body = grid.closest('.side-body');
  if (!body || !studio) return;
  const offset = grid.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
  const target = Math.max(0, offset - studio.offsetHeight - 12);
  if (body.scrollTop > target) body.scrollTop = target;
}

function insertGlyph(id = state.iconSelected) {
  if (!state.current) return;
  if (isPic()) {
    toast('贴图不支持图标排版，切换到文章后再使用', 'error');
    return;
  }
  const glyph = getGlyph(id);
  if (!glyph) return;
  insertText(`${glyphSyntax(glyph.id, state.iconStyle)} `);
  toast(`已插入图标「${glyph.name}」`, 'success', 1800);
}

function insertComponent(id) {
  const component = STYLE_COMPONENTS.find((item) => item.id === id);
  if (!component || !state.current) return;
  if (isPic()) {
    toast('贴图不支持排版组件，切换到文章后再使用', 'error');
    return;
  }
  insertText(`\n\n${component.sample}\n\n`);
  toast(`已插入「${component.name}」，请替换占位文字`, 'success');
}

function renderOptions() {
  if (!state.current) return;
  const options = normalizeOptions(state.current.options);
  const theme = getTheme(state.current.themeId);

  $('#themeName').textContent = theme.name;
  $('#editorThemePill').textContent = theme.name;

  $('#fontSizeSeg').innerHTML = [15, 16, 17, 18]
    .map((size) => `<button data-size="${size}" class="${Math.abs(options.fontSize - size) < 0.1 ? 'active' : ''}" type="button">${size}</button>`)
    .join('');

  $('#lineHeightSeg').innerHTML = [
    [1.7, '1.7'],
    [1.9, '1.9'],
    [2.1, '2.1'],
  ]
    .map(([value, label]) => `<button data-lh="${value}" class="${Math.abs(options.lineHeight - value) < 0.01 ? 'active' : ''}" type="button">${label}</button>`)
    .join('');

  $('#accentSwatches').innerHTML = ACCENT_PRESETS.map((preset) => {
    const active = (options.accent || '') === preset.value ? 'active' : '';
    const none = preset.value ? '' : 'none';
    const style = preset.value ? `background:${preset.value}` : '';
    return `<button class="swatch ${none} ${active}" data-accent="${preset.value}" title="${preset.name}" style="${style}" type="button"></button>`;
  }).join('');
}

function renderArticleList() {
  if (!state.current) {
    $('#articleList').innerHTML = '<p class="empty">还没有文章。</p>';
    return;
  }
  const list = visibleArticles().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  if (!list.length) {
    $('#articleList').innerHTML = '<p class="empty">这个账号还没有文章，点上方「新建」或「导入文档」开始。</p>';
    return;
  }
  $('#articleList').innerHTML = list
    .map((article) => {
      const active = article.id === state.current.id ? 'active' : '';
      const pic = article.kind === 'pic';
      const words = pic
        ? (article.copy || '').length
        : (article.markdown || '').replace(/\s/g, '').length;
      const meta = pic
        ? `${formatUpdated(article.updatedAt)} · ${(article.images || []).length} 张图${article.author ? ` · ${escapeHtml(article.author)}` : ''}`
        : `${formatUpdated(article.updatedAt)} · ${formatNumber(words)} 字${article.author ? ` · ${escapeHtml(article.author)}` : ''}`;
      return `<div class="article-item ${active}" data-id="${article.id}">
        <div class="article-item-main">
          <div class="article-item-title"><span class="article-kind ${pic ? 'pic' : ''}">${pic ? '贴图' : '图文'}</span>${escapeHtml(article.title || (pic ? '未命名贴图' : '未命名文章'))}</div>
          <div class="article-item-meta">${meta}</div>
        </div>
        <button class="article-delete" data-act="delete" title="删除文章" type="button">${icon('trash', 14)}</button>
      </div>`;
    })
    .join('');
}

function setArticleView(view) {
  state.articleView = ['drafts', 'published'].includes(view) ? view : 'local';
  $$('[data-article-view]').forEach((button) => {
    const active = button.dataset.articleView === state.articleView;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  $('#localArticlesView').hidden = state.articleView !== 'local';
  $('#draftArticlesView').hidden = state.articleView !== 'drafts';
  $('#publishedArticlesView').hidden = state.articleView !== 'published';
  $('#btnNewArticle').hidden = state.articleView !== 'local';
  $('#newArticleMenu').hidden = true;
  if (state.articleView === 'drafts') {
    renderDraftList();
    if (!state.drafts.loaded && !state.drafts.loading) loadDrafts(true);
  }
  if (state.articleView === 'published') {
    renderPublishedList();
    if (!state.published.loaded && !state.published.loading) loadPublished(true);
  }
}

async function loadPublished(reset = false) {
  const published = state.published;
  if (published.loading) return;
  if (reset) {
    published.items = [];
    published.offset = 0;
    published.total = 0;
    published.hasMore = false;
    published.loaded = false;
  }
  const id = ++published.requestId;
  published.loading = true;
  published.error = '';
  renderPublishedList();
  try {
    const data = await api.wechatPublished({ offset: published.offset, count: 20 });
    if (id !== published.requestId) return;
    const existing = new Set(published.items.map((item) => item.id));
    published.items.push(...(data.items || []).filter((item) => !existing.has(item.id)));
    published.offset = Number(data.offset) + 20;
    published.total = Number(data.total) || 0;
    published.hasMore = Boolean(data.hasMore);
    published.loaded = true;
  } catch (err) {
    if (id !== published.requestId) return;
    published.error = err.message;
    published.loaded = true;
  } finally {
    if (id === published.requestId) {
      published.loading = false;
      renderPublishedList();
    }
  }
}

function renderPublishedList() {
  const published = state.published;
  const list = $('#publishedList');
  const summary = $('#publishedSummary');
  const refresh = $('#publishedRefresh');
  const more = $('#publishedLoadMore');
  if (!list || !summary || !refresh || !more) return;

  refresh.disabled = published.loading;
  summary.textContent = published.total ? `${published.total} 次成功发布` : '公众号发布档案';
  more.hidden = !published.hasMore;
  more.disabled = published.loading;
  more.textContent = published.loading ? '正在加载…' : '加载更多';

  if (published.loading && !published.items.length) {
    list.innerHTML = Array.from({ length: 3 }, () => `<div class="published-skeleton">
      <span></span><div><i></i><i></i><i></i></div>
    </div>`).join('');
    return;
  }
  if (published.error && !published.items.length) {
    list.innerHTML = `<div class="published-state">
      <span class="published-state-icon">${icon('book', 20)}</span>
      <strong>暂时无法读取发布记录</strong>
      <p>${escapeHtml(published.error)}</p>
      <div class="button-row">
        <button class="btn btn-sm btn-dark" data-published-retry type="button">重新加载</button>
        <button class="btn btn-sm" data-published-settings type="button">检查配置</button>
      </div>
    </div>`;
    return;
  }
  if (!published.items.length) {
    list.innerHTML = `<div class="published-state empty-published">
      <span class="published-state-icon">${icon('book', 20)}</span>
      <strong>还没有发布记录</strong>
      <p>通过微信公众号“发布能力”成功发表的文章，会在这里形成一份安静的内容档案。</p>
    </div>`;
    return;
  }

  list.innerHTML = published.items.map((item) => {
    const date = publishedDateParts(item.publishedAt);
    const group = item.groupSize > 1 ? ` · 第 ${item.position} / ${item.groupSize} 篇` : '';
    return `<button class="published-item" data-published-id="${escapeHtml(item.id)}" type="button">
      <span class="published-date"><strong>${date.day}</strong><small>${date.month}</small><i>${date.year}</i></span>
      <span class="published-item-main">
        <span class="published-kicker">Published${group}</span>
        <span class="published-item-title">${escapeHtml(item.title)}</span>
        ${item.digest ? `<span class="published-item-digest">${escapeHtml(item.digest)}</span>` : ''}
        <span class="published-item-meta">${escapeHtml(item.author || '公众号文章')}<i></i>已发布</span>
      </span>
      <span class="published-item-arrow">${icon('chevron-right', 13)}</span>
    </button>`;
  }).join('') + (published.error ? `<div class="published-inline-error">
      <span>${escapeHtml(published.error)}</span>
      <button class="link-btn" data-published-retry type="button">重试</button>
    </div>` : '');
}

function openPublishedDetail(item) {
  const date = publishedDateParts(item.publishedAt);
  const group = item.groupSize > 1 ? ` · 同组第 ${item.position} 篇，共 ${item.groupSize} 篇` : '';
  openModal({
    title: '发布档案',
    subtitle: '这条记录来自微信公众号的成功发布列表，只读查看，不会修改线上文章。',
    width: 620,
    body: `<div class="published-detail-hero">
        <div class="published-detail-date"><span>已发布</span><strong>${date.day}</strong><small>${date.month} · ${date.year}</small></div>
        <div class="published-detail-heading">
          <p class="eyebrow">Published article</p>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(formatDate(item.publishedAt) || '发布时间未知')}${escapeHtml(group)}</p>
        </div>
      </div>
      <div class="published-detail-meta">
        <span>${icon('user', 13)}${escapeHtml(item.author || '未填写作者')}</span>
        <span class="status-dot ok"></span><span>发布成功</span>
      </div>
      ${item.digest ? `<div class="published-detail-digest"><span>文章摘要</span><p>${escapeHtml(item.digest)}</p></div>` : ''}
      ${item.url ? `<div class="published-detail-link"><span>原文链接</span><code>${escapeHtml(item.url)}</code></div>` : '<p class="config-note">微信没有返回这篇文章的原文链接。</p>'}`,
    footer: `<button class="btn" data-footer-close type="button">关闭</button>
      ${item.url ? `<button class="btn" id="copyPublishedUrl" type="button">${icon('copy', 14)}复制链接</button>
      <a class="btn btn-accent" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">打开原文${icon('external', 14)}</a>` : ''}`,
    onMount(root) {
      $('#copyPublishedUrl', root)?.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(item.url);
          toast('原文链接已复制', 'success');
        } catch (err) {
          toast(`复制失败：${err.message}`, 'error');
        }
      });
    },
  });
}

async function loadDrafts(reset = false) {
  const drafts = state.drafts;
  if (drafts.loading) return;
  if (reset) {
    drafts.items = [];
    drafts.offset = 0;
    drafts.total = 0;
    drafts.hasMore = false;
    drafts.loaded = false;
  }
  const id = ++drafts.requestId;
  drafts.loading = true;
  drafts.error = '';
  drafts.errorCode = '';
  renderDraftList();
  try {
    const data = await api.wechatDrafts({ offset: drafts.offset, count: 10 });
    if (id !== drafts.requestId) return;
    const existing = new Set(drafts.items.map((item) => item.mediaId));
    drafts.items.push(...(data.items || []).filter((item) => !existing.has(item.mediaId)));
    drafts.offset = Number(data.offset) + 10;
    drafts.total = Number(data.total) || 0;
    drafts.hasMore = Boolean(data.hasMore);
    drafts.loaded = true;
  } catch (err) {
    if (id !== drafts.requestId) return;
    drafts.error = err.message;
    drafts.errorCode = err.code ? String(err.code) : '';
    drafts.loaded = true;
  } finally {
    if (id === drafts.requestId) {
      drafts.loading = false;
      renderDraftList();
    }
  }
}

function renderDraftList() {
  const drafts = state.drafts;
  const list = $('#draftList');
  const summary = $('#draftSummary');
  const refresh = $('#draftRefresh');
  const more = $('#draftLoadMore');
  if (!list || !summary || !refresh || !more) return;

  refresh.disabled = drafts.loading;
  summary.textContent = drafts.total ? `${drafts.total} 份草稿` : '公众号草稿箱';
  more.hidden = !drafts.hasMore;
  more.disabled = drafts.loading;
  more.textContent = drafts.loading ? '正在加载…' : '加载更多';

  if (drafts.loading && !drafts.items.length) {
    list.innerHTML = Array.from({ length: 3 }, () => `<div class="published-skeleton">
      <span></span><div><i></i><i></i><i></i></div>
    </div>`).join('');
    return;
  }
  if (drafts.error && !drafts.items.length) {
    list.innerHTML = `<div class="published-state">
      <span class="published-state-icon">${icon('file', 20)}</span>
      <strong>暂时无法读取草稿箱</strong>
      <p>${escapeHtml(drafts.error)}</p>
      ${drafts.errorCode ? `<p class="draft-error-code">错误码 ${escapeHtml(drafts.errorCode)}</p>` : ''}
      <div class="button-row">
        <button class="btn btn-sm btn-dark" data-draft-retry type="button">重新加载</button>
        <button class="btn btn-sm" data-draft-settings type="button">检查配置</button>
      </div>
    </div>`;
    return;
  }
  if (!drafts.items.length) {
    list.innerHTML = `<div class="published-state empty-published">
      <span class="published-state-icon">${icon('file', 20)}</span>
      <strong>草稿箱是空的</strong>
      <p>在发布弹窗点「保存并发布」后，草稿会先出现在这里，再到公众号后台确认群发。</p>
    </div>`;
    return;
  }

  list.innerHTML = drafts.items.map((item) => {
    const first = item.articles[0] || {};
    const pic = first.articleType === 'newspic';
    const thumb = first.thumbUrl
      ? `<img src="${escapeHtml(first.thumbUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
      : icon(pic ? 'image' : 'file', 18);
    const count = pic
      ? (first.imageCount ? ` · ${first.imageCount} 张图` : '')
      : (item.articles.length > 1 ? ` · ${item.articles.length} 篇图文` : '');
    return `<button class="published-item draft-item" data-draft-id="${escapeHtml(item.mediaId)}" type="button">
      <span class="draft-thumb">${thumb}</span>
      <span class="published-item-main">
        <span class="published-kicker">${pic ? '图片消息' : 'Draft'}${count}</span>
        <span class="published-item-title">${escapeHtml(first.title || '未命名草稿')}</span>
        ${first.digest ? `<span class="published-item-digest">${escapeHtml(first.digest)}</span>` : ''}
        <span class="published-item-meta">${escapeHtml(first.author || '公众号草稿')}<i></i>${escapeHtml(formatUpdated(item.updatedAt) || '时间未知')}</span>
      </span>
      <span class="published-item-arrow">${icon('chevron-right', 13)}</span>
    </button>`;
  }).join('') + (drafts.error ? `<div class="published-inline-error">
      <span>${escapeHtml(drafts.error)}</span>
      <button class="link-btn" data-draft-retry type="button">重试</button>
    </div>` : '');
}

function openDraftDetail(item) {
  const first = item.articles[0] || {};
  const pic = first.articleType === 'newspic';
  const date = publishedDateParts(item.updatedAt);
  const updated = formatDate(item.updatedAt) || '时间未知';
  const countText = pic
    ? (first.imageCount ? `共 ${first.imageCount} 张图片` : '图片消息')
    : `共 ${item.articles.length} 篇图文`;
  const rows = item.articles.map((article) => `<li class="draft-article-row">
      <span class="draft-article-index">${article.position}</span>
      <span class="draft-article-text"><strong>${escapeHtml(article.title)}</strong><small>${escapeHtml(article.author || '未署名')}</small></span>
    </li>`).join('');

  openModal({
    title: '公众号草稿',
    subtitle: '来自公众号草稿箱的只读记录，不会修改或删除线上草稿。',
    width: 620,
    body: `<div class="published-detail-hero">
        <div class="published-detail-date"><span>草稿</span><strong>${date.day}</strong><small>${date.month} · ${date.year}</small></div>
        <div class="published-detail-heading">
          <p class="eyebrow">WeChat draft</p>
          <h3>${escapeHtml(first.title || '未命名草稿')}</h3>
          <p>更新于 ${escapeHtml(updated)} · ${countText}</p>
        </div>
      </div>
      ${first.thumbUrl ? `<div class="draft-detail-cover"><img src="${escapeHtml(first.thumbUrl)}" alt="草稿封面" referrerpolicy="no-referrer"></div>` : ''}
      <div class="published-detail-meta">
        <span>${icon('user', 13)}${escapeHtml(first.author || '未填写作者')}</span>
        <span class="status-dot ok"></span><span>仅本机读取</span>
      </div>
      ${first.digest ? `<div class="published-detail-digest"><span>${pic ? '贴图文案' : '文章摘要'}</span><p>${escapeHtml(first.digest)}</p></div>` : ''}
      ${!pic && item.articles.length > 1 ? `<div class="draft-detail-list"><span>图文顺序</span><ol>${rows}</ol></div>` : ''}
      <div class="published-detail-link"><span>草稿 ID</span><code>${escapeHtml(item.mediaId)}</code></div>
      <p class="config-note">${pic ? '图片消息草稿需要到公众号后台继续编辑或发表。这里只读取列表，不会改动线上内容。' : '草稿需要到公众号后台继续编辑或群发。这里只读取列表，不会改动线上内容。'}</p>`,
    footer: `<button class="btn" data-footer-close type="button">关闭</button>
      <button class="btn btn-dark" id="copyDraftId" type="button">${icon('copy', 14)}复制草稿 ID</button>`,
    onMount(root) {
      $('#copyDraftId', root)?.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(item.mediaId);
          toast('草稿 ID 已复制', 'success');
        } catch (err) {
          toast(`复制失败：${err.message}`, 'error');
        }
      });
    },
  });
}

function renderCoverPanel() {
  if (!state.current) return;
  const cover = state.current.cover;
  const preview = $('#coverPreview');
  if (cover) {
    preview.innerHTML = `<img src="${cover}" alt="文章封面" referrerpolicy="no-referrer">`;
  } else {
    preview.innerHTML = '<div class="cover-empty">还没有封面<br>用「封面工坊」快速生成一张</div>';
  }
  $('#btnCoverRemove').hidden = !cover;
  $('#btnCoverCrop').hidden = !cover;
}

function updateAccountUI() {
  const name = state.settings.accountName || '我的公众号';
  $('#wxAccountName').textContent = name;
  $('#wxAvatar').textContent = name.slice(0, 1);
  $('#authorInput').placeholder = state.settings.author ? `默认：${state.settings.author}` : '未署名';
  renderAccountSwitcher();
}

/* ------------------------------ 账号切换器 ------------------------------ */

function renderAccountSwitcher() {
  const accounts = state.settings.accounts || [];
  const activeId = state.settings.activeAccountId;
  const active = activeAccountInfo();
  const name = active?.accountName || '我的公众号';
  $('#accountSwitchName').textContent = name;
  $('#accountSwitchAvatar').textContent = name.slice(0, 1);
  $('#accountSwitchBtn').title = `当前账号：${name}（点击切换）`;

  const menu = $('#accountMenu');
  menu.innerHTML = accounts.map((acc) => {
    const isActive = acc.id === activeId;
    const sub = acc.appId ? `${escapeHtml(acc.appId)}${acc.hasSecret ? '' : ' · 未填密钥'}` : '未配置接口，仅本机写作';
    return `<button class="account-menu-item ${isActive ? 'active' : ''}" data-account-id="${escapeHtml(acc.id)}" type="button">
      <span class="account-menu-avatar">${escapeHtml((acc.accountName || '号').slice(0, 1))}</span>
      <span class="account-menu-info">
        <strong>${escapeHtml(acc.accountName || '我的公众号')}</strong>
        <span>${sub}</span>
      </span>
      ${isActive ? `<span class="account-menu-check">${icon('check', 13)}当前</span>` : ''}
    </button>`;
  }).join('') + `
    <button class="account-menu-item account-menu-manage" data-account-manage type="button">
      ${icon('settings', 14)}<span>管理账号 / 添加账号…</span>
    </button>`;
}

function closeAccountMenu() {
  const menu = $('#accountMenu');
  if (menu) menu.hidden = true;
}

function bindAccountSwitcher() {
  const btn = $('#accountSwitchBtn');
  const menu = $('#accountMenu');
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    menu.hidden = !menu.hidden;
  });
  menu.addEventListener('click', async (event) => {
    const item = event.target.closest('[data-account-id]');
    if (item) {
      closeAccountMenu();
      await switchAccount(item.dataset.accountId);
      return;
    }
    if (event.target.closest('[data-account-manage]')) {
      closeAccountMenu();
      openSettings();
    }
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('#accountSwitch')) closeAccountMenu();
  });
}

/* --------------------------------- assets --------------------------------- */

function renderAssets() {
  const grid = $('#assetGrid');
  const empty = $('#assetEmpty');
  grid.innerHTML = state.uploads
    .map(
      (item) => `<div class="asset" data-file="${escapeHtml(item.file)}" title="${escapeHtml(item.name)}">
        <img src="${item.url}" alt="${escapeHtml(item.name)}" loading="lazy">
        <span class="asset-size">${formatBytes(item.size)}</span>
        <div class="asset-actions">
          <button data-act="insert" type="button">${icon('plus', 12)}${isPic() ? '添加' : '插入'}</button>
          <button data-act="delete" type="button">${icon('trash', 12)}删除</button>
        </div>
      </div>`
    )
    .join('');
  empty.hidden = state.uploads.length > 0;
}

async function uploadFiles(files, { insert = false, silent = false } = {}) {
  const list = [...files].filter((file) => file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(file.name));
  if (!list.length) {
    toast('请选择图片文件', 'error');
    return [];
  }
  const uploaded = [];
  for (const file of list) {
    try {
      const prepared = await prepareImage(file);
      const res = await api.upload({
        name: file.name,
        dataUrl: prepared.dataUrl,
        width: prepared.width,
        height: prepared.height,
      });
      state.uploads.unshift(res.file);
      uploaded.push(res.file);
    } catch (err) {
      toast(`${file.name}：${err.message}`, 'error', 4500);
    }
  }
  if (uploaded.length) {
    renderAssets();
    if (!silent && !(insert && isPic())) toast(`已添加 ${uploaded.length} 张图片`, 'success');
    if (insert) {
      if (isPic()) addPicImages(uploaded.map(toPicImage));
      else uploaded.forEach((item) => insertImage(item));
    }
  }
  return uploaded;
}

function prepareImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      try {
        const maxEdge = 1600;
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const needsReencode = file.size > 900 * 1024 || scale < 1 || !['image/jpeg', 'image/png'].includes(file.type);
        if (!needsReencode) {
          const dataUrl = await fileToDataUrl(file);
          URL.revokeObjectURL(url);
          resolve({ dataUrl, width: img.width, height: img.height });
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        let quality = 0.88;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        while (dataUrl.length > 1.15 * 1024 * 1024 && quality > 0.42) {
          quality -= 0.08;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        URL.revokeObjectURL(url);
        resolve({ dataUrl, width: canvas.width, height: canvas.height });
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片无法读取'));
    };
    img.src = url;
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

async function uploadEmbeddedImage(dataUrl, name) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[blob.type] || 'png';
  const file = new File([blob], `${String(name || '导入图片').replace(/[\\/:*?"<>|]/g, '-').slice(0, 60)}.${extension}`, {
    type: blob.type || 'image/png',
  });
  const prepared = await prepareImage(file);
  const res = await api.upload({
    name: file.name,
    dataUrl: prepared.dataUrl,
    width: prepared.width,
    height: prepared.height,
  });
  state.uploads.unshift(res.file);
  return res.file;
}

function conversionMessage(stats, action = '转换') {
  const parts = [];
  if (stats.embedded) parts.push(`${stats.embedded} 张图片已存入素材库`);
  if (stats.external) parts.push(`${stats.external} 张外链图片保留原地址`);
  if (stats.failed) parts.push(`${stats.failed} 张图片未能导入`);
  return parts.length ? `${action}完成：${parts.join('，')}` : '';
}

function insertImages(items) {
  const list = items.filter((item) => item?.url);
  if (!list.length) return;
  const blocks = list.map((item) => {
    let caption = String(item.name || '').replace(/\.[^.]+$/, '');
    if (/^[a-z0-9]+-[a-z0-9]+-/i.test(caption)) caption = '';
    caption = caption.replace(/([\[\]])/g, '\\$1');
    return `![${caption}](${item.url})`;
  });
  insertText(`\n\n${blocks.join('\n\n')}\n\n`);
  toast(list.length > 1 ? `${list.length} 张图片已插入正文` : '图片已插入正文', 'success');
}

function insertImage(item) {
  if (!item?.url) return;
  if (isPic()) {
    addPicImages([toPicImage(item)]);
    return;
  }
  insertImages([item]);
}

async function deleteUpload(item) {
  const ok = await confirmDialog({
    title: '删除这张图片？',
    message: `「${item.name}」将从素材库移除。如果它正在文章中使用，删除后需要重新插入。`,
    confirmText: '删除',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.deleteUpload(item.file);
    state.uploads = state.uploads.filter((upload) => upload.file !== item.file);
    renderAssets();
    toast('图片已删除', 'success');
  } catch (err) {
    if (/引用/.test(err.message)) {
      const force = await confirmDialog({
        title: '图片仍在使用',
        message: `${err.message}\n\n强制删除会让文章中的图片失效。`,
        confirmText: '仍然删除',
        danger: true,
      });
      if (force) {
        try {
          await api.deleteUpload(item.file, true);
          state.uploads = state.uploads.filter((upload) => upload.file !== item.file);
          renderAssets();
          toast('图片已强制删除', 'success');
        } catch (e) {
          toast(e.message, 'error');
        }
      }
      return;
    }
    toast(err.message, 'error');
  }
}

/* -------------------------------- editor ops ------------------------------- */

function insertText(text, selectText) {
  const editor = $('#editor');
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  editor.setRangeText(text, start, end, 'end');
  let selStart = start + text.length;
  let selEnd = selStart;
  if (selectText) {
    const offset = text.indexOf(selectText);
    if (offset >= 0) {
      selStart = start + offset;
      selEnd = selStart + selectText.length;
    }
  }
  editor.focus();
  editor.setSelectionRange(selStart, selEnd);
  onEditorInput();
}

function wrapSelection(before, after) {
  const editor = $('#editor');
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const selected = editor.value.slice(start, end);
  editor.setRangeText(`${before}${selected}${after}`, start, end, 'end');
  editor.focus();
  const selStart = start + before.length;
  editor.setSelectionRange(selStart, selStart + selected.length);
  onEditorInput();
}

function prefixLines(prefix, ordered = false) {
  const editor = $('#editor');
  const value = editor.value;
  const start = value.lastIndexOf('\n', editor.selectionStart - 1) + 1;
  let end = value.indexOf('\n', editor.selectionEnd);
  if (end === -1) end = value.length;
  const block = value.slice(start, end);
  const lines = block.split('\n');
  const next = lines
    .map((line, index) => {
      if (!line.trim()) return line;
      return (ordered ? `${index + 1}. ` : prefix) + line;
    })
    .join('\n');
  editor.setRangeText(next, start, end, 'end');
  editor.focus();
  editor.setSelectionRange(start, start + next.length);
  onEditorInput();
}

async function handleAction(action) {
  switch (action) {
    case 'h2':
      prefixLines('## ');
      break;
    case 'h3':
      prefixLines('### ');
      break;
    case 'bold':
      wrapSelection('**', '**');
      break;
    case 'italic':
      wrapSelection('*', '*');
      break;
    case 'highlight':
      wrapSelection('==', '==');
      break;
    case 'quote':
      prefixLines('> ');
      break;
    case 'ul':
      prefixLines('- ');
      break;
    case 'ol':
      prefixLines('1. ', true);
      break;
    case 'divider':
      insertText('\n\n---\n\n');
      break;
    case 'code': {
      const editor = $('#editor');
      const selected = editor.value.slice(editor.selectionStart, editor.selectionEnd);
      if (selected) {
        insertText(`\n\n\`\`\`\n${selected}\n\`\`\`\n\n`);
      } else {
        insertText('\n\n```\n// 在这里写代码\n```\n\n', '// 在这里写代码');
      }
      break;
    }
    case 'callout':
      insertText('\n\n:::tip 小提示\n在这里写一段提示。\n:::\n\n', '在这里写一段提示。');
      break;
    case 'glyph':
      openIconStudio();
      break;
    case 'timeline':
      insertComponent('icon-timeline');
      break;
    case 'image':
      openMediaPicker((item) => insertImage(item));
      break;
    case 'link': {
      const editor = $('#editor');
      const selected = editor.value.slice(editor.selectionStart, editor.selectionEnd);
      const values = await formDialog({
        title: '插入链接',
        subtitle: '公众号正文中的外部链接会被微信过滤，通常只保留文字。',
        fields: [
          { name: 'label', label: '链接文字', value: selected || '', placeholder: '例如：延伸阅读' },
          { name: 'url', label: '链接地址', value: 'https://', placeholder: 'https://' },
        ],
        confirmText: '插入',
      });
      if (values && values.url) {
        insertText(`[${values.label || values.url}](${values.url})`);
      }
      break;
    }
    case 'help':
      showHelp();
      break;
    default:
      break;
  }
}

/* -------------------------------- modals ---------------------------------- */

function openModal({ title, subtitle = '', body = '', footer = '', width = 760, wide = false, onMount, onClose }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.zIndex = String(100 + modalStack.length * 2);
  overlay.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" style="max-width:${width}px" role="dialog" aria-modal="true">
    <header class="modal-head">
      <div>
        <h3>${title}</h3>
        ${subtitle ? `<p>${subtitle}</p>` : ''}
      </div>
      <button class="icon-btn" data-close title="关闭" type="button">${icon('x', 17)}</button>
    </header>
    <div class="modal-body">${body}</div>
    ${footer ? `<footer class="modal-foot">${footer}</footer>` : ''}
  </div>`;

  $('#modalRoot').appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('in'));

  const entry = { overlay, closed: false, close: null };
  entry.close = () => {
    if (entry.closed) return;
    entry.closed = true;
    overlay.classList.remove('in');
    setTimeout(() => {
      overlay.remove();
      const index = modalStack.indexOf(entry);
      if (index >= 0) modalStack.splice(index, 1);
      onClose?.();
    }, 170);
  };
  modalStack.push(entry);

  overlay.querySelector('[data-close]').addEventListener('click', entry.close);
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) entry.close();
  });
  overlay.addEventListener('click', (event) => {
    if (event.target.closest('[data-footer-close]')) entry.close();
  });

  onMount?.(overlay, entry.close);
  return entry;
}

function confirmDialog({ title, message, confirmText = '确定', cancelText = '取消', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    openModal({
      title,
      body: `<p class="dialog-text" style="margin:0;font-size:12.5px;line-height:1.85;color:#5f574b;">${escapeHtml(message).replace(/\n/g, '<br>')}</p>`,
      footer: `<button class="btn" data-cancel type="button">${cancelText}</button><button class="btn ${danger ? 'btn-accent' : 'btn-dark'}" data-confirm type="button">${confirmText}</button>`,
      width: 480,
      onMount(root, close) {
        const finish = (value) => {
          if (settled) return;
          settled = true;
          close();
          resolve(value);
        };
        $('[data-cancel]', root).addEventListener('click', () => finish(false));
        $('[data-confirm]', root).addEventListener('click', () => finish(true));
      },
      onClose() {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      },
    });
  });
}

function formDialog({ title, subtitle, fields, confirmText = '确定' }) {
  return new Promise((resolve) => {
    let settled = false;
    const body = `<div class="form-grid">${fields
      .map(
        (field) => `<div class="field ${field.full ? 'full' : ''}">
          <label>${escapeHtml(field.label)}</label>
          <input name="${field.name}" value="${escapeHtml(field.value || '')}" placeholder="${escapeHtml(field.placeholder || '')}" />
        </div>`
      )
      .join('')}</div>`;
    openModal({
      title,
      subtitle,
      body,
      footer: `<button class="btn" data-cancel type="button">取消</button><button class="btn btn-dark" data-ok type="button">${confirmText}</button>`,
      width: 520,
      onMount(root, close) {
        const collect = () =>
          Object.fromEntries($$('[name]', root).map((input) => [input.name, input.value.trim()]));
        const finish = (value) => {
          if (settled) return;
          settled = true;
          close();
          resolve(value);
        };
        $('[data-cancel]', root).addEventListener('click', () => finish(null));
        $('[data-ok]', root).addEventListener('click', () => finish(collect()));
        $$('input', root).forEach((input) => {
          input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              finish(collect());
            }
          });
        });
        $('input', root)?.focus();
      },
      onClose() {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      },
    });
  });
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!$('#accountMenu').hidden) {
    closeAccountMenu();
    return;
  }
  if (aiContinueBubble.visible) {
    hideAiContinue();
    return;
  }
  if (modalStack.length) {
    modalStack[modalStack.length - 1].close();
  }
});

/* -------------------------------- media ----------------------------------- */

function openMediaPicker(onPick, { title = '插入图片', subtitle = '点击素材即可插入正文，也可以继续上传新图片。', allowWeChat = true } = {}) {
  openModal({
    title,
    subtitle,
    body: `<div class="button-row" style="margin:0 0 12px">
        <label class="btn btn-sm btn-dark">${icon('upload', 14)}上传图片<input type="file" id="pickerUpload" accept="image/*" multiple hidden></label>
        ${allowWeChat ? `<button class="btn btn-sm" data-open-wechat type="button">${icon('image', 14)}公众号图库</button>` : ''}
        <span style="align-self:center;font-size:10.5px;color:var(--muted)">也可以直接把截图粘贴到编辑器里</span>
      </div>
      <div class="media-grid" id="pickerGrid"></div>`,
    width: 720,
    onMount(root, close) {
      const grid = $('#pickerGrid', root);
      const paint = () => {
        grid.innerHTML =
          state.uploads
            .map(
              (item) => `<div class="asset" data-file="${escapeHtml(item.file)}" title="${escapeHtml(item.name)}">
                <img src="${item.url}" alt="" loading="lazy">
                <span class="asset-size">${formatBytes(item.size)}</span>
              </div>`
            )
            .join('') || '<p class="empty" style="grid-column:1/-1">素材库为空，先上传一张图片吧。</p>';
      };
      paint();
      grid.addEventListener('click', (event) => {
        const asset = event.target.closest('[data-file]');
        if (!asset) return;
        const item = state.uploads.find((upload) => upload.file === asset.dataset.file);
        if (item) {
          onPick(item);
          close();
        }
      });
      $('[data-open-wechat]', root)?.addEventListener('click', () => {
        close();
        openWeChatGallery();
      });
      const input = $('#pickerUpload', root);
      input.addEventListener('change', async () => {
        await uploadFiles(input.files);
        input.value = '';
        paint();
      });
    },
  });
}

function toPicImage(item) {
  const source = item.source === 'wechat' ? 'wechat' : 'local';
  return {
    url: item.url,
    name: item.name || '图片',
    width: Number(item.width) || 0,
    height: Number(item.height) || 0,
    source,
    mediaId: source === 'wechat' ? item.mediaId || '' : '',
    // 图库素材的 media_id 与账号绑定，记录来源账号，跨账号发布时服务端会改走下载重传
    accountId: source === 'wechat' ? item.accountId || state.settings.activeAccountId : '',
  };
}

function addPicImages(items) {
  if (!isPic() || !items.length) return;
  const article = state.current;
  const existing = article.images || [];
  const room = 20 - existing.length;
  if (room <= 0) {
    toast('贴图最多 20 张图片', 'error');
    return;
  }
  const accepted = items.slice(0, room).map(toPicImage);
  article.images = existing.concat(accepted);
  state.editSeq += 1;
  renderPicEditor();
  renderPreview();
  scheduleSaveSoon();
  renderArticleList();
  toast(`已添加 ${accepted.length} 张图片`, 'success');
  if (items.length > accepted.length) toast('已达到 20 张上限，多余的图片未添加', 'default', 4200);
}

function movePicImage(from, to) {
  if (!isPic()) return;
  const images = state.current.images || [];
  if (from === to || from < 0 || to < 0 || from >= images.length || to >= images.length) return;
  const [moved] = images.splice(from, 1);
  images.splice(to, 0, moved);
  state.editSeq += 1;
  renderPicEditor();
  renderPreview();
  scheduleSaveSoon();
}

function openPicImagePicker(onPickMany) {
  openModal({
    title: '添加贴图图片',
    subtitle: '从本机素材或公众号图库选择，可一次添加多张。首图会成为封面。',
    body: `<div class="button-row" style="margin:0 0 12px">
        <label class="btn btn-sm btn-dark">${icon('upload', 14)}上传图片<input type="file" id="picPickerUpload" accept="image/*" multiple hidden></label>
        <button class="btn btn-sm" data-open-wechat-pic type="button">${icon('image', 14)}公众号图库</button>
        <span style="align-self:center;font-size:10.5px;color:var(--muted)">也可以把图片直接拖到贴图网格里</span>
      </div>
      <div class="media-grid" id="picPickerGrid"></div>`,
    width: 720,
    footer: `<span class="left" id="picPickerSelected">未选择图片</span>
      <button class="btn" data-footer-close type="button">取消</button>
      <button class="btn btn-accent" id="picPickerAdd" type="button" disabled>${icon('plus', 14)}添加图片</button>`,
    onMount(root, close) {
      const grid = $('#picPickerGrid', root);
      const selectedText = $('#picPickerSelected', root);
      const addButton = $('#picPickerAdd', root);
      const selected = new Map();

      const paint = () => {
        selectedText.textContent = selected.size ? `已选择 ${selected.size} 张图片` : '未选择图片';
        addButton.disabled = selected.size === 0;
        grid.innerHTML = state.uploads.map((item) => {
          const checked = selected.has(item.file);
          return `<button class="asset pic-picker-item ${checked ? 'selected' : ''}" data-file="${escapeHtml(item.file)}" type="button" title="${escapeHtml(item.name)}" aria-pressed="${checked}">
            <img src="${item.url}" alt="" loading="lazy">
            <span class="pic-picker-check">${checked ? icon('check', 13) : ''}</span>
            <span class="pic-picker-name">${escapeHtml(item.name)}</span>
          </button>`;
        }).join('') || '<p class="empty" style="grid-column:1/-1">素材库为空，先上传一张图片吧。</p>';
      };

      grid.addEventListener('click', (event) => {
        const card = event.target.closest('[data-file]');
        if (!card) return;
        const item = state.uploads.find((upload) => upload.file === card.dataset.file);
        if (!item) return;
        if (selected.has(item.file)) selected.delete(item.file);
        else selected.set(item.file, item);
        paint();
      });

      $('#picPickerUpload', root).addEventListener('change', async (event) => {
        const input = event.target;
        const uploaded = await uploadFiles(input.files, { silent: true });
        input.value = '';
        uploaded.forEach((item) => selected.set(item.file, item));
        paint();
      });

      $('[data-open-wechat-pic]', root).addEventListener('click', () => {
        close();
        openWeChatGallery({
          onPick(items) {
            onPickMany(items.map((item) => toPicImage({ ...item, source: 'wechat' })));
          },
        });
      });

      addButton.addEventListener('click', () => {
        if (!selected.size) return;
        onPickMany([...selected.values()].map(toPicImage));
        close();
      });

      paint();
    },
  });
}

function openWeChatPicGallery() {
  if (!isPic()) return;
  openWeChatGallery({
    onPick(items) {
      addPicImages(items.map((item) => toPicImage({ ...item, source: 'wechat' })));
    },
  });
}

function openWeChatGallery({ onPick } = {}) {
  const pageSize = 20;
  const forPic = typeof onPick === 'function';
  openModal({
    title: '公众号图库',
    subtitle: forPic
      ? '读取公众号后台的永久图片素材。支持跨页多选，选中的图片会作为贴图发布，不会修改或删除线上素材。'
      : '读取公众号后台的永久图片素材。支持跨页多选，只插入正文，不会修改或删除线上素材。',
    body: `<div class="gallery-toolbar">
        <span id="wxGalleryStatus">准备读取图库</span>
        <button class="btn btn-sm" id="wxGalleryRefresh" type="button">${icon('refresh', 13)}刷新</button>
      </div>
      <div class="media-grid wx-gallery-grid" id="wxGalleryGrid"></div>
      <div class="gallery-pagination">
        <button class="btn btn-sm" id="wxGalleryPrev" type="button">${icon('arrow-left', 13)}上一页</button>
        <span id="wxGalleryPage"></span>
        <button class="btn btn-sm" id="wxGalleryNext" type="button">下一页${icon('chevron-right', 13)}</button>
      </div>`,
    width: 760,
    footer: `<span class="left" id="wxGallerySelected">未选择图片</span>
      <button class="btn" data-footer-close type="button">取消</button>
      <button class="btn btn-accent" id="wxGalleryInsert" type="button" disabled>${icon('plus', 14)}${forPic ? '添加到贴图' : '插入正文'}</button>`,
    onMount(root, close) {
      const grid = $('#wxGalleryGrid', root);
      const status = $('#wxGalleryStatus', root);
      const page = $('#wxGalleryPage', root);
      const selectedText = $('#wxGallerySelected', root);
      const insertButton = $('#wxGalleryInsert', root);
      const prevButton = $('#wxGalleryPrev', root);
      const nextButton = $('#wxGalleryNext', root);
      const refreshButton = $('#wxGalleryRefresh', root);
      const selected = new Map();
      let items = [];
      let offset = 0;
      let total = 0;
      let hasMore = false;
      let loading = false;
      let error = '';
      let requestId = 0;

      const paint = () => {
        selectedText.textContent = selected.size ? `已选择 ${selected.size} 张图片` : '未选择图片';
        insertButton.disabled = selected.size === 0;
        prevButton.disabled = loading || offset === 0;
        nextButton.disabled = loading || !hasMore;
        refreshButton.disabled = loading;
        const currentPage = Math.floor(offset / pageSize) + 1;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        page.textContent = total ? `第 ${currentPage} / ${totalPages} 页` : '';

        if (loading) {
          status.textContent = '正在读取公众号图库…';
          grid.innerHTML = '<div class="gallery-loading"><div class="spinner"></div><span>正在读取图片素材，请稍候</span></div>';
          return;
        }
        if (error) {
          status.textContent = '图库读取失败';
          grid.innerHTML = `<div class="gallery-state">
            <strong>暂时无法读取图库</strong>
            <p>${escapeHtml(error)}</p>
            <div class="button-row">
              <button class="btn btn-sm btn-dark" data-gallery-retry type="button">重新加载</button>
              <button class="btn btn-sm" data-gallery-settings type="button">检查接口配置</button>
            </div>
          </div>`;
          return;
        }
        status.textContent = total ? `本页 ${items.length} 张 · 共 ${total} 张` : '公众号图库为空';
        grid.innerHTML = items.map((item) => {
          const checked = selected.has(item.mediaId);
          return `<button class="asset wx-gallery-item ${checked ? 'selected' : ''}" data-media-id="${escapeHtml(item.mediaId)}" type="button" aria-pressed="${checked}" title="${escapeHtml(item.name)}">
            <img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.name)}" loading="lazy" referrerpolicy="no-referrer">
            <span class="wx-gallery-check">${checked ? icon('check', 13) : ''}</span>
            <span class="wx-gallery-name">${escapeHtml(item.name)}</span>
          </button>`;
        }).join('') || '<p class="empty" style="grid-column:1/-1">公众号还没有永久图片素材，请先在公众平台的素材管理中上传。</p>';
      };

      const load = async () => {
        const id = ++requestId;
        loading = true;
        error = '';
        paint();
        try {
          const data = await api.wechatMaterials({ offset, count: pageSize });
          if (id !== requestId) return;
          items = data.items || [];
          total = Number(data.total) || 0;
          hasMore = Boolean(data.hasMore);
        } catch (err) {
          if (id !== requestId) return;
          items = [];
          total = 0;
          hasMore = false;
          error = err.message;
        } finally {
          if (id === requestId) {
            loading = false;
            paint();
          }
        }
      };

      grid.addEventListener('click', (event) => {
        if (event.target.closest('[data-gallery-retry]')) {
          load();
          return;
        }
        if (event.target.closest('[data-gallery-settings]')) {
          close();
          openSettings();
          return;
        }
        const card = event.target.closest('[data-media-id]');
        if (!card) return;
        const item = items.find((entry) => entry.mediaId === card.dataset.mediaId);
        if (!item) return;
        if (selected.has(item.mediaId)) selected.delete(item.mediaId);
        else selected.set(item.mediaId, item);
        paint();
      });
      prevButton.addEventListener('click', () => {
        offset = Math.max(0, offset - pageSize);
        load();
      });
      nextButton.addEventListener('click', () => {
        if (!hasMore) return;
        offset += pageSize;
        load();
      });
      refreshButton.addEventListener('click', load);
      insertButton.addEventListener('click', () => {
        if (!selected.size) return;
        if (forPic) onPick([...selected.values()]);
        else insertImages([...selected.values()]);
        close();
      });
      load();
    },
  });
}

/* -------------------------------- settings -------------------------------- */

function accountRowsHtml() {
  const accounts = state.settings.accounts || [];
  const activeId = state.settings.activeAccountId;
  return accounts.map((acc) => {
    const isActive = acc.id === activeId;
    const sub = acc.appId
      ? `${escapeHtml(acc.appId)}${acc.hasSecret ? ' · 密钥已保存' : ' · 未填密钥'}`
      : '未配置接口，仅本机写作与复制文字';
    return `<div class="account-row ${isActive ? 'active' : ''}">
      <span class="account-row-avatar">${escapeHtml((acc.accountName || '号').slice(0, 1))}</span>
      <div class="account-row-info">
        <strong>${escapeHtml(acc.accountName || '我的公众号')}${isActive ? '<span class="account-row-badge">当前</span>' : ''}</strong>
        <span>${sub}</span>
      </div>
      <div class="account-row-actions">
        ${isActive ? '' : `<button class="btn btn-sm" data-acc-switch="${escapeHtml(acc.id)}" type="button">切换</button>`}
        <button class="btn btn-sm" data-acc-edit="${escapeHtml(acc.id)}" type="button">编辑</button>
        <button class="btn btn-sm" data-acc-delete="${escapeHtml(acc.id)}" type="button">删除</button>
      </div>
    </div>`;
  }).join('');
}

function settingsBodyHtml() {
  return `<div class="form-section">
      <div class="form-section-head">
        <h4>公众号账号</h4>
        <span class="hint" style="font-size:10.5px;color:var(--muted)">文章跟随账号保存，切换账号后只显示该账号的文章</span>
      </div>
      <div class="account-rows" id="accountRows">${accountRowsHtml()}</div>
      <button class="btn btn-sm" id="btnAddAccount" type="button">${icon('plus', 14)}添加账号</button>
    </div>
    <p class="config-note">每个账号独立保存名称、默认作者、AppID 与 AppSecret；密钥只保存在本机 data/settings.json（权限 600），界面不会回显。草稿箱接口通常需要已认证的公众号，并把本机公网 IP 加入「IP 白名单」。</p>
    <p class="config-note">AI 美化 / 续写使用独立的 OpenAI 兼容接口，所有账号共用，在文章页点「AI 美化」即可配置模型，不需要公众号凭证。</p>`;
}

function configFieldsHtml() {
  const settings = state.settings;
  return `<div class="config-grid">
      <div class="field">
        <label>AppID</label>
        <input name="appId" value="${escapeHtml(settings.appId)}" placeholder="wx..." autocomplete="off" />
      </div>
      <div class="field">
        <label>AppSecret</label>
        <input name="appSecret" type="password" placeholder="${settings.hasSecret ? '已保存，留空不修改' : '填写 AppSecret'}" autocomplete="new-password" />
      </div>
    </div>
    <div class="config-actions">
      <button class="btn btn-sm" data-test-wx type="button">${icon('refresh', 14)}测试连接</button>
      <span class="config-result" data-test-result></span>
    </div>
    <p class="config-note">需要已认证公众号；本机公网 IP 需加入公众号后台的 IP 白名单。账号名可在右上角设置中修改。</p>`;
}

async function saveSettingsFromRoot(root, { withAccount = false } = {}) {
  const field = (name) => root.querySelector(`[name="${name}"]`);
  const appId = (field('appId')?.value || '').trim();
  const appSecret = (field('appSecret')?.value || '').trim();
  const payload = {};

  if (appId || appSecret) {
    if (!appId) throw new Error('请填写 AppID');
    if (state.settings.hasSecret && appId !== state.settings.appId && !appSecret) {
      throw new Error('更换 AppID 时，需要同时填写新的 AppSecret');
    }
    if (!state.settings.hasSecret && !appSecret) throw new Error('请填写 AppSecret');
    payload.appId = appId;
    if (appSecret) payload.appSecret = appSecret;
  }

  if (withAccount) {
    payload.accountName = (field('accountName')?.value || '').trim() || state.settings.accountName;
    payload.author = (field('author')?.value || '').trim();
  }

  const res = await api.saveSettings(payload);
  state.settings = res.settings;
  updateAccountUI();
  return res.settings;
}

function bindTestButton(root) {
  const button = root.querySelector('[data-test-wx]');
  if (!button) return;
  button.addEventListener('click', async () => {
    const result = root.querySelector('[data-test-result]');
    result.textContent = '正在连接微信…';
    result.className = 'config-result';
    button.disabled = true;
    try {
      if (!root.querySelector('[name="appId"]')?.value.trim()) throw new Error('请先填写 AppID');
      await saveSettingsFromRoot(root, { withAccount: Boolean(root.querySelector('[name="accountName"]')) });
      const res = await api.testWeChat();
      result.textContent = '连接成功，凭证有效';
      result.className = 'config-result ok';
      toast('微信接口连接成功', 'success');
    } catch (err) {
      result.textContent = err.message;
      result.className = 'config-result bad';
    } finally {
      button.disabled = false;
    }
  });
}

function openSettings() {
  openModal({
    title: '账号与接口',
    subtitle: '管理多个公众号账号，文章跟随账号保存。所有信息只保存在这台电脑上。',
    body: settingsBodyHtml(),
    width: 700,
    footer: `<button class="btn" data-footer-close type="button">关闭</button>`,
    onMount(root) {
      const rows = $('#accountRows', root);
      const refresh = () => {
        rows.innerHTML = accountRowsHtml();
      };
      rows.addEventListener('click', async (event) => {
        const switchBtn = event.target.closest('[data-acc-switch]');
        if (switchBtn) {
          await switchAccount(switchBtn.dataset.accSwitch);
          refresh();
          return;
        }
        const editBtn = event.target.closest('[data-acc-edit]');
        if (editBtn) {
          const acc = (state.settings.accounts || []).find((item) => item.id === editBtn.dataset.accEdit);
          if (acc) openAccountEditor(acc, refresh);
          return;
        }
        const deleteBtn = event.target.closest('[data-acc-delete]');
        if (deleteBtn) {
          await deleteAccountFlow(deleteBtn.dataset.accDelete, refresh);
        }
      });
      $('#btnAddAccount', root).addEventListener('click', () => openAccountEditor(null, refresh));
    },
  });
}

async function deleteAccountFlow(id, refresh) {
  const acc = (state.settings.accounts || []).find((item) => item.id === id);
  if (!acc) return;
  if ((state.settings.accounts || []).length <= 1) {
    toast('至少需要保留一个公众号账号', 'error');
    return;
  }
  const boundCount = state.articles.filter((article) => article.accountId === id).length;
  const ok = await confirmDialog({
    title: '删除这个公众号账号？',
    message: boundCount
      ? `「${acc.accountName || '我的公众号'}」下的 ${boundCount} 篇文章会一并从本机删除，操作不可撤销。公众号线上内容不受影响。`
      : `「${acc.accountName || '我的公众号'}」的账号配置会从本机删除，操作不可撤销。公众号线上内容不受影响。`,
    confirmText: '删除',
    danger: true,
  });
  if (!ok) return;
  try {
    const wasActive = state.settings.activeAccountId === id;
    const res = await api.deleteAccount(id, boundCount > 0);
    state.articles = state.articles.filter((article) => article.accountId !== id);
    state.settings = res.settings;
    if (wasActive) {
      resetAccountScopedState();
      await ensureCurrentForAccount();
    }
    updateAccountUI();
    renderArticleList();
    refresh?.();
    toast('账号已删除', 'success');
  } catch (err) {
    toast(err.message, 'error', 4500);
  }
}

function openAccountEditor(account, onSaved) {
  const isNew = !account;
  const acc = account || { id: '', accountName: '', author: '', appId: '', hasSecret: false };
  const body = `<div class="form-grid">
      <div class="field">
        <label>公众号名称</label>
        <input name="accountName" value="${escapeHtml(acc.accountName)}" maxlength="40" placeholder="我的公众号" />
        <span class="hint">显示在预览顶部和封面工坊中</span>
      </div>
      <div class="field">
        <label>默认作者</label>
        <input name="author" value="${escapeHtml(acc.author)}" maxlength="40" placeholder="作者名" />
        <span class="hint">微信作者栏建议不超过 8 个字符</span>
      </div>
      <div class="field">
        <label>AppID</label>
        <input name="appId" value="${escapeHtml(acc.appId)}" placeholder="wx...（可不填，仅本机写作）" autocomplete="off" />
      </div>
      <div class="field">
        <label>AppSecret</label>
        <input name="appSecret" type="password" placeholder="${acc.hasSecret ? '已保存，留空不修改' : '填写 AppSecret'}" autocomplete="new-password" />
        <span class="hint">${acc.hasSecret ? '密钥已保存在本机，界面不会回显。' : '在公众号后台「设置与开发 → 基本配置」获取。'}</span>
      </div>
    </div>
    <div class="config-actions">
      <button class="btn btn-sm" data-test-wx type="button">${icon('refresh', 14)}保存并测试连接</button>
      <span class="config-result" data-test-result></span>
      ${!isNew && acc.hasSecret ? '<button class="link-btn danger" id="accClearSecret" style="margin-left:auto">清除密钥</button>' : ''}
    </div>
    <p class="config-note">${isNew ? '新账号保存后会自动切换为当前账号。' : ''}不填 AppID / AppSecret 也可以保存，用来纯本机写作；配置接口后才能传图、读图库和写草稿箱。</p>`;

  openModal({
    title: isNew ? '添加公众号账号' : `编辑账号 · ${escapeHtml(acc.accountName || '我的公众号')}`,
    subtitle: '凭证只保存在本机，不会回传到浏览器。',
    body,
    width: 640,
    footer: `<button class="btn" data-footer-close type="button">取消</button>
      <button class="btn btn-accent" id="accountSave" type="button">${isNew ? '添加账号' : '保存账号'}</button>`,
    onMount(root, close) {
      // 新账号首次保存成功后记录已创建的账号 ID：之后的保存一律走更新，
      // 避免关闭动画期间重复点击「添加账号」再次 POST 出第二个账号
      let createdId = null;
      let saving = false;
      let closed = false;
      let savedSecret = acc.hasSecret;
      let savedAppId = acc.appId;
      let savedName = acc.accountName;

      const collect = () => {
        const field = (name) => root.querySelector(`[name="${name}"]`);
        const accountName = (field('accountName').value || '').trim();
        const author = (field('author').value || '').trim();
        const appId = (field('appId').value || '').trim();
        const appSecret = (field('appSecret').value || '').trim();
        if (appId || appSecret) {
          if (!appId) throw new Error('请填写 AppID');
          if (!appSecret) {
            if (savedSecret && appId === savedAppId) {
              // 沿用已保存的密钥，不需要重填
            } else if (savedSecret) {
              throw new Error('更换 AppID 时，需要同时填写新的 AppSecret');
            } else {
              throw new Error('请填写 AppSecret');
            }
          }
        }
        const payload = {
          accountName: accountName || (isNew && !createdId ? '新公众号' : savedName || '我的公众号'),
          author,
          appId,
        };
        if (appSecret) payload.appSecret = appSecret;
        return payload;
      };

      const save = async () => {
        const payload = collect();
        if (isNew && !createdId) {
          await saveNow();
          const res = await api.createAccount(payload);
          createdId = res.account.id;
          state.settings = res.settings;
          resetAccountScopedState();
          updateAccountUI();
          await ensureCurrentForAccount();
        } else {
          const res = await api.saveAccount(createdId || acc.id, payload);
          state.settings = res.settings;
          updateAccountUI();
          renderPreview();
        }
        savedAppId = payload.appId;
        savedName = payload.accountName;
        if (payload.appSecret) savedSecret = true;
        onSaved?.();
        return payload;
      };

      $('#accountSave', root).addEventListener('click', async () => {
        if (saving || closed) return;
        saving = true;
        const button = $('#accountSave', root);
        button.disabled = true;
        const firstCreate = isNew && !createdId;
        try {
          await save();
          toast(firstCreate ? '已添加并切换到新账号' : '账号已保存', 'success');
          closed = true;
          close();
        } catch (err) {
          toast(err.message, 'error', 4500);
        } finally {
          saving = false;
          if (!closed) button.disabled = false;
        }
      });

      const testBtn = root.querySelector('[data-test-wx]');
      testBtn.addEventListener('click', async () => {
        if (saving || closed) return;
        saving = true;
        const result = root.querySelector('[data-test-result]');
        result.textContent = '正在保存并连接微信…';
        result.className = 'config-result';
        testBtn.disabled = true;
        const saveBtn = $('#accountSave', root);
        saveBtn.disabled = true;
        const firstCreate = isNew && !createdId;
        try {
          const appId = root.querySelector('[name="appId"]').value.trim();
          const secret = root.querySelector('[name="appSecret"]').value.trim();
          if (!appId || (!secret && !(savedSecret && appId === savedAppId))) {
            throw new Error('请先填写 AppID 和 AppSecret 再测试连接');
          }
          await save();
          await api.testWeChat();
          result.textContent = '连接成功，凭证有效';
          result.className = 'config-result ok';
          if (firstCreate) {
            // 新账号已创建成功，直接关闭编辑器，避免停留在「添加」态再次新建
            toast('已添加并切换到新账号，微信接口连接成功', 'success');
            closed = true;
            close();
          } else {
            toast('微信接口连接成功', 'success');
          }
        } catch (err) {
          result.textContent = err.message;
          result.className = 'config-result bad';
        } finally {
          saving = false;
          if (!closed) {
            testBtn.disabled = false;
            saveBtn.disabled = false;
          }
        }
      });

      const clear = $('#accClearSecret', root);
      if (clear) {
        clear.addEventListener('click', async () => {
          if (saving || closed) return;
          const ok = await confirmDialog({
            title: '清除这个账号的密钥？',
            message: '清除后需要重新填写 AppSecret 才能使用复制带图与草稿发布功能。',
            confirmText: '清除',
            danger: true,
          });
          if (!ok) return;
          try {
            const res = await api.saveAccount(acc.id, { clearSecret: true });
            state.settings = res.settings;
            updateAccountUI();
            onSaved?.();
            toast('密钥已清除', 'success');
            closed = true;
            close();
          } catch (err) {
            toast(err.message, 'error');
          }
        });
      }
    },
  });
}

/* --------------------------------- publish -------------------------------- */

function publishTargetHtml() {
  const name = state.settings.accountName || '我的公众号';
  return `<div class="publish-target-account">${icon('user', 13)}<span>目标账号</span><strong>${escapeHtml(name)}</strong><span class="hint">如需换号，请先在顶栏切换账号</span></div>`;
}

function localBodyCoverImage(src) {
  if (!src) return null;
  let pathname = src;
  try {
    if (/^https?:\/\//i.test(src)) {
      const url = new URL(src);
      if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return null;
      pathname = url.pathname;
    } else {
      pathname = src.split(/[?#]/)[0];
    }
  } catch {
    return null;
  }

  const match = pathname.match(/^\/uploads\/([^/]+)$/);
  if (!match) return null;
  let file;
  try {
    file = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  if (!file || file.includes('..') || file.includes('\\') || !/\.(?:jpe?g|png)$/i.test(file)) return null;

  const upload = state.uploads.find((item) => item.file === file);
  if (upload) return { ...upload, source: 'local' };
  return {
    file,
    url: `/uploads/${encodeURIComponent(file)}`,
    name: file,
    size: 0,
    source: 'local',
  };
}

function isWeChatImageUrl(src) {
  try {
    const url = new URL(String(src || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    return host === 'qpic.cn' || host.endsWith('.qpic.cn') || host.endsWith('.wx.qq.com');
  } catch {
    return false;
  }
}

function wechatBodyCoverImage(src) {
  if (!isWeChatImageUrl(src)) return null;
  return { url: src, name: '公众号图库图片', size: 0, source: 'wechat' };
}

function bodyCoverImages() {
  const seen = new Set();
  return currentRender().imageSrcs.flatMap((src) => {
    const image = localBodyCoverImage(src) || wechatBodyCoverImage(src);
    if (!image || seen.has(image.url)) return [];
    seen.add(image.url);
    return [image];
  });
}

function openBodyCoverPicker(onPick) {
  const images = bodyCoverImages();
  openModal({
    title: '从正文选择封面',
    subtitle: '列出正文中来自本机素材库和公众号图库的 JPG / PNG 图片。选中后会按 2.35 : 1 裁剪作为公众号首图。',
    body: images.length
      ? `<div class="media-grid body-cover-grid" id="bodyCoverGrid">${images.map((image, index) => `
          <button class="asset body-cover-option" data-body-cover="${index}" type="button" title="${escapeHtml(image.name)}">
            <img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.name)}" loading="lazy" referrerpolicy="no-referrer">
            <span class="body-cover-order">正文第 ${index + 1} 张 · ${image.source === 'wechat' ? '公众号图库' : '本机素材'}</span>
            <span class="body-cover-name">${escapeHtml(image.name)}</span>
          </button>`).join('')}</div>`
      : `<div class="body-cover-empty">
          <span class="body-cover-empty-icon">${icon('image', 22)}</span>
          <strong>正文里还没有可用作封面的图片</strong>
          <p>先在编辑器中插入本机素材或公众号图库图片，再回来选择。其他网站的外链图片不会直接作为封面。</p>
        </div>`,
    width: 760,
    onMount(root, close) {
      $('.body-cover-grid', root)?.addEventListener('click', (event) => {
        const card = event.target.closest('[data-body-cover]');
        if (!card) return;
        const image = images[Number(card.dataset.bodyCover)];
        if (!image) return;
        onPick(image);
        close();
      });
    },
  });
}

const COVER_RATIO = 1080 / 460;
const COVER_OUTPUT_WIDTH = 1080;
const COVER_OUTPUT_HEIGHT = 460;

/** 裁剪时统一走同源地址：公众号图片走服务端代理，本机图片去掉 http://127.0.0.1 前缀。 */
function coverCropSrc(url) {
  if (isWeChatImageUrl(url)) return `/api/wechat/image?url=${encodeURIComponent(url)}`;
  try {
    const parsed = new URL(url, window.location.href);
    if (['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
      return `${parsed.pathname}${parsed.search}`;
    }
  } catch {
    /* 保持原地址 */
  }
  return url;
}

function coverNeedsCrop(width, height) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (!w || !h) return true;
  return Math.abs(w / h - COVER_RATIO) > 0.04;
}

function openCoverCropper({ url, name = '封面', onDone }) {
  if (!url) return;
  let resizeObserver = null;
  let resizeFallback = null;
  openModal({
    title: '裁剪封面',
    subtitle: '拖动图片选择保留区域，滚轮或滑块缩放。输出 1080 × 460，与公众号首图 2.35 : 1 一致。',
    width: 720,
    body: `<div class="crop-card">
        <div class="crop-stage" id="coverCropStage">
          <img id="coverCropImage" alt="${escapeHtml(name)}" draggable="false" />
          <div class="crop-grid" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
          <span class="crop-ratio">2.35 : 1</span>
          <span class="crop-loading" id="coverCropLoading">正在读取图片…</span>
        </div>
        <div class="crop-toolbar">
          <button class="crop-zoom-btn" id="coverCropZoomOut" type="button" title="缩小" aria-label="缩小">−</button>
          <input class="crop-zoom-range" id="coverCropZoom" type="range" min="1" max="4" step="0.01" value="1" aria-label="缩放" />
          <button class="crop-zoom-btn" id="coverCropZoomIn" type="button" title="放大" aria-label="放大">+</button>
          <button class="link-btn" id="coverCropReset" type="button">重置</button>
          <span class="crop-scale" id="coverCropScale">100%</span>
        </div>
        <p class="crop-tip">小提示：主体偏离中心时先拖到画面中间，再放大；公众号分享卡片的 1 : 1 缩略图会从裁剪结果中间截取。</p>
      </div>`,
    footer: `<button class="btn" data-footer-close type="button">取消</button>
      <button class="btn btn-accent" id="coverCropSave" type="button" disabled>${icon('check', 14)}使用这张封面</button>`,
    onMount(root, close) {
      const stage = $('#coverCropStage', root);
      const img = $('#coverCropImage', root);
      const slider = $('#coverCropZoom', root);
      const scaleLabel = $('#coverCropScale', root);
      const loading = $('#coverCropLoading', root);
      const saveButton = $('#coverCropSave', root);

      let naturalW = 0;
      let naturalH = 0;
      let stageW = 0;
      let stageH = 0;
      let baseScale = 1;
      let scale = 1;
      let zoom = 1;
      let offsetX = 0;
      let offsetY = 0;
      let drag = null;
      let loaded = false;

      const render = () => {
        if (!naturalW) return;
        const width = naturalW * scale;
        const height = naturalH * scale;
        const maxX = Math.max(0, (width - stageW) / 2);
        const maxY = Math.max(0, (height - stageH) / 2);
        offsetX = Math.min(maxX, Math.max(-maxX, offsetX));
        offsetY = Math.min(maxY, Math.max(-maxY, offsetY));
        img.style.width = `${width}px`;
        img.style.height = `${height}px`;
        img.style.transform = `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px))`;
      };

      const syncZoomUi = () => {
        slider.value = String(zoom);
        scaleLabel.textContent = `${Math.round(zoom * 100)}%`;
      };

      const setZoom = (next, anchor = null) => {
        if (!naturalW) return;
        const clamped = Math.min(4, Math.max(1, next));
        if (Math.abs(clamped - zoom) < 0.0005) return;
        const nextScale = baseScale * clamped;
        if (anchor) {
          const ix = (anchor.x - stageW / 2 - offsetX) / scale;
          const iy = (anchor.y - stageH / 2 - offsetY) / scale;
          offsetX = anchor.x - stageW / 2 - ix * nextScale;
          offsetY = anchor.y - stageH / 2 - iy * nextScale;
        }
        zoom = clamped;
        scale = nextScale;
        render();
        syncZoomUi();
      };

      const reset = () => {
        if (!naturalW) return;
        zoom = 1;
        scale = baseScale;
        offsetX = 0;
        offsetY = 0;
        render();
        syncZoomUi();
      };

      const handleLoad = () => {
        if (loaded) return;
        if (!img.naturalWidth || !img.naturalHeight) return;
        naturalW = img.naturalWidth;
        naturalH = img.naturalHeight;
        stageW = stage.clientWidth;
        stageH = stage.clientHeight;
        if (!stageW || !stageH) {
          requestAnimationFrame(handleLoad);
          return;
        }
        loaded = true;
        baseScale = Math.max(stageW / naturalW, stageH / naturalH);
        reset();
        img.classList.add('ready');
        loading.hidden = true;
        saveButton.disabled = false;
      };

      const handleError = () => {
        if (loaded) return;
        loading.textContent = '图片读取失败，请换一张再试';
        loading.classList.add('bad');
      };

      img.addEventListener('load', handleLoad);
      img.addEventListener('error', handleError);
      img.src = coverCropSrc(url);
      if (img.complete) handleLoad();

      $('#coverCropZoomOut', root).addEventListener('click', () => setZoom(zoom / 1.15));
      $('#coverCropZoomIn', root).addEventListener('click', () => setZoom(zoom * 1.15));
      $('#coverCropReset', root).addEventListener('click', reset);
      slider.addEventListener('input', () => setZoom(Number(slider.value)));

      stage.addEventListener(
        'wheel',
        (event) => {
          if (!naturalW) return;
          event.preventDefault();
          const rect = stage.getBoundingClientRect();
          setZoom(zoom * (event.deltaY > 0 ? 0.92 : 1.08), {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          });
        },
        { passive: false }
      );

      stage.addEventListener('pointerdown', (event) => {
        if (!naturalW) return;
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY, ox: offsetX, oy: offsetY };
        stage.setPointerCapture(event.pointerId);
        stage.classList.add('dragging');
      });
      stage.addEventListener('pointermove', (event) => {
        if (!drag || drag.id !== event.pointerId) return;
        offsetX = drag.ox + (event.clientX - drag.x);
        offsetY = drag.oy + (event.clientY - drag.y);
        render();
      });
      const endDrag = (event) => {
        if (!drag || drag.id !== event.pointerId) return;
        drag = null;
        stage.classList.remove('dragging');
        if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
      };
      stage.addEventListener('pointerup', endDrag);
      stage.addEventListener('pointercancel', endDrag);

      const handleResize = () => {
        if (!naturalW) return;
        const nextW = stage.clientWidth;
        const nextH = stage.clientHeight;
        if (!nextW || !nextH || (nextW === stageW && nextH === stageH)) return;
        const prevW = stageW;
        const prevH = stageH;
        stageW = nextW;
        stageH = nextH;
        baseScale = Math.max(stageW / naturalW, stageH / naturalH);
        if (prevW && prevH) {
          offsetX *= stageW / prevW;
          offsetY *= stageH / prevH;
        }
        scale = baseScale * zoom;
        render();
      };
      if (typeof ResizeObserver === 'function') {
        resizeObserver = new ResizeObserver(handleResize);
        resizeObserver.observe(stage);
      } else {
        resizeFallback = handleResize;
        window.addEventListener('resize', resizeFallback);
      }

      saveButton.addEventListener('click', async () => {
        if (!loaded || saveButton.disabled) return;
        saveButton.disabled = true;
        const original = saveButton.innerHTML;
        saveButton.textContent = '正在保存…';
        try {
          const canvas = document.createElement('canvas');
          canvas.width = COVER_OUTPUT_WIDTH;
          canvas.height = COVER_OUTPUT_HEIGHT;
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';

          const left = stageW / 2 - (naturalW * scale) / 2 + offsetX;
          const top = stageH / 2 - (naturalH * scale) / 2 + offsetY;
          let sx = -left / scale;
          let sy = -top / scale;
          let sw = stageW / scale;
          let sh = stageH / scale;
          sx = Math.max(0, Math.min(naturalW - 0.5, sx));
          sy = Math.max(0, Math.min(naturalH - 0.5, sy));
          sw = Math.max(0.5, Math.min(naturalW - sx, sw));
          sh = Math.max(0.5, Math.min(naturalH - sy, sh));
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

          const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
          const baseName = String(name || '封面').replace(/\.[^.]+$/, '').trim().slice(0, 24) || '封面';
          const res = await api.upload({
            name: `${baseName}-裁剪.jpg`,
            dataUrl,
            width: COVER_OUTPUT_WIDTH,
            height: COVER_OUTPUT_HEIGHT,
          });
          state.uploads.unshift(res.file);
          toast('封面已裁剪并保存到本机素材', 'success');
          onDone?.(res.file.url, res.file);
          close();
        } catch (err) {
          saveButton.disabled = false;
          saveButton.innerHTML = original;
          toast(`裁剪失败：${err.message}`, 'error', 4500);
        }
      });
    },
    onClose() {
      resizeObserver?.disconnect();
      if (resizeFallback) window.removeEventListener('resize', resizeFallback);
    },
  });
}

function coverSlotHtml(url) {
  return `<div class="cover-slot">
    <div class="cover-slot-img">${url ? `<img src="${url}" alt="封面" referrerpolicy="no-referrer">` : '未设置'}</div>
    <div class="cover-slot-info">
      <span class="hint" style="font-size:10.5px;color:var(--muted);line-height:1.6">${url ? '发布时会作为永久素材上传到微信。' : '需要一张 2.35 : 1 的封面。'}</span>
      <div class="button-row" style="margin:0">
        <button class="btn btn-sm btn-dark" id="publishPickBodyCover" type="button">${icon('image', 13)}从正文选择</button>
        <button class="btn btn-sm" id="publishPickCover" type="button">${icon('upload', 13)}本机素材</button>
        ${url ? `<button class="btn btn-sm" id="publishCropCover" type="button">${icon('crop', 13)}裁剪</button>` : ''}
        <button class="btn btn-sm" id="publishCoverStudio" type="button">${icon('sparkles', 13)}封面工坊</button>
      </div>
    </div>
  </div>`;
}

function openPicPublish() {
  const article = state.current;
  if (!article) return;
  const images = article.images || [];
  const configured = state.settings.hasSecret && state.settings.appId;
  const author = article.author || state.settings.author || '';
  const copy = article.copy || '';
  const needOpenComment = article.needOpenComment !== false;

  const body = `<div id="publishError"></div>
    <div id="publishProgress" hidden></div>
    ${publishTargetHtml()}
    <div class="publish-type-strip">
      <span class="theme-pill">贴图 · 图片消息</span>
      <span>首图将作为封面，写入草稿箱后仍需到公众号后台手动发表。</span>
    </div>
    <div class="form-grid">
      <div class="field full">
        <label>标题</label>
        <input name="pubTitle" maxlength="32" value="${escapeHtml(article.title || '')}" placeholder="贴图标题" />
        <span class="hint">图片消息标题最多 32 字符 · 当前 <span id="pubTitleCount">${(article.title || '').length}</span></span>
      </div>
      <div class="field">
        <label>作者</label>
        <input name="pubAuthor" maxlength="8" value="${escapeHtml(author)}" placeholder="作者名" />
      </div>
      <div class="field">
        <label>图片</label>
        <div class="pub-pic-summary">
          ${images[0] ? `<img src="${escapeHtml(images[0].url)}" alt="" referrerpolicy="no-referrer">` : ''}
          <div>
            <strong>${images.length} 张图片</strong>
            <span>按当前顺序发布，首图为封面</span>
          </div>
        </div>
      </div>
    </div>
    <div class="form-section">
      <div class="form-section-head">
        <h4>贴图文案</h4>
        <span class="hint" style="font-size:10.5px;color:var(--muted)"><span id="pubCopyCount">${copy.length}</span> / 1000</span>
      </div>
      <textarea class="pub-pic-copy" name="pubCopy" maxlength="1000" spellcheck="false" placeholder="这段文字会显示在图片下方">${escapeHtml(copy)}</textarea>
    </div>
    <details class="config-box" ${configured ? '' : 'open'} id="publishConfig">
      <summary><span class="status-dot ${configured ? 'ok' : ''}"></span>微信接口配置 <span style="color:var(--muted);font-weight:400">${configured ? '已保存密钥' : '尚未配置'}</span></summary>
      ${configFieldsHtml()}
    </details>
    <label class="check-row"><input type="checkbox" name="pubComments" ${needOpenComment ? 'checked' : ''} /> 允许读者留言</label>`;

  openModal({
    title: '发布贴图到公众号草稿箱',
    subtitle: '贴图会按当前顺序写入草稿箱，图片自动上传为永久素材。',
    body,
    width: 760,
    footer: `<span class="left" style="font-size:10.5px;color:var(--muted)">写入后，请到公众号后台草稿箱确认再发表。</span>
      <button class="btn" data-footer-close type="button">取消</button>
      <button class="btn btn-accent" id="publishSubmit" type="button">${icon('send', 15)}写入草稿箱</button>`,
    onMount(root, close) {
      const titleInput = root.querySelector('[name="pubTitle"]');
      const copyInput = root.querySelector('[name="pubCopy"]');
      const titleCount = $('#pubTitleCount', root);
      const copyCount = $('#pubCopyCount', root);
      titleInput.addEventListener('input', () => {
        titleCount.textContent = titleInput.value.length;
      });
      copyInput.addEventListener('input', () => {
        copyCount.textContent = copyInput.value.length;
      });

      bindTestButton(root);

      const submit = $('#publishSubmit', root);
      submit.addEventListener('click', async () => {
        const errorBox = $('#publishError', root);
        const progress = $('#publishProgress', root);
        const showError = (message) => {
          errorBox.innerHTML = `<div class="banner error">${escapeHtml(message)}</div>`;
        };
        errorBox.innerHTML = '';

        const title = titleInput.value.trim();
        const authorValue = root.querySelector('[name="pubAuthor"]').value.trim();
        const copyValue = copyInput.value;
        const comments = root.querySelector('[name="pubComments"]').checked;

        if (!title) return showError('请填写贴图标题。');
        if (title.length > 32) return showError(`贴图标题最多 32 个字符，当前 ${title.length} 个。`);
        if (!images.length) return showError('贴图至少需要 1 张图片。');
        if (images.length > 20) return showError('贴图最多 20 张图片。');
        if (!copyValue.trim()) return showError('请填写贴图文案。');
        if (copyValue.length > 1000) return showError(`贴图文案最多 1000 个字符，当前 ${copyValue.length} 个。`);
        const appId = root.querySelector('[name="appId"]')?.value.trim();
        const secret = root.querySelector('[name="appSecret"]')?.value.trim();
        if (!appId) return showError('请填写公众号 AppID。');
        if (!state.settings.hasSecret && !secret) return showError('请填写 AppSecret。');

        submit.disabled = true;
        try {
          await saveSettingsFromRoot(root, { withAccount: false });
        } catch (err) {
          submit.disabled = false;
          return showError(err.message);
        }

        Object.assign(article, { title, author: authorValue, copy: copyValue, needOpenComment: comments });
        $('#titleInput').value = title;
        $('#authorInput').value = authorValue;
        $('#picCopy').value = copyValue;
        $('#picCopyCount').textContent = `${copyValue.length} / 1000`;
        $('#picCopyCount').classList.toggle('warn', copyValue.length >= 900);
        await saveNow();

        progress.hidden = false;
        progress.innerHTML = `<div class="progress-box"><div class="spinner"></div><strong>正在写入贴图草稿</strong><span>正在上传图片为永久素材并创建图片消息草稿。图片较多时可能需要十几秒，请不要关闭窗口。</span></div>`;

        try {
          const res = await api.publish({
            kind: 'pic',
            title,
            author: authorValue,
            copy: copyValue,
            images: article.images,
            needOpenComment: comments,
          });
          renderPreview();
          renderArticleList();
          showPublishSuccess(root, close, res);
        } catch (err) {
          progress.hidden = true;
          submit.disabled = false;
          showError(err.message);
        }
      });
    },
  });
}

function openPublish() {
  if (!state.current) return;
  if (isPic()) return openPicPublish();
  const article = state.current;
  const bodyImages = bodyCoverImages();
  const firstLocalImage = bodyImages.find((image) => image.source !== 'wechat')?.url || bodyImages[0]?.url || '';
  let cover = article.cover || firstLocalImage;
  const author = article.author || state.settings.author || '';
  const digest = article.digest || plainText(article.markdown).slice(0, 120);
  const configured = state.settings.hasSecret && state.settings.appId;

  const body = `<div id="publishError"></div>
    <div id="publishProgress" hidden></div>
    ${publishTargetHtml()}
    <div class="form-grid">
      <div class="field full">
        <label>标题</label>
        <input name="pubTitle" maxlength="64" value="${escapeHtml(article.title || '')}" placeholder="文章标题" />
        <span class="hint">公众号标题最多 64 字符 · 当前 <span id="pubTitleCount">${(article.title || '').length}</span></span>
      </div>
      <div class="field">
        <label>作者</label>
        <input name="pubAuthor" maxlength="8" value="${escapeHtml(author)}" placeholder="作者名" />
      </div>
      <div class="field">
        <label>摘要</label>
        <input name="pubDigest" maxlength="120" value="${escapeHtml(digest)}" placeholder="不填则自动截取正文" />
      </div>
      <div class="field full">
        <label>原文链接（选填）</label>
        <input name="pubSource" value="${escapeHtml(article.sourceUrl || '')}" placeholder="https://" />
      </div>
    </div>
    <div class="form-section">
      <div class="form-section-head">
        <h4>封面</h4>
        <span class="hint" style="font-size:10.5px;color:var(--muted)">2.35 : 1 · ${cover ? '已选择' : '未设置'}</span>
      </div>
      <div id="publishCoverBox">${coverSlotHtml(cover)}</div>
    </div>
    <details class="config-box" ${configured ? '' : 'open'} id="publishConfig">
      <summary><span class="status-dot ${configured ? 'ok' : ''}"></span>微信接口配置 <span style="color:var(--muted);font-weight:400">${configured ? '已保存密钥' : '尚未配置'}</span></summary>
      ${configFieldsHtml()}
    </details>
    <label class="check-row"><input type="checkbox" name="pubComments" checked /> 允许读者留言</label>`;

  openModal({
    title: '发布到公众号草稿箱',
    subtitle: '按当前排版写入草稿箱，正文图片与封面会自动上传到微信。',
    body,
    width: 760,
    footer: `<span class="left" style="font-size:10.5px;color:var(--muted)">写入后，请到公众号后台草稿箱确认再群发。</span>
      <button class="btn" data-footer-close type="button">取消</button>
      <button class="btn btn-accent" id="publishSubmit" type="button">${icon('send', 15)}保存并发布</button>`,
    onMount(root, close) {
      const box = $('#publishCoverBox', root);
      const paintCover = () => {
        box.innerHTML = coverSlotHtml(cover);
        const meta = root.querySelector('.form-section-head .hint');
        if (meta) meta.textContent = `2.35 : 1 · ${cover ? '已选择' : '未设置'}`;
      };
      paintCover();

      const pickCover = (image, message = '') => {
        const commit = (pickedUrl) => {
          cover = pickedUrl;
          paintCover();
          if (message) toast(message, 'success');
        };
        if (coverNeedsCrop(image.width, image.height)) {
          openCoverCropper({ url: image.url, name: image.name, onDone: commit });
        } else {
          commit(image.url);
        }
      };

      box.addEventListener('click', (event) => {
        if (event.target.closest('#publishPickBodyCover')) {
          openBodyCoverPicker((item) => {
            pickCover(item, `已选用正文图片「${item.name}」作为封面`);
          });
        }
        if (event.target.closest('#publishPickCover')) {
          openMediaPicker(
            (item) => pickCover(item),
            { title: '选择封面', subtitle: '从本机素材库选一张图片作为公众号首图，比例不是 2.35 : 1 时会先打开裁剪。', allowWeChat: false }
          );
        }
        if (event.target.closest('#publishCropCover')) {
          openCoverCropper({
            url: cover,
            name: '公众号封面',
            onDone: (pickedUrl) => {
              cover = pickedUrl;
              paintCover();
            },
          });
        }
        if (event.target.closest('#publishCoverStudio')) {
          openCoverStudio({
            onSaved: (url) => {
              cover = url;
              paintCover();
            },
          });
        }
      });

      const titleInput = root.querySelector('[name="pubTitle"]');
      const count = $('#pubTitleCount', root);
      titleInput.addEventListener('input', () => {
        count.textContent = titleInput.value.length;
      });

      bindTestButton(root);

      const submit = $('#publishSubmit', root);
      submit.addEventListener('click', async () => {
        const errorBox = $('#publishError', root);
        const progress = $('#publishProgress', root);
        const showError = (message) => {
          errorBox.innerHTML = `<div class="banner error">${escapeHtml(message)}</div>`;
        };
        errorBox.innerHTML = '';

        const title = titleInput.value.trim();
        const authorValue = root.querySelector('[name="pubAuthor"]').value.trim();
        const digestValue = root.querySelector('[name="pubDigest"]').value.trim();
        const sourceUrl = root.querySelector('[name="pubSource"]').value.trim();

        if (!title) return showError('请填写文章标题。');
        if (title.length > 64) return showError(`标题最多 64 个字符，当前 ${title.length} 个。`);
        if (!cover) return showError('请先选择或生成一张封面。');
        const appId = root.querySelector('[name="appId"]')?.value.trim();
        const secret = root.querySelector('[name="appSecret"]')?.value.trim();
        if (!appId) return showError('请填写公众号 AppID。');
        if (!state.settings.hasSecret && !secret) return showError('请填写 AppSecret。');

        submit.disabled = true;
        try {
          await saveSettingsFromRoot(root, { withAccount: false });
        } catch (err) {
          submit.disabled = false;
          return showError(err.message);
        }

        const finalDigest = digestValue || plainText(state.current.markdown).slice(0, 120);
        Object.assign(state.current, { title, author: authorValue, digest: finalDigest, sourceUrl, cover });
        $('#titleInput').value = title;
        $('#authorInput').value = authorValue;
        await saveNow();

        const content = currentRender().html;
        progress.hidden = false;
        progress.innerHTML = `<div class="progress-box"><div class="spinner"></div><strong>正在写入草稿箱</strong><span>正在上传正文图片与封面、创建微信草稿。图片较多时可能需要十几秒，请不要关闭窗口。</span></div>`;

        try {
          const res = await api.publish({
            title,
            author: authorValue,
            digest: finalDigest,
            sourceUrl,
            cover,
            content,
            needOpenComment: root.querySelector('[name="pubComments"]').checked,
          });
          renderPreview();
          renderArticleList();
          showPublishSuccess(root, close, res);
        } catch (err) {
          progress.hidden = true;
          submit.disabled = false;
          showError(err.message);
        }
      });
    },
  });
}

function showPublishSuccess(root, close, res) {
  const body = $('.modal-body', root);
  const head = $('.modal-head p', root);
  const pic = res.kind === 'pic';
  if (head) {
    head.textContent = pic
      ? '贴图草稿已创建，去公众号后台确认后再发表。'
      : '草稿已创建，去公众号后台确认排版后再群发。';
  }
  const summary = pic
    ? `共 ${res.imageCount || 0} 张图片，${res.uploadedImages || 0} 张新上传、${res.reusedImages || 0} 张复用永久素材；首图将作为封面出现在对话列表。`
    : `打开公众号后台「内容与互动 → 草稿箱」即可看到这篇文章。正文图片 ${res.uploadedImages || 0} 张已转存到微信服务器，封面已作为永久素材上传。`;
  body.innerHTML = `<div class="success-box">
      <div class="success-mark">${icon('check', 22)}</div>
      <h4>已写入公众号草稿箱</h4>
      <p>${summary}</p>
      ${res.warnings && res.warnings.length ? `<div class="banner warn" style="margin-top:14px;text-align:left">${res.warnings.map(escapeHtml).join('<br>')}</div>` : ''}
      <span class="media-id">media_id: ${escapeHtml(res.mediaId || '')}</span>
    </div>`;

  const foot = $('.modal-foot', root);
  foot.innerHTML = `<a class="btn" href="https://mp.weixin.qq.com/" target="_blank" rel="noreferrer">${icon('external', 14)}打开公众号后台</a>
    <button class="btn btn-dark" id="publishDone" type="button">完成</button>`;
  const done = $('#publishDone', root);
  done.addEventListener('click', close);
}

/* -------------------------------- cover studio ----------------------------- */

function openCoverStudio({ onSaved } = {}) {
  const article = state.current;
  if (!article) return;
  const opts = {
    styleId: inferCoverStyle(article.themeId),
    layout: 'left',
    title: article.title || '未命名文章',
    subtitle: article.digest || '',
    account: state.settings.accountName || '我的公众号',
  };

  const body = `<div class="studio">
    <div>
      <div class="studio-preview-wrap"><canvas id="coverCanvas"></canvas></div>
      <p class="studio-note">1080 × 460 · 公众号首图 2.35 : 1。标题过长时会自动缩小字号；建议控制在 12 字以内。</p>
    </div>
    <div class="studio-controls">
      <div class="field">
        <label>主标题</label>
        <input id="coverTitleInput" maxlength="40" value="${escapeHtml(opts.title)}" />
      </div>
      <div class="field">
        <label>副标题</label>
        <input id="coverSubtitleInput" maxlength="48" value="${escapeHtml(opts.subtitle)}" placeholder="可选，一句话说明" />
      </div>
      <div class="field">
        <label>账号名</label>
        <input id="coverAccountInput" maxlength="24" value="${escapeHtml(opts.account)}" />
      </div>
      <div class="field">
        <label>色彩风格</label>
        <div class="style-swatches" id="coverStyles"></div>
      </div>
      <div class="field">
        <label>版式</label>
        <div class="segmented wide" id="coverLayouts">
          <button data-layout="left" class="active" type="button">左对齐</button>
          <button data-layout="center" type="button">居中</button>
        </div>
      </div>
      <div class="studio-actions">
        <button class="btn" id="coverDownload" type="button">${icon('download', 14)}下载</button>
        <button class="btn btn-accent" id="coverSave" type="button">${icon('check', 14)}保存为封面</button>
      </div>
    </div>
  </div>`;

  openModal({
    title: '封面工坊',
    subtitle: '用文章标题快速生成一张干净的首图。保存后会自动设为当前文章封面。',
    body,
    wide: true,
    width: 1040,
    footer: `<button class="btn" data-footer-close type="button">关闭</button>`,
    onMount(root, close) {
      const canvas = $('#coverCanvas', root);
      const titleInput = $('#coverTitleInput', root);
      const subtitleInput = $('#coverSubtitleInput', root);
      const accountInput = $('#coverAccountInput', root);
      let styleId = opts.styleId;
      let layout = opts.layout;

      $('#coverStyles', root).innerHTML = COVER_STYLES.map(
        (style) =>
          `<button class="style-swatch ${style.id === styleId ? 'active' : ''}" data-style="${style.id}" style="background:linear-gradient(135deg,${style.from},${style.to});color:${style.ink}" title="${style.name}" type="button"><span>${style.name}</span></button>`
      ).join('');

      const options = () => ({
        styleId,
        layout,
        title: titleInput.value,
        subtitle: subtitleInput.value,
        account: accountInput.value,
      });

      const paint = () => drawCover(canvas, options());

      $('#coverStyles', root).addEventListener('click', (event) => {
        const button = event.target.closest('[data-style]');
        if (!button) return;
        styleId = button.dataset.style;
        $$('.style-swatch', root).forEach((item) => item.classList.toggle('active', item === button));
        paint();
      });

      $('#coverLayouts', root).addEventListener('click', (event) => {
        const button = event.target.closest('[data-layout]');
        if (!button) return;
        layout = button.dataset.layout;
        $$('#coverLayouts button', root).forEach((item) => item.classList.toggle('active', item === button));
        paint();
      });

      [titleInput, subtitleInput, accountInput].forEach((input) => input.addEventListener('input', paint));

      paint();

      $('#coverDownload', root).addEventListener('click', () => {
        paint();
        const link = document.createElement('a');
        const safeTitle = (titleInput.value || '封面').replace(/[\\/:*?"<>|]/g, '').slice(0, 24);
        link.download = `封面-${safeTitle}.jpg`;
        link.href = coverToDataUrl(canvas, 0.95);
        link.click();
      });

      $('#coverSave', root).addEventListener('click', async () => {
        const button = $('#coverSave', root);
        button.disabled = true;
        try {
          paint();
          const dataUrl = coverToDataUrl(canvas, 0.92);
          const res = await api.upload({
            name: `封面-${(titleInput.value || '未命名').slice(0, 20)}.jpg`,
            dataUrl,
            width: 1080,
            height: 460,
          });
          state.uploads.unshift(res.file);
          state.current.cover = res.file.url;
          state.editSeq += 1;
          renderAssets();
          renderCoverPanel();
          scheduleSaveSoon();
          onSaved?.(res.file.url);
          toast('封面已保存并设为文章封面', 'success');
          close();
        } catch (err) {
          toast(`保存失败：${err.message}`, 'error', 4500);
        } finally {
          button.disabled = false;
        }
      });
    },
  });
}

function scheduleSaveSoon() {
  setSave('dirty', '有未保存更改');
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveNow, 500);
}

/* --------------------------------- ai ------------------------------------- */

function aiContinueConfigured() {
  return Boolean(state.settings.aiBaseUrl && state.settings.aiModel);
}

function writingField() {
  return isPic() ? $('#picCopy') : $('#editor');
}

function readEditorSelection(field = writingField()) {
  if (!field) return null;
  const start = field.selectionStart;
  const end = field.selectionEnd;
  if (end <= start) return null;
  const text = field.value.slice(start, end);
  if (!text.trim()) return null;
  return { start, end, text };
}

function hideAiContinue() {
  const el = $('#aiContinueBubble');
  aiContinueBubble.requestId += 1;
  aiContinueBubble.visible = false;
  aiContinueBubble.loading = false;
  aiContinueBubble.result = '';
  aiContinueBubble.error = '';
  aiContinueBubble.model = '';
  aiContinueBubble.selection = null;
  aiContinueBubble.field = null;
  if (!el) return;
  el.hidden = true;
  el.innerHTML = '';
  el.className = 'ai-continue';
  el.style.left = '';
  el.style.top = '';
}

function placeAiContinue(x, y) {
  const el = $('#aiContinueBubble');
  if (!el || el.hidden) return;
  el.style.left = '0px';
  el.style.top = '0px';
  const rect = el.getBoundingClientRect();
  const margin = 12;
  let left = x - rect.width / 2;
  let top = y + 16;
  if (left + rect.width > window.innerWidth - margin) left = window.innerWidth - margin - rect.width;
  left = Math.max(margin, left);
  if (top + rect.height > window.innerHeight - margin) top = y - rect.height - 16;
  top = Math.max(margin, top);
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}

function showAiContinue(x, y, { selection: preset = null } = {}) {
  if (!aiContinueConfigured()) {
    hideAiContinue();
    return;
  }
  const field = writingField();
  const selection = preset || readEditorSelection(field);
  if (!field || !selection) {
    hideAiContinue();
    return;
  }
  const el = $('#aiContinueBubble');
  if (!el) return;
  const pic = isPic();
  aiContinueBubble.visible = true;
  aiContinueBubble.mode = pic ? 'pic' : 'article';
  aiContinueBubble.field = field;
  aiContinueBubble.selection = selection;
  aiContinueBubble.anchorX = x;
  aiContinueBubble.anchorY = y;
  aiContinueBubble.result = '';
  aiContinueBubble.error = '';
  aiContinueBubble.loading = false;
  aiContinueBubble.model = state.settings.aiModel;
  el.hidden = false;
  el.className = 'ai-continue is-pill';
  el.innerHTML = `<button class="ai-continue-launch" type="button" data-ai-continue-run>
      <span class="ai-continue-spark">${icon('sparkles', 14)}</span>
      <span class="ai-continue-launch-text"><strong>${pic ? 'AI 扩写' : 'AI 续写'}</strong><small>${pic ? '把选中的文案写得更充分' : '在选中句后补一段'}</small></span>
    </button>`;
  placeAiContinue(x, y);
}

function renderAiContinue() {
  const el = $('#aiContinueBubble');
  if (!el || !aiContinueBubble.visible) return;
  el.hidden = false;
  const pic = aiContinueBubble.mode === 'pic';

  const head = `<div class="ai-continue-head">
      <span class="ai-continue-title">${icon('sparkles', 13)}<strong>${pic ? 'AI 扩写' : 'AI 续写'}</strong></span>
      <span class="ai-continue-model">${escapeHtml(aiContinueBubble.model || '')}</span>
      <button class="icon-btn" data-ai-continue-close type="button" title="关闭">${icon('x', 13)}</button>
    </div>`;

  if (aiContinueBubble.loading) {
    el.className = 'ai-continue';
    el.innerHTML = `${head}<div class="ai-continue-loading"><span class="spinner"></span><span>${pic ? '正在扩写…' : '正在接着写…'}</span></div>`;
  } else if (aiContinueBubble.error) {
    el.className = 'ai-continue';
    el.innerHTML = `${head}
      <p class="ai-continue-error">${escapeHtml(aiContinueBubble.error)}</p>
      <div class="ai-continue-actions">
        <button class="btn btn-sm btn-dark" data-ai-continue-run type="button">重试</button>
        <button class="btn btn-sm" data-ai-continue-close type="button">取消</button>
      </div>`;
  } else if (aiContinueBubble.result) {
    el.className = 'ai-continue';
    el.innerHTML = `${head}
      <div class="ai-continue-text">${escapeHtml(aiContinueBubble.result).replace(/\n+/g, '<br><br>')}</div>
      <div class="ai-continue-actions">
        <button class="btn btn-sm btn-dark" data-ai-continue-insert type="button" title="${pic ? '把扩写内容插入到选中文字之后' : '在选中文字后面另起一段插入'}">${icon('check', 13)}插入</button>
        <button class="link-btn ai-continue-retry" data-ai-continue-run type="button">重试</button>
        <button class="link-btn" data-ai-continue-close type="button">取消</button>
      </div>`;
  }
  placeAiContinue(aiContinueBubble.anchorX, aiContinueBubble.anchorY);
}

async function runAiContinue() {
  const { selection, field } = aiContinueBubble;
  if (!selection || !field) return;
  const pic = aiContinueBubble.mode === 'pic';
  const context = field.value.slice(Math.max(0, selection.start - 2200), selection.end);
  const id = ++aiContinueBubble.requestId;
  aiContinueBubble.loading = true;
  aiContinueBubble.error = '';
  aiContinueBubble.result = '';
  renderAiContinue();

  try {
    const res = await api.aiContinue({
      title: state.current?.title || '',
      selection: selection.text,
      context,
      model: state.settings.aiModel,
      format: pic ? 'plain' : 'markdown',
    });
    if (id !== aiContinueBubble.requestId) return;
    aiContinueBubble.loading = false;
    aiContinueBubble.result = res.markdown || '';
    aiContinueBubble.model = res.model || state.settings.aiModel;
    if (!aiContinueBubble.result) aiContinueBubble.error = '模型没有返回内容，请重试';
    renderAiContinue();
  } catch (err) {
    if (id !== aiContinueBubble.requestId) return;
    aiContinueBubble.loading = false;
    aiContinueBubble.error = err.message;
    renderAiContinue();
  }
}

function insertAiContinue() {
  const { selection, result, field } = aiContinueBubble;
  if (!selection || !result || !field || !state.current) return;
  const pic = aiContinueBubble.mode === 'pic';
  if (field.value.slice(selection.start, selection.end) !== selection.text) {
    hideAiContinue();
    toast(pic ? '文案已变化，请重新选择后再扩写' : '正文已变化，请重新选择后再续写', 'error');
    return;
  }

  // 贴图文案是纯文本：扩写内容放到选中句所在段落的末尾，避免把原句从中间截断。
  let anchor = selection.end;
  if (pic && field.value[anchor] !== '\n') {
    const nextBreak = field.value.indexOf('\n', anchor);
    anchor = nextBreak === -1 ? field.value.length : nextBreak;
  }
  const before = field.value.slice(0, anchor);
  const after = field.value.slice(anchor);
  const lead = before ? (before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n') : '';
  const tail = after ? (after.startsWith('\n') ? '' : '\n\n') : '';
  let text = result.trim();
  let truncated = false;
  if (pic) {
    const available = 1000 - (before.length + after.length + lead.length + tail.length);
    if (available <= 0) {
      toast('文案已满 1000 字，请先删减一些再扩写', 'error');
      return;
    }
    if (text.length > available) {
      text = text.slice(0, available);
      truncated = true;
    }
  }
  const addition = `${lead}${text}${tail}`;
  field.value = `${before}${addition}${after}`;
  const caret = before.length + addition.length;
  field.focus({ preventScroll: true });
  field.setSelectionRange(caret, caret);
  field.dispatchEvent(new Event('input', { bubbles: true }));
  hideAiContinue();
  toast(
    pic ? (truncated ? '扩写已插入，文案达到 1000 字上限并截断' : '扩写已插入文案') : '续写已插入正文',
    'success'
  );
}

function openPicAiExpand() {
  if (!isPic() || !state.current) return;
  const field = $('#picCopy');
  if (!field) return;
  const copy = String(field.value || '');
  if (!copy.trim()) {
    toast('先写点文案，再让 AI 扩写', 'error');
    field.focus();
    return;
  }
  if (!aiContinueConfigured()) {
    openPicAiConfig();
    return;
  }

  let selection = readEditorSelection(field);
  if (!selection) {
    field.focus({ preventScroll: true });
    field.setSelectionRange(0, field.value.length);
    selection = { start: 0, end: field.value.length, text: field.value };
  }
  const rect = $('#btnAiBeautify').getBoundingClientRect();
  const head = $('.editor-head').getBoundingClientRect();
  showAiContinue(rect.left + rect.width / 2, head.bottom - 18, { selection });
}

function openPicAiConfig() {
  const presetId =
    AI_PRESETS.find((preset) => preset.baseUrl && preset.baseUrl === state.settings.aiBaseUrl)?.id || 'custom';
  openModal({
    title: '配置 AI 扩写',
    subtitle: '配置一次，文章的 AI 美化与贴图的 AI 扩写共用同一个模型。',
    width: 640,
    body: `<div id="picAiError"></div>
      <div class="form-grid">
        <div class="field">
          <label>服务商预设</label>
          <select id="picAiPreset">
            ${AI_PRESETS.map(
              (preset) => `<option value="${preset.id}" ${preset.id === presetId ? 'selected' : ''}>${preset.name}</option>`
            ).join('')}
          </select>
        </div>
        <div class="field">
          <label>模型名</label>
          <input id="picAiModel" list="picAiModelOptions" value="${escapeHtml(state.settings.aiModel || '')}" placeholder="deepseek-chat" autocomplete="off" />
          <datalist id="picAiModelOptions"></datalist>
        </div>
        <div class="field full">
          <label>接口地址（OpenAI 兼容）</label>
          <input id="picAiBaseUrl" value="${escapeHtml(state.settings.aiBaseUrl || '')}" placeholder="https://api.example.com/v1" autocomplete="off" />
        </div>
        <div class="field full">
          <label>API Key</label>
          <input id="picAiKey" type="password" placeholder="${state.settings.hasAiKey ? '已保存，留空不修改' : '本地 Ollama 可留空'}" autocomplete="new-password" />
        </div>
      </div>
      <div class="config-actions">
        <button class="btn btn-sm" id="picAiFetch" type="button">${icon('refresh', 13)}获取模型列表</button>
        <span class="config-result" id="picAiModels"></span>
      </div>
      <p class="config-note">支持 DeepSeek、OpenAI、通义千问、智谱、Moonshot、Ollama 等 OpenAI 兼容接口。Key 只保存在本机 data/settings.json（权限 600），不会回显。</p>`,
    footer: `<button class="btn" data-footer-close type="button">取消</button>
      <button class="btn btn-accent" id="picAiSave" type="button">${icon('sparkles', 14)}保存并扩写</button>`,
    onMount(root, close) {
      const errorBox = $('#picAiError', root);
      const baseInput = $('#picAiBaseUrl', root);
      const modelInput = $('#picAiModel', root);
      const keyInput = $('#picAiKey', root);

      const showError = (message) => {
        errorBox.innerHTML = `<div class="banner error">${escapeHtml(message)}</div>`;
      };

      $('#picAiPreset', root).addEventListener('change', (event) => {
        const preset = AI_PRESETS.find((item) => item.id === event.target.value);
        if (!preset || !preset.baseUrl) return;
        baseInput.value = preset.baseUrl;
        modelInput.value = preset.model;
      });

      $('#picAiFetch', root).addEventListener('click', async () => {
        const button = $('#picAiFetch', root);
        const output = $('#picAiModels', root);
        const baseUrl = baseInput.value.trim();
        if (!baseUrl) {
          output.textContent = '请先填写接口地址';
          output.className = 'config-result bad';
          baseInput.focus();
          return;
        }
        button.disabled = true;
        output.textContent = '正在获取模型列表…';
        output.className = 'config-result';
        try {
          const res = await api.aiModels({ baseUrl, apiKey: keyInput.value.trim() });
          const models = res.models || [];
          const filled = res.baseUrl && res.baseUrl !== baseUrl ? res.baseUrl : '';
          if (filled) baseInput.value = filled;
          $('#picAiModelOptions', root).innerHTML = models
            .map((name) => `<option value="${escapeHtml(name)}"></option>`)
            .join('');
          output.textContent = res.unsupported
            ? `该接口没有提供模型列表，请手动填写模型名${filled ? `（接口地址已自动补全为 ${filled}）` : ''}`
            : models.length
            ? `已获取 ${models.length} 个模型，可在模型输入框下拉选择${filled ? `（接口地址已自动补全为 ${filled}）` : ''}`
            : `接口没有返回模型列表，请手动填写模型名${filled ? `（接口地址已自动补全为 ${filled}）` : ''}`;
          output.className = `config-result ${models.length && !res.unsupported ? 'ok' : ''}`;
        } catch (err) {
          output.textContent = err.message;
          output.className = 'config-result bad';
        } finally {
          button.disabled = false;
        }
      });

      $('#picAiSave', root).addEventListener('click', async () => {
        const button = $('#picAiSave', root);
        const baseUrl = baseInput.value.trim();
        const model = modelInput.value.trim();
        const apiKey = keyInput.value.trim();
        if (!baseUrl || !model) {
          showError('请先填写接口地址和模型名。');
          (baseUrl ? modelInput : baseInput).focus();
          return;
        }
        button.disabled = true;
        try {
          const payload = { aiBaseUrl: baseUrl, aiModel: model };
          if (apiKey) payload.aiApiKey = apiKey;
          const res = await api.saveSettings(payload);
          state.settings = res.settings;
          close();
          toast('AI 配置已保存', 'success');
          openPicAiExpand();
        } catch (err) {
          showError(err.message);
        } finally {
          button.disabled = false;
        }
      });
    },
  });
}

function openAiBeautify() {
  if (!state.current) return;
  if (isPic()) {
    openPicAiExpand();
    return;
  }
  const article = state.current;
  if (!(article.markdown || '').trim()) {
    toast('先写点内容，再让 AI 美化', 'error');
    return;
  }

  const editor = $('#editor');
  const selectionStart = editor.selectionStart;
  const selectionEnd = editor.selectionEnd;
  const selectedText = selectionStart !== selectionEnd ? editor.value.slice(selectionStart, selectionEnd) : '';
  const selection = selectedText.trim() ? { start: selectionStart, end: selectionEnd, text: selectedText } : null;

  const fullChars = plainText(article.markdown).replace(/\s/g, '').length;
  const selectionChars = selection ? plainText(selection.text).replace(/\s/g, '').length : 0;
  const presetId =
    AI_PRESETS.find((preset) => preset.baseUrl && preset.baseUrl === state.settings.aiBaseUrl)?.id || 'custom';
  const configured = Boolean(state.settings.aiBaseUrl && state.settings.aiModel);

  let mode = 'layout';
  let scope = selection ? 'selection' : 'full';
  let result = null;
  let snapshot = null;
  let applied = false;
  let running = false;
  let baseHint = '';
  let disposed = false;
  let timer = null;

  const body = `<div id="aiError"></div>
    <div class="ai-model-bar">
      <span class="ai-model-badge">${icon('sparkles', 13)}</span>
      <span>使用模型</span>
      <strong id="aiModelLabelTop">${escapeHtml(state.settings.aiModel || '未配置')}</strong>
      <button class="link-btn" id="aiOpenConfig" type="button">${configured ? '更换' : '去配置'}</button>
    </div>

    <div class="ai-section">
      <div class="ai-section-head">
        <h4>怎么美化</h4>
        <span>只改本机草稿，不会自动发布</span>
      </div>
      <div class="ai-modes" id="aiModes">
        ${AI_MODES.map(
          (item) => `<button class="ai-mode ${item.id === mode ? 'active' : ''}" data-mode="${item.id}" type="button">
            <span class="ai-mode-icon">${icon(item.icon, 16)}</span>
            <strong>${item.name}</strong>
            <span>${item.desc}</span>
          </button>`
        ).join('')}
      </div>
    </div>

    <div class="ai-scope-row">
      <span class="ai-scope-label">处理范围</span>
      <div class="segmented" id="aiScope">
        ${
          selection
            ? `<button data-scope="selection" class="${scope === 'selection' ? 'active' : ''}" type="button">仅选中 ${formatNumber(selectionChars)} 字</button>`
            : ''
        }
        <button data-scope="full" class="${scope === 'full' ? 'active' : ''}" type="button">全文 ${formatNumber(fullChars)} 字</button>
      </div>
      <span class="hint" id="aiScopeHint">${
        selection ? '只替换编辑器里选中的片段，其余内容保持不动。' : '想只改一段？先在编辑器里选中文字，再打开这里。'
      }</span>
    </div>

    <div class="field ai-instruction">
      <label>额外要求（选填）</label>
      <textarea id="aiInstruction" rows="2" maxlength="800" placeholder="例如：保留所有小标题；语气更克制；不要使用感叹号"></textarea>
    </div>

    <details class="config-box ai-config" id="aiConfigBox" ${configured ? '' : 'open'}>
      <summary><span class="status-dot ${configured ? 'ok' : ''}" id="aiConfigDot"></span>模型设置 <span class="ai-summary-model">· <span id="aiModelLabel">${escapeHtml(state.settings.aiModel || '未配置')}</span></span></summary>
      <div class="form-grid ai-config-grid">
        <div class="field">
          <label>服务商预设</label>
          <select id="aiPreset">
            ${AI_PRESETS.map(
              (preset) => `<option value="${preset.id}" ${preset.id === presetId ? 'selected' : ''}>${preset.name}</option>`
            ).join('')}
          </select>
        </div>
        <div class="field">
          <label>模型名</label>
          <input id="aiModel" list="aiModelOptions" value="${escapeHtml(state.settings.aiModel)}" placeholder="deepseek-chat" autocomplete="off" />
          <datalist id="aiModelOptions"></datalist>
        </div>
        <div class="field full">
          <label>接口地址（OpenAI 兼容）</label>
          <input id="aiBaseUrl" value="${escapeHtml(state.settings.aiBaseUrl)}" placeholder="https://api.example.com/v1" autocomplete="off" />
        </div>
        <div class="field full">
          <label>API Key</label>
          <input id="aiApiKey" type="password" placeholder="${state.settings.hasAiKey ? '已保存，留空不修改' : '本地 Ollama 可留空'}" autocomplete="new-password" />
        </div>
      </div>
      <div class="config-actions">
        <button class="btn btn-sm" id="aiFetchModels" type="button">${icon('refresh', 13)}获取模型列表</button>
        <span class="config-result" id="aiModelsResult"></span>
        ${state.settings.hasAiKey ? '<button class="link-btn danger ai-clear-key" id="aiClearKey" type="button">清除已保存的 Key</button>' : ''}
      </div>
      <p class="config-note">支持 DeepSeek、OpenAI、通义千问、智谱、Moonshot、Ollama 等 OpenAI 兼容接口。Key 只保存在本机 data/settings.json（权限 600），不会写入文章，也不会回显。</p>
    </details>

    <div id="aiProgress" hidden></div>
    <div id="aiResult" hidden></div>`;

  openModal({
    title: 'AI 美化',
    subtitle: '让模型整理结构与措辞，结果先在弹窗里预览，确认后再写回正文。',
    body,
    wide: true,
    width: 980,
    footer: '<span></span>',
    onMount(root, close) {
      const errorBox = $('#aiError', root);
      const progress = $('#aiProgress', root);
      const resultBox = $('#aiResult', root);
      const footer = $('.modal-foot', root);
      const baseInput = $('#aiBaseUrl', root);
      const modelInput = $('#aiModel', root);
      const keyInput = $('#aiApiKey', root);
      const configBox = $('#aiConfigBox', root);

      const showError = (message) => {
        errorBox.innerHTML = `<div class="banner error">${escapeHtml(message)}</div>`;
      };
      const clearError = () => {
        errorBox.innerHTML = '';
      };

      const updateModelLabel = () => {
        const model = modelInput.value.trim();
        $('#aiModelLabelTop', root).textContent = model || '未配置';
        $('#aiModelLabel', root).textContent = model || '未配置';
        $('#aiConfigDot', root).classList.toggle('ok', Boolean(baseInput.value.trim() && model));
      };

      const setFooter = (phase) => {
        const left = {
          idle: 'AI 只修改本机草稿，不会自动发布',
          loading: '正在等待模型返回，长文可能需要几分钟',
          result: '结果尚未写入正文，可以先生成预览',
          applied: '已写入正文，关闭后仍可手动修改',
        }[phase];
        const buttons =
          phase === 'loading'
            ? '<button class="btn" type="button" disabled>正在美化…</button>'
            : phase === 'result'
            ? '<button class="btn" data-ai-close type="button">取消</button><button class="btn" data-ai-run type="button">再生成一次</button><button class="btn btn-accent" data-ai-apply type="button">应用到正文</button>'
            : phase === 'applied'
            ? '<button class="btn" data-ai-undo type="button">撤销本次修改</button><button class="btn btn-dark" data-ai-done type="button">完成</button>'
            : `<button class="btn" data-ai-close type="button">取消</button><button class="btn btn-accent" data-ai-run type="button">${icon('sparkles', 15)}开始美化</button>`;
        footer.innerHTML = `<span class="left ${phase === 'applied' ? 'ok-text' : ''}">${left}</span>${buttons}`;
      };

      footer.addEventListener('click', (event) => {
        if (event.target.closest('[data-ai-close]')) close();
        else if (event.target.closest('[data-ai-done]')) close();
        else if (event.target.closest('[data-ai-run]')) run();
        else if (event.target.closest('[data-ai-apply]')) applyResult();
        else if (event.target.closest('[data-ai-undo]')) undoResult();
      });

      $('#aiOpenConfig', root).addEventListener('click', () => {
        configBox.open = true;
        baseInput.focus();
      });

      $('#aiModes', root).addEventListener('click', (event) => {
        const button = event.target.closest('[data-mode]');
        if (!button) return;
        mode = button.dataset.mode;
        $$('.ai-mode', root).forEach((item) => item.classList.toggle('active', item === button));
      });

      $('#aiScope', root).addEventListener('click', (event) => {
        const button = event.target.closest('[data-scope]');
        if (!button) return;
        scope = button.dataset.scope;
        $$('#aiScope button', root).forEach((item) => item.classList.toggle('active', item === button));
      });

      $('#aiPreset', root).addEventListener('change', (event) => {
        const preset = AI_PRESETS.find((item) => item.id === event.target.value);
        if (!preset || !preset.baseUrl) return;
        baseInput.value = preset.baseUrl;
        modelInput.value = preset.model;
        updateModelLabel();
      });

      modelInput.addEventListener('input', updateModelLabel);
      baseInput.addEventListener('input', updateModelLabel);

      $('#aiFetchModels', root).addEventListener('click', async () => {
        const button = $('#aiFetchModels', root);
        const output = $('#aiModelsResult', root);
        const baseUrl = baseInput.value.trim();
        if (!baseUrl) {
          configBox.open = true;
          baseInput.focus();
          output.textContent = '请先填写接口地址';
          output.className = 'config-result bad';
          return;
        }
        button.disabled = true;
        output.textContent = '正在获取模型列表…';
        output.className = 'config-result';
        try {
          const res = await api.aiModels({ baseUrl, apiKey: keyInput.value.trim() });
          const models = res.models || [];
          const filled = res.baseUrl && res.baseUrl !== baseUrl ? res.baseUrl : '';
          if (filled) {
            baseInput.value = filled;
            updateModelLabel();
          }
          $('#aiModelOptions', root).innerHTML = models
            .map((name) => `<option value="${escapeHtml(name)}"></option>`)
            .join('');
          output.textContent = res.unsupported
            ? `该接口没有提供模型列表，请手动填写模型名${filled ? `（接口地址已自动补全为 ${filled}）` : ''}`
            : models.length
            ? `已获取 ${models.length} 个模型，可在模型输入框下拉选择${filled ? `（接口地址已自动补全为 ${filled}）` : ''}`
            : `接口没有返回模型列表，请手动填写模型名${filled ? `（接口地址已自动补全为 ${filled}）` : ''}`;
          output.className = `config-result ${models.length && !res.unsupported ? 'ok' : ''}`;
        } catch (err) {
          output.textContent = err.message;
          output.className = 'config-result bad';
        } finally {
          button.disabled = false;
        }
      });

      const clearKey = $('#aiClearKey', root);
      if (clearKey) {
        clearKey.addEventListener('click', async () => {
          const ok = await confirmDialog({
            title: '清除 AI 接口 Key？',
            message: '清除后需要重新填写 API Key，已保存的模型和接口地址不会变化。',
            confirmText: '清除',
            danger: true,
          });
          if (!ok) return;
          try {
            const res = await api.saveSettings({ clearAiKey: true });
            state.settings = res.settings;
            clearKey.remove();
            keyInput.placeholder = '本地 Ollama 可留空';
            toast('AI 接口 Key 已清除', 'success');
          } catch (err) {
            toast(err.message, 'error');
          }
        });
      }

      resultBox.addEventListener('click', (event) => {
        const button = event.target.closest('[data-ai-view]');
        if (!button) return;
        $$('[data-ai-view]', resultBox).forEach((item) => item.classList.toggle('active', item === button));
        const view = button.dataset.aiView;
        $('.ai-preview', resultBox).hidden = view !== 'preview';
        $('.ai-md', resultBox).hidden = view !== 'markdown';
      });

      const paintResult = () => {
        if (!result) return;
        const source =
          applied && snapshot
            ? snapshot.markdown
            : scope === 'selection' && selection
            ? selection.text
            : state.current.markdown;
        const before = plainText(source).replace(/\s/g, '').length;
        const after = plainText(result.markdown).replace(/\s/g, '').length;
        const rendered = renderArticle(result.markdown, getTheme(state.current.themeId), normalizeOptions(state.current.options));
        const modeName = AI_MODES.find((item) => item.id === result.mode)?.name || result.mode;
        resultBox.innerHTML = `<div class="ai-result-head">
            <div class="ai-result-stats">
              <span class="ai-stat"><strong>${formatNumber(before)}</strong> 字 <i>→</i> <strong>${formatNumber(after)}</strong> 字</span>
              <span class="ai-tag">${escapeHtml(result.model)}</span>
              <span class="ai-tag">${escapeHtml(modeName)}</span>
              ${baseHint ? `<span class="ai-tag" title="接口地址缺少 /v1 前缀，本次已自动补全">已自动补全 /v1</span>` : ''}
              ${applied ? '<span class="ai-applied">已应用</span>' : ''}
            </div>
            <div class="segmented" id="aiViewTabs">
              <button data-ai-view="preview" class="active" type="button">排版预览</button>
              <button data-ai-view="markdown" type="button">Markdown</button>
            </div>
          </div>
          ${result.warnings && result.warnings.length ? `<div class="banner warn">${result.warnings.map(escapeHtml).join('<br>')}</div>` : ''}
          <div class="ai-preview">${rendered.html}</div>
          <pre class="ai-md" hidden>${escapeHtml(result.markdown)}</pre>`;
      };

      async function run() {
        if (running) return;
        clearError();
        const baseUrl = baseInput.value.trim();
        const model = modelInput.value.trim();
        const apiKey = keyInput.value.trim();
        if (!baseUrl || !model) {
          configBox.open = true;
          showError('请先填写接口地址和模型名。');
          (baseUrl ? modelInput : baseInput).focus();
          return;
        }

        const instruction = $('#aiInstruction', root).value.trim();
        const source = scope === 'selection' && selection ? selection.text : state.current.markdown;

        running = true;
        applied = false;
        baseHint = '';
        resultBox.hidden = true;
        progress.hidden = false;
        progress.innerHTML = `<div class="progress-box">
            <div class="spinner"></div>
            <strong>AI 正在整理这篇文章</strong>
            <span>模型：${escapeHtml(model)} · 已用时 <b id="aiElapsed">0 秒</b><br>正在调整结构与措辞，长文可能需要几分钟，请不要关闭窗口。</span>
          </div>`;
        setFooter('loading');

        const started = Date.now();
        timer = setInterval(() => {
          const el = $('#aiElapsed', root);
          if (el) el.textContent = `${Math.floor((Date.now() - started) / 1000)} 秒`;
        }, 1000);

        try {
          const payload = {};
          if (baseUrl !== state.settings.aiBaseUrl) payload.aiBaseUrl = baseUrl;
          if (model !== state.settings.aiModel) payload.aiModel = model;
          if (apiKey) payload.aiApiKey = apiKey;
          if (Object.keys(payload).length) {
            const saved = await api.saveSettings(payload);
            state.settings = saved.settings;
          }

          const res = await api.aiBeautify({
            markdown: source,
            title: state.current.title,
            mode,
            instruction,
            scope,
            baseUrl,
            model,
            apiKey,
          });
          if (disposed) return;

          result = res;
          baseHint = res.baseUrl && res.baseUrl !== baseUrl ? res.baseUrl : '';
          progress.hidden = true;
          resultBox.hidden = false;
          paintResult();
          setFooter('result');
          resultBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } catch (err) {
          if (disposed) return;
          progress.hidden = true;
          setFooter('idle');
          showError(err.message);
          if (/接口|模型|Key|鉴权|地址/i.test(err.message)) configBox.open = true;
        } finally {
          clearInterval(timer);
          timer = null;
          running = false;
        }
      }

      async function applyResult() {
        if (!result) return;
        if (result.missingImages && result.missingImages.length) {
          const ok = await confirmDialog({
            title: 'AI 结果遗漏了图片',
            message: `这次结果里少了 ${result.missingImages.length} 张图片。仍然应用的话，这些图片会从正文里消失。\n\n建议先点「再生成一次」。`,
            confirmText: '仍然应用',
            danger: true,
          });
          if (!ok) return;
        }

        snapshot = { markdown: editor.value, start: editor.selectionStart, end: editor.selectionEnd };
        if (scope === 'selection' && selection) {
          if (editor.value.slice(selection.start, selection.end) !== selection.text) {
            showError('选区已经变化，请关闭弹窗后重新选择。');
            return;
          }
          editor.setRangeText(result.markdown, selection.start, selection.end, 'end');
        } else {
          editor.value = result.markdown;
        }

        state.current.markdown = editor.value;
        applied = true;
        onEditorInput();
        await saveNow();
        renderPreview();
        paintResult();
        setFooter('applied');
        toast('AI 美化已应用，可撤销', 'success');
      }

      async function undoResult() {
        if (!snapshot) return;
        editor.value = snapshot.markdown;
        editor.setSelectionRange(snapshot.start, snapshot.end);
        state.current.markdown = snapshot.markdown;
        applied = false;
        onEditorInput();
        await saveNow();
        renderPreview();
        paintResult();
        setFooter('result');
        toast('已撤销 AI 修改');
      }

      setFooter('idle');
      updateModelLabel();
    },
    onClose() {
      disposed = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
  });
}

/* --------------------------------- copy ----------------------------------- */

function stripLocalImages(html) {
  let next = html.replace(
    /<section style="[^"]*text-align:center;"><img src="\/uploads\/[^"]*"[^>]*>(?:<span[\s\S]*?<\/span>)?<\/section>/g,
    ''
  );
  next = next.replace(/<img src="\/uploads\/[^"]*"[^>]*>/g, '');
  return next;
}

async function copyArticle() {
  if (!state.current) return;
  if (isPic()) {
    toast('贴图不走文章排版复制，请直接写入公众号草稿箱', 'default', 4200);
    return;
  }
  let html = currentRender().html;
  const localCount = (html.match(/src="\/uploads\//g) || []).length;

  if (localCount && state.settings.hasSecret) {
    try {
      toast('正在把正文图片上传到微信…');
      const res = await api.prepare(html);
      html = res.content;
      if (res.skipped && res.skipped.length) {
        toast(`有 ${res.skipped.length} 张图片未能上传到微信`, 'error', 4500);
      }
    } catch (err) {
      const go = await confirmDialog({
        title: '图片上传失败',
        message: `${err.message}\n\n仍要复制文字排版吗？粘贴后图片需要手动补充。`,
        confirmText: '仍然复制',
      });
      if (!go) return;
      html = stripLocalImages(html);
    }
  } else if (localCount) {
    const go = await confirmDialog({
      title: `文章含 ${localCount} 张本地图片`,
      message:
        `当前账号「${state.settings.accountName || '我的公众号'}」还没配置公众号接口，微信无法读取本机图片。\n\n配置接口后，「复制到公众号」会自动上传图片；也可以只复制文字排版，稍后在微信编辑器里手动插图。`,
      confirmText: '只复制文字',
      cancelText: '去配置接口',
    });
    if (go === false) {
      openSettings();
      return;
    }
    if (go !== true) return;
    html = stripLocalImages(html);
  }

  try {
    await copyRich(html, plainText(state.current.markdown));
    toast(`已复制排版（${state.settings.accountName || '我的公众号'}），粘贴到公众号编辑器即可`, 'success', 4200);
  } catch (err) {
    toast(`复制失败：${err.message}`, 'error');
  }
}

async function copyRich(html, text) {
  if (navigator.clipboard && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text || ''], { type: 'text/plain' }),
        }),
      ]);
      return;
    } catch {
      // fall through to execCommand
    }
  }
  const holder = document.createElement('div');
  holder.contentEditable = 'true';
  holder.style.cssText = 'position:fixed;left:-9999px;top:0;width:600px;opacity:0;';
  holder.innerHTML = html;
  document.body.appendChild(holder);
  const range = document.createRange();
  range.selectNodeContents(holder);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  const ok = document.execCommand('copy');
  selection.removeAllRanges();
  holder.remove();
  if (!ok) throw new Error('浏览器拒绝了复制操作');
}

async function copyHtmlSource() {
  if (!state.current) return;
  try {
    await navigator.clipboard.writeText(currentRender().html);
    toast('HTML 源码已复制', 'success');
  } catch (err) {
    toast(`复制失败：${err.message}`, 'error');
  }
}

/* --------------------------------- export --------------------------------- */

function downloadFile(filename, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportMarkdown() {
  if (!state.current) return;
  const title = (state.current.title || '未命名文章').replace(/[\\/:*?"<>|]/g, '');
  downloadFile(`${title}.md`, state.current.markdown || '', 'text/markdown;charset=utf-8');
  toast('Markdown 已导出', 'success');
}

function exportHtml() {
  if (!state.current) return;
  const article = state.current;
  const html = currentRender().html;
  const page = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(article.title || '未命名文章')}</title>
<style>body{margin:0;background:#ffffff;padding:32px 18px;display:flex;justify-content:center}.page{width:100%;max-width:680px}</style>
</head>
<body><div class="page">${html}</div></body>
</html>`;
  const title = (article.title || '未命名文章').replace(/[\\/:*?"<>|]/g, '');
  downloadFile(`${title}.html`, page, 'text/html;charset=utf-8');
  toast('HTML 文件已导出', 'success');
}

/* --------------------------------- dialogs -------------------------------- */

function showHelp() {
  if (isPic()) {
    openModal({
      title: '贴图说明',
      subtitle: '贴图会发布为公众号图片消息：图片在前，文案显示在图片下方。',
      width: 620,
      body: `<div class="help-section">
          <h4>基本规则</h4>
          <table class="help-table">
            <tr><td>图片</td><td>1–20 张，单张 ≤ 1MB，仅 JPG / PNG，首图即封面</td></tr>
            <tr><td>标题</td><td>最多 32 个字符</td></tr>
            <tr><td>文案</td><td>最多 1000 字，纯文本，换行会保留</td></tr>
          </table>
        </div>
        <div class="help-section">
          <h4>AI 扩写</h4>
          <p class="panel-footnote">在文案里选中一句话，会出现「AI 扩写」浮层；也可以直接点右上角「AI 扩写」，扩写整段文案。生成的内容只插入到选中文字之后，不会替换原文。</p>
        </div>`,
      footer: `<button class="btn btn-dark" data-footer-close type="button">知道了</button>`,
    });
    return;
  }
  const iconComponents = STYLE_COMPONENTS.filter((component) => component.category === '图标');
  const iconStrip = ['star', 'check-circle', 'clock', 'bulb', 'right', 'heart', 'target', 'flag']
    .map((id) => renderGlyph(id, { size: 20, shape: 'circle', tint: 12, color: resolveGlyphColor('accent', iconPalette()) }))
    .join('');
  openModal({
    title: '格式说明',
    subtitle: '左侧写 Markdown，右侧实时预览；复制时全部转成内联样式。',
    width: 660,
    body: `<div class="help-section">
        <h4>基础语法</h4>
        <table class="help-table">
          <tr><td>## 小标题</td><td>二级标题，模板会自动装饰</td></tr>
          <tr><td>### 小标题</td><td>三级标题</td></tr>
          <tr><td>**加粗**</td><td>强调重点，快捷键 ⌘B</td></tr>
          <tr><td>*斜体*</td><td>弱化语气，快捷键 ⌘I</td></tr>
          <tr><td>==荧光==</td><td>带底色的高亮标记</td></tr>
          <tr><td>&gt; 一段引用</td><td>金句、引言，可连续多行</td></tr>
          <tr><td>- 列表 / 1. 列表</td><td>无序与有序列表</td></tr>
          <tr><td>![图注](图片地址)</td><td>图片，图注显示在图片下方</td></tr>
          <tr><td>---</td><td>分割线</td></tr>
        </table>
      </div>
      <div class="help-section">
        <h4>进阶模块</h4>
        <table class="help-table">
          <tr><td>:::tip 标题<br>内容<br>:::</td><td>提示卡片，类型可用 tip / note / warn</td></tr>
          <tr><td>三个反引号包住代码</td><td>代码块，会自动换行适配手机</td></tr>
          <tr><td>| 表头 | 表头 |<br>| --- | --- |</td><td>表格，支持左右/居中对齐</td></tr>
        </table>
        <p class="panel-footnote">把截图直接粘贴到编辑器，会自动上传到素材库并插入正文。⌘S 保存，⌘K 插入链接。</p>
      </div>
      <div class="help-section">
        <h4>行内图标</h4>
        <div class="help-icon-strip">${iconStrip}</div>
        <table class="help-table">
          <tr><td>:star: :clock: :check:</td><td>在句子里插入图标，共 ${GLYPH_COUNT} 个，颜色默认跟随强调色</td></tr>
          <tr><td>:star{24,circle}:</td><td>参数依次为 尺寸、底座、颜色、底色浓度</td></tr>
          <tr><td>:star{24,circle,#1d4ed8,18}:</td><td>底座可用 none / circle / square / outline</td></tr>
          <tr><td>:star{weight=700,gap=6,opacity=80}:</td><td>还可调线条字重、与文字间距、不透明度、align 对齐</td></tr>
        </table>
        <p class="panel-footnote">不想记语法就打开「样式 → 图标工坊」：左侧滑杆实时预览，点图标即插入。图标用字符与 CSS 图形绘制，不是图片，不占公众号素材配额。</p>
      </div>
      <div class="help-section">
        <h4>图标结构化组件</h4>
        <table class="help-table">
          ${iconComponents.map((component) => {
            const kind = (component.sample.match(/^:::(\w+)/) || [, ''])[1];
            return `<tr><td>:::${kind} 标题<br>一行一条，用 | 分栏<br>:::</td><td><strong>${component.name}</strong> — ${component.description}</td></tr>`;
          }).join('')}
        </table>
        <p class="panel-footnote">完整示例在「样式 → 排版组件 → 图标」里，点一下就插入带占位内容的模板。</p>
      </div>`,
    footer: `<button class="btn btn-dark" data-footer-close type="button">知道了</button>`,
  });
}

/* ------------------------------- utilities -------------------------------- */

function loadStyleFavorites() {
  try {
    const values = JSON.parse(localStorage.getItem(STYLE_FAVORITES_KEY) || '[]');
    return new Set(Array.isArray(values) ? values.filter((value) => typeof value === 'string') : []);
  } catch {
    return new Set();
  }
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('zh-CN');
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatClock(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function publishedDateParts(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { day: '--', month: '日期未知', year: '' };
  return {
    day: pad(date.getDate()),
    month: `${date.getMonth() + 1}月`,
    year: String(date.getFullYear()),
  };
}

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatUpdated(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return `今天 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

function toast(message, type = 'default', timeout = 3200) {
  const stack = $('#toastStack');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const glyph = type === 'success' ? icon('check', 14) : type === 'error' ? icon('alert', 14) : '';
  el.innerHTML = `${glyph}<span>${escapeHtml(message)}</span>`;
  stack.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .2s ease, transform .2s ease';
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(() => el.remove(), 220);
  }, timeout);
}

/* ------------------------------ static events ----------------------------- */

function bindStaticEvents() {
  // 顶栏账号切换
  bindAccountSwitcher();

  // tabs
  $$('.side-tab').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.disabled) return;
      activateSideTab(button.dataset.tab);
      // 窄屏抽屉：模板 / 样式选完即应用，自动收起；文章 / 素材 / 封面还要在面板里继续操作，保持打开
      if (window.innerWidth <= 900 && ['themes', 'styles'].includes(button.dataset.tab)) {
        document.body.classList.remove('sidebar-open');
      }
    });
  });

  // article title + author
  $('#titleInput').addEventListener('input', (event) => {
    onArticleMetaInput('title', event.target.value);
    if (isPic()) $('#titleCount').textContent = `${event.target.value.length} / 32`;
  });
  $('#authorInput').addEventListener('input', (event) => {
    onArticleMetaInput('author', event.target.value);
  });

  // editor
  $('#editor').addEventListener('input', onEditorInput);

  $('#editor').addEventListener('paste', async (event) => {
    const clipboard = event.clipboardData;
    const files = [...(clipboard?.files || [])].filter((file) => file.type.startsWith('image/'));
    const html = clipboard?.getData('text/html') || '';
    if (html.trim()) {
      event.preventDefault();
      try {
        const converted = await htmlToMarkdown(html, { uploadImage: uploadEmbeddedImage });
        if (converted.embedded) renderAssets();
        if (converted.markdown) insertText(converted.markdown);
        else insertText(clipboard?.getData('text/plain') || '');
        const detail = conversionMessage(converted);
        toast(detail || '富文本已转换为 Markdown', converted.failed ? 'default' : 'success', 4800);
      } catch (err) {
        insertText(clipboard?.getData('text/plain') || '');
        toast(`富文本转换失败，已保留纯文字：${err.message}`, 'error', 5000);
      }
      return;
    }
    if (files.length) {
      event.preventDefault();
      uploadFiles(files, { insert: true });
    }
  });

  const editorWrap = $('.editor-scroll');
  ['dragenter', 'dragover'].forEach((type) => {
    editorWrap.addEventListener(type, (event) => {
      event.preventDefault();
      editorWrap.style.background = 'rgba(244, 228, 220, 0.5)';
    });
  });
  ['dragleave', 'drop'].forEach((type) => {
    editorWrap.addEventListener(type, (event) => {
      event.preventDefault();
      editorWrap.style.background = '';
    });
  });
  editorWrap.addEventListener('drop', (event) => {
    const files = [...(event.dataTransfer?.files || [])].filter((file) => file.type.startsWith('image/'));
    if (files.length) uploadFiles(files, { insert: true });
  });

  // pic editor
  $('#picCopy').addEventListener('input', onPicCopyInput);
  if (window.ResizeObserver) {
    new ResizeObserver(() => {
      if (isPic()) fitPicCopy();
    }).observe($('.editor-scroll'));
  }
  $('#picToolbar').addEventListener('click', (event) => {
    const action = event.target.closest('[data-pic-action]')?.dataset.picAction;
    if (!action || !isPic()) return;
    if (action === 'add') openPicImagePicker(addPicImages);
    else if (action === 'gallery') openWeChatPicGallery();
  });

  const picGrid = $('#picGrid');
  let picDragIndex = -1;
  const clearPicDrop = () => {
    $$('.pic-card', picGrid).forEach((card) => card.classList.remove('dragging', 'drop-target'));
    picGrid.classList.remove('file-dragover');
  };

  picGrid.addEventListener('click', (event) => {
    if (event.target.closest('[data-pic-add]')) {
      openPicImagePicker(addPicImages);
      return;
    }
    const remove = event.target.closest('[data-pic-remove]');
    if (!remove || !isPic()) return;
    const index = Number(remove.dataset.picRemove);
    state.current.images.splice(index, 1);
    state.editSeq += 1;
    renderPicEditor();
    renderPreview();
    scheduleSaveSoon();
    renderArticleList();
    toast('已移除图片', 'success');
  });

  picGrid.addEventListener('dragstart', (event) => {
    const card = event.target.closest('[data-pic-index]');
    if (!card) return;
    picDragIndex = Number(card.dataset.picIndex);
    card.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(picDragIndex));
  });

  picGrid.addEventListener('dragover', (event) => {
    if (picDragIndex < 0 && !event.dataTransfer?.files?.length) return;
    event.preventDefault();
    if (picDragIndex < 0) {
      picGrid.classList.add('file-dragover');
      return;
    }
    event.dataTransfer.dropEffect = 'move';
    $$('.pic-card', picGrid).forEach((card) => card.classList.remove('drop-target'));
    const card = event.target.closest('[data-pic-index]');
    if (card) card.classList.add('drop-target');
  });

  picGrid.addEventListener('dragleave', (event) => {
    if (!picGrid.contains(event.relatedTarget)) {
      picGrid.classList.remove('file-dragover');
      $$('.pic-card', picGrid).forEach((card) => card.classList.remove('drop-target'));
    }
  });

  picGrid.addEventListener('drop', async (event) => {
    const files = [...(event.dataTransfer?.files || [])].filter((file) => file.type.startsWith('image/'));
    if (files.length) {
      event.preventDefault();
      event.stopPropagation();
      picDragIndex = -1;
      clearPicDrop();
      const uploaded = await uploadFiles(files, { silent: true });
      addPicImages(uploaded.map(toPicImage));
      return;
    }
    if (picDragIndex < 0) return;
    event.preventDefault();
    const card = event.target.closest('[data-pic-index]');
    const to = card ? Number(card.dataset.picIndex) : (state.current?.images || []).length - 1;
    const from = picDragIndex;
    picDragIndex = -1;
    clearPicDrop();
    movePicImage(from, to);
  });

  picGrid.addEventListener('dragend', () => {
    picDragIndex = -1;
    clearPicDrop();
  });

  // toolbar
  $('#toolbar').addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (button) handleAction(button.dataset.action);
  });

  // themes
  $('#themeGroups').addEventListener('click', (event) => {
    const button = event.target.closest('[data-theme-group]');
    if (!button) return;
    state.themeGroup = button.dataset.themeGroup;
    renderThemeGrid();
  });

  $('#themeGrid').addEventListener('click', (event) => {
    const card = event.target.closest('[data-theme]');
    if (!card || !state.current) return;
    state.current.themeId = card.dataset.theme;
    state.editSeq += 1;
    renderThemeGrid();
    renderStyleCenter();
    renderOptions();
    renderPreview();
    scheduleSaveSoon();
  });

  // style library
  $('#styleMode').addEventListener('click', (event) => {
    const button = event.target.closest('[data-style-mode]');
    if (!button || button.dataset.styleMode === state.styleMode) return;
    state.styleMode = button.dataset.styleMode;
    renderStyleCenter();
    if (state.styleMode === 'icons') revealIconGrid();
  });
  $('#styleCategories').addEventListener('click', (event) => {
    const button = event.target.closest('[data-style-category]');
    if (!button) return;
    state.styleCategory = button.dataset.styleCategory;
    renderStyleCenter();
  });
  $('#styleSearch').addEventListener('input', (event) => {
    if (state.styleMode === 'icons') {
      state.iconQuery = event.target.value;
      renderIconGrid();
      revealIconGrid();
    } else {
      state.styleQuery = event.target.value;
      renderStyleCenter();
    }
  });
  $('#styleList').addEventListener('click', (event) => {
    const favoriteButton = event.target.closest('[data-style-favorite]');
    if (favoriteButton) {
      const id = favoriteButton.dataset.styleFavorite;
      if (state.styleFavorites.has(id)) state.styleFavorites.delete(id);
      else state.styleFavorites.add(id);
      localStorage.setItem(STYLE_FAVORITES_KEY, JSON.stringify([...state.styleFavorites]));
      renderStyleCenter();
      return;
    }
    const insertButton = event.target.closest('[data-style-insert]');
    if (!insertButton || !state.current) return;
    insertComponent(insertButton.dataset.styleInsert);
  });

  // icon studio
  $('#iconGroups').addEventListener('click', (event) => {
    const button = event.target.closest('[data-icon-group]');
    if (!button) return;
    state.iconGroup = button.dataset.iconGroup;
    renderIconStudio();
    revealIconGrid();
  });
  $('#iconGrid').addEventListener('click', (event) => {
    const cell = event.target.closest('[data-icon-id]');
    if (!cell) return;
    state.iconSelected = cell.dataset.iconId;
    renderIconStudio();
    if (!event.shiftKey) insertGlyph(state.iconSelected);
  });
  $('#iconSwatches').addEventListener('click', (event) => {
    const button = event.target.closest('[data-icon-color]');
    if (!button) return;
    setIconStyle({ color: button.dataset.iconColor });
  });
  const iconRanges = [
    ['#iconSize', 'size'],
    ['#iconTint', 'tint'],
    ['#iconWeight', 'weight'],
    ['#iconGap', 'gap'],
    ['#iconOpacity', 'opacity'],
  ];
  iconRanges.forEach(([selector, key]) => {
    $(selector).addEventListener('input', (event) => setIconStyle({ [key]: Number(event.target.value) }));
  });
  $('#iconShape').addEventListener('change', (event) => setIconStyle({ shape: event.target.value }));
  $('#iconAlign').addEventListener('change', (event) => setIconStyle({ align: event.target.value }));
  $('#iconColorPick').addEventListener('input', (event) => setIconStyle({ color: event.target.value }));
  $('#btnIconColorFollow').addEventListener('click', () => setIconStyle({ color: 'accent' }));
  $('#btnIconInsert').addEventListener('click', () => insertGlyph());
  const copyIconSyntax = async () => {
    const syntax = glyphSyntax(state.iconSelected, state.iconStyle);
    try {
      await navigator.clipboard.writeText(syntax);
      toast(`已复制 ${syntax}`, 'success', 2200);
    } catch (err) {
      toast(`复制失败：${err.message}`, 'error');
    }
  };
  $('#btnIconCopy').addEventListener('click', copyIconSyntax);
  $('#iconStageSyntax').addEventListener('click', copyIconSyntax);
  $('#btnIconRandom').addEventListener('click', () => {
    const pool = searchGlyphs(state.iconQuery, state.iconGroup);
    if (!pool.length) return;
    const others = pool.filter((glyph) => glyph.id !== state.iconSelected);
    const pick = (others.length ? others : pool)[Math.floor(Math.random() * (others.length || pool.length))];
    state.iconSelected = pick.id;
    renderIconStudio();
  });
  $('#btnIconReset').addEventListener('click', () => {
    setIconStyle({ ...DEFAULT_GLYPH_STYLE });
    toast('图标样式已恢复默认', 'success', 1800);
  });

  // options
  $('#fontSizeSeg').addEventListener('click', (event) => {
    const button = event.target.closest('[data-size]');
    if (!button || !state.current) return;
    state.current.options.fontSize = Number(button.dataset.size);
    state.editSeq += 1;
    renderOptions();
    renderPreview();
    scheduleSaveSoon();
  });

  $('#lineHeightSeg').addEventListener('click', (event) => {
    const button = event.target.closest('[data-lh]');
    if (!button || !state.current) return;
    state.current.options.lineHeight = Number(button.dataset.lh);
    state.editSeq += 1;
    renderOptions();
    renderPreview();
    scheduleSaveSoon();
  });

  $('#accentSwatches').addEventListener('click', (event) => {
    const button = event.target.closest('[data-accent]');
    if (!button || !state.current) return;
    state.current.options.accent = button.dataset.accent || '';
    state.editSeq += 1;
    renderOptions();
    renderStyleCenter();
    renderPreview();
    scheduleSaveSoon();
  });

  $('#btnResetOptions').addEventListener('click', () => {
    if (!state.current) return;
    const theme = getTheme(state.current.themeId);
    state.current.options = {
      fontSize: theme.baseFontSize || 16,
      lineHeight: theme.baseLineHeight || 1.9,
      accent: '',
    };
    state.editSeq += 1;
    renderOptions();
    renderStyleCenter();
    renderPreview();
    scheduleSaveSoon();
  });

  // preview + sidebar toggles
  $('#btnPreviewToggle').addEventListener('click', () => {
    const open = !document.body.classList.contains('preview-open');
    document.body.classList.toggle('preview-open', open);
    localStorage.setItem(PREVIEW_KEY, open ? '1' : '0');
  });

  $('#btnSidebarToggle').addEventListener('click', () => {
    document.body.classList.toggle('sidebar-open');
  });

  // top actions
  $('#btnCopy').addEventListener('click', copyArticle);
  $('#btnPublish').addEventListener('click', openPublish);
  $('#btnSettings').addEventListener('click', openSettings);
  $('#btnAiBeautify').addEventListener('click', openAiBeautify);

  // AI continue bubble
  const continueBubble = $('#aiContinueBubble');
  continueBubble.addEventListener('mousedown', (event) => event.preventDefault());
  continueBubble.addEventListener('click', (event) => {
    if (event.target.closest('[data-ai-continue-close]')) {
      hideAiContinue();
      return;
    }
    if (event.target.closest('[data-ai-continue-insert]')) {
      insertAiContinue();
      return;
    }
    if (event.target.closest('[data-ai-continue-run]')) runAiContinue();
  });

  const bindAiSelection = (field) => {
    if (!field) return;
    field.addEventListener('mouseup', (event) => {
      if (event.button !== 0) return;
      if (!aiContinueConfigured()) {
        hideAiContinue();
        return;
      }
      window.setTimeout(() => {
        const selection = readEditorSelection(field);
        if (!selection) {
          hideAiContinue();
          return;
        }
        showAiContinue(event.clientX, event.clientY, { selection });
      }, 0);
    });
    field.addEventListener(
      'touchend',
      (event) => {
        if (!aiContinueConfigured()) return;
        const touch = event.changedTouches && event.changedTouches[0];
        window.setTimeout(() => {
          const selection = readEditorSelection(field);
          if (!selection) return;
          showAiContinue(
            touch ? touch.clientX : window.innerWidth / 2,
            touch ? touch.clientY : window.innerHeight / 2,
            { selection }
          );
        }, 320);
      },
      { passive: true }
    );
  };
  bindAiSelection($('#editor'));
  bindAiSelection($('#picCopy'));
  $('.editor-scroll').addEventListener('scroll', hideAiContinue, { passive: true });
  window.addEventListener('resize', hideAiContinue);
  document.addEventListener('mousedown', (event) => {
    if (!aiContinueBubble.visible) return;
    if (
      event.target.closest('#aiContinueBubble') ||
      event.target.closest('#editor') ||
      event.target.closest('#picCopy') ||
      event.target.closest('#btnAiBeautify')
    ) {
      return;
    }
    hideAiContinue();
  });

  // assets
  $('#fileInput').addEventListener('change', async (event) => {
    await uploadFiles(event.target.files);
    event.target.value = '';
  });
  $('#btnUploadTop').addEventListener('click', () => $('#fileInput').click());
  $('#btnWxGallery').addEventListener('click', () => {
    if (isPic()) openWeChatPicGallery();
    else openWeChatGallery();
  });

  const dropzone = $('#dropzone');
  ['dragenter', 'dragover'].forEach((type) => {
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach((type) => {
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.classList.remove('dragover');
    });
  });
  dropzone.addEventListener('drop', (event) => {
    if (event.dataTransfer?.files?.length) uploadFiles(event.dataTransfer.files);
  });

  $('#assetGrid').addEventListener('click', async (event) => {
    const asset = event.target.closest('.asset');
    if (!asset) return;
    const item = state.uploads.find((upload) => upload.file === asset.dataset.file);
    if (!item) return;
    const action = event.target.closest('[data-act]')?.dataset.act;
    if (action === 'delete') {
      await deleteUpload(item);
      return;
    }
    insertImage(item);
  });

  // cover panel
  const commitArticleCover = (url) => {
    if (!state.current) return;
    state.current.cover = url;
    state.editSeq += 1;
    renderCoverPanel();
    scheduleSaveSoon();
  };
  const chooseArticleCover = (item) => {
    if (coverNeedsCrop(item.width, item.height)) {
      openCoverCropper({ url: item.url, name: item.name, onDone: commitArticleCover });
    } else {
      commitArticleCover(item.url);
      toast('封面已更新', 'success');
    }
  };

  $('#btnCoverStudio').addEventListener('click', () => openCoverStudio());
  $('#btnCoverPick').addEventListener('click', () => {
    openMediaPicker(
      (item) => chooseArticleCover(item),
      { title: '选择封面', subtitle: '从本机素材库选一张图片作为公众号首图，比例不是 2.35 : 1 时会先打开裁剪。', allowWeChat: false }
    );
  });
  $('#btnCoverCrop').addEventListener('click', () => {
    if (!state.current?.cover) return;
    openCoverCropper({
      url: state.current.cover,
      name: '文章封面',
      onDone: commitArticleCover,
    });
  });
  $('#btnCoverRemove').addEventListener('click', () => {
    if (!state.current) return;
    state.current.cover = '';
    state.editSeq += 1;
    renderCoverPanel();
    scheduleSaveSoon();
    toast('封面已移除');
  });

  // article list + publication archive
  $$('[data-article-view]').forEach((button) => {
    button.addEventListener('click', () => setArticleView(button.dataset.articleView));
  });
  $('#publishedRefresh').addEventListener('click', () => loadPublished(true));
  $('#publishedLoadMore').addEventListener('click', () => loadPublished(false));
  $('#publishedList').addEventListener('click', (event) => {
    if (event.target.closest('[data-published-retry]')) {
      loadPublished(state.published.items.length === 0);
      return;
    }
    if (event.target.closest('[data-published-settings]')) {
      openSettings();
      return;
    }
    const card = event.target.closest('[data-published-id]');
    if (!card) return;
    const item = state.published.items.find((entry) => entry.id === card.dataset.publishedId);
    if (item) openPublishedDetail(item);
  });

  $('#draftRefresh').addEventListener('click', () => loadDrafts(true));
  $('#draftLoadMore').addEventListener('click', () => loadDrafts(false));
  $('#draftList').addEventListener('click', (event) => {
    if (event.target.closest('[data-draft-retry]')) {
      loadDrafts(state.drafts.items.length === 0);
      return;
    }
    if (event.target.closest('[data-draft-settings]')) {
      openSettings();
      return;
    }
    const card = event.target.closest('[data-draft-id]');
    if (!card) return;
    const item = state.drafts.items.find((entry) => entry.mediaId === card.dataset.draftId);
    if (item) openDraftDetail(item);
  });

  $('#articleList').addEventListener('click', async (event) => {
    const item = event.target.closest('.article-item');
    if (!item) return;
    const id = item.dataset.id;
    if (event.target.closest('[data-act="delete"]')) {
      await deleteArticle(id);
      return;
    }
    if (state.current?.id === id) return;
    await saveNow();
    const next = state.articles.find((article) => article.id === id);
    if (next) setCurrent(next);
  });

  const newMenu = $('#newArticleMenu');
  $('#btnNewArticle').addEventListener('click', (event) => {
    event.stopPropagation();
    newMenu.hidden = !newMenu.hidden;
  });
  newMenu.addEventListener('click', (event) => {
    const importButton = event.target.closest('[data-import]');
    if (importButton) {
      newMenu.hidden = true;
      $(importButton.dataset.import === 'md' ? '#importMdInput' : '#importInput').click();
      return;
    }
    const button = event.target.closest('[data-new-kind]');
    if (!button) return;
    newMenu.hidden = true;
    newArticle({ kind: button.dataset.newKind });
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.new-article-wrap')) newMenu.hidden = true;
  });
  $('#btnImport').addEventListener('click', () => $('#importInput').click());
  $('#btnImportMd').addEventListener('click', () => $('#importMdInput').click());
  const onImportFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const input = event.target;
    input.disabled = true;
    try {
      if (file.size > 30 * 1024 * 1024) throw new Error('导入文档不能超过 30MB');
      const extension = file.name.split('.').pop()?.toLowerCase() || '';
      let markdown = '';
      let conversion = null;
      if (extension === 'docx') {
        toast('正在解析 Word 文档与内嵌图片…', 'default', 5000);
        conversion = await docxToMarkdown(file, { uploadImage: uploadEmbeddedImage });
        markdown = conversion.markdown;
      } else if (['html', 'htm'].includes(extension)) {
        conversion = await htmlToMarkdown(await file.text(), { uploadImage: uploadEmbeddedImage });
        markdown = conversion.markdown;
      } else if (['md', 'markdown', 'txt'].includes(extension)) {
        markdown = await file.text();
      } else {
        throw new Error('支持 DOCX、HTML、Markdown 和 TXT 文件');
      }
      if (!markdown.trim()) throw new Error('没有识别到可导入的正文');
      if (conversion?.embedded) renderAssets();
      await newArticle({
        title: file.name.replace(/\.(docx|html?|md|markdown|txt)$/i, ''),
        markdown,
      });
      const detail = conversion ? conversionMessage(conversion, '导入') : '';
      if (detail) toast(detail, conversion.failed ? 'default' : 'success', 5200);
      if (conversion?.warnings?.length) toast(`${conversion.warnings.length} 项 Word 复杂格式已简化`, 'default', 4500);
    } catch (err) {
      toast(`导入失败：${err.message}`, 'error', 5500);
    } finally {
      input.value = '';
      input.disabled = false;
    }
  };
  $('#importInput').addEventListener('change', onImportFileChange);
  $('#importMdInput').addEventListener('change', onImportFileChange);
  $('#btnExportMd').addEventListener('click', exportMarkdown);
  $('#btnExportHtml').addEventListener('click', exportHtml);
  $('#btnCopyHtml').addEventListener('click', copyHtmlSource);

  // help
  $('#btnHelp').addEventListener('click', showHelp);

  // keyboard
  document.addEventListener('keydown', (event) => {
    const meta = event.metaKey || event.ctrlKey;
    if (!meta) return;
    const key = event.key.toLowerCase();
    if (key === 's') {
      event.preventDefault();
      saveNow();
      return;
    }
    if (document.activeElement !== $('#editor')) return;
    if (key === 'b') {
      event.preventDefault();
      wrapSelection('**', '**');
    } else if (key === 'i') {
      event.preventDefault();
      wrapSelection('*', '*');
    } else if (key === 'k') {
      event.preventDefault();
      handleAction('link');
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.current) saveNow();
  });
}

async function newArticle(overrides = {}) {
  await saveNow();
  const kind = overrides.kind === 'pic' ? 'pic' : 'article';
  try {
    const res = await api.createArticle({
      kind,
      title: overrides.title || (kind === 'pic' ? '未命名贴图' : '未命名文章'),
      markdown: kind === 'pic' ? '' : overrides.markdown || '',
      themeId: state.current?.themeId || 'paper',
      options: state.current?.options || { fontSize: 16, lineHeight: 1.9, accent: '' },
      author: state.current?.author || state.settings.author || '',
      images: kind === 'pic' ? [] : undefined,
      copy: kind === 'pic' ? '' : undefined,
    });
    state.articles.unshift(res.article);
    setCurrent(res.article);
    if (!overrides.markdown) {
      $('#titleInput').focus();
      $('#titleInput').select();
    }
    toast(overrides.markdown ? '文章已导入' : kind === 'pic' ? '已新建贴图' : '已新建文章', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteArticle(id) {
  const article = state.articles.find((item) => item.id === id);
  if (!article) return;
  const ok = await confirmDialog({
    title: '删除这篇文章？',
    message: `「${article.title || '未命名文章'}」会从本机删除，操作不可撤销。`,
    confirmText: '删除',
    danger: true,
  });
  if (!ok) return;
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  try {
    await api.deleteArticle(id);
    state.articles = state.articles.filter((item) => item.id !== id);
    if (state.current?.id === id) {
      const visible = visibleArticles();
      if (visible.length) {
        setCurrent(visible[0]);
      } else {
        await newArticle({ kind: article.kind });
      }
    } else {
      renderArticleList();
    }
    toast('文章已删除', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}
