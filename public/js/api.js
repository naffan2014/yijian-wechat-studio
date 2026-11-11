async function request(method, url, body) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`无法连接本地服务：${err.message}`);
  }
  let data = {};
  try {
    data = await response.json();
  } catch {
    throw new Error(`本地服务返回异常（HTTP ${response.status}）`);
  }
  if (!response.ok || data.ok === false) {
    const message = data.error?.message || data.message || `请求失败（HTTP ${response.status}）`;
    const error = new Error(message);
    error.code = data.error?.code;
    error.ip = data.error?.ip;
    error.detail = data.error?.detail;
    throw error;
  }
  return data;
}

export const api = {
  bootstrap: () => request('GET', '/api/bootstrap'),
  createArticle: (payload) => request('POST', '/api/articles', payload),
  saveArticle: (id, payload) => request('PUT', `/api/articles/${id}`, payload),
  deleteArticle: (id) => request('DELETE', `/api/articles/${id}`),
  uploads: () => request('GET', '/api/uploads'),
  upload: (payload) => request('POST', '/api/upload', payload),
  deleteUpload: (file, force = false) =>
    request('DELETE', `/api/uploads/${encodeURIComponent(file)}${force ? '?force=1' : ''}`),
  saveSettings: (payload) => request('PUT', '/api/settings', payload),
  testWeChat: () => request('POST', '/api/wechat/test'),
  wechatMaterials: ({ offset = 0, count = 20 } = {}) =>
    request('GET', `/api/wechat/materials?offset=${offset}&count=${count}`),
  wechatPublished: ({ offset = 0, count = 20 } = {}) =>
    request('GET', `/api/wechat/published?offset=${offset}&count=${count}`),
  wechatDrafts: ({ offset = 0, count = 10 } = {}) =>
    request('GET', `/api/wechat/drafts?offset=${offset}&count=${count}`),
  prepare: (content) => request('POST', '/api/wechat/prepare', { content }),
  publish: (payload) => request('POST', '/api/wechat/publish', payload),
  aiModels: (payload) => request('POST', '/api/ai/models', payload),
  aiBeautify: (payload) => request('POST', '/api/ai/beautify', payload),
  aiContinue: (payload) => request('POST', '/api/ai/continue', payload),
};
