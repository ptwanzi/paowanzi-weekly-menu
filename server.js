const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const staticFiles = new Map([
  ['/', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/index.html', { file: 'index.html', type: 'text/html; charset=utf-8' }]
]);

function json(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 32_000) request.destroy();
    });
    request.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch (error) { reject(error); }
    });
    request.on('error', reject);
  });
}

async function submitToFeishu(request, response) {
  let data;
  try { data = await readJson(request); }
  catch (_) { return json(response, 400, { ok: false, message: '提交内容格式错误' }); }

  const { name, role = '', challenge = '', selections = [] } = data;
  if (!name || !Array.isArray(selections) || selections.length !== 5) {
    return json(response, 400, { ok: false, message: '请填写名字并选择 5 道主题' });
  }

  const webhookUrl = process.env.FEISHU_WEBHOOK_URL;
  if (!webhookUrl) {
    return json(response, 503, { ok: false, message: '飞书收集服务尚未配置' });
  }

  const payload = {
    name: String(name).slice(0, 30),
    role: String(role).slice(0, 60),
    challenge: String(challenge).slice(0, 200),
    submitted_at: new Date().toISOString(),
    selected_topics: selections.map(item => item.topic).join('、'),
    selected_titles: selections.map(item => `${item.rank}. ${item.title}`).join('\n'),
    ...Object.fromEntries(selections.map(item => [`choice_${item.rank}`, item.title]))
  };

  const headers = { 'Content-Type': 'application/json' };
  if (process.env.FEISHU_WEBHOOK_TOKEN) {
    headers.Authorization = `Bearer ${process.env.FEISHU_WEBHOOK_TOKEN}`;
  }

  try {
    const feishuResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    if (!feishuResponse.ok) {
      return json(response, 502, { ok: false, message: '飞书写入失败' });
    }
    return json(response, 200, { ok: true });
  } catch (_) {
    return json(response, 502, { ok: false, message: '暂时无法连接飞书' });
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

  if (request.method === 'POST' && url.pathname === '/api/submit') {
    return submitToFeishu(request, response);
  }
  if (request.method === 'GET' && url.pathname === '/health') {
    return json(response, 200, { ok: true });
  }

  const asset = request.method === 'GET' ? staticFiles.get(url.pathname) : null;
  if (!asset) return json(response, 404, { ok: false, message: 'Not found' });

  fs.readFile(path.join(ROOT, asset.file), (error, content) => {
    if (error) return json(response, 500, { ok: false, message: '文件读取失败' });
    response.writeHead(200, {
      'Content-Type': asset.type,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    response.end(content);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Topic menu is running on port ${PORT}`);
});
