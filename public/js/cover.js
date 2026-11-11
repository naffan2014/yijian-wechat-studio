export const COVER_STYLES = [
  {
    id: 'dusk',
    name: '暮纸',
    from: '#f8ecd9',
    to: '#e2b78c',
    ink: '#3a2a1d',
    sub: '#6d5745',
    accent: '#b5432a',
    serif: true,
    dark: false,
  },
  {
    id: 'azure',
    name: '青岚',
    from: '#e9f2ff',
    to: '#b5d2fb',
    ink: '#0f2a4a',
    sub: '#43628a',
    accent: '#2563eb',
    serif: false,
    dark: false,
  },
  {
    id: 'night',
    name: '夜幕',
    from: '#0b1020',
    to: '#1e2c46',
    ink: '#f2f6ff',
    sub: '#a8b8cf',
    accent: '#67e8f9',
    serif: false,
    dark: true,
  },
  {
    id: 'peach',
    name: '暖橘',
    from: '#ffe9db',
    to: '#ffb98f',
    ink: '#4a2418',
    sub: '#7d4a37',
    accent: '#c2410c',
    serif: true,
    dark: false,
  },
  {
    id: 'ink',
    name: '墨白',
    from: '#fbfaf7',
    to: '#e6e0d4',
    ink: '#171614',
    sub: '#6f685d',
    accent: '#b03a2e',
    serif: true,
    dark: false,
  },
  {
    id: 'forest',
    name: '松间',
    from: '#e9f6ee',
    to: '#b8ddc8',
    ink: '#122a1e',
    sub: '#3f604f',
    accent: '#0f766e',
    serif: false,
    dark: false,
  },
];

const SERIF_STACK = '"Songti SC","Source Han Serif SC","Noto Serif SC","SimSun",Georgia,serif';
const SANS_STACK = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';
const W = 1080;
const H = 460;

export function inferCoverStyle(themeId) {
  const map = {
    paper: 'dusk',
    ink: 'ink',
    azure: 'azure',
    warm: 'peach',
    noir: 'night',
    magazine: 'ink',
  };
  return map[themeId] || 'dusk';
}

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function wrapText(ctx, text, maxWidth) {
  const paragraphs = String(text || '').split('\n');
  const lines = [];
  for (const paragraph of paragraphs) {
    let line = '';
    for (const char of paragraph) {
      if (!line && char === ' ') continue;
      const test = line + char;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line.replace(/\s+$/, ''));
        line = char === ' ' ? '' : char;
      } else {
        line = test;
      }
    }
    if (line.trim()) lines.push(line.trim());
  }
  return lines.length ? lines : [''];
}

function fitTitle(ctx, text, maxWidth, maxLines, serif) {
  const family = serif ? SERIF_STACK : SANS_STACK;
  for (let size = 66; size >= 36; size -= 2) {
    ctx.font = `700 ${size}px ${family}`;
    const lines = wrapText(ctx, text, maxWidth);
    if (lines.length <= maxLines) return { size, lines, family };
  }
  const size = 36;
  ctx.font = `700 ${size}px ${family}`;
  const lines = wrapText(ctx, text, maxWidth).slice(0, maxLines);
  if (lines.length === maxLines) {
    let last = lines[maxLines - 1];
    while (ctx.measureText(`${last}…`).width > maxWidth && last.length > 1) {
      last = last.slice(0, -1);
    }
    lines[maxLines - 1] = `${last}…`;
  }
  return { size, lines, family };
}

function drawNoise(ctx, style) {
  let seed = 17;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const color = style.dark ? '255,255,255' : hexToRgb(style.ink).r + ',' + hexToRgb(style.ink).g + ',' + hexToRgb(style.ink).b;
  for (let i = 0; i < 2400; i += 1) {
    ctx.fillStyle = `rgba(${color},${(style.dark ? 0.05 : 0.035) * rand()})`;
    ctx.fillRect(rand() * W, rand() * H, 1.4, 1.4);
  }
}

export function drawCover(canvas, options = {}) {
  const style = COVER_STYLES.find((item) => item.id === options.styleId) || COVER_STYLES[0];
  const layout = options.layout === 'center' ? 'center' : 'left';
  const account = String(options.account || '我的公众号').trim() || '我的公众号';
  const badge = String(options.badge || 'WECHAT · 公众号').trim();
  const title = String(options.title || '在这里写下标题').trim() || '在这里写下标题';
  const subtitle = String(options.subtitle || '').trim();

  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  const gradient = ctx.createLinearGradient(0, 0, W, H);
  gradient.addColorStop(0, style.from);
  gradient.addColorStop(1, style.to);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H);

  drawNoise(ctx, style);

  // 大色块与细线装饰
  ctx.save();
  ctx.beginPath();
  ctx.arc(W * 0.87, H * 0.22, 200, 0, Math.PI * 2);
  ctx.fillStyle = style.dark ? 'rgba(255,255,255,0.045)' : 'rgba(255,255,255,0.28)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(W * 0.87, H * 0.22, 148, 0, Math.PI * 2);
  ctx.strokeStyle = rgba(style.accent, style.dark ? 0.4 : 0.32);
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = rgba(style.ink, style.dark ? 0.16 : 0.14);
  ctx.lineWidth = 1;
  ctx.strokeRect(26.5, 26.5, W - 53, H - 53);

  const margin = 72;
  const centerX = W / 2;
  const titleWidth = layout === 'center' ? W - 200 : W - margin * 2 - 70;
  const fitted = fitTitle(ctx, title, titleWidth, 3, style.serif);
  const lineHeight = Math.round(fitted.size * 1.24);
  const titleBottom = subtitle ? 312 : 344;
  const totalHeight = (fitted.lines.length - 1) * lineHeight;

  // 顶部标签
  ctx.textBaseline = 'alphabetic';
  ctx.font = `500 18px ${SANS_STACK}`;
  ctx.fillStyle = style.accent;
  if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '2px';
  if (layout === 'center') {
    const width = ctx.measureText(badge).width;
    ctx.fillText(badge, centerX - width / 2, 92);
  } else {
    ctx.fillRect(margin, 76, 30, 2);
    ctx.fillText(badge, margin + 44, 92);
  }
  if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '0px';

  // 右上一枚小印章
  if (layout === 'left') {
    const sealChar = account.slice(0, 1);
    const sealSize = 44;
    ctx.fillStyle = style.accent;
    ctx.beginPath();
    ctx.roundRect(W - margin - sealSize, 56, sealSize, sealSize, 4);
    ctx.fill();
    ctx.fillStyle = style.dark ? '#0b1020' : '#ffffff';
    ctx.font = `700 24px ${SERIF_STACK}`;
    ctx.textAlign = 'center';
    ctx.fillText(sealChar, W - margin - sealSize / 2, 56 + sealSize / 2 + 9);
    ctx.textAlign = 'left';
  }

  // 标题
  ctx.fillStyle = style.ink;
  ctx.font = `700 ${fitted.size}px ${fitted.family}`;
  ctx.textAlign = layout === 'center' ? 'center' : 'left';
  const startX = layout === 'center' ? centerX : margin;
  const firstBaseline = titleBottom - totalHeight;
  fitted.lines.forEach((line, index) => {
    ctx.fillText(line, startX, firstBaseline + index * lineHeight);
  });

  // 副标题
  if (subtitle) {
    ctx.font = `400 23px ${SANS_STACK}`;
    ctx.fillStyle = style.sub;
    let text = subtitle;
    const maxSubWidth = layout === 'center' ? W - 240 : W - margin * 2;
    while (ctx.measureText(text).width > maxSubWidth && text.length > 1) {
      text = text.slice(0, -1);
    }
    if (text !== subtitle) text += '…';
    ctx.fillText(text, startX, titleBottom + 44);
  }

  // 底部账号与装饰线
  ctx.strokeStyle = rgba(style.ink, style.dark ? 0.22 : 0.16);
  ctx.lineWidth = 1;
  if (layout === 'center') {
    const y = 392;
    ctx.beginPath();
    ctx.moveTo(centerX - 24, y);
    ctx.lineTo(centerX + 24, y);
    ctx.stroke();
    ctx.fillStyle = style.sub;
    ctx.font = `400 17px ${SANS_STACK}`;
    ctx.textAlign = 'center';
    ctx.fillText(account, centerX, 424);
    ctx.font = `400 12px ${SANS_STACK}`;
    ctx.fillStyle = rgba(style.ink, 0.5);
    ctx.fillText('长按识别 · 关注我们', centerX, 446);
  } else {
    ctx.beginPath();
    ctx.moveTo(margin, 390);
    ctx.lineTo(margin + 44, 390);
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.fillStyle = style.sub;
    ctx.font = `400 17px ${SANS_STACK}`;
    ctx.fillText(account, margin, 426);
    ctx.font = `400 13px ${SANS_STACK}`;
    ctx.fillStyle = rgba(style.ink, 0.45);
    ctx.textAlign = 'right';
    ctx.fillText('WECHAT OFFICIAL ACCOUNT', W - margin, 426);
  }
  ctx.textAlign = 'left';
  return canvas;
}

export function coverToDataUrl(canvas, quality = 0.92) {
  return canvas.toDataURL('image/jpeg', quality);
}
