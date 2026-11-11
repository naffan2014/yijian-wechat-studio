function assertConverters({ docx = false } = {}) {
  if (!window.DOMPurify || !window.TurndownService || !window.turndownPluginGfm?.gfm) {
    throw new Error('富文本转换组件没有加载，请刷新页面后重试');
  }
  if (docx && !window.mammoth) throw new Error('Word 转换组件没有加载，请刷新页面后重试');
}

function cleanHtml(html) {
  return window.DOMPurify.sanitize(String(html || ''), {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'svg', 'math', 'video', 'audio'],
    FORBID_ATTR: ['style', 'class', 'id', 'srcset', 'sizes', 'loading', 'contenteditable'],
    ALLOW_DATA_ATTR: false,
    KEEP_CONTENT: true,
  });
}

async function localizeEmbeddedImages(root, uploadImage) {
  let embedded = 0;
  let external = 0;
  let failed = 0;
  const images = [...root.querySelectorAll('img')];
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    const src = String(image.getAttribute('src') || '').trim();
    const alt = String(image.getAttribute('alt') || '').trim();
    if (/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(src)) {
      if (typeof uploadImage !== 'function') {
        image.remove();
        failed += 1;
        continue;
      }
      try {
        const uploaded = await uploadImage(src, alt || `导入图片-${index + 1}`);
        image.setAttribute('src', uploaded.url);
        image.setAttribute('alt', alt || '');
        embedded += 1;
      } catch {
        image.replaceWith(root.ownerDocument.createTextNode(alt ? `[图片：${alt}]` : '[图片导入失败]'));
        failed += 1;
      }
      continue;
    }
    if (/^(https?:\/\/|\/uploads\/)/i.test(src)) {
      if (/^https?:\/\//i.test(src)) external += 1;
      image.setAttribute('src', src);
      continue;
    }
    image.remove();
    failed += 1;
  }
  return { embedded, external, failed };
}

function createTurndown() {
  const service = new window.TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
    linkReferenceStyle: 'full',
  });
  service.use(window.turndownPluginGfm.gfm);
  service.addRule('highlight', {
    filter: ['mark', 'u'],
    replacement: (content) => (content.trim() ? `==${content}==` : content),
  });
  service.addRule('lineBreak', {
    filter: 'br',
    replacement: () => '  \n',
  });
  return service;
}

export async function htmlToMarkdown(html, { uploadImage } = {}) {
  assertConverters();
  const template = document.createElement('template');
  template.innerHTML = cleanHtml(html);
  const imageStats = await localizeEmbeddedImages(template.content, uploadImage);
  const markdown = createTurndown()
    .turndown(template.innerHTML)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  return { markdown, ...imageStats };
}

export async function docxToMarkdown(file, options = {}) {
  assertConverters({ docx: true });
  const arrayBuffer = await file.arrayBuffer();
  const result = await window.mammoth.convertToHtml(
    { arrayBuffer },
    {
      includeDefaultStyleMap: true,
      convertImage: window.mammoth.images.imgElement((image) =>
        image.read('base64').then((data) => ({ src: `data:${image.contentType};base64,${data}` }))
      ),
    }
  );
  const converted = await htmlToMarkdown(result.value, options);
  return {
    ...converted,
    warnings: (result.messages || []).map((message) => message.message).filter(Boolean),
  };
}
