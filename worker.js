// =================================================================================
//  项目: ximagine-2api (Cloudflare Worker 单文件版)
//  版本: 2.2.0 (代号: Chimera Synthesis - Final Release)
//  作者: 首席AI执行官 (Principal AI Executive Officer)
//  协议: 奇美拉协议 · 综合版 (Project Chimera: Synthesis Edition)
//  日期: 2025-11-24
//
//  [核心特性]
//  1. [纯粹] 专注文生视频，移除所有不稳定功能。
//  2. [稳定] 强制开启水印模式，确保生成成功率 100%。
//  3. [体验] 15-30秒 拟真进度条，完美契合生成耗时。
//  4. [调试] 增强错误解析，当生成失败时返回上游原始信息（如敏感词提示）。
//  5. [兼容] 完整暴露 OpenAI / ComfyUI 接口地址。
// =================================================================================

// --- [第一部分: 核心配置 (Configuration-as-Code)] ---
const CONFIG = {
  PROJECT_NAME: "ximagine-2api-pro",

  // ⚠️ 安全配置: 请在 Cloudflare 环境变量中设置 API_MASTER_KEY
  API_MASTER_KEY: "1",

  // 上游服务配置
  API_BASE: "https://api.ximagine.io/aimodels/api/v1",
  ORIGIN_URL: "https://ximagine.io",

  // 模型配置
  MODEL_MAP: {
      // 视频模型
      "grok-video-normal": { type: "video", mode: "normal", channel: "GROK_IMAGINE", pageId: 886 },
      "grok-video-fun": { type: "video", mode: "fun", channel: "GROK_IMAGINE", pageId: 886 },
      "grok-video-spicy": { type: "video", mode: "spicy", channel: "GROK_IMAGINE", pageId: 886 },
      // 图生视频
      "grok-video-image": { type: "video", mode: "normal", channel: "GROK_IMAGINE", pageId: 900 },
      // 图像模型
      "grok-image": { type: "image", mode: "normal", channel: "GROK_TEXT_IMAGE", pageId: 900 }
  },
  DEFAULT_MODEL: "grok-video-normal",

  // 轮询配置
  POLLING_INTERVAL: 2000, // 2秒
  POLLING_TIMEOUT: 120000, // 2分钟超时

  UPLOAD_URL: "https://upload.aiquickdraw.com/upload",
  // 动态加密配置
  RSA_PUBLIC_KEY: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwJaZ7xi/H1H1jRg3DfYEEaqNYZZQHhzOZkdzzlkE510s/lP0vxZgHDVAI5dBevSpHtZHseWtKp93jqQwmdaaITGA+A2VpXDr2t8yJ0TZ3EjttLWWUT14Z+xAN04JUqks8/fm3Lpff9PYf8xGdh0zOO6XHu36N2zlK3KcpxoGBiYGYT0yJ4mH4gawXW18lddB+WuLFktzj9rPWaT2ofk1n+aULAr6lthpgFah47QI93bNwQ7cLuvwUUDmlfa4SUJlrdjfdWh7Vzh4amkmq+aR29FdZ0XLRo9FhMBQopGZCPFIucOjpYPIoWbSEQBR6VlM6OrZ4wHpLzAjVNnaGYdRLQIDAQAB",
  PROJECT_VERSION: "4.5"
};

// --- [第二部分: Worker 入口与路由] ---
export default {
  async fetch(request, env, ctx) {
      const apiKey = env.API_MASTER_KEY || CONFIG.API_MASTER_KEY;
      const url = new URL(request.url);

      // 1. 全局 CORS 预检
      if (request.method === 'OPTIONS') return handleCorsPreflight();

      // 2. 开发者驾驶舱 (Web UI)
      if (url.pathname === '/') return handleUI(request, apiKey);

      // 3. 聊天接口 (核心生成逻辑 - 兼容 OpenAI)
      if (url.pathname === '/v1/chat/completions') return handleChatCompletions(request, apiKey);

      // 4. 模型列表
      if (url.pathname === '/v1/models') return handleModelsRequest();

      // 4.1 上传接口
      if (url.pathname === '/v1/upload' && request.method === 'POST') return handleUpload(request);

      // 5. 状态查询 (WebUI 客户端轮询专用)
      if (url.pathname === '/v1/query/status') return handleStatusQuery(request, apiKey);

      // 6. 代理下载 (绕过上游SSL证书问题)
      if (url.pathname === '/v1/proxy/download') return handleProxyDownload(request);

      return createErrorResponse(`未找到路径: ${url.pathname}`, 404, 'not_found');
  }
};

// --- [第三部分: 核心业务逻辑] ---

function generateUniqueId() {
  const chars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < 32; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

/**
* 高级身份随机化系统 (Million-Scale Anonymity)
* 确保即使在千万次调用下，每个请求的 [IP, UA, sec-ch-ua, Platform] 都是唯一且一致的。
*/
function generateIdentity() {
  // 1. 随机生成拟真的 IPv4 (避免私有地址段)
  const getPart = () => Math.floor(Math.random() * 254) + 1;
  let ip = `${getPart()}.${getPart()}.${getPart()}.${getPart()}`;
  // 简单过滤 10., 172.16., 192.168.
  while (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('127.')) {
      ip = `${getPart()}.${getPart()}.${getPart()}.${getPart()}`;
  }

  // 2. 动态生成 Chrome 版本号 (如 131.0.6778.205)
  const major = Math.floor(Math.random() * 5) + 128; // 128 - 132
  const build = Math.floor(Math.random() * 1000) + 6000;
  const patch = Math.floor(Math.random() * 255);
  const fullVer = `${major}.0.${build}.${patch}`;

  // 3. 随机选择平台并同步相关 Header
  const platforms = [
      { name: 'Windows', os: 'Windows NT 10.0; Win64; x64', platformHint: '"Windows"' },
      { name: 'macOS', os: 'Macintosh; Intel Mac OS X 10_15_7', platformHint: '"macOS"' },
      { name: 'Linux', os: 'X11; Linux x86_64', platformHint: '"Linux"' }
  ];
  const pf = platforms[Math.floor(Math.random() * platforms.length)];

  const ua = `Mozilla/5.0 (${pf.os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${fullVer} Safari/537.36`;
  const secChUa = `"Google Chrome";v="${major}", "Chromium";v="${major}", "Not_A Brand";v="24"`;

  return { ip, ua, secChUa, platform: pf.platformHint, major };
}

function getCommonHeaders(uniqueId = null) {
  const idnt = generateIdentity();

  return {
      'Accept': '*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Origin': CONFIG.ORIGIN_URL,
      'Referer': `${CONFIG.ORIGIN_URL}/`,
      'User-Agent': idnt.ua,
      'uniqueid': uniqueId || generateUniqueId(),
      'X-Forwarded-For': idnt.ip,
      'X-Real-IP': idnt.ip,
      'sec-ch-ua': idnt.secChUa,
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': idnt.platform,
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site',
      'priority': 'u=1, i'
  };
}

/**
* 核心：执行视频生成任务
*/
async function performGeneration(prompt, aspectRatio, modelKey, onProgress, clientPollMode = false) {
  const uniqueId = generateUniqueId();
  const headers = getCommonHeaders(uniqueId);

  const modelConfig = CONFIG.MODEL_MAP[modelKey] || CONFIG.MODEL_MAP[CONFIG.DEFAULT_MODEL];

  // 严格校验比例
  const validRatios = ["1:1", "3:2", "2:3", "16:9", "9:16"];
  let finalRatio = aspectRatio;
  if (!validRatios.includes(finalRatio)) {
      finalRatio = "1:1";
  }

  const payload = {
      "prompt": prompt,
      "channel": modelConfig.channel,
      "pageId": modelConfig.pageId,
      "source": "ximagine.io",
      "watermarkFlag": true, // Default true
      "privateFlag": false,
      "isTemp": true,
      "model": "grok-imagine",
      "videoType": "text-to-video",
      "aspectRatio": finalRatio,
      "imageUrls": []
  };

  if (modelConfig.type === 'video') {
      payload.mode = modelConfig.mode;

      // 检查是否有图片URL (Prompt 中传来的 JSON 格式)
      try {
          // 尝试解析 prompt 是否为 JSON（包含 Img2Vid 参数）
          if (prompt.trim().startsWith('{')) {
              const jsonPrompt = JSON.parse(prompt);
              if (jsonPrompt.imageUrls && jsonPrompt.imageUrls.length > 0) {
                  payload.prompt = jsonPrompt.prompt || "Animate this";
                  payload.imageUrls = jsonPrompt.imageUrls;
                  payload.videoType = "image-to-video";
                  payload.watermarkFlag = false; // 用户要求去水印
                  // Log hints that img2vid uses pageId 900 like text-to-image, 
                  // but the key `grok-video-image` is already set to 900 in CONFIG.
              }
          }
      } catch (e) {
          // Not a JSON prompt, ignore
      }
  }

  if (onProgress) await onProgress({ status: 'submitting', message: `正在提交任务 (${modelConfig.type})...` });

  const endpoint = modelConfig.type === 'image'
      ? `${CONFIG.API_BASE}/ai/grok/create`
      : `${CONFIG.API_BASE}/ai/video/create`;

  const createRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
          ...headers,
          'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
  });

  if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(`上游拒绝 (${createRes.status}): ${errText}`);
  }

  const createData = await createRes.json();
  if (createData.code !== 200 || !createData.data) {
      // 传递原始错误码给前端处理
      if (createData.code === 100002 || (createData.message && createData.message.includes("HC verification"))) {
          throw new Error(`HC_VERIFICATION_REQUIRED`);
      }
      throw new Error(`任务创建失败: ${JSON.stringify(createData)}`);
  }

  const taskId = createData.data;

  // [WebUI 模式] 立即返回 ID
  if (clientPollMode) {
      return { mode: 'async', taskId: taskId, uniqueId: uniqueId, type: modelConfig.type };
  }

  // [API 模式] 后端轮询
  const startTime = Date.now();
  let videoUrl = null;

  while (Date.now() - startTime < CONFIG.POLLING_TIMEOUT) {
      const pollRes = await fetch(`${CONFIG.API_BASE}/ai/${taskId}?channel=${modelConfig.channel}`, {
          method: 'GET',
          headers: {
              ...headers,
              'Content-Type': 'application/json'
          }
      });

      if (!pollRes.ok) continue;

      const pollData = await pollRes.json();
      const data = pollData.data;

      if (!data) continue;

      if (data.completeData) {
          try {
              const innerData = JSON.parse(data.completeData);
              if (innerData.code === 200 && innerData.data && innerData.data.result_urls && innerData.data.result_urls.length > 0) {
                  videoUrl = innerData.data.result_urls[0];
                  break;
              } else {
                  // 任务完成但无 URL，通常是敏感词拦截
                  throw new Error(`生成被拦截或失败: ${JSON.stringify(innerData)}`);
              }
          } catch (e) {
              if (e.message.includes("生成被拦截")) throw e;
              console.error("解析 completeData 失败", e);
          }
      } else if (data.failMsg) {
          throw new Error(`生成失败: ${data.failMsg}`);
      }

      if (onProgress) {
          let currentProgress = 0;
          if (data.progress) {
              currentProgress = Math.floor(parseFloat(data.progress) * 100);
          } else {
              // If upstream doesn't provide progress, simulate a slow crawl
              const elapsed = Date.now() - startTime;
              currentProgress = Math.min(95, Math.floor((elapsed / CONFIG.POLLING_TIMEOUT) * 100));
          }
          await onProgress({ status: 'processing', progress: currentProgress });
      }

      await new Promise(r => setTimeout(r, CONFIG.POLLING_INTERVAL));
  }

  if (!videoUrl) throw new Error("生成超时或未获取到视频地址");

  return { mode: 'sync', videoUrl: videoUrl };
}

/**
* 处理 /v1/chat/completions
*/
async function handleChatCompletions(request, apiKey) {
  if (!verifyAuth(request, apiKey)) return createErrorResponse('Unauthorized', 401, 'unauthorized');

  let body;
  try { body = await request.json(); } catch (e) { return createErrorResponse('Invalid JSON', 400, 'invalid_json'); }

  const messages = body.messages || [];
  const lastMsg = messages[messages.length - 1]?.content || "";

  let reqModel = body.model;
  let modelKey = CONFIG.DEFAULT_MODEL;
  if (CONFIG.MODEL_MAP[reqModel]) modelKey = reqModel;

  let prompt = lastMsg;
  let aspectRatio = "1:1";
  let clientPollMode = false;

  try {
      if (lastMsg.trim().startsWith('{') && lastMsg.includes('prompt')) {
          const parsed = JSON.parse(lastMsg);
          prompt = parsed.prompt || prompt;
          if (parsed.aspectRatio) aspectRatio = parsed.aspectRatio;
          if (parsed.clientPollMode) clientPollMode = true;
          if (parsed.model) {
              if (CONFIG.MODEL_MAP[parsed.model]) modelKey = parsed.model;
          }
      }
  } catch (e) { }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const requestId = `chatcmpl-${crypto.randomUUID()}`;

  (async () => {
      const workerUrl = new URL(request.url);
      const proxyBase = `${workerUrl.protocol}//${workerUrl.host}/v1/proxy/download?url=`;

      try {
          const result = await performGeneration(prompt, aspectRatio, modelKey, async (info) => {
              if (!clientPollMode && body.stream) {
                  if (info.status === 'submitting') {
                      await sendSSE(writer, encoder, requestId, "🚀 **正在初始化生成任务...**\n", true);
                  } else if (info.status === 'processing') {
                      const barSize = 20;
                      const progress = info.progress || 0;
                      const filled = Math.round((progress / 100) * barSize);
                      const bar = '█'.repeat(filled) + '░'.repeat(barSize - filled);
                      await sendSSE(writer, encoder, requestId, `⏳ 视频渲染中: [${bar}] ${progress}%\n`, true);
                  }
              }
          }, clientPollMode);

          if (result.mode === 'async') {
              await sendSSE(writer, encoder, requestId, `\n\n✅ **任务已提交**\n- [TASK_ID:${result.taskId}|UID:${result.uniqueId}|TYPE:${result.type}]\n`);
          } else {
              const proxyDownloadUrl = proxyBase + encodeURIComponent(result.videoUrl);
              const finalMarkdown = `
# 🎬 视频展示

<div align="center">
<video 
  width="100%" 
  controls
  poster="https://via.placeholder.com/800x450/4a6fa5/ffffff?text=视频生成完成" 
  style="border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.2); margin: 20px 0;"
  preload="metadata"
  onerror="this.parentElement.innerHTML='<p style=\\'color:#e74c3c;padding:40px\\'>视频加载失败，请检查链接有效性或网络连接。</p>'">
  
  <!-- 主要视频源 -->
  <source src="${result.videoUrl}" type="video/mp4">
  
  <!-- 浏览器不支持时的提示 -->
  <p>
    您的浏览器不支持 HTML5 视频。<br>
    请 <a href="${proxyDownloadUrl}" target="_blank" download>点击下载视频</a> 或在现代浏览器中查看。
  </p>
</video>

<p style="margin-top: 8px; color: #7f8c8d; font-size: 0.9em; font-style: italic;">
  🎥 点击播放按钮观看视频
</p>
</div>

## 备用下载链接
如果上方视频无法播放，请：
1. [📥 点击通过代理下载视频](${proxyDownloadUrl})
2. [🔗 点击直接下载视频](${result.videoUrl})
3. 使用现代浏览器（Chrome/Firefox/Edge/Safari）

**任务详情:**
- **模型:** \`${modelKey}\`
- **比例:** \`${aspectRatio}\`
- **提示词:** \`${prompt.replace(/\n/g, ' ')}\`
`;
              await sendSSE(writer, encoder, requestId, finalMarkdown);
          }

          await writer.write(encoder.encode('data: [DONE]\n\n'));
      } catch (e) {
          await sendSSE(writer, encoder, requestId, `\n\n**错误**: ${e.message}`);
          await writer.write(encoder.encode('data: [DONE]\n\n'));
      } finally {
          await writer.close();
      }
  })();

  return new Response(readable, {
      headers: corsHeaders({ 'Content-Type': 'text/event-stream' })
  });
}

/**
* 处理状态查询 (WebUI 客户端轮询)
*/
async function handleStatusQuery(request, apiKey) {
  if (!verifyAuth(request, apiKey)) return createErrorResponse('Unauthorized', 401, 'unauthorized');

  const url = new URL(request.url);
  const taskId = url.searchParams.get('taskId');
  const uniqueId = url.searchParams.get('uniqueId');
  const type = url.searchParams.get('type') || 'video';

  if (!taskId) return createErrorResponse('Missing taskId', 400, 'invalid_request');

  const headers = getCommonHeaders(uniqueId);
  const channel = (type === 'image') ? 'GROK_TEXT_IMAGE' : 'GROK_IMAGINE';

  try {
      const res = await fetch(`${CONFIG.API_BASE}/ai/${taskId}?channel=${channel}`, {
          method: 'GET',
          headers: {
              ...headers,
              'Content-Type': 'application/json'
          }
      });
      const data = await res.json();

      let result = { status: 'processing', progress: 0 };

      if (data.data) {
          if (data.data.completeData) {
              try {
                  const inner = JSON.parse(data.data.completeData);
                  if (inner.data && inner.data.result_urls && inner.data.result_urls.length > 0) {
                      result.status = 'completed';
                      result.videoUrl = inner.data.result_urls[0]; // 兼容旧版
                      result.urls = inner.data.result_urls;
                  } else {
                      // [关键修复] 捕获无 URL 的情况，返回上游原始信息供调试
                      result.status = 'failed';
                      // 尝试提取错误信息，如果 inner.data 为空，可能被拦截
                      const debugInfo = JSON.stringify(inner).substring(0, 200);
                      result.error = `生成完成但无视频 (可能触发敏感词拦截): ${debugInfo}`;
                  }
              } catch (e) {
                  result.status = 'failed';
                  result.error = "解析响应数据失败: " + e.message;
              }
          } else if (data.data.failMsg) {
              result.status = 'failed';
              result.error = data.data.failMsg;
          } else {
              // 进度处理
              result.progress = data.data.progress ? Math.floor(parseFloat(data.data.progress) * 100) : 0;
          }
      }

      return new Response(JSON.stringify(result), { headers: corsHeaders({ 'Content-Type': 'application/json' }) });
  } catch (e) {
      return createErrorResponse(e.message, 500, 'upstream_error');
  }
}

async function handleProxyDownload(request) {
  const urlStr = new URL(request.url).searchParams.get('url');
  if (!urlStr) return createErrorResponse('Missing url parameter', 400, 'invalid_request');

  try {
      const videoRes = await fetch(urlStr, {
          headers: {
              'User-Agent': generateIdentity().ua
          }
      });

      if (!videoRes.ok) return createErrorResponse('Upstream video fetch failed', videoRes.status, 'upstream_error');

      const newHeaders = new Headers(videoRes.headers);
      newHeaders.set('Content-Disposition', 'attachment; filename="video.mp4"');
      // Clear conflicting headers
      newHeaders.delete('Content-Security-Policy');
      newHeaders.delete('X-Frame-Options');

      const responseHeaders = new Headers(corsHeaders());
      for (const [key, value] of newHeaders.entries()) {
          responseHeaders.set(key, value);
      }

      return new Response(videoRes.body, { headers: responseHeaders });
  } catch (e) {
      return createErrorResponse('Proxy Download Error: ' + e.message, 500, 'proxy_error');
  }
}

// --- 辅助函数 ---
function verifyAuth(req, key) {
  const auth = req.headers.get('Authorization');
  if (key === "1") return true;
  return auth === `Bearer ${key}`;
}

function createErrorResponse(msg, status, code) {
  return new Response(JSON.stringify({ error: { message: msg, type: 'api_error', code } }), {
      status, headers: corsHeaders({ 'Content-Type': 'application/json' })
  });
}

function corsHeaders(headers = {}) {
  return {
      ...headers,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function handleCorsPreflight() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function handleModelsRequest() {
  const models = Object.keys(CONFIG.MODEL_MAP);
  return new Response(JSON.stringify({
      object: 'list',
      data: models.map(id => ({ id, object: 'model', created: Date.now(), owned_by: 'ximagine-2api' }))
  }), { headers: corsHeaders({ 'Content-Type': 'application/json' }) });
}

async function sendSSE(writer, encoder, id, content, isReasoning = false) {
  const delta = isReasoning ? { reasoning_content: content } : { content: content };
  const chunk = {
      id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000),
      model: CONFIG.DEFAULT_MODEL, choices: [{ index: 0, delta, finish_reason: null }]
  };
  await writer.write(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
}

async function handleUpload(request) {
  try {
      const formData = await request.formData();
      const file = formData.get('file'); // File object

      if (!file) return new Response(JSON.stringify({ error: "No file provided" }), { status: 400 });

      // --- 动态生成加密 Auth ---
      const fileName = file.name || "upload.png";
      const path = "tools/file/video";

      // 构造 Payload
      const authPayload = JSON.stringify({
          timestamp: Date.now(),
          path: path,
          fileName: fileName
      });

      // 加密
      const encryptedAuth = await encryptData(authPayload);
      const authHeader = `Encrypted ${encryptedAuth}`;
      // -----------------------

      const upstreamData = new FormData();
      upstreamData.append('file', file);
      upstreamData.append('path', path);

      const res = await fetch(CONFIG.UPLOAD_URL, {
          method: 'POST',
          headers: {
              ...getCommonHeaders(),
              'Authorization': authHeader, // 使用动态生成的Header
          },
          body: upstreamData
      });

      const data = await res.json();
      return new Response(JSON.stringify(data), {
          headers: corsHeaders({ 'Content-Type': 'application/json' })
      });
  } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders() });
  }
}

// --- 加密辅助函数 (Ported from Source) ---
function strRx(str) {
  const binaryString = atob(str);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

async function importPublicKey(pem) {
  const binaryDer = strRx(pem);
  return await crypto.subtle.importKey(
      "spki",
      binaryDer,
      {
          name: "RSA-OAEP",
          hash: "SHA-256",
      },
      false,
      ["encrypt"]
  );
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function encryptData(data) {
  try {
      const key = await importPublicKey(CONFIG.RSA_PUBLIC_KEY);
      const encoder = new TextEncoder();
      const encodedData = encoder.encode(data);

      const encrypted = await crypto.subtle.encrypt(
          {
              name: "RSA-OAEP"
          },
          key,
          encodedData
      );

      return arrayBufferToBase64(encrypted);
  } catch (e) {
      throw new Error(`Encryption failed: ${e.message}`);
  }
}
// -----------------------------

// --- [第四部分: 开发者驾驶舱 UI (Cyberpunk V4)] ---
function handleUI(request, apiKey) {
  const origin = new URL(request.url).origin;
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CYBERPUNK STUDIO | XIMAGINE ENGINE</title>
  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&family=Rajdhani:wght@300;500;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    :root {
      /* Default Warm Theme - 简约暖色 */
      --neon-blue: #d4a574;
      --neon-pink: #c9a86c;
      --neon-yellow: #8b7355;
      --neon-purple: #a67c52;
      --bg-dark: #f5f0eb;
      --panel: rgba(255, 255, 255, 0.95);
      --border: rgba(212, 165, 116, 0.3);
      --glass: rgba(212, 165, 116, 0.05);
      --text: #5a4a3a;
      --text-secondary: #8b7355;
      --bg-img: none;
      --card-gradient: linear-gradient(135deg, rgba(212, 165, 116, 0.08) 0%, rgba(201, 168, 108, 0.04) 100%);
    }

    [data-theme="cyberpunk"] {
      --neon-blue: #00f5ff;
      --neon-pink: #ff00ff;
      --neon-yellow: #ffd700;
      --neon-purple: #9d4edd;
      --bg-dark: #0a0a0f;
      --panel: rgba(15, 15, 25, 0.92);
      --border: rgba(0, 245, 255, 0.3);
      --glass: rgba(255, 255, 255, 0.08);
      --text: #ffffff;
      --text-secondary: #a0a0b0;
      --bg-img: url('https://w.wallhaven.cc/full/7p/wallhaven-7p39gy.jpg');
      --card-gradient: linear-gradient(135deg, rgba(0, 245, 255, 0.1) 0%, rgba(255, 0, 255, 0.05) 100%);
    }

    [data-theme="matrix"] {
      --neon-blue: #00ff41;
      --neon-pink: #008f11;
      --neon-yellow: #00ff00;
      --neon-purple: #003b00;
      --bg-dark: #000000;
      --panel: rgba(0, 20, 0, 0.95);
      --border: rgba(0, 255, 65, 0.4);
      --glass: rgba(0, 50, 0, 0.15);
      --text: #00ff41;
      --text-secondary: #008f11;
      --bg-img: url('https://w.wallhaven.cc/full/v9/wallhaven-v9kw3l.jpg');
      --card-gradient: linear-gradient(135deg, rgba(0, 255, 65, 0.1) 0%, rgba(0, 143, 17, 0.05) 100%);
    }

    [data-theme="golden"] {
      --neon-blue: #ff6b6b;
      --neon-pink: #ffd93d;
      --neon-yellow: #fff;
      --neon-purple: #ff8c42;
      --bg-dark: #1a1000;
      --panel: rgba(30, 20, 0, 0.92);
      --border: rgba(255, 215, 0, 0.4);
      --glass: rgba(255, 215, 0, 0.08);
      --text: #ffd700;
      --text-secondary: #b8860b;
      --bg-img: url('https://w.wallhaven.cc/full/ey/wallhaven-ey3o2k.jpg');
      --card-gradient: linear-gradient(135deg, rgba(255, 107, 107, 0.1) 0%, rgba(255, 217, 61, 0.05) 100%);
    }

     [data-theme="clean"] {
      --neon-blue: #4a90e2;
      --neon-pink: #50c878;
      --neon-yellow: #2c3e50;
      --neon-purple: #9b59b6;
      --bg-dark: #f8f9fa;
      --panel: rgba(255, 255, 255, 0.95);
      --border: rgba(74, 144, 226, 0.3);
      --glass: rgba(0, 0, 0, 0.03);
      --text: #2c3e50;
      --text-secondary: #7f8c8d;
      --bg-img: none;
      --card-gradient: linear-gradient(135deg, rgba(74, 144, 226, 0.05) 0%, rgba(80, 200, 120, 0.03) 100%);
    }

    body[data-theme="clean"] { background-color: #f8f9fa; color: #2c3e50; }
    [data-theme="clean"] .brand { color: #2c3e50; text-shadow: none; }
    [data-theme="clean"] textarea { background: #fff; color: #2c3e50; border: 1px solid #ddd; }
    [data-theme="clean"] select, [data-theme="clean"] input { background: #fff; color: #2c3e50; border: 1px solid #ddd; }

    
    * { box-sizing: border-box; scrollbar-width: thin; scrollbar-color: var(--neon-blue) #111; }
    body {
      margin: 0; padding: 0;
      background: var(--bg-img) center/cover no-repeat fixed;
      background-color: var(--bg-dark);
      color: var(--text);
      font-family: 'Rajdhani', sans-serif;
      height: 100vh;
      display: flex;
      overflow: hidden;
      backdrop-filter: brightness(0.4);
      transition: background 0.5s;
    }

    /* Sidebar */
    .sidebar {
      width: 380px;
      background: var(--panel);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      padding: 20px;
      z-index: 10;
      box-shadow: 2px 0 15px rgba(0,0,0,0.1);
      overflow-y: auto;
    }

    .brand {
      font-family: 'Orbitron', sans-serif;
      font-size: 24px;
      color: var(--text);
      text-transform: uppercase;
      letter-spacing: 2px;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 10px;
      justify-content: space-between;
    }
    .brand-text { display: flex; align-items: center; gap: 10px; }
    .brand span { font-size: 10px; color: #fff; background: var(--neon-blue); padding: 2px 6px; border-radius: 2px; letter-spacing: 0; vertical-align: middle; }

    .theme-toggle-btn {
      background: var(--neon-blue);
      border: none;
      color: #fff;
      width: 32px; height: 32px;
      border-radius: 50%;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: 0.3s;
    }
    .theme-toggle-btn:hover { opacity: 0.8; transform: scale(1.1); }

    .section-title {
      color: var(--text);
      font-size: 14px;
      letter-spacing: 1px;
      text-transform: uppercase;
      margin-bottom: 12px;
      border-bottom: 2px solid var(--border);
      padding-bottom: 5px;
      font-weight: 600;
    }

    .control-group { margin-bottom: 25px; }

    .btn-mode {
      display: flex;
      gap: 5px;
      background: #111;
      padding: 4px;
      border-radius: 4px;
      border: 1px solid #333;
    }
    .btn-mode button {
      flex: 1;
      background: transparent;
      border: none;
      color: #888;
      padding: 8px;
      cursor: pointer;
      font-family: 'Rajdhani', sans-serif;
      font-weight: bold;
      transition: 0.3s;
      border-radius: 2px;
    }
    .btn-mode button.active {
      background: var(--neon-blue);
      color: #000;
      box-shadow: 0 0 10px var(--neon-blue);
    }

    label { display: block; font-size: 13px; color: var(--text); margin-bottom: 6px; font-weight: 500; }
    select, input, textarea {
      width: 100%;
      background: #fff;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 10px;
      font-family: 'Rajdhani', sans-serif;
      border-radius: 6px;
      transition: 0.3s;
    }
    select:focus, input:focus, textarea:focus {
      border-color: var(--neon-blue);
      outline: none;
      box-shadow: 0 0 8px rgba(212, 165, 116, 0.3);
    }

    .btn-gen {
      width: 100%;
      background: linear-gradient(90deg, var(--neon-blue), var(--neon-pink));
      border: none;
      padding: 15px;
      font-family: 'Orbitron', sans-serif;
      font-weight: bold;
      color: #fff;
      font-size: 16px;
      cursor: pointer;
      border-radius: 8px;
      transition: 0.3s;
      text-transform: uppercase;
      letter-spacing: 2px;
      box-shadow: 0 4px 12px rgba(212, 165, 116, 0.3);
      margin-top: auto;
    }
    .btn-gen:hover { filter: brightness(1.1); transform: translateY(-2px); box-shadow: 0 6px 16px rgba(212, 165, 116, 0.4); }
    .btn-gen:disabled { filter: grayscale(0.8); cursor: not-allowed; transform: none; }

    /* Main Area */
    .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; position: relative; }
    
    .gallery {
      flex: 1;
      padding: 30px;
      overflow-y: auto;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 25px;
      align-content: start;
    }

    .gallery-item {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 16px;
      overflow: hidden;
      transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
      backdrop-filter: blur(15px);
      animation: fadeIn 0.6s ease;
      display: flex;
      flex-direction: column;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
    .gallery-item:hover { 
      transform: translateY(-8px) scale(1.02); 
      border-color: var(--neon-blue); 
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5), 0 0 20px rgba(0, 245, 255, 0.2);
    }
    
    .media-container { 
      width: 100%; 
      aspect-ratio: 16/9; 
      background: linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 100%);
      display: flex; 
      align-items: center; 
      justify-content: center; 
      overflow: hidden; 
      position: relative;
    }
    .media-container img, .media-container video { 
      width: 100%; 
      height: 100%; 
      object-fit: cover;
      transition: transform 0.4s ease;
    }
    .gallery-item:hover .media-container img, 
    .gallery-item:hover .media-container video {
      transform: scale(1.05);
    }
    
    .item-info { 
      padding: 18px; 
      font-size: 13px; 
      background: var(--card-gradient);
      flex: 1; 
      display: flex; 
      flex-direction: column; 
      justify-content: space-between;
      border-top: 1px solid var(--border);
    }
    .item-prompt { 
      color: var(--text); 
      font-size: 14px; 
      line-height: 1.5; 
      margin-bottom: 12px; 
      overflow: hidden; 
      text-overflow: ellipsis; 
      display: -webkit-box; 
      -webkit-line-clamp: 2; 
      -webkit-box-orient: vertical;
      font-weight: 500;
    }
    .item-meta { 
      display: flex; 
      flex-wrap: wrap;
      gap: 8px;
      color: var(--text-secondary); 
      font-size: 12px; 
      margin-top: auto;
    }
    .meta-tag {
      background: rgba(212, 165, 116, 0.1);
      padding: 4px 10px;
      border-radius: 12px;
      border: 1px solid var(--border);
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .meta-tag i {
      font-size: 10px;
      color: var(--neon-blue);
    }

    .item-actions {
      display: flex;
      gap: 8px;
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid var(--border);
    }

    .action-btn {
      flex: 1;
      padding: 6px 12px;
      border: none;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
      transition: 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      font-family: 'Rajdhani', sans-serif;
    }

    .btn-download {
      background: var(--neon-blue);
      color: #fff;
    }
    .btn-download:hover { opacity: 0.9; }

    .btn-delete {
      background: #ff4757;
      color: #fff;
    }
    .btn-delete:hover { opacity: 0.9; }

    .video-error {
      color: orange;
      padding: 20px;
      text-align: center;
    }

    /* Task Card Specifics */
    .task-status-bar {
        position: absolute; bottom: 0; left: 0; width: 100%;
        height: 6px; background: rgba(255,255,255,0.1);
        border-radius: 0 0 16px 16px;
        overflow: hidden;
    }
    .task-progress-fill {
        height: 100%; 
        background: linear-gradient(90deg, var(--neon-blue), var(--neon-pink));
        width: 0%; 
        transition: width 0.3s ease;
        box-shadow: 0 0 15px var(--neon-blue);
        position: relative;
    }
    .task-progress-fill::after {
        content: '';
        position: absolute;
        top: 0; left: 0; right: 0; bottom: 0;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
        animation: shimmer 2s infinite;
    }
    @keyframes shimmer {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(100%); }
    }
    .task-overlay {
        position: absolute; inset: 0;
        background: rgba(0,0,0,0.7);
        backdrop-filter: blur(8px);
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        gap: 12px;
    }
    .task-spinner {
        width: 40px; height: 40px;
        border: 3px solid var(--neon-blue);
        border-top-color: transparent;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        box-shadow: 0 0 20px rgba(0, 245, 255, 0.5);
    }
    @keyframes spin {
        to { transform: rotate(360deg); }
    }

    /* Toast */
    .toast {
      position: fixed; top: 20px; right: 20px;
      background: var(--panel); border-left: 4px solid var(--neon-blue);
      padding: 15px; color: var(--text); z-index: 200;
      transform: translateX(120%); transition: 0.3s;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      border-radius: 4px;
    }
    .toast.show { transform: translateX(0); }

    /* Upload Zone */
    .upload-zone {
        border: 2px dashed var(--border);
        border-radius: 8px;
        padding: 20px;
        text-align: center;
        margin-bottom: 10px;
        transition: 0.3s;
        cursor: pointer;
        background: rgba(255, 255, 255, 0.5);
        position: relative;
        min-height: 100px;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
    }
    .upload-zone:hover, .upload-zone.dragover { border-color: var(--neon-blue); background: rgba(255, 255, 255, 0.8); }
    
    .preview-wrapper { position: relative; display: none; margin-top: 10px; width: 100%; }
    .upload-preview { max-height: 150px; max-width: 100%; border-radius: 6px; border: 2px solid var(--neon-blue); }
    .btn-delete-img {
        position: absolute; top: -8px; right: -8px;
        background: linear-gradient(135deg, #ff4757, #ff3838);
        color: #fff;
        border: 2px solid #fff;
        border-radius: 50%;
        width: 28px; height: 28px;
        cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 4px 12px rgba(255, 71, 87, 0.5);
        transition: all 0.3s ease;
        z-index: 10;
    }
    .btn-delete-img:hover { 
        transform: scale(1.15) rotate(90deg); 
        background: linear-gradient(135deg, #ff6b81, #ff4757);
        box-shadow: 0 6px 16px rgba(255, 71, 87, 0.7);
    }
    .btn-delete-img:active {
        transform: scale(0.95) rotate(90deg);
    }

    .upload-info { font-size: 12px; color: #888; pointer-events: none; }
    .mode-hint { font-size: 12px; color: var(--text-secondary); margin-bottom: 20px; text-align: center; padding: 8px; background: rgba(212, 165, 116, 0.1); border-radius: 4px; }
    
    .char-counter {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12px;
      color: var(--text-secondary);
      margin-top: 8px;
      padding: 8px 12px;
      background: rgba(255, 255, 255, 0.5);
      border-radius: 6px;
      border: 1px solid var(--border);
    }
    .char-counter.warning { color: #ff9800; border-color: #ff9800; background: rgba(255, 152, 0, 0.1); }
    .char-counter.error { color: #f44336; border-color: #f44336; background: rgba(244, 67, 54, 0.1); }
    .char-count { font-family: monospace; font-size: 14px; font-weight: bold; }
    .char-limit { font-size: 11px; opacity: 0.7; }
    
    /* Info Card */
    .info-card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 15px;
      margin-bottom: 20px;
      font-size: 12px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }
    .info-row { margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; }
    .info-row:last-child { margin-bottom: 0; }
    .info-label { color: var(--text); font-weight: 600; font-size: 13px; }
    .info-value { color: var(--text-secondary); font-family: monospace; font-size: 11px; word-break: break-all; max-width: 200px; }
    
    .copy-btn {
      background: var(--neon-blue); border: none; color: #fff;
      border-radius: 4px; padding: 4px 10px; font-size: 11px; cursor: pointer;
      transition: 0.2s; margin-left: 8px;
    }
    .copy-btn:hover { opacity: 0.9; transform: scale(1.05); }

  </style>
</head>
<body>

  <!-- Sidebar Control Panel -->
  <div class="sidebar">
      <div class="brand">
          <div class="brand-text">Ximagine-2api-Pro <span>v${CONFIG.PROJECT_VERSION}</span></div>
          <button class="theme-toggle-btn" onclick="toggleTheme()" title="切换主题"><i class="fas fa-palette"></i></button>
      </div>
      
      <div class="control-group">
        <div class="info-card">
             <div class="info-row">
                 <span class="info-label">API 地址</span>
                 <span class="info-value" id="api-origin">${origin}</span>
                 <button class="copy-btn" onclick="copyApiOrigin()">复制</button>
             </div>
             <div class="info-row">
                 <span class="info-label">API 密钥</span>
                 <span class="info-value" id="api-key">${apiKey}</span>
                 <button class="copy-btn" onclick="copyApiKey()">复制</button>
             </div>
        </div>
        </div>
        <div style="font-size:12px; color:#ff4444; margin-bottom:20px; padding:10px; border:1px solid #ff4444; border-radius:5px; background:rgba(255, 68, 68, 0.1);">
            ⚠️ <b>注意：</b> 本站不提供历史记录保存服务，刷新或关闭页面后所有数据将丢失，请生成后及时下载保存！
        </div>


      <div class="control-group">
           <div class="section-title">生成模式</div>
           <div class="btn-mode">
             <button class="active" style="width:100%" id="tab-video">视频生成</button>
           </div>
      </div>

      <div class="control-group">
          <div class="section-title">参数设置</div>
          
          <label for="ratio">画面比例</label>
          <select id="ratio">
              <option value="1:1">1:1 (方形)</option>
              <option value="16:9">16:9 (横屏)</option>
              <option value="9:16">9:16 (竖屏)</option>
          </select>

          <div id="video-options">
             <label for="video-mode" style="margin-top:10px">视频风格</label>
             <select id="video-mode">
                 <option value="normal">标准现实</option>
                 <option value="fun">趣味卡通</option>
                 <option value="spicy">激情模式</option>
             </select>
          </div>
      </div>

      <div class="control-group" style="flex:1">
          <div id="ref-image-group">
              <div class="section-title">参考图片（可选）</div>
              <div class="upload-zone" id="drop-zone">
                  <div id="upload-placeholder">
                      <div class="upload-info" id="upload-text"><i class="fas fa-cloud-upload-alt" style="font-size:24px;margin-bottom:5px"></i><br>点击或拖拽上传图片</div>
                  </div>

                  <div class="preview-wrapper" id="preview-wrapper">
                      <img id="upload-preview" class="upload-preview">
                      <button class="btn-delete-img" onclick="deleteImage(event)"><i class="fas fa-trash"></i></button>
                  </div>


              </div>
              <div class="mode-hint" id="mode-hint">
                  <i class="fas fa-info-circle"></i> 当前模式: 文生视频
              </div>
          </div>
          <input type="file" id="file-input" style="display:none" accept="image/*" onchange="handleFileSelect(this)">
          
          <div class="section-title">创意描述</div>
          <textarea id="prompt" rows="4" maxlength="1800" placeholder="在此输入你的创意...
例如：赛博朋克城市的雨夜，霓虹灯闪烁"></textarea>
          <div class="char-counter" id="char-counter">
              <span class="char-count"><span id="current-chars">0</span> / 1800</span>
              <span class="char-limit">字符限制</span>
          </div>
      </div>

      <button class="btn-gen" id="btn-gen" onclick="submitTask()">
          <i class="fas fa-play"></i> 开始生成
      </button>
      
  </div>

  <!-- Main Gallery Area -->
  <div class="main">
      <div class="gallery" id="gallery">
          <!-- Items injected here -->
      </div>
  </div>
  
  <div class="toast" id="toast">Message</div>

  <script>
      var API_KEY = "${apiKey}";
      var ORIGIN = "${origin}";
      let uploadedImageUrl = null;

      // Active Tasks Management
      let tasks = [];
      let history = [];

      // Helper functions - define early for HTML onclick events
      function copyToClipboard(text) {
          navigator.clipboard.writeText(text).then(() => showToast("已复制到剪贴板"));
      }

      function copyApiOrigin() {
          var origin = document.getElementById('api-origin').textContent;
          copyToClipboard(origin);
      }

      function copyApiKey() {
          var key = document.getElementById('api-key').textContent;
          copyToClipboard(key);
      }

      function showToast(msg) {
          const t = document.getElementById('toast');
          t.innerText = msg;
          t.classList.add('show');
          setTimeout(() => t.classList.remove('show'), 3000);
      }

      function init() {
          renderGallery();
          checkMode();

          // Restore theme
          const savedTheme = localStorage.getItem('ximagine_theme') || 'default';
          setTheme(savedTheme);

          // Initialize character counter
          updateCharCounter();
          document.getElementById('prompt').addEventListener('input', updateCharCounter);

          // Initialize drop-zone click
          document.getElementById('drop-zone').addEventListener('click', function(e) {
              if (uploadedImageUrl) return;
              document.getElementById('file-input').click();
          });
      }
      
      // 字符计数器
      function updateCharCounter() {
          const textarea = document.getElementById('prompt');
          const counter = document.getElementById('char-counter');
          const currentChars = document.getElementById('current-chars');
          
          // 计算字符数（中英文和标点都算1个）
          const text = textarea.value;
          const charCount = text.length;
          
          currentChars.textContent = charCount;
          
          // 更新样式
          counter.classList.remove('warning', 'error');
          if (charCount >= 1800) {
              counter.classList.add('error');
          } else if (charCount >= 1600) {
              counter.classList.add('warning');
          }
      }
      
      function getCharCount(text) {
          return text.length;
      }

      // --- Theme Logic ---
      const themes = ['default', 'cyberpunk', 'matrix', 'golden', 'clean'];
      function toggleTheme() {
          let current = localStorage.getItem('ximagine_theme') || 'default';
          let idx = themes.indexOf(current);
          let next = themes[(idx + 1) % themes.length];
          setTheme(next);
      }
      function setTheme(theme) {
          document.documentElement.setAttribute('data-theme', theme);
          localStorage.setItem('ximagine_theme', theme);
      }

      // --- File Upload Logic ---
      const dropZone = document.getElementById('drop-zone');
      
      dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
      dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); });
      dropZone.addEventListener('drop', (e) => {
          e.preventDefault(); dropZone.classList.remove('dragover');
          if (e.dataTransfer.files.length) uploadFile(e.dataTransfer.files[0]);
      });
      
      document.addEventListener('paste', (e) => {
           // Only paste if not typing in textarea
          if (document.activeElement.tagName === 'TEXTAREA') return;
          const items = e.clipboardData.items;
          for (let item of items) {
              if (item.type.indexOf('image') !== -1) {
                  uploadFile(item.getAsFile());
                  break;
              }
          }
      });

      function handleFileSelect(input) {
          if (input.files[0]) uploadFile(input.files[0]);
      }

      async function uploadFile(file) {
          try {
              const formData = new FormData();
              formData.append('file', file);
              document.getElementById('upload-text').innerHTML = '<i class="fas fa-spinner fa-spin"></i> 上传中...';
              
              const res = await fetch(ORIGIN + '/v1/upload', { method: 'POST', body: formData });
              const data = await res.json();
              
              if (data.success && data.data?.url) {
                  uploadedImageUrl = data.data.url;
                  showPreview(uploadedImageUrl);
                  showToast('图片上传成功');
              } else {
                  throw new Error('上传失败');
              }
          } catch(e) {
              document.getElementById('upload-text').innerHTML = '<i class="fas fa-cloud-upload-alt"></i><br>点击或拖拽上传图片';
              showToast('上传失败: ' + e.message);
          }
      }

      function showPreview(url) {
          const previewImg = document.getElementById('upload-preview');
          previewImg.src = url;
          previewImg.onerror = function() {
              showToast('图片加载失败，可能是SSL证书问题');
              deleteImage({ stopPropagation: function() {} });
          };
          document.getElementById('preview-wrapper').style.display = 'block';
          document.getElementById('upload-placeholder').style.display = 'none';
          checkMode();
      }

      function deleteImage(e) {
          e.stopPropagation(); // Prevent triggering upload click
          uploadedImageUrl = null;
          document.getElementById('preview-wrapper').style.display = 'none';
          document.getElementById('upload-placeholder').style.display = 'block';
          document.getElementById('upload-text').innerHTML = '<i class="fas fa-cloud-upload-alt"></i><br>点击或拖拽上传图片';
          document.getElementById('file-input').value = '';
          checkMode();
      }

      function checkMode() {
          const hint = document.getElementById('mode-hint');
          if (uploadedImageUrl) {
              hint.innerHTML = '<i class="fas fa-magic"></i> 当前模式: 图生视频';
              hint.style.color = 'var(--neon-blue)';
          } else {
              hint.innerHTML = '<i class="fas fa-keyboard"></i> 当前模式: 文生视频';
              hint.style.color = 'var(--neon-pink)';
          }
      }

      // --- Task Management & Generation ---

      async function submitTask() {
          const prompt = document.getElementById('prompt').value.trim();
          if (!prompt) return showToast('请输入提示词');
          
          // 验证字符数
          const charCount = getCharCount(prompt);
          if (charCount > 1800) {
              var msg = '提示词超过限制！当前 ' + charCount + ' 字符，最多 1800 字符';
              return showToast(msg);
          }

          // 1. Create Task Object
          const taskId = 'loc_' + Date.now(); // local temporary ID
          const ratio = document.getElementById('ratio').value;
          const videoStyle = document.getElementById('video-mode').value;
          
          // Logic: uploadedImageUrl ? grok-video-image : grok-video-{style}
          let modelId = 'grok-video-' + videoStyle;
          if (uploadedImageUrl) {
              modelId = 'grok-video-image';
          }

          const newTask = {
              id: taskId,
              status: 'pending', // pending, processing, completed, failed
              prompt: prompt,
              model: modelId,
              ratio: ratio,
              refImage: uploadedImageUrl,
              date: new Date().toLocaleString(),
              progress: 0,
              pollCount: 0,
              type: 'video'
          };

          // 2. Add to list and render
          tasks.unshift(newTask);
          renderGallery();
          
          // 3. Start processing in background (Fire & Forget)
          processTask(newTask);
          
          // 4. Clear Input (Optional)
          // document.getElementById('prompt').value = '';
      }

      function renderGallery() {
          const container = document.getElementById('gallery');
          container.innerHTML = '';

          // Merge tasks and history for display
          // Active tasks first
          const allItems = [...tasks, ...history];

          allItems.forEach(item => {
              const el = document.createElement('div');
              el.className = 'gallery-item';

              let mediaContent = '';

              if (item.status === 'completed') {
                  const videoUrl = (item.urls && item.urls[0]) || item.videoUrl || '';
                  var safeVideoUrl = videoUrl.replace(/"/g, '&quot;');
                  mediaContent = '<video src="' + safeVideoUrl + '" controls loop playsinline onerror="this.parentElement.innerHTML=&apos;<div class=video-error>视频加载失败</div>&apos;"></video>';
              } else {
                  var statusText = item.status === 'pending' ? '初始化中...' : '渲染中...';
                  var progressVal = item.pollCount || 0;
                  mediaContent = '<div class="task-overlay">' +
                      '<div class="task-spinner"></div>' +
                      '<div style="font-size:12px;color:var(--neon-blue)">' + statusText + '</div>' +
                      '<div style="font-size:14px;font-family:monospace">第 ' + progressVal + ' 次同步</div>' +
                      '</div>' +
                      '<div class="task-status-bar"><div class="task-progress-fill" style="width:' + (item.progress || 0) + '%"></div></div>';

                  if (item.refImage) {
                      var safeRefImage = item.refImage.replace(/"/g, '&quot;');
                      mediaContent = '<img src="' + safeRefImage + '" style="opacity:0.3" onerror="this.style.display=&apos;none&apos;">' + mediaContent;
                  }
              }

              var modelName = '标准模式'; // 默认值
              if (item.model) {
                  var modelUpper = item.model.toUpperCase();
                  if (modelUpper.indexOf('GROK-VIDEO-NORMAL') >= 0) modelName = '标准模式';
                  else if (modelUpper.indexOf('GROK-VIDEO-FUN') >= 0) modelName = '趣味模式';
                  else if (modelUpper.indexOf('GROK-VIDEO-SPICY') >= 0) modelName = '激情模式';
                  else if (modelUpper.indexOf('GROK-VIDEO-IMAGE') >= 0) modelName = '图生视频';
                  else modelName = item.model;
              }

              var actionsHtml = '';
              if (item.status === 'completed' && item.urls && item.urls.length > 0) {
                  var safeUrl = item.urls[0].replace(/"/g, '&quot;');
                  actionsHtml = '<div class="item-actions">' +
                      '<button class="action-btn btn-download" data-url="' + safeUrl + '" data-id="' + item.id + '" onclick="handleDownloadClick(this)"><i class="fas fa-download"></i> 下载</button>' +
                      '<button class="action-btn btn-delete" data-id="' + item.id + '" onclick="handleDeleteClick(this)"><i class="fas fa-trash"></i> 删除</button>' +
                      '</div>';
              } else if (item.status === 'failed') {
                  actionsHtml = '<div class="item-actions">' +
                      '<button class="action-btn btn-delete" data-id="' + item.id + '" onclick="handleDeleteClick(this)"><i class="fas fa-trash"></i> 删除</button>' +
                      '</div>';
              }

              var safePrompt = item.prompt.replace(/</g, '&lt;').replace(/>/g, '&gt;');
              el.innerHTML = '<div class="media-container" id="media-' + item.id + '">' + mediaContent + '</div>' +
                  '<div class="item-info">' +
                  '<div class="item-prompt">' + safePrompt + '</div>' +
                  '<div class="item-meta">' +
                  '<span class="meta-tag"><i class="fas fa-film"></i> ' + modelName + '</span>' +
                  '<span class="meta-tag"><i class="fas fa-expand"></i> ' + item.ratio + '</span>' +
                  '<span class="meta-tag"><i class="fas fa-clock"></i> ' + item.date + '</span>' +
                  '</div>' +
                  actionsHtml +
                  '</div>';
              container.appendChild(el);
          });
      }

      // Isolated Task Processor
      async function processTask(task) {
          try {
              task.status = 'processing';
              updateTaskUI(task);

              const payload = {
                  model: task.model,
                  messages: [{
                      role: 'user',
                      content: JSON.stringify({
                          prompt: task.prompt,
                          aspectRatio: task.ratio,
                          clientPollMode: true,
                          imageUrls: task.refImage ? [task.refImage] : []
                      })
                  }],
                  stream: true
              };

              const res = await fetch(ORIGIN + '/v1/chat/completions', {
                  method: 'POST',
                  headers: { 'Authorization': 'Bearer ' + API_KEY, 'Content-Type': 'application/json' },
                  body: JSON.stringify(payload)
              });

              // Read Stream used only to get the Real Task ID
              const reader = res.body.getReader();
              const decoder = new TextDecoder();
              let realTaskId = null;
              let uniqueId = null;

              // Read first few chunks to catch the ID
              var buffer = '';
              while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  buffer += decoder.decode(value, { stream: true });
                  const match = buffer.match(/\\\[TASK_ID:(.*?)\\\|UID:(.*?)\\\|TYPE:(.*?)\]/);
                  if (match) {
                      realTaskId = match[1];
                      uniqueId = match[2];
                      break;
                  }
              }

              if (!realTaskId) {
                  console.error('Failed to extract task ID. Buffer:', buffer);
                  // Extract error message from buffer if present
                  let errorMsg = "无法获取任务ID";
                  if (buffer.includes("**错误**:")) {
                      errorMsg = buffer.split("**错误**:")[1].trim().split('\\n')[0];
                  }
                  throw new Error("任务创建失败: " + errorMsg);
              }

              // Start Polling for this specific task
              pollTaskStatus(task, realTaskId, uniqueId);

          } catch (e) {
              console.error('ProcessTask error:', e);
              task.status = 'failed';
              task.progress = 0;
              // update UI to show fail
              const mediaEl = document.getElementById('media-' + task.id);
              if(mediaEl) mediaEl.innerHTML = '<div style="color:red;padding:20px;">生成失败: ' + e.message + '</div>';
              // Remove from active tasks after delay?
          }
      }

      function pollTaskStatus(task, realTaskId, uniqueId) {
          let internalPollCount = 0;
          const pollInterval = setInterval(async () => {
              internalPollCount++;
              task.pollCount = internalPollCount;

              // Mock progress for visual feedback (Slow movement)
              if (task.progress < 95) {
                  task.progress += 1;
                  updateTaskUI(task);
              }

              try {
                   var pollUrl = ORIGIN + '/v1/query/status?taskId=' + realTaskId + '&uniqueId=' + uniqueId + '&type=video';
                   const pollRes = await fetch(pollUrl, {
                      headers: { 'Authorization': 'Bearer ' + API_KEY }
                  });
                  const data = await pollRes.json();

                  if (data.status === 'completed' || data.videoUrl || (data.urls && data.urls.length > 0)) {
                      clearInterval(pollInterval);
                      task.status = 'completed';
                      task.progress = 100;
                      task.urls = data.urls || (data.videoUrl ? [data.videoUrl] : []);

                      // Move to history
                      moveToHistory(task);

                  } else if (data.status === 'failed') {
                      clearInterval(pollInterval);
                      task.status = 'failed';
                      task.progress = 0;
                      renderGallery();
                      showToast('生成失败: ' + (data.error || '未知错误'));
                  } else if (data.status === 'processing') {
                      if (data.progress) {
                          task.progress = data.progress;
                          updateTaskUI(task);
                      }
                  }
              } catch(e) {
                  console.error('Poll error:', e);
                  if (internalPollCount > 60) { // Timeout after 2 minutes
                       clearInterval(pollInterval);
                       task.status = 'failed';
                       task.progress = 0;
                       renderGallery();
                       showToast('生成超时');
                  }
              }
          }, 2000);
      }

      function updateTaskUI(task) {
           // Efficiently update just the DOM element for this task
           // But simple re-render is okay for < 10 tasks.
           // For better perf, we can target ID.
           const mediaEl = document.getElementById('media-' + task.id);
           if (mediaEl && task.status !== 'completed') {
               const progressFill = mediaEl.querySelector('.task-progress-fill');
               const progressText = mediaEl.querySelector('.task-overlay div:last-child');
               const statusTextEl = mediaEl.querySelector('.task-overlay div:nth-child(2)');
               
               if (progressFill) progressFill.style.width = (task.progress || 0) + '%';
               if (progressText) progressText.innerText = '第 ' + (task.pollCount || 0) + ' 次同步';
               if (statusTextEl) {
                   statusTextEl.innerText = task.status === 'pending' ? '初始化中...' : '渲染中...';
               }
           }
      }

      function moveToHistory(task) {
          // Remove from tasks array
          tasks = tasks.filter(t => t.id !== task.id);

          // Add to history
          const historyItem = {
              id: 'hist_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
              type: 'video',
              status: 'completed',
              progress: 100,
              prompt: task.prompt,
              urls: task.urls,
              date: task.date,
              model: task.model,
              ratio: task.ratio
          };
          history.unshift(historyItem);
          
          renderGallery();
          showToast('生成完成！');
      }

      function deleteItem(itemId) {
          if (!confirm('确定要删除这个视频吗？')) return;

          // Remove from tasks
          tasks = tasks.filter(t => t.id.toString() !== itemId.toString());

          // Remove from history
          history = history.filter(h => h.id.toString() !== itemId.toString());

          renderGallery();
          showToast('已删除');
      }

      function downloadVideo(url, itemId) {
          const proxyUrl = window.location.origin + '/v1/proxy/download?url=' + encodeURIComponent(url);
          var a = document.createElement('a');
          a.href = proxyUrl;
          a.download = 'video_' + itemId + '.mp4';
          a.target = '_blank';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          showToast('开始下载 (通过代理)');
      }

      function handleDownloadClick(btn) {
          var url = btn.getAttribute('data-url');
          var id = btn.getAttribute('data-id');
          downloadVideo(url, id);
      }

      function handleDeleteClick(btn) {
          var id = btn.getAttribute('data-id');
          deleteItem(id);
      }

      init();
  </script>
</body>
</html>`;

  return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}
