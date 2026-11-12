import { getTheme } from './themes.js';
import { hasGlyph, renderGlyph, parseGlyphOptions, resolveGlyphColor } from './glyphs.js';

/* ------------------------------- color utils ------------------------------ */

function parseHex(hex) {
  let value = String(hex || '').trim().replace('#', '');
  if (value.length === 3) value = value.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(value)) value = 'b5432a';
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

export function rgba(hex, alpha) {
  const { r, g, b } = parseHex(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function mix(hex, targetHex, amount) {
  const a = parseHex(hex);
  const b = parseHex(targetHex);
  const to = (x, y) => Math.round(x + (y - x) * amount);
  return (
    '#' +
    [to(a.r, b.r), to(a.g, b.g), to(a.b, b.b)]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('')
  );
}

function luminance(hex) {
  const { r, g, b } = parseHex(hex);
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function readableAccent(accent, bg) {
  return luminance(bg) < 0.4 ? mix(accent, '#ffffff', 0.18) : mix(accent, '#000000', 0.2);
}

/* --------------------------------- helpers -------------------------------- */

function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeUrl(url) {
  const value = String(url || '').trim().replace(/^<|>$/g, '');
  if (/^(https?:\/\/|\/|#|mailto:|tel:)/i.test(value)) return value.replace(/["'\s]/g, encodeURIComponent);
  return '#';
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createContext(theme, options = {}) {
  const fontSize = clamp(Number(options.fontSize) || 16, 13, 22);
  const lineHeight = clamp(Number(options.lineHeight) || 1.9, 1.4, 2.3);
  const accent = /^#[0-9a-f]{6}$/i.test(options.accent || '') ? options.accent : theme.accent;
  const isDark = luminance(theme.bg) < 0.4;
  return {
    theme,
    fs: fontSize,
    lh: lineHeight,
    accent,
    accentCustom: /^#[0-9a-f]{6}$/i.test(options.accent || ''),
    isDark,
    accentText: readableAccent(accent, theme.bg),
    gap: Math.round(fontSize * 1.35),
    tint: (alpha) => rgba(accent, alpha),
  };
}

function replaceImportedAccent(style, ctx) {
  if (!ctx.accentCustom || !ctx.theme.sourceAccent) return style;
  const source = ctx.theme.sourceAccent;
  let out = style.replace(new RegExp(source, 'gi'), ctx.accent);
  const { r, g, b } = parseHex(source);
  const rgbaPattern = new RegExp(`rgba?\\(\\s*${r}\\s*,\\s*${g}\\s*,\\s*${b}\\s*(,\\s*([\\d.]+)\\s*)?\\)`, 'gi');
  out = out.replace(rgbaPattern, (match, alphaPart, alpha) =>
    alpha == null ? ctx.accent : rgba(ctx.accent, alpha)
  );
  return out;
}

function importedStyle(ctx, key, extra = '') {
  const theme = ctx.theme;
  let style = theme.styles?.[key] || '';
  style = replaceImportedAccent(style, ctx);
  const fontDelta = ctx.fs - (theme.baseFontSize || 16);
  const baseLineHeight = theme.baseLineHeight || 1.9;
  style = style.replace(/font-size\s*:\s*([\d.]+)px/gi, (match, value) => {
    const size = clamp(Number(value) + fontDelta, 11, 48);
    return `font-size:${Math.round(size * 10) / 10}px`;
  });
  style = style.replace(/line-height\s*:\s*([\d.]+)(?=\s*(?:!important|;|$))/gi, (match, value) => {
    const next = clamp((Number(value) / baseLineHeight) * ctx.lh, 1.15, 3.2);
    return `line-height:${Math.round(next * 100) / 100}`;
  });
  let accentOverride = '';
  if (ctx.accentCustom) {
    if (['a', 'strong'].includes(key)) accentOverride += `color:${ctx.accentText} !important;`;
    if (['a', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'th', 'td'].includes(key) && /border/i.test(style)) {
      accentOverride += `border-color:${ctx.accent} !important;`;
    }
  }
  return escapeHtml(`${style};${accentOverride};${extra}`);
}

/* ------------------------------- inline parse ------------------------------ */

function inline(text, ctx, alreadyEscaped = false) {
  let out = alreadyEscaped ? String(text) : escapeHtml(text);
  out = out.replace(/\u0000/g, '');
  const stashed = [];
  const keep = (html) => `\u0000${stashed.push(html) - 1}\u0000`;
  const theme = ctx.theme;

  out = out.replace(/`([^`]+)`/g, (m, code) => {
    const style = theme.imported
      ? importedStyle(ctx, 'code')
      : `font-family:Menlo,Consolas,monospace;font-size:0.9em;background-color:${ctx.tint(0.1)};color:${ctx.accentText};padding:1px 5px;border-radius:4px;`;
    return keep(`<code style="${style}">${code}</code>`);
  });

  out = out.replace(/!\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (m, alt, src) =>
    keep(
      `<img src="${safeUrl(src)}" alt="${alt}" style="display:inline-block;max-width:100%;height:auto;vertical-align:middle;border-radius:${theme.radius}px;">`
    )
  );

  out = out.replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (m, label, url) => {
    const style = theme.imported
      ? importedStyle(ctx, 'a')
      : `color:${ctx.accentText};text-decoration:none;border-bottom:1px solid ${rgba(ctx.accent, 0.4)};`;
    return keep(`<a href="${safeUrl(url)}" style="${style}">${inline(label, ctx, true)}</a>`);
  });

  // 行内图标 `:star:` / `:star{28,circle,#1d4ed8}:`
  // 放在链接之后，避免把 URL 里的冒号误判成图标
  out = out.replace(/:([a-zA-Z][a-zA-Z0-9-]{0,24})(?:\{([^{}]*)\})?:/g, (match, name, rawOptions) => {
    if (!hasGlyph(name)) return match;
    const options = parseGlyphOptions(rawOptions);
    return keep(renderGlyph(name, {
      size: Math.round(ctx.fs * 1.05),
      shape: 'none',
      tint: 12,
      weight: 500,
      gap: 0,
      align: 'middle',
      opacity: 100,
      ...options,
      color: resolveGlyphColor(options.color || 'accent', glyphPalette(ctx)),
    }));
  });

  out = out.replace(/\*\*([^*]+)\*\*/g, (m, inner) =>
    keep(`<strong style="${strongStyle(ctx)}">${inline(inner, ctx, true)}</strong>`)
  );

  out = out.replace(/==([^=]+)==/g, (m, inner) =>
    keep(
      `<span style="background-color:${ctx.tint(0.18)};padding:0 2px;border-radius:2px;">${inline(inner, ctx, true)}</span>`
    )
  );

  out = out.replace(/~~([^~]+)~~/g, (m, inner) =>
    keep(`<del style="color:${theme.muted};">${inline(inner, ctx, true)}</del>`)
  );

  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, (m, pre, inner) => {
    const style = theme.imported ? importedStyle(ctx, 'em') : 'font-style:italic;';
    return pre + keep(`<em style="${style}">${inline(inner, ctx, true)}</em>`);
  });

  for (let round = 0; round < 6; round += 1) {
    const next = out.replace(/\u0000(\d+)\u0000/g, (m, index) => stashed[Number(index)] || '');
    if (next === out) break;
    out = next;
  }
  return out;
}

function strongStyle(ctx) {
  const theme = ctx.theme;
  if (theme.imported) return importedStyle(ctx, 'strong');
  switch (theme.strong) {
    case 'color':
      return `color:${ctx.accentText};font-weight:600;`;
    case 'underline':
      return `font-weight:700;border-bottom:2px solid ${ctx.accent};padding-bottom:1px;`;
    case 'highlight':
      return `font-weight:600;color:${ctx.accentText};background-color:${ctx.tint(0.14)};padding:0 3px;border-radius:3px;`;
    case 'editorial':
      return `font-weight:700;border-bottom:2px solid ${ctx.accent};`;
    default:
      return 'font-weight:600;';
  }
}

/* --------------------------------- blocks --------------------------------- */

function parseBlocks(source) {
  const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (/^```/.test(line)) {
      const lang = line.replace(/^```/, '').trim();
      i += 1;
      const buf = [];
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ type: 'code', lang, text: buf.join('\n') });
      continue;
    }

    const callout = line.match(/^:::\s*([a-zA-Z]+)?\s*(.*)$/);
    if (callout && !/^:::\s*$/.test(line)) {
      const kind = (callout[1] || 'note').toLowerCase();
      const title = callout[2] || '';
      i += 1;
      const buf = [];
      while (i < lines.length) {
        if (/^:::\s*$/.test(lines[i])) {
          i += 1;
          break;
        }
        // 未闭合的提示块遇到标题时自动收尾，避免吞掉后文
        if (/^#{1,6}[ \t]+/.test(lines[i])) break;
        buf.push(lines[i]);
        i += 1;
      }
      blocks.push({ type: 'callout', kind, title, text: buf.join('\n') });
      continue;
    }

    const heading = line.match(/^(#{1,6})[ \t]+(.+)$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() });
      i += 1;
      continue;
    }

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      blocks.push({ type: 'quote', lines: buf });
      continue;
    }

    const image = line.match(/^!\[([^\]]*)\]\(\s*((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\s*\)\s*$/);
    if (image) {
      blocks.push({ type: 'image', alt: image[1], src: image[2] });
      i += 1;
      continue;
    }

    if (startsTable(lines, i)) {
      blocks.push(parseTable(lines, i));
      i = blocks[blocks.length - 1].next;
      delete blocks[blocks.length - 1].next;
      continue;
    }

    const listItem = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
    if (listItem) {
      const ordered = /^\d/.test(listItem[1]);
      const start = ordered ? parseInt(listItem[1], 10) || 1 : 1;
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
        if (!m) break;
        items.push(m[2]);
        i += 1;
      }
      blocks.push({ type: 'list', ordered, start, items });
      continue;
    }

    const buf = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i], lines, i)) {
      buf.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: 'paragraph', lines: buf });
  }

  return blocks;
}

function isBlockStart(line, lines, index) {
  if (/^```/.test(line)) return true;
  if (/^:::\s*\S+/.test(line)) return true;
  if (/^(#{1,6})[ \t]+/.test(line)) return true;
  if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) return true;
  if (/^\s*>\s?/.test(line)) return true;
  if (/^!\[[^\]]*\]\(\s*[^)\s]+(?:\s+"[^"]*")?\s*\)\s*$/.test(line)) return true;
  if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) return true;
  if (startsTable(lines, index)) return true;
  return false;
}

function isTableSeparator(line) {
  if (!line || !line.includes('-') || !line.includes('|')) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell.replace(/\s/g, '')));
}

function startsTable(lines, index) {
  if (index + 1 >= lines.length) return false;
  if (!lines[index].includes('|')) return false;
  return isTableSeparator(lines[index + 1]);
}

function splitRow(line) {
  let value = line.trim();
  if (value.startsWith('|')) value = value.slice(1);
  if (value.endsWith('|')) value = value.slice(0, -1);
  return value.split('|').map((cell) => cell.trim());
}

function parseTable(lines, index) {
  const header = splitRow(lines[index]);
  const aligns = splitRow(lines[index + 1]).map((cell) => {
    const value = cell.replace(/\s/g, '');
    if (value.startsWith(':') && value.endsWith(':')) return 'center';
    if (value.endsWith(':')) return 'right';
    return 'left';
  });
  let i = index + 2;
  const rows = [];
  while (i < lines.length && lines[i].trim() && lines[i].includes('|') && !isTableSeparator(lines[i])) {
    rows.push(splitRow(lines[i]));
    i += 1;
  }
  return { type: 'table', header, rows, aligns, next: i };
}

/* -------------------------------- rendering ------------------------------- */

function renderH2(text, ctx, size) {
  const theme = ctx.theme;
  const top = Math.round(ctx.fs * 2.15);
  const bottom = Math.round(ctx.fs * 0.8);
  const base = `margin:${top}px 0 ${bottom}px;font-family:${escapeHtml(theme.headingFont)};font-size:${size}px;line-height:1.5;font-weight:700;color:${theme.heading};`;

  switch (theme.h2) {
    case 'centerline':
      return `<h2 style="${base}padding:12px 0;border-top:1px solid ${theme.line};border-bottom:1px solid ${theme.line};text-align:center;letter-spacing:0.16em;">${text}</h2>`;
    case 'block':
      return `<h2 style="margin:${top}px 0 ${bottom}px;padding:10px 14px;background-color:${ctx.tint(0.075)};border-left:4px solid ${ctx.accent};border-radius:${theme.radius}px;font-family:${escapeHtml(theme.headingFont)};font-size:${size}px;line-height:1.5;font-weight:700;color:${theme.heading};">${text}</h2>`;
    case 'pill':
      return `<h2 style="${base}"><span style="display:inline-block;padding:5px 14px;background-color:${ctx.tint(0.1)};border-radius:999px;color:${ctx.accentText};font-size:${size}px;font-weight:700;letter-spacing:0.03em;">${text}</span></h2>`;
    case 'bar':
      return `<h2 style="${base}padding-left:12px;border-left:3px solid ${ctx.accent};">${text}</h2>`;
    case 'rule':
      return `<h2 style="${base}padding-top:14px;border-top:2px solid ${theme.heading};font-size:${size}px;line-height:1.35;letter-spacing:0.01em;">${text}</h2>`;
    case 'underline':
    default:
      return `<h2 style="${base}"><span style="display:inline-block;padding-bottom:5px;border-bottom:3px solid ${ctx.accent};">${text}</span></h2>`;
  }
}

function renderH3(text, ctx, size) {
  const theme = ctx.theme;
  const top = Math.round(ctx.fs * 1.7);
  const bottom = Math.round(ctx.fs * 0.65);
  const base = `margin:${top}px 0 ${bottom}px;font-family:${escapeHtml(theme.headingFont)};font-size:${size}px;line-height:1.6;font-weight:700;color:${theme.heading};`;

  switch (theme.h3) {
    case 'dot':
      return `<h3 style="${base}"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background-color:${ctx.accent};margin-right:9px;vertical-align:middle;"></span>${text}</h3>`;
    case 'bar':
      return `<h3 style="${base}padding-left:10px;border-left:3px solid ${ctx.accent};color:${ctx.accentText};">${text}</h3>`;
    case 'kicker':
      return `<h3 style="${base}font-size:${ctx.fs}px;letter-spacing:0.14em;color:${theme.heading};"><span style="color:${ctx.accent};margin-right:8px;">—</span>${text}</h3>`;
    case 'square':
    default:
      return `<h3 style="${base}"><span style="display:inline-block;width:8px;height:8px;background-color:${ctx.accent};margin-right:9px;vertical-align:middle;"></span>${text}</h3>`;
  }
}

function renderQuote(lines, ctx) {
  const theme = ctx.theme;
  const html = lines.map((line) => inline(line, ctx)).join('<br>');
  if (theme.imported) return `<blockquote style="${importedStyle(ctx, 'blockquote')}">${html}</blockquote>`;
  const top = Math.round(ctx.fs * 1.4);
  const bottom = Math.round(ctx.fs * 1.4);
  const common = `margin:${top}px 0 ${bottom}px;font-size:${ctx.fs}px;line-height:${ctx.lh};color:${theme.quoteText};border:none;`;

  switch (theme.quote) {
    case 'line':
      return `<blockquote style="${common}padding:2px 0 2px 16px;border-left:2px solid ${ctx.accent};background:none;">${html}</blockquote>`;
    case 'card':
      return `<blockquote style="${common}padding:15px 17px;background-color:${ctx.tint(0.045)};border:1px solid ${ctx.tint(0.14)};border-radius:${theme.radius}px;">${html}</blockquote>`;
    case 'dark':
      return `<blockquote style="${common}padding:14px 16px;background-color:${ctx.tint(0.07)};border-left:3px solid ${ctx.accent};border-radius:0 ${theme.radius}px ${theme.radius}px 0;">${html}</blockquote>`;
    case 'dashed':
      return `<blockquote style="${common}padding:14px 16px;background-color:${ctx.tint(0.05)};border:1px dashed ${ctx.tint(0.35)};border-radius:${theme.radius}px;">${html}</blockquote>`;
    case 'serif':
      return `<section style="margin:${top}px 0 ${bottom}px;color:${theme.quoteText};font-family:${escapeHtml(theme.headingFont)};font-size:${ctx.fs + 1}px;line-height:1.75;"><span style="display:block;font-family:Georgia,serif;font-size:38px;line-height:1;color:${ctx.accent};">“</span><span style="display:block;margin-top:-6px;">${html}</span></section>`;
    case 'soft':
    default:
      return `<blockquote style="${common}padding:15px 17px;background-color:${ctx.tint(0.055)};border-radius:${theme.radius}px;">${html}</blockquote>`;
  }
}

function componentLines(block) {
  return block.text.split('\n').map((line) => line.trim()).filter(Boolean);
}

/* ----------------------------- 图标类组件 ------------------------------- */

function glyphPalette(ctx) {
  const theme = ctx.theme;
  return { accent: ctx.accent, text: theme.text, muted: theme.muted, heading: theme.heading, line: theme.line };
}

// 组件里画图标：默认圆形底座 + 主题强调色，尺寸随正文字号
function componentGlyph(name, ctx, overrides = {}) {
  const id = hasGlyph(name) ? String(name).trim().toLowerCase() : 'dot';
  return renderGlyph(id, {
    size: ctx.fs + 2,
    color: ctx.accent,
    shape: 'circle',
    tint: 11,
    weight: 500,
    gap: 0,
    align: 'middle',
    opacity: 100,
    ...overrides,
  });
}

function componentFields(line) {
  return String(line || '')
    .replace(/^(?:\d+[.)]|[-*+])\s+/, '')
    .split('|')
    .map((part) => part.trim());
}

// 「图标名 | 标题 | 说明」；首段不是图标名时整行按「标题 | 说明」解析
function iconRow(line, fallbackIcon = 'dot') {
  const fields = componentFields(line);
  if (hasGlyph(fields[0])) {
    return { icon: fields[0].toLowerCase(), title: fields[1] || '', desc: fields.slice(2).join(' | ') };
  }
  return { icon: fallbackIcon, title: fields[0] || '', desc: fields.slice(1).join(' | ') };
}

function semanticPair(ctx) {
  return ctx.isDark
    ? { good: '#7ddba6', bad: '#f0a3a3' }
    : { good: '#3f7d52', bad: '#c2410c' };
}

function renderTimeline(block, ctx, lines, top) {
  const theme = ctx.theme;
  const items = lines.map((line) => {
    const fields = componentFields(line);
    if (fields.length >= 3) return { time: fields[0], title: fields[1], desc: fields.slice(2).join(' | ') };
    if (fields.length === 2) return { time: '', title: fields[0], desc: fields[1] };
    return { time: '', title: fields[0] || '', desc: '' };
  }).filter((item) => item.title || item.desc);

  const rows = items.map((item, index) => {
    const last = index === items.length - 1;
    const rail = `<section style="flex-shrink:0;width:13px;display:flex;flex-direction:column;align-items:center;"><span style="flex-shrink:0;width:11px;height:11px;margin-top:${Math.round(ctx.fs * 0.45)}px;border-radius:50%;background-color:${theme.bg};border:2px solid ${ctx.accent};box-sizing:border-box;"></span><span style="flex:1;width:2px;margin-top:4px;background-color:${last ? 'transparent' : ctx.tint(0.24)};"></span></section>`;
    const badge = item.time
      ? `<section style="display:inline-block;margin-bottom:5px;padding:2px 9px;border-radius:999px;background-color:${ctx.tint(0.1)};color:${ctx.accentText};font-size:${Math.max(10, ctx.fs - 4)}px;line-height:1.6;font-weight:700;letter-spacing:0.06em;">${inline(item.time, ctx)}</section>`
      : '';
    const body = `<section style="flex:1;min-width:0;padding:0 0 ${last ? 0 : Math.round(ctx.fs * 1.15)}px 13px;">${badge}<section style="font-size:${ctx.fs}px;line-height:1.6;font-weight:700;color:${theme.heading};">${inline(item.title, ctx)}</section>${item.desc ? `<section style="margin-top:4px;font-size:${ctx.fs - 2}px;line-height:1.8;color:${theme.muted};">${inline(item.desc, ctx)}</section>` : ''}</section>`;
    return `<section style="display:flex;align-items:stretch;">${rail}${body}</section>`;
  }).join('');

  return `<section style="margin:${top}px 0;">${componentHeading(block.title, ctx)}${rows}</section>`;
}

function renderIconList(block, ctx, lines, top) {
  const theme = ctx.theme;
  const rows = lines.map((line, index) => {
    const item = iconRow(line);
    return `<section style="display:flex;align-items:flex-start;${index ? `margin-top:${Math.round(ctx.fs * 0.9)}px;` : ''}">${componentGlyph(item.icon, ctx, { size: ctx.fs + 4 })}<section style="flex:1;min-width:0;margin-left:11px;"><section style="font-size:${ctx.fs}px;line-height:1.6;font-weight:700;color:${theme.heading};">${inline(item.title, ctx)}</section>${item.desc ? `<section style="margin-top:3px;font-size:${ctx.fs - 2}px;line-height:1.8;color:${theme.muted};">${inline(item.desc, ctx)}</section>` : ''}</section></section>`;
  }).join('');
  return `<section style="margin:${top}px 0;">${componentHeading(block.title, ctx)}${rows}</section>`;
}

function renderIconGrid(block, ctx, lines, top) {
  const theme = ctx.theme;
  const items = lines.map((line) => iconRow(line, 'sparkle')).filter((item) => item.title);
  const cols = items.length <= 3 ? Math.max(1, items.length) : items.length === 4 ? 2 : 3;
  const cells = items.map((item) => `<section style="width:${Math.round(10000 / cols) / 100}%;box-sizing:border-box;padding:4px;"><section style="height:100%;box-sizing:border-box;padding:14px 10px;text-align:center;background-color:${ctx.tint(0.045)};border:1px solid ${ctx.tint(0.14)};border-radius:${theme.radius}px;">${componentGlyph(item.icon, ctx, { size: ctx.fs + 6, tint: 12 })}<section style="margin-top:9px;font-size:${ctx.fs - 1}px;line-height:1.55;font-weight:700;color:${theme.heading};">${inline(item.title, ctx)}</section>${item.desc ? `<section style="margin-top:5px;font-size:${Math.max(10, ctx.fs - 3)}px;line-height:1.7;color:${theme.muted};">${inline(item.desc, ctx)}</section>` : ''}</section></section>`).join('');
  return `<section style="margin:${top}px 0;">${block.title ? `<section style="margin-bottom:9px;text-align:center;font-size:${ctx.fs}px;line-height:1.6;font-weight:700;color:${theme.heading};">${inline(block.title, ctx)}</section>` : ''}<section style="display:flex;flex-wrap:wrap;align-items:stretch;">${cells}</section></section>`;
}

function renderFlow(block, ctx, lines, top) {
  const theme = ctx.theme;
  const items = lines.map((line) => iconRow(line, 'caret')).filter((item) => item.title);
  const arrow = renderGlyph('right', { size: ctx.fs - 1, color: ctx.accent, shape: 'none', gap: 0, align: 'middle' });
  const chips = items.map((item, index) => {
    const chip = `<span style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;background-color:${ctx.tint(0.07)};border:1px solid ${ctx.tint(0.17)};border-radius:999px;font-size:${ctx.fs - 2}px;line-height:1.6;font-weight:600;color:${theme.heading};">${componentGlyph(item.icon, ctx, { size: ctx.fs - 2, shape: 'none' })}${inline(item.title, ctx)}</span>`;
    return index ? `${arrow}${chip}` : chip;
  }).join('');
  return `<section style="margin:${top}px 0;">${componentHeading(block.title, ctx)}<section style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;">${chips}</section></section>`;
}

function renderChecklist(block, ctx, lines, top) {
  const theme = ctx.theme;
  const pair = semanticPair(ctx);
  const rows = lines.map((line, index) => {
    const fields = componentFields(line);
    let state = 'todo';
    let text = fields.join(' | ');
    if (/^(?:v|y|yes|done|1|✓)$/i.test(fields[0])) {
      state = 'done';
      text = fields.slice(1).join(' | ');
    } else if (/^(?:x|n|no|✕|✗)$/i.test(fields[0])) {
      state = 'no';
      text = fields.slice(1).join(' | ');
    } else if (/^(?:o|todo|0)$/i.test(fields[0])) {
      text = fields.slice(1).join(' | ');
    }
    const mark = state === 'done'
      ? componentGlyph('check-circle', ctx, { size: ctx.fs, shape: 'none', color: ctx.accent, weight: 600 })
      : state === 'no'
        ? componentGlyph('cross', ctx, { size: ctx.fs, shape: 'none', color: pair.bad, weight: 600 })
        : componentGlyph('ring', ctx, { size: ctx.fs, shape: 'none', color: theme.muted });
    const textStyle = state === 'no' ? `color:${theme.muted};text-decoration:line-through;` : `color:${theme.text};`;
    return `<section style="display:flex;align-items:flex-start;${index ? `margin-top:${Math.round(ctx.fs * 0.6)}px;` : ''}">${mark}<span style="flex:1;min-width:0;margin-left:10px;font-size:${ctx.fs - 1}px;line-height:1.75;${textStyle}">${inline(text, ctx)}</span></section>`;
  }).join('');
  return `<section style="margin:${top}px 0;padding:16px 17px;border:1px solid ${theme.line};border-radius:${theme.radius}px;background-color:${ctx.tint(0.025)};">${componentHeading(block.title || '检查清单', ctx)}${rows}</section>`;
}

function renderTags(block, ctx, lines, top) {
  const chips = lines.map((line) => {
    const item = iconRow(line, '');
    const icon = item.icon ? componentGlyph(item.icon, ctx, { size: ctx.fs - 3, shape: 'none' }) : '';
    return `<span style="display:inline-flex;align-items:center;gap:5px;margin:0 7px 7px 0;padding:5px 11px;background-color:${ctx.tint(0.08)};border:1px solid ${ctx.tint(0.18)};border-radius:999px;font-size:${Math.max(10, ctx.fs - 3)}px;line-height:1.6;color:${ctx.accentText};">${icon}${inline(item.title, ctx)}</span>`;
  }).join('');
  return `<section style="margin:${top}px 0;">${componentHeading(block.title, ctx)}<section style="display:flex;flex-wrap:wrap;align-items:center;">${chips}</section></section>`;
}

function renderMeta(block, ctx, lines, top) {
  const theme = ctx.theme;
  const rows = lines.map((line, index) => {
    const item = iconRow(line, 'dot');
    return `<section style="display:flex;align-items:flex-start;${index ? `margin-top:${Math.round(ctx.fs * 0.7)}px;` : ''}">${componentGlyph(item.icon, ctx, { size: ctx.fs, shape: 'none' })}<span style="flex-shrink:0;width:${Math.round(ctx.fs * 3.6)}px;margin-left:9px;font-size:${ctx.fs - 2}px;line-height:1.75;color:${theme.muted};">${inline(item.title, ctx)}</span><span style="flex:1;min-width:0;font-size:${ctx.fs - 1}px;line-height:1.75;color:${theme.text};">${inline(item.desc, ctx)}</span></section>`;
  }).join('');
  return `<section style="margin:${top}px 0;padding:15px 17px;background-color:${ctx.tint(0.05)};border-left:3px solid ${ctx.accent};border-radius:0 ${theme.radius}px ${theme.radius}px 0;">${componentHeading(block.title, ctx)}${rows}</section>`;
}

function renderVersus(block, ctx, lines, top) {
  const theme = ctx.theme;
  const pair = semanticPair(ctx);
  const good = [];
  const bad = [];
  lines.forEach((line) => {
    const fields = componentFields(line);
    if (/^(?:x|n|no|✕|✗)$/i.test(fields[0])) bad.push(fields.slice(1).join(' | '));
    else if (/^(?:v|y|yes|done|1|✓)$/i.test(fields[0])) good.push(fields.slice(1).join(' | '));
    else good.push(fields.join(' | '));
  });
  const column = (items, kind) => {
    const color = kind === 'good' ? pair.good : pair.bad;
    const head = kind === 'good' ? '推荐' : '避免';
    const mark = componentGlyph(kind === 'good' ? 'check' : 'cross', ctx, { size: ctx.fs - 2, shape: 'none', color, weight: 700 });
    const rows = items.map((text, index) => `<section style="display:flex;align-items:flex-start;${index ? 'margin-top:8px;' : ''}">${mark}<span style="flex:1;min-width:0;margin-left:8px;font-size:${ctx.fs - 2}px;line-height:1.7;color:${theme.text};">${inline(text, ctx)}</span></section>`).join('');
    return `<section style="flex:1;min-width:0;box-sizing:border-box;padding:13px 14px;background-color:${rgba(color, 0.06)};border:1px solid ${rgba(color, 0.18)};border-radius:${theme.radius}px;"><section style="margin-bottom:9px;font-size:${Math.max(10, ctx.fs - 3)}px;line-height:1.5;font-weight:700;letter-spacing:0.14em;color:${color};">${head}</section>${rows || `<section style="font-size:${ctx.fs - 2}px;line-height:1.7;color:${theme.muted};">—</section>`}</section>`;
  };
  return `<section style="margin:${top}px 0;">${block.title ? `<section style="margin-bottom:10px;text-align:center;font-size:${ctx.fs}px;line-height:1.6;font-weight:700;color:${theme.heading};">${inline(block.title, ctx)}</section>` : ''}<section style="display:flex;align-items:stretch;gap:10px;">${column(good, 'good')}${column(bad, 'bad')}</section></section>`;
}

function renderIconTitle(block, ctx, lines, top) {
  const theme = ctx.theme;
  const item = iconRow(block.title || '', 'sparkle');
  const content = lines.map((line) => inline(line, ctx)).join('<br>');
  const desc = item.desc || content;
  return `<section style="margin:${top}px 0 ${Math.round(ctx.fs * 0.8)}px;"><section style="display:flex;align-items:center;">${componentGlyph(item.icon, ctx, { size: ctx.fs + 2, shape: 'square', tint: 12 })}<section style="flex:1;min-width:0;margin-left:11px;font-family:${escapeHtml(theme.headingFont)};font-size:${ctx.fs + 2}px;line-height:1.5;font-weight:700;color:${theme.heading};">${inline(item.title || '小标题', ctx)}</section></section>${desc ? `<section style="margin-top:8px;font-size:${ctx.fs - 1}px;line-height:${ctx.lh};color:${theme.muted};">${inline(item.desc, ctx)}${item.desc && content ? '<br>' : ''}${content}</section>` : ''}</section>`;
}

function renderIconDivider(block, ctx, top) {
  const theme = ctx.theme;
  const title = String(block.title || '').trim();
  const middle = hasGlyph(title)
    ? renderGlyph(title.toLowerCase(), { size: ctx.fs + 2, color: ctx.accent, shape: 'none', gap: 0, align: 'middle' })
    : `<span style="font-size:12px;line-height:1.5;letter-spacing:0.18em;color:${ctx.accentText};">${inline(title || '✦', ctx)}</span>`;
  return `<section style="margin:${Math.round(top * 1.4)}px 0;display:flex;align-items:center;gap:12px;"><span style="flex:1;height:1px;background-color:${theme.line};"></span>${middle}<span style="flex:1;height:1px;background-color:${theme.line};"></span></section>`;
}

function renderScore(block, ctx, lines, top) {
  const theme = ctx.theme;
  const rows = lines.map((line, index) => {
    const fields = componentFields(line);
    const label = fields[0] || '';
    const raw = Number(String(fields[1] || '').replace(/[^\d.]/g, ''));
    const value = Number.isFinite(raw) ? Math.min(5, Math.max(0, raw)) : 0;
    const filled = Math.round(value);
    const stars = `<span style="color:${ctx.accent};">${'★'.repeat(filled)}</span><span style="color:${theme.line};">${'☆'.repeat(5 - filled)}</span>`;
    return `<section style="display:flex;align-items:center;${index ? `margin-top:${Math.round(ctx.fs * 0.55)}px;` : ''}"><span style="flex:1;min-width:0;font-size:${ctx.fs - 1}px;line-height:1.7;color:${theme.text};">${inline(label, ctx)}</span><span style="flex-shrink:0;margin:0 10px;font-size:${ctx.fs - 1}px;line-height:1;letter-spacing:3px;">${stars}</span><span style="flex-shrink:0;width:30px;text-align:right;font-size:${ctx.fs - 2}px;line-height:1.7;font-weight:700;color:${ctx.accentText};">${value.toFixed(1)}</span></section>`;
  }).join('');
  return `<section style="margin:${top}px 0;">${componentHeading(block.title, ctx)}${rows}</section>`;
}

function renderIconComponent(block, ctx) {
  const lines = componentLines(block);
  const top = Math.round(ctx.fs * 1.45);
  switch (block.kind) {
    case 'timeline':
      return renderTimeline(block, ctx, lines, top);
    case 'iconlist':
      return renderIconList(block, ctx, lines, top);
    case 'icongrid':
      return renderIconGrid(block, ctx, lines, top);
    case 'flow':
      return renderFlow(block, ctx, lines, top);
    case 'checklist':
      return renderChecklist(block, ctx, lines, top);
    case 'tags':
      return renderTags(block, ctx, lines, top);
    case 'meta':
      return renderMeta(block, ctx, lines, top);
    case 'versus':
      return renderVersus(block, ctx, lines, top);
    case 'icontitle':
      return renderIconTitle(block, ctx, lines, top);
    case 'icondivider':
      return renderIconDivider(block, ctx, top);
    case 'score':
      return renderScore(block, ctx, lines, top);
    default:
      return '';
  }
}

function componentHeading(title, ctx) {
  if (!title) return '';
  return `<section style="margin:0 0 10px;font-size:${ctx.fs + 1}px;line-height:1.5;font-weight:700;color:${ctx.theme.heading};">${inline(title, ctx)}</section>`;
}

function renderCallout(block, ctx) {
  const iconComponent = renderIconComponent(block, ctx);
  if (iconComponent) return iconComponent;
  const theme = ctx.theme;
  const top = Math.round(ctx.fs * 1.45);
  const lines = componentLines(block);
  const content = lines.map((line) => inline(line, ctx)).join('<br>');
  const title = block.title || '';

  if (block.kind === 'title') {
    return `<section style="margin:${top * 1.5}px 0 ${top}px;text-align:center;"><section style="font-size:10px;line-height:1.5;letter-spacing:0.28em;color:${ctx.accentText};">CHAPTER</section><h2 style="margin:7px 0 0;font-family:${escapeHtml(theme.headingFont)};font-size:${ctx.fs + 7}px;line-height:1.45;color:${theme.heading};">${inline(title || '章节标题', ctx)}</h2><section style="width:30px;height:3px;margin:13px auto 0;background-color:${ctx.accent};"></section>${content ? `<section style="margin-top:12px;font-size:${ctx.fs - 2}px;line-height:1.8;color:${theme.muted};">${content}</section>` : ''}</section>`;
  }

  if (block.kind === 'kicker') {
    return `<section style="margin:${top}px 0;padding:0 0 0 16px;border-left:3px solid ${ctx.accent};"><section style="font-size:10px;line-height:1.5;letter-spacing:0.2em;color:${ctx.accentText};margin-bottom:6px;">KEY POINT</section>${componentHeading(title || '一个小标题', ctx)}<section style="font-size:${ctx.fs - 1}px;line-height:${ctx.lh};color:${theme.muted};">${content}</section></section>`;
  }

  if (block.kind === 'lead') {
    return `<section style="margin:${top}px 0;padding:18px 19px;background-color:${ctx.tint(0.055)};border-top:1px solid ${ctx.tint(0.22)};border-bottom:1px solid ${ctx.tint(0.22)};">${title ? `<section style="margin-bottom:8px;font-size:11px;line-height:1.6;letter-spacing:0.16em;color:${ctx.accentText};">${inline(title, ctx)}</section>` : ''}<section style="font-family:${escapeHtml(theme.headingFont)};font-size:${ctx.fs + 1}px;line-height:${Math.min(ctx.lh, 2)};color:${theme.heading};">${content}</section></section>`;
  }

  if (block.kind === 'center') {
    return `<section style="margin:${top}px 0;padding:22px 16px;text-align:center;background-color:${ctx.tint(0.04)};border-radius:${theme.radius}px;"><section style="font-family:${escapeHtml(theme.headingFont)};font-size:${ctx.fs + 3}px;line-height:1.65;font-weight:700;color:${theme.heading};">${inline(title || '一句话核心观点', ctx)}</section>${content ? `<section style="margin-top:10px;font-size:${ctx.fs - 1}px;line-height:1.85;color:${theme.muted};">${content}</section>` : ''}</section>`;
  }

  if (block.kind === 'quote') {
    return `<section style="margin:${top}px 0;padding:4px 18px;text-align:center;"><section style="height:32px;font-family:Georgia,serif;font-size:44px;line-height:1;color:${ctx.accent};">“</section><section style="font-family:${escapeHtml(theme.headingFont)};font-size:${ctx.fs + 1}px;line-height:1.9;color:${theme.heading};">${content}</section>${title ? `<section style="margin-top:12px;font-size:12px;line-height:1.7;color:${theme.muted};">—— ${inline(title, ctx)}</section>` : ''}</section>`;
  }

  if (block.kind === 'card') {
    return `<section style="margin:${top}px 0;border:1px solid ${theme.line};border-radius:${theme.radius}px;overflow:hidden;background-color:${theme.bg};"><section style="padding:10px 16px;background-color:${ctx.tint(0.09)};font-size:${ctx.fs}px;line-height:1.5;font-weight:700;color:${ctx.accentText};">${inline(title || '卡片标题', ctx)}</section><section style="padding:15px 16px;font-size:${ctx.fs - 1}px;line-height:${ctx.lh};color:${theme.text};">${content}</section></section>`;
  }

  if (block.kind === 'steps' || block.kind === 'toc') {
    const items = lines.map((line, index) => {
      const text = line.replace(/^(?:\d+[.)]|[-*+])\s+/, '');
      const marker = block.kind === 'toc' ? String(index + 1).padStart(2, '0') : String(index + 1);
      return `<section style="display:flex;align-items:flex-start;margin:${index ? '12px' : '0'} 0 0;"><span style="flex-shrink:0;width:${block.kind === 'toc' ? '31px' : '24px'};height:24px;line-height:24px;text-align:center;border-radius:${block.kind === 'toc' ? '3px' : '50%'};background-color:${ctx.tint(0.11)};color:${ctx.accentText};font-size:11px;font-weight:700;">${marker}</span><span style="flex:1;margin-left:11px;padding-top:1px;font-size:${ctx.fs - 1}px;line-height:1.75;color:${theme.text};">${inline(text, ctx)}</span></section>`;
    }).join('');
    return `<section style="margin:${top}px 0;padding:16px 17px;border:1px solid ${theme.line};border-radius:${theme.radius}px;background-color:${ctx.tint(0.025)};">${componentHeading(title || (block.kind === 'toc' ? '本文目录' : '行动步骤'), ctx)}${items}</section>`;
  }

  if (block.kind === 'grid' || block.kind === 'facts') {
    const cells = lines.map((line) => {
      const [head, ...rest] = line.split('|');
      const body = rest.join('|').trim();
      return { head: head.trim(), body };
    }).filter((cell) => cell.head);
    const body = cells.map((cell, index) => `<section style="flex:1;min-width:0;padding:${block.kind === 'facts' ? '12px 8px' : '13px 12px'};box-sizing:border-box;text-align:center;${index ? `border-left:1px solid ${theme.line};` : ''}"><section style="font-family:${escapeHtml(theme.headingFont)};font-size:${block.kind === 'facts' ? ctx.fs + 7 : ctx.fs}px;line-height:1.45;font-weight:700;color:${block.kind === 'facts' ? ctx.accentText : theme.heading};">${inline(cell.head, ctx)}</section>${cell.body ? `<section style="margin-top:6px;font-size:${ctx.fs - 3}px;line-height:1.7;color:${theme.muted};">${inline(cell.body, ctx)}</section>` : ''}</section>`).join('');
    return `<section style="margin:${top}px 0;">${title ? `<section style="margin-bottom:10px;text-align:center;font-size:${ctx.fs}px;line-height:1.6;font-weight:700;color:${theme.heading};">${inline(title, ctx)}</section>` : ''}<section style="display:flex;align-items:stretch;background-color:${ctx.tint(0.045)};border:1px solid ${ctx.tint(0.13)};border-radius:${theme.radius}px;overflow:hidden;">${body}</section></section>`;
  }

  if (block.kind === 'follow') {
    return `<section style="margin:${top * 1.4}px 0;padding:18px;text-align:center;border:1px dashed ${ctx.tint(0.38)};border-radius:${theme.radius}px;"><section style="font-size:10px;line-height:1.5;letter-spacing:0.2em;color:${ctx.accentText};">FOLLOW US</section><section style="margin-top:7px;font-family:${escapeHtml(theme.headingFont)};font-size:${ctx.fs + 3}px;line-height:1.5;font-weight:700;color:${theme.heading};">${inline(title || '关注我的公众号', ctx)}</section><section style="margin-top:8px;font-size:${ctx.fs - 2}px;line-height:1.8;color:${theme.muted};">${content || '如果这篇文章对你有帮助，欢迎关注与交流。'}</section></section>`;
  }

  if (block.kind === 'ending') {
    return `<section style="margin:${top * 1.6}px 0 ${top}px;text-align:center;"><section style="display:flex;align-items:center;gap:12px;"><span style="flex:1;height:1px;background-color:${theme.line};"></span><span style="font-family:Georgia,serif;font-size:12px;line-height:1;letter-spacing:0.3em;color:${ctx.accentText};">${inline(title || 'END', ctx)}</span><span style="flex:1;height:1px;background-color:${theme.line};"></span></section>${content ? `<section style="margin-top:13px;font-size:${ctx.fs - 2}px;line-height:1.8;color:${theme.muted};">${content}</section>` : ''}</section>`;
  }

  if (block.kind === 'divider') {
    return `<section style="margin:${top * 1.4}px 0;display:flex;align-items:center;gap:12px;"><span style="flex:1;height:1px;background-color:${theme.line};"></span><span style="font-size:12px;line-height:1.5;letter-spacing:0.18em;color:${ctx.accentText};">${inline(title || '· · ·', ctx)}</span><span style="flex:1;height:1px;background-color:${theme.line};"></span></section>`;
  }

  if (block.kind === 'caption') {
    return `<section style="margin:${Math.round(ctx.fs * 0.8)}px 0 ${top}px;text-align:center;font-size:${ctx.fs - 3}px;line-height:1.8;color:${theme.muted};">${inline(title, ctx)}${title && content ? '<br>' : ''}${content}</section>`;
  }

  const isWarn = block.kind === 'warn';
  const isTip = block.kind === 'tip';
  const accent = isWarn ? '#c2410c' : ctx.accent;
  const label = title || (isWarn ? '注意' : isTip ? '小提示' : '笔记');
  return `<section style="margin:${top}px 0;padding:15px 17px;background-color:${rgba(accent, 0.07)};border:1px solid ${rgba(accent, 0.19)};border-radius:${theme.radius}px;"><section style="font-size:12px;line-height:1.6;font-weight:700;letter-spacing:0.12em;color:${isWarn ? accent : ctx.accentText};margin-bottom:7px;">${inline(label, ctx)}</section><section style="font-size:${ctx.fs - 1}px;line-height:${ctx.lh};color:${theme.text};">${content}</section></section>`;
}

function renderList(block, ctx) {
  const theme = ctx.theme;
  if (theme.imported) {
    const tag = block.ordered ? 'ol' : 'ul';
    const items = block.items.map((item) => `<li style="${importedStyle(ctx, 'li')}">${inline(item, ctx)}</li>`).join('');
    const start = block.ordered && block.start !== 1 ? ` start="${Number(block.start) || 1}"` : '';
    return `<${tag}${start} style="${importedStyle(ctx, tag)}">${items}</${tag}>`;
  }
  const items = block.items
    .map((item, index) => {
      const marker = block.ordered
        ? `<span style="color:${ctx.accentText};font-weight:700;">${(block.start || 1) + index}.</span>`
        : `<span style="color:${ctx.accent};">•</span>`;
      return `<li style="margin:0 0 9px;padding-left:20px;text-indent:-20px;list-style:none;color:${theme.text};">${marker}&nbsp;&nbsp;${inline(item, ctx)}</li>`;
    })
    .join('');
  return `<${block.ordered ? 'ol' : 'ul'} style="margin:0 0 ${ctx.gap}px;padding:0;list-style:none;">${items}</${block.ordered ? 'ol' : 'ul'}>`;
}

function renderImage(block, ctx) {
  const theme = ctx.theme;
  if (theme.imported) {
    const caption = block.alt
      ? `<span style="display:block;margin:-8px 0 20px;text-align:center;font-size:12px;line-height:1.7;color:${theme.muted};">${inline(block.alt, ctx)}</span>`
      : '';
    return `<section style="margin:0;padding:0;"><img src="${safeUrl(block.src)}" alt="${escapeHtml(block.alt)}" style="${importedStyle(ctx, 'img', 'box-sizing:border-box;')}">${caption}</section>`;
  }
  const shadow = theme.shadow ? 'box-shadow:0 10px 26px rgba(60,45,30,0.12);' : '';
  const caption = block.alt
    ? `<span style="display:block;margin-top:9px;font-size:12.5px;line-height:1.7;color:${theme.muted};letter-spacing:0.02em;">${inline(block.alt, ctx)}</span>`
    : '';
  return `<section style="margin:${Math.round(ctx.fs * 1.6)}px 0;text-align:center;"><img src="${safeUrl(block.src)}" alt="${escapeHtml(block.alt)}" style="display:block;max-width:100%;height:auto;margin:0 auto;border-radius:${theme.radius}px;${shadow}">${caption}</section>`;
}

function renderTable(block, ctx) {
  const theme = ctx.theme;
  if (theme.imported) {
    const head = block.header.map((cell, index) =>
      `<th style="${importedStyle(ctx, 'th', `text-align:${block.aligns[index] || 'left'};`)}">${inline(cell, ctx)}</th>`
    ).join('');
    const body = block.rows.map((row) => `<tr style="${importedStyle(ctx, 'tr')}">${row.map((cell, index) =>
      `<td style="${importedStyle(ctx, 'td', `text-align:${block.aligns[index] || 'left'};`)}">${inline(cell, ctx)}</td>`
    ).join('')}</tr>`).join('');
    return `<section style="margin:0 0 ${ctx.gap}px;overflow-x:auto;"><table style="${importedStyle(ctx, 'table', 'margin:0;')}"><thead><tr style="${importedStyle(ctx, 'tr')}">${head}</tr></thead><tbody>${body}</tbody></table></section>`;
  }
  const size = Math.max(13, ctx.fs - 2);
  const head = block.header
    .map((cell, index) => {
      const align = block.aligns[index] || 'left';
      return `<th style="padding:9px 11px;text-align:${align};font-weight:700;color:${theme.heading};background-color:${ctx.tint(0.07)};border-bottom:2px solid ${ctx.accent};font-size:${size}px;line-height:1.6;">${inline(cell, ctx)}</th>`;
    })
    .join('');
  const body = block.rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell, index) => {
            const align = block.aligns[index] || 'left';
            return `<td style="padding:9px 11px;text-align:${align};border-bottom:1px solid ${theme.line};color:${theme.text};font-size:${size}px;line-height:1.6;">${inline(cell, ctx)}</td>`;
          })
          .join('')}</tr>`
    )
    .join('');
  return `<section style="margin:0 0 ${ctx.gap}px;overflow-x:auto;"><table style="width:100%;border-collapse:collapse;table-layout:auto;"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></section>`;
}

function renderHr(ctx) {
  const theme = ctx.theme;
  if (theme.imported) return `<section style="${importedStyle(ctx, 'hr', 'font-size:0;line-height:0;')}"></section>`;
  const top = Math.round(ctx.fs * 2.1);
  switch (theme.divider) {
    case 'line':
      return `<section style="margin:${top}px 0;border-top:1px solid ${theme.line};height:0;font-size:0;"></section>`;
    case 'ornament':
      return `<section style="margin:${top}px 0;text-align:center;color:${ctx.accent};font-size:13px;letter-spacing:0.55em;line-height:1;">◦&nbsp;◦&nbsp;◦</section>`;
    case 'dots':
    default:
      return `<section style="margin:${top}px 0;text-align:center;color:${ctx.accent};font-size:14px;letter-spacing:0.5em;line-height:1;">·&nbsp;·&nbsp;·</section>`;
  }
}

function renderImportedHeading(block, ctx, text) {
  const level = clamp(block.level, 1, 6);
  return `<h${level} style="${importedStyle(ctx, `h${level}`)}">${text}</h${level}>`;
}

function renderBlock(block, ctx) {
  const theme = ctx.theme;
  switch (block.type) {
    case 'heading': {
      const text = inline(block.text, ctx);
      if (theme.imported) return renderImportedHeading(block, ctx, text);
      if (block.level === 1) return renderH2(text, ctx, ctx.fs + theme.h2Delta + 3);
      if (block.level === 2) return renderH2(text, ctx, ctx.fs + theme.h2Delta);
      if (block.level === 3) return renderH3(text, ctx, ctx.fs + theme.h3Delta);
      return `<h4 style="margin:${Math.round(ctx.fs * 1.4)}px 0 ${Math.round(ctx.fs * 0.5)}px;font-size:${ctx.fs}px;line-height:1.6;font-weight:700;color:${ctx.accentText};">${text}</h4>`;
    }
    case 'paragraph': {
      const html = block.lines.map((line) => inline(line, ctx)).join('<br>');
      if (theme.imported) return `<p style="${importedStyle(ctx, 'p')}">${html}</p>`;
      return `<p style="margin:0 0 ${ctx.gap}px;text-align:justify;color:${theme.text};">${html}</p>`;
    }
    case 'quote':
      return renderQuote(block.lines, ctx);
    case 'callout':
      return renderCallout(block, ctx);
    case 'list':
      return renderList(block, ctx);
    case 'image':
      return renderImage(block, ctx);
    case 'code': {
      if (theme.imported) {
        return `<pre style="${importedStyle(ctx, 'pre', `color:${theme.codeText};white-space:pre-wrap;word-break:break-word;`)}"><code style="font-family:inherit;background:none;padding:0;border:0;color:inherit;">${escapeHtml(block.text)}</code></pre>`;
      }
      return `<pre style="margin:0 0 ${ctx.gap}px;padding:14px 16px;background-color:${theme.codeBg};border-radius:${theme.radius}px;color:${theme.codeText};font-size:13px;line-height:1.7;white-space:pre-wrap;word-break:break-all;overflow-x:auto;font-family:Menlo,Consolas,'Courier New',monospace;"><code style="font-family:inherit;background:none;padding:0;color:inherit;">${escapeHtml(block.text)}</code></pre>`;
    }
    case 'hr':
      return renderHr(ctx);
    case 'table':
      return renderTable(block, ctx);
    default:
      return '';
  }
}

/* --------------------------------- exports -------------------------------- */

export function plainText(markdown) {
  return String(markdown || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/:([a-zA-Z][a-zA-Z0-9-]{0,24})(?:\{[^{}]*\})?:/g, (match, name) => (hasGlyph(name) ? ' ' : match))
    .replace(/^\s*:::\s*\w*\s*/gm, ' ')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/[#>*`~=|\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function renderArticle(markdown, themeOrId, options = {}) {
  const theme = typeof themeOrId === 'string' ? getTheme(themeOrId) : themeOrId || getTheme('paper');
  const ctx = createContext(theme, options);
  const blocks = parseBlocks(markdown);
  const containerStyle = theme.imported
    ? importedStyle(ctx, 'container', 'width:100%;max-width:100%;box-sizing:border-box;overflow-wrap:break-word;')
    : `background-color:${theme.bg};color:${theme.text};font-family:${escapeHtml(theme.bodyFont)};font-size:${ctx.fs}px;line-height:${ctx.lh};letter-spacing:${theme.letterSpacing};word-break:break-word;overflow-wrap:break-word;text-align:left;max-width:100%;`;
  const body = blocks.map((block) => renderBlock(block, ctx)).join('');
  // 微信公众号会清洗掉正文最外层容器的 background-color。
  // 外面套一层只负责背景的 section 兜底，内层同时保留主题背景，两层任一生效都不会丢底色。
  const html = `<section style="background-color:${theme.bg};"><section style="${containerStyle}">${body}</section></section>`;

  const text = plainText(markdown);
  const chars = text.replace(/\s/g, '').length;
  const cjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const latin = (text.replace(/[\u3400-\u9fff]/g, ' ').match(/[A-Za-z0-9]+/g) || []).length;
  const images = blocks.filter((block) => block.type === 'image').length;
  const imageSrcs = blocks.filter((block) => block.type === 'image').map((block) => block.src);
  const reading = Math.max(1, Math.ceil((cjk + latin * 2) / 400));

  return {
    html,
    stats: { chars, words: cjk + latin, reading, images },
    imageSrcs,
    blocks,
  };
}
