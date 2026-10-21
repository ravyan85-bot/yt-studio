// Chạy: node server.js  (Node 18+)  → mở http://localhost:3000
// Tạo file .env cạnh file này:
//   ANTHROPIC_API_KEY=sk-ant-...        CLAUDE_MODEL=claude-sonnet-5-5
//   APP_PASSWORD=...  (đặt khi đưa lên mạng, để người lạ không dùng key của bạn)
//   GEMINI_API_KEY=...   (lấy ở aistudio.google.com, dùng cho cả ảnh và video)
//   IMAGE_MODEL=gemini-2.5-flash-image   VIDEO_MODEL=veo-3.0-generate-001   (tuỳ chọn, đổi model nếu muốn)
const http = require('http'), fs = require('fs'), path = require('path');
try { fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n').forEach(l => { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/); if (m) process.env[m[1]] ??= m[2]; }); } catch {}
const E = process.env;
const G = 'https://generativelanguage.googleapis.com/v1beta', GH = { 'content-type': 'application/json', 'x-goog-api-key': E.GEMINI_API_KEY };
const J = async (url, opt) => { const r = await fetch(url, opt), t = await r.text(); if (!r.ok) throw new Error(r.status + ' ' + t.slice(0, 300)); return JSON.parse(t); };

const api = {
  async claude({ system, content }) {
    const d = await J('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': E.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: E.CLAUDE_MODEL || 'claude-sonnet-5-5', max_tokens: 2000, system, messages: [{ role: 'user', content }] })
    });
    return { text: d.content.map(c => c.text || '').join('') };
  },
  // ẢNH: Gemini (generateContent). Có ảnh tham chiếu thì gửi kèm để sửa/tạo theo ảnh đó.
  async image({ prompt, ref }) {
    const parts = [{ text: prompt || 'Tạo một ảnh đẹp' }];
    if (ref) { const m = /^data:(.+?);base64,(.+)$/.exec(ref); parts.push({ inline_data: { mime_type: m[1], data: m[2] } }); }
    const d = await J(`${G}/models/${E.IMAGE_MODEL || 'gemini-2.5-flash-image'}:generateContent`, {
      method: 'POST', headers: GH,
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } })
    });
    const p = (d.candidates?.[0]?.content?.parts || []).map(x => x.inlineData || x.inline_data).find(Boolean);
    if (!p) throw new Error('Gemini không trả về ảnh: ' + JSON.stringify(d).slice(0, 300));
    return { image: `data:${p.mimeType || p.mime_type};base64,${p.data}` };
  },
  // VIDEO: Veo qua Gemini API (cùng họ model với Google Flow). Flow không có API riêng.
  async video({ prompt, image }) {
    const inst = { prompt: prompt || 'Cinematic video' };
    if (image) { const m = /^data:(.+?);base64,(.+)$/.exec(image); inst.image = { bytesBase64Encoded: m[2], mimeType: m[1] }; }
    const j = await J(`${G}/models/${E.VIDEO_MODEL || 'veo-3.0-generate-001'}:predictLongRunning`, { method: 'POST', headers: GH, body: JSON.stringify({ instances: [inst] }) });
    for (let i = 0; i < 120; i++) {
      const s = await J(`${G}/${j.name}`, { headers: GH });
      if (s.done) {
        if (s.error) throw new Error(s.error.message);
        const uri = s.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
        if (!uri) throw new Error('Không có video: ' + JSON.stringify(s).slice(0, 300));
        const r = await fetch(uri, { headers: GH, redirect: 'follow' });
        if (!r.ok) throw new Error('Tải video lỗi ' + r.status);
        return { video: 'data:video/mp4;base64,' + Buffer.from(await r.arrayBuffer()).toString('base64') };
      }
      await new Promise(r => setTimeout(r, 8000));
    }
    throw new Error('Tạo video quá lâu');
  }
};

http.createServer(async (q, s) => {
  if (E.APP_PASSWORD) { // Bật khi đưa lên mạng: trình duyệt sẽ hỏi mật khẩu, tên đăng nhập gõ gì cũng được
    const a = Buffer.from((q.headers.authorization || '').split(' ')[1] || '', 'base64').toString().split(':').slice(1).join(':');
    if (a !== E.APP_PASSWORD) { s.statusCode = 401; s.setHeader('www-authenticate', 'Basic realm="YT Studio"'); return s.end('Can mat khau'); }
  }
  if (q.method === 'GET') { s.setHeader('content-type', 'text/html;charset=utf-8'); return s.end(fs.readFileSync(path.join(__dirname, 'index.html'))); }
  let b = ''; for await (const c of q) b += c;
  try {
    const n = q.url.split('/').pop(); if (!api[n]) throw new Error('Không có API ' + n);
    s.setHeader('content-type', 'application/json'); s.end(JSON.stringify(await api[n](JSON.parse(b || '{}'))));
  } catch (e) { s.statusCode = 500; s.end(JSON.stringify({ error: e.message })); }
}).listen(E.PORT || 3000, () => console.log('Đang chạy, cổng ' + (E.PORT || 3000)));
