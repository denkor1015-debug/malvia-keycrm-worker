// ============================================================
// KeyCRM MCP Server для Cloudflare Workers
// Версія 8.5 — OAuth 2.1, секрет більше не потрібен в URL.
//
// ЗМІНИ ПРОТИ v8.4 (безпека; логіка тулів не чіпалась):
//   [НОВЕ] справжній OAuth 2.1 з PKCE — саме те, чого клієнт Claude шукав сам,
//          отримуючи 401. Ендпоінти: /.well-known/oauth-protected-resource,
//          /.well-known/oauth-authorization-server, /register, /authorize, /token.
//          Тепер в URL конектора лишається чистий /mcp, а секрет вводиться один
//          раз на екрані входу й далі живе як токен на стороні клієнта.
//   [НОВЕ] стан НЕ зберігається ніде: client_id, код і токен — блоби, підписані
//          HMAC-SHA256 на MCP_SHARED_SECRET. Жодних KV/D1/Durable Objects.
//   [ФІКС] /mcp знову віддає 401, але тепер з WWW-Authenticate на метадані —
//          у v8.4 стояв 403, бо OAuth не було й 401 вів клієнта в нікуди.
//   [ЗБЕРЕЖЕНО] X-MCP-Key і /mcp/<секрет> працюють як раніше — для curl і мосту.
//
// ЗМІНИ ПРОТИ v8.3 (безпека; логіка тулів не чіпалась):
//   [ФІКС] /mcp більше не відкритий. Був доступний будь-кому, хто знає URL,
//          разом із правом ЗАПИСУ: create_order, update_order, update_product,
//          add_order_tag, upload_file. Тепер потрібен MCP_SHARED_SECRET —
//          заголовком X-MCP-Key, або Authorization: Bearer, або сегментом
//          шляху /mcp/<секрет> для клієнтів, де задається лише URL.
//          Фейлиться ЗАКРИТО: без заданого секрету сервер не пускає нікого.
//   [ФІКС] прибрано Access-Control-Allow-Origin: '*'. Обидва клієнти ходять
//          із сервера, CORS їм не потрібен, а '*' дозволяв виклики з браузера
//          будь-якої сторінки.
//   [ФІКС] serverInfo.version відставав: 8.0.0 → 8.4.0.
//
// ЗМІНИ ПРОТИ v8.2 (тільки додано):
//   [НОВЕ] у рядках з'явилось поле closed — дата закриття замовлення.
//          Без неї калькулятор обрізав вибірку за датою СТВОРЕННЯ, і в
//          покриття червня падали 137 замовлень, створених 21–30 червня, а
//          викуплених уже в липні, — тоді як 74 травневі, викуплені в червні,
//          випадали зовсім. Покриття показувало 454 з 599 замість 453 з 455.
//
// ЗМІНИ ПРОТИ v8.1 (тільки додано, нічого не видалено):
//   [НОВЕ] get_period_summary: параметр rows. При rows:true до підсумку
//          додається масив «рядки» — по одному рядку на позицію замовлення
//          (замовлення · ТТН · товар · кількість · знижка · ціна · тег).
//          Це рівно те, що раніше доводилось вивантажувати руками з CRM
//          у калькулятор. Підсумок при цьому не змінюється ні на копійку:
//          rows нічого не перераховує, лише віддає те саме сировиною.
//          Без rows поведінка v8.1 збережена байт у байт.
//
// ЗМІНИ ПРОТИ v8.0 (тільки додано/виправлено, нічого не видалено):
//   [НОВЕ] get_period_summary: виручка за типами (товар/Преміум/пакування),
//          одиниці по виробниках, кількість по артикулах. Замінює ручну
//          вигрузку CRM у шаблон «Подсчеты». Точний режим — за списком ТТН
//          із реєстру NovaPay (гривня належить місяцю свого реєстру).
//   [ФІКС] вартість повернення НП у get_product_pl: 120 → 94 грн
//          (заміряно на 1489 актах, березень–червень 2026; 120 завищувало ~28%).
//
// ЗМІНИ ПРОТИ v7.0 (тільки додано/виправлено, нічого не видалено):
//   [ФІКС] get_funnel_by_campaign: прибрано хибний filter[utm_campaign]
//          (KeyCRM API його не дозволяє → 400). Фільтр лишився клієнтський.
//   [ФІКС] у воронки додано ВИРУЧКУ (сума grand_total по виконаних) → ROAS.
//   [НОВЕ] get_funnel_by_creative: воронка по utm_content (конкретний креатив)
//          + utm_term (ID оголошення Meta) + виручка + середній чек викупу.
//   [НОВЕ] list_orders: параметр page (посторінково) + метадані пагінації
//          (page/last_page/total) + utm_content/utm_term/utm_medium у виводі.
//          Це дозволяє тягнути ВСІ замовлення частинами навіть на безкоштовному
//          плані Cloudflare (кожен виклик = 1 сторінка = 1 підзапит, без ліміту).
//   [НОВЕ] get_orders_by_date: додано utm_content/utm_term у вивід.
// ============================================================

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return corsResponse(null, 204);
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/') {
      return corsResponse(JSON.stringify({ status: 'KeyCRM MCP Server v8.5 running ✓' }), 200);
    }

    // OAuth 2.1 — те, що клієнт Claude шукає сам, отримавши 401 від /mcp.
    if (request.method === 'GET' && url.pathname === '/.well-known/oauth-protected-resource') {
      return oauthProtectedResource(url);
    }
    if (request.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server') {
      return oauthServerMetadata(url);
    }
    if (request.method === 'POST' && url.pathname === '/register') return oauthRegister(request, url, env);
    if (url.pathname === '/authorize' && (request.method === 'GET' || request.method === 'POST')) {
      return oauthAuthorize(request, url, env);
    }
    if (request.method === 'POST' && url.pathname === '/token') return oauthToken(request, url, env);

    // /mcp або /mcp/<секрет> — друге лишається для curl і keycrm_bridge.py.
    if (request.method === 'POST' && (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/'))) {
      if (!await isAuthorized(request, url, env)) return unauthorized(env, url);
      return handleMCP(request, env);
    }
    return corsResponse(JSON.stringify({ error: 'Not found' }), 404);
  }
};

// ─── Авторизація ──────────────────────────────────────
//
// Секрет задається одним із трьох способів — береться перший наявний:
//   1. заголовок  X-MCP-Key: <секрет>        — для keycrm_bridge.py (stdio)
//   2. заголовок  Authorization: Bearer <секрет>  — для клієнтів з OAuth-полем
//   3. шлях       POST /mcp/<секрет>              — для конектора, де в UI є лише URL
//
// Фейлиться ЗАКРИТО: якщо MCP_SHARED_SECRET не заданий у секретах воркера,
// сервер не пускає нікого. Краще впасти голосно, ніж тихо стояти відкритим.
//
// ВАЖЛИВО: секрет має бути ASCII. HTTP-заголовок фізично не може нести
// символи поза 0-255, тож кирилиця у секреті зламає варіанти 1 і 2.

async function isAuthorized(request, url, env) {
  const expected = env.MCP_SHARED_SECRET;
  if (!expected) return false;

  const headerKey = request.headers.get('X-MCP-Key');
  if (headerKey) return safeEqual(headerKey, expected);

  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) {
    const bearer = auth.slice(7);
    // Спершу OAuth-токен, виданий нашим /token; якщо ні — сирий спільний секрет.
    if (await verifyBlob(bearer, expected, 'tok')) return true;
    return safeEqual(bearer, expected);
  }

  if (url.pathname.startsWith('/mcp/')) {
    return safeEqual(decodeURIComponent(url.pathname.slice(5)), expected);
  }
  return false;
}

// Порівняння за сталий час — щоб побайтний підбір по таймінгу нічого не давав.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const enc = new TextEncoder();
  const A = enc.encode(a), B = enc.encode(b);
  if (A.length !== B.length) return false;
  let diff = 0;
  for (let i = 0; i < A.length; i++) diff |= A[i] ^ B[i];
  return diff === 0;
}

function unauthorized(env, url) {
  if (!env.MCP_SHARED_SECRET) {
    return corsResponse(JSON.stringify({
      jsonrpc: '2.0', id: null,
      error: { code: -32001, message: 'Server misconfigured: MCP_SHARED_SECRET is not set' }
    }), 500);
  }
  // 401 + WWW-Authenticate — тепер це коректно: у нас Є OAuth, і саме цей
  // заголовок каже клієнту, де шукати метадані, щоб пройти вхід самому.
  return new Response(JSON.stringify({
    jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' }
  }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': `Bearer resource_metadata="${url.origin}/.well-known/oauth-protected-resource"`
    }
  });
}

// ─── OAuth 2.1 (без стану, на HMAC) ───────────────────────────
//
// Навіщо: клієнт Claude вміє авторизуватись лише через OAuth. Без нього секрет
// доводилось тримати у хвості URL конектора, звідки він світився в налаштуваннях
// і писався в логи. Тут — мінімальний, але справжній OAuth 2.1 з PKCE.
//
// Сховища у воркера немає, тому стан НЕ зберігається ніде: client_id, код і
// токен — це підписані HMAC-SHA256 блоби. Підпис на MCP_SHARED_SECRET, тож
// підробити їх без секрету неможливо, а перевірити можна без бази.
//
// Роль MCP_SHARED_SECRET подвійна: ключ підпису + пароль на екрані входу.

const TOKEN_TTL = 60 * 60 * 24 * 30;  // 30 днів
const CODE_TTL  = 300;                // 5 хвилин

function b64urlEncode(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecodeBytes(str) {
  const pad = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '='.repeat((4 - pad.length % 4) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

async function hmacSign(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return b64urlEncode(new Uint8Array(sig));
}

// Підписаний блоб: <payload>.<signature>
async function signBlob(payload, secret) {
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  return `${body}.${await hmacSign(secret, body)}`;
}

async function verifyBlob(blob, secret, expectedType) {
  if (typeof blob !== 'string' || !blob.includes('.')) return null;
  const [body, sig] = blob.split('.', 2);
  if (!body || !sig) return null;
  if (!safeEqual(sig, await hmacSign(secret, body))) return null;
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(b64urlDecodeBytes(body))); }
  catch { return null; }
  if (expectedType && payload.typ !== expectedType) return null;
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
  return payload;
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

// Метадані захищеного ресурсу — з них клієнт дізнається, де сервер авторизації.
function oauthProtectedResource(url) {
  return jsonResponse({
    resource: `${url.origin}/mcp`,
    authorization_servers: [url.origin]
  });
}

function oauthServerMetadata(url) {
  return jsonResponse({
    issuer: url.origin,
    authorization_endpoint: `${url.origin}/authorize`,
    token_endpoint: `${url.origin}/token`,
    registration_endpoint: `${url.origin}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['mcp']
  });
}

// Динамічна реєстрація. Нічого не зберігаємо: client_id — це підписаний список
// дозволених redirect_uri. На /authorize ми його розпакуємо й звіримо.
async function oauthRegister(request, url, env) {
  if (!env.MCP_SHARED_SECRET) return jsonResponse({ error: 'server_error' }, 500);
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'invalid_request' }, 400); }

  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  if (!redirectUris.length) {
    return jsonResponse({ error: 'invalid_redirect_uri', error_description: 'redirect_uris required' }, 400);
  }
  const clientId = await signBlob(
    { typ: 'client', uris: redirectUris, iat: Math.floor(Date.now() / 1000) },
    env.MCP_SHARED_SECRET
  );
  return jsonResponse({
    client_id: clientId,
    redirect_uris: redirectUris,
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none'
  }, 201);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function loginPage(params, message) {
  const hidden = ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'scope']
    .map(k => params.get(k) ? `<input type="hidden" name="${k}" value="${escapeHtml(params.get(k))}">` : '')
    .join('');
  return new Response(`<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>KeyCRM MCP</title>
<style>
 body{font:16px/1.5 system-ui,sans-serif;max-width:24rem;margin:15vh auto;padding:0 1rem;color:#111}
 h1{font-size:1.15rem;margin:0 0 .25rem} p{color:#666;margin:0 0 1.5rem;font-size:.9rem}
 input[type=password]{width:100%;padding:.6rem;font-size:1rem;border:1px solid #ccc;border-radius:6px;box-sizing:border-box}
 button{width:100%;margin-top:.75rem;padding:.6rem;font-size:1rem;border:0;border-radius:6px;background:#111;color:#fff;cursor:pointer}
 .err{color:#b00;font-size:.875rem;margin-bottom:.75rem}
 @media(prefers-color-scheme:dark){body{background:#111;color:#eee}p{color:#999}
  input[type=password]{background:#1c1c1c;color:#eee;border-color:#444}button{background:#eee;color:#111}}
</style>
<h1>KeyCRM MCP</h1>
<p>Підключення доступу до CRM. Введіть ключ доступу сервера.</p>
${message ? `<div class="err">${escapeHtml(message)}</div>` : ''}
<form method="POST">${hidden}
 <input type="password" name="password" autofocus autocomplete="current-password" placeholder="Ключ доступу">
 <button type="submit">Дозволити</button>
</form>`, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

async function oauthAuthorize(request, url, env) {
  if (!env.MCP_SHARED_SECRET) return new Response('Server misconfigured', { status: 500 });

  const params = request.method === 'POST'
    ? new URLSearchParams(await request.text())
    : url.searchParams;

  const clientId    = params.get('client_id') || '';
  const redirectUri = params.get('redirect_uri') || '';
  const challenge   = params.get('code_challenge') || '';
  const state       = params.get('state') || '';

  // Клієнт мусить бути нашим (підпис) і redirect_uri — із зареєстрованих.
  const client = await verifyBlob(clientId, env.MCP_SHARED_SECRET, 'client');
  if (!client) return new Response('invalid_client', { status: 400 });
  if (!client.uris.includes(redirectUri)) return new Response('invalid_redirect_uri', { status: 400 });
  if (params.get('code_challenge_method') !== 'S256' || !challenge) {
    return new Response('PKCE S256 required', { status: 400 });
  }

  if (request.method === 'GET') return loginPage(params, null);

  if (!safeEqual(params.get('password') || '', env.MCP_SHARED_SECRET)) {
    return loginPage(params, 'Невірний ключ доступу.');
  }

  const code = await signBlob({
    typ: 'code', cid: clientId, ruri: redirectUri, chal: challenge,
    exp: Math.floor(Date.now() / 1000) + CODE_TTL
  }, env.MCP_SHARED_SECRET);

  const dest = new URL(redirectUri);
  dest.searchParams.set('code', code);
  if (state) dest.searchParams.set('state', state);
  return Response.redirect(dest.toString(), 302);
}

async function oauthToken(request, url, env) {
  if (!env.MCP_SHARED_SECRET) return jsonResponse({ error: 'server_error' }, 500);
  const form = new URLSearchParams(await request.text());

  if (form.get('grant_type') !== 'authorization_code') {
    return jsonResponse({ error: 'unsupported_grant_type' }, 400);
  }
  const code = await verifyBlob(form.get('code') || '', env.MCP_SHARED_SECRET, 'code');
  if (!code) return jsonResponse({ error: 'invalid_grant' }, 400);
  if (code.ruri !== (form.get('redirect_uri') || '')) return jsonResponse({ error: 'invalid_grant' }, 400);
  if (code.cid !== (form.get('client_id') || ''))     return jsonResponse({ error: 'invalid_client' }, 400);

  // PKCE: SHA256(verifier) має збігтись із challenge, зафіксованим на /authorize.
  const verifier = form.get('code_verifier') || '';
  if (!verifier) return jsonResponse({ error: 'invalid_grant' }, 400);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  if (!safeEqual(b64urlEncode(new Uint8Array(digest)), code.chal)) {
    return jsonResponse({ error: 'invalid_grant', error_description: 'PKCE mismatch' }, 400);
  }

  const token = await signBlob({
    typ: 'tok', exp: Math.floor(Date.now() / 1000) + TOKEN_TTL
  }, env.MCP_SHARED_SECRET);

  return jsonResponse({ access_token: token, token_type: 'Bearer', expires_in: TOKEN_TTL, scope: 'mcp' });
}

// ─── Статуси Malvia ──────────────────────────────────────────

const STATUS = {
  NEW: [1],
  IN_PROGRESS: [2, 3, 4, 23, 25, 33, 34],
  CONFIRMED_BY_OPERATOR: [26],
  PRODUCTION: [6],
  DELIVERY: [9, 20],
  RETURN: [28, 32],
  COMPLETED: [12],
  CANCELLED: [13, 15, 16, 17, 18, 19, 21, 22, 24, 29, 31],
};

const STATUS_GROUP = {
  1:  'Новий',
  2:  'Погодження', 3: 'Погодження', 4: 'Погодження',
  23: 'Погодження', 25: 'Погодження', 33: 'Погодження', 34: 'Погодження',
  26: 'Підтверджено',
  6:  'Виробництво',
  9:  'Доставка', 20: 'Доставка',
  28: 'Повернення', 32: 'Повернення',
  12: 'Виконано',
  13: 'Відмінено', 15: 'Відмінено', 16: 'Відмінено', 17: 'Відмінено',
  18: 'Відмінено', 19: 'Відмінено', 21: 'Відмінено', 22: 'Відмінено',
  24: 'Відмінено', 29: 'Відмінено', 31: 'Відмінено',
};

function classifyStatus(statusId) {
  const id = parseInt(statusId);
  if (STATUS.COMPLETED.includes(id))             return 'completed';
  if (STATUS.CONFIRMED_BY_OPERATOR.includes(id)) return 'confirmed';
  if (STATUS.PRODUCTION.includes(id))            return 'production';
  if (STATUS.DELIVERY.includes(id))              return 'delivery';
  if (STATUS.RETURN.includes(id))                return 'return';
  if (STATUS.CANCELLED.includes(id))             return 'cancelled';
  if (STATUS.IN_PROGRESS.includes(id))           return 'in_progress';
  if (STATUS.NEW.includes(id))                   return 'new';
  return 'unknown';
}

// ─── MCP Protocol ────────────────────────────────────────────

async function handleMCP(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return corsResponse(JSON.stringify({ jsonrpc:'2.0', id:null, error:{code:-32700,message:'Parse error'} }), 400); }

  if (Array.isArray(body)) {
    const responses = await Promise.all(body.map(msg => handleMessage(msg, env)));
    return corsResponse(JSON.stringify(responses.filter(r => r !== null)));
  }
  const response = await handleMessage(body, env);
  if (response === null) return corsResponse(null, 202);
  return corsResponse(JSON.stringify(response));
}

async function handleMessage(message, env) {
  const { id, method, params } = message;
  try {
    switch (method) {
      case 'initialize':
        return { jsonrpc:'2.0', id, result:{
          protocolVersion:'2024-11-05',
          capabilities:{tools:{}},
          serverInfo:{name:'keycrm-mcp',version:'8.4.0'}
        }};
      case 'notifications/initialized': return null;
      case 'ping': return { jsonrpc:'2.0', id, result:{} };
      case 'tools/list': return { jsonrpc:'2.0', id, result:{tools:TOOLS} };
      case 'tools/call': {
        if (!env.KEYCRM_API_KEY) throw new Error('KEYCRM_API_KEY not set');
        const result = await callTool(params.name, params.arguments || {}, env.KEYCRM_API_KEY, env.NP_API_KEY || '');
        return { jsonrpc:'2.0', id, result:{content:[{type:'text',text:JSON.stringify(result,null,2)}]} };
      }
      default: return { jsonrpc:'2.0', id, error:{code:-32601,message:`Method not found: ${method}`} };
    }
  } catch (error) {
    return { jsonrpc:'2.0', id, error:{code:-32603,message:error.message} };
  }
}

// ─── Tool Definitions ────────────────────────────────────────

const TOOLS = [
  {
    name: 'get_order_statuses',
    description: 'Показати всі статуси замовлень Malvia з їх ID та групами.',
    inputSchema: { type:'object', properties:{} }
  },
  {
    name: 'get_funnel_by_campaign',
    description: 'Воронка по utm_campaign: ліди → підтверджено оператором → виробництво → доставка → виконано (викуплено) → відмінено. З % підтвердження, % викупу і ВИРУЧКОЮ (сума grand_total виконаних). Можна фільтрувати по частині назви кампанії через campaign_name.',
    inputSchema: {
      type:'object',
      properties:{
        date_from:     { type:'string', description:'Дата початку YYYY-MM-DD' },
        date_to:       { type:'string', description:'Дата кінця YYYY-MM-DD' },
        campaign_name: { type:'string', description:'Фільтр по назві або частині назви кампанії (опціонально). Приклад: "21-05" або "CBO"' }
      },
      required:['date_from','date_to']
    }
  },
  {
    name: 'get_funnel_by_creative',
    description: 'Воронка по КОНКРЕТНОМУ КРЕАТИВУ (utm_content) + ID оголошення Meta (utm_term). Для кожного креативу: ліди → апрув КЦ → викуп → виручка → середній чек викупу + % апруву/викупу. Це місток відео ↔ гроші. Можна звузити через campaign_name або creative_name. УВАГА: на широкому вікні може впертись у ліміт підзапитів Cloudflare — звужуй період або переходь на платний план.',
    inputSchema: {
      type:'object',
      properties:{
        date_from:     { type:'string', description:'Дата початку YYYY-MM-DD' },
        date_to:       { type:'string', description:'Дата кінця YYYY-MM-DD' },
        campaign_name: { type:'string', description:'Фільтр по частині назви кампанії (опціонально)' },
        creative_name: { type:'string', description:'Фільтр по частині utm_content/назви креативу (опціонально). Приклад: "962 Яблоко"' }
      },
      required:['date_from','date_to']
    }
  },
  {
    name: 'get_funnel_by_product',
    description: 'Воронка по конкретному товару (артикул/SKU): всі замовлення → підтверджено КЦ → відправлено НП → викуплено → повернено + ВИРУЧКА. Показує розбивку по кампаніях. Вирішує проблему неповних даних при пошуку по UTM.',
    inputSchema: {
      type:'object',
      properties:{
        sku:      { type:'string', description:'Артикул товару. Приклад: "21-05"' },
        date_from:{ type:'string', description:'Дата початку YYYY-MM-DD' },
        date_to:  { type:'string', description:'Дата кінця YYYY-MM-DD' }
      },
      required:['sku','date_from','date_to']
    }
  },
  {
    name: 'get_product_pl',
    description: 'P&L по конкретному товару (SKU) за period. Повертає: воронку, виручку по ЗАВЕРШЕНИМ замовленням з розбивкою базовий товар / Преміум / пакування (прив\'язані до конкретних замовлень), комісії КЦ по кожному типу апсейлу, повернення НП. Дані для прямого P&L без Excel-вигрузки.',
    inputSchema: {
      type:'object',
      properties:{
        sku:      { type:'string', description:'Артикул/частина назви товару. Приклад: "21-183"' },
        date_from:{ type:'string', description:'Дата початку YYYY-MM-DD' },
        date_to:  { type:'string', description:'Дата кінця YYYY-MM-DD' }
      },
      required:['sku','date_from','date_to']
    }
  },
  {
    name: 'get_orders_by_date',
    description: 'Список замовлень за датою з utm_campaign/utm_content/utm_term, менеджером, статусом і сумою.',
    inputSchema: {
      type:'object',
      properties:{
        date_from:{ type:'string', description:'Дата початку YYYY-MM-DD' },
        date_to:{   type:'string', description:'Дата кінця YYYY-MM-DD' },
        status_id:{ type:'number', description:'ID статусу для фільтрації (опціонально)' },
        limit:{     type:'number', description:'Максимум записів (за замовчуванням 50)' }
      },
      required:['date_from','date_to']
    }
  },
  {
    name: 'get_manager_stats',
    description: 'Статистика менеджерів кол-центру: скільки лідів отримав, підтвердив, відмовив. % підтвердження на кожного менеджера.',
    inputSchema: {
      type:'object',
      properties:{
        date_from:{ type:'string', description:'Дата початку YYYY-MM-DD' },
        date_to:{   type:'string', description:'Дата кінця YYYY-MM-DD' }
      },
      required:['date_from','date_to']
    }
  },
  {
    name: 'get_keycrm_categories',
    description: 'Отримати список категорій товарів з KeyCRM, щоб дізнатися їхні ID.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_delivery_services',
    description: 'Отримати список доступних методів доставки з KeyCRM (дозволяє дізнатися delivery_service_id).',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'create_keycrm_product',
    description: 'Створити нову картку товару в KeyCRM.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Назва товару' },
        description: { type: 'string', description: 'Опис товару' },
        sku: { type: 'string', description: 'Артикул товару (якщо без варіантів)' },
        price: { type: 'number', description: 'Вартість товару' },
        purchased_price: { type: 'number', description: 'Закупівельна ціна товару' },
        category_id: { type: 'number', description: 'ID категорії товару' },
        currency_code: { type: 'string', description: 'Валюта товару, напр. "UAH" (опціонально)' },
        pictures: { type: 'array', items: { type: 'string' }, description: 'Зображення товару, максимум 6 штук, перше - головне' },
        custom_fields: {
          type: 'array',
          description: 'Користувацькі поля: [{ uuid, value }] (опціонально)',
          items: { type: 'object', properties: { uuid: { type: 'string' }, value: {} }, required: ['uuid', 'value'] }
        }
      },
      required: ['name', 'price']
    }
  },
  {
    name: 'create_keycrm_offers',
    description: 'Створити варіанти (offers) для існуючого товару (розміри, кольори, ціни, SKU).',
    inputSchema: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'Ідентифікатор товару в KeyCRM' },
        offers: {
          type: 'array',
          description: 'Список варіантів',
          items: {
            type: 'object',
            properties: {
              sku: { type: 'string', description: 'Артикул варіанту' },
              price: { type: 'number', description: 'Ціна варіанту' },
              purchased_price: { type: 'number', description: 'Закупівельна ціна варіанту' },
              image_url: { type: 'string', description: 'Посилання на зображення варіанту' },
              properties: {
                type: 'array',
                description: 'Властивості варіанту (Розмір, Колір)',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', description: 'Назва властивості, напр. "Розмір" або "Колір"' },
                    value: { type: 'string', description: 'Значення властивості, напр. "50-52" або "Червоний"' }
                  },
                  required: ['name', 'value']
                }
              }
            },
            required: ['sku', 'price', 'properties']
          }
        }
      },
      required: ['productId', 'offers']
    }
  },
  {
    name: 'get_product_offers',
    description: 'Знайти варіанти (офери) товару по назві або артикулу. Повертає список офферів з offer_id, SKU, розмірами, кольорами та цінами. Використовуй перед create_order щоб знайти правильний offer_id.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Артикул або назва товару. Приклад: "21-154" або "сукня"' }
      },
      required: ['query']
    }
  },
  {
    name: 'create_order',
    description: 'Створити замовлення в KeyCRM з Facebook Messenger (source_id: 3). Перед викликом знайди SKU оферу через get_product_offers. KeyCRM тригер автоматично створить ТТН НП.',
    inputSchema: {
      type: 'object',
      properties: {
        buyer_name:   { type: 'string',  description: 'ПІБ клієнтки. Приклад: "Ніна Коваленко"' },
        buyer_phone:  { type: 'string',  description: 'Телефон. Приклад: "0671234567"' },
        city:         { type: 'string',  description: 'Місто доставки. Приклад: "Харків"' },
        np_branch:    { type: 'string',  description: 'Номер або адреса відділення НП. Приклад: "15" або "Відділення №15"' },
        offer_sku:    { type: 'string',  description: 'Артикул (SKU) конкретного оферу з get_product_offers. Приклад: "21-154-50-52-BLU"' },
        product_name: { type: 'string',  description: 'Назва товару для відображення в замовленні' },
        price:        { type: 'number',  description: 'Ціна продажу в грн' },
        quantity:     { type: 'number',  description: 'Кількість. Зазвичай 1' },
        comment:      { type: 'string',  description: 'Додатковий коментар (опціонально).' },
        tags:         { type: 'array', items: { type: 'string' }, description: 'Масив тегів для замовлення. Наприклад, ["KORA"] (опціонально)' },
        manager_name: { type: 'string',  description: 'Ім\'я або частина імені менеджера для автоматичного пошуку та призначення. Наприклад, "Ирина" (опціонально)' }
      },
      required: ['buyer_name', 'buyer_phone', 'city', 'np_branch', 'offer_sku', 'product_name', 'price']
    }
  },
  {
    name: 'get_keycrm_users',
    description: 'Отримати список користувачів (менеджерів) KeyCRM для визначення їх ID та ролей.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_all_products',
    description: 'Отримати список товарів каталогу KeyCRM з пагінацією. Фільтр по категорії (category_id) та пошук по назві/SKU (query, фільтр на стороні воркера). Повертає id, назву, SKU, ціну, опис, категорію. Для масових операцій: аудит, оновлення описів/цін.',
    inputSchema: {
      type: 'object',
      properties: {
        category_id: { type: 'number', description: 'ID категорії (опціонально). Seven=3, Lotran=6, Minova=2, KORA=1' },
        query: { type: 'string', description: 'Пошук по назві або SKU (опціонально)' },
        is_archived: { type: 'string', description: 'Фільтр архівних: "true" або "false" (опціонально)' },
        include_custom_fields: { type: 'boolean', description: 'Підключити користувацькі поля товару' },
        max_pages: { type: 'number', description: 'Максимум сторінок по 50 (за замовчуванням 100)' }
      }
    }
  },
  {
    name: 'update_product',
    description: 'Оновити існуючу картку товару (PUT /products/{id}). Передавати лише поля, які треба змінити: опис, ціну, собівартість, категорію, SKU, картинки, користувацькі поля. product_id знайди через get_all_products або get_product_offers.',
    inputSchema: {
      type: 'object',
      properties: {
        product_id: { type: 'number', description: 'ID товару в KeyCRM (обовʼязково)' },
        name: { type: 'string', description: 'Назва товару' },
        description: { type: 'string', description: 'Опис товару' },
        price: { type: 'number', description: 'Ціна товару' },
        purchased_price: { type: 'number', description: 'Закупівельна ціна (COGS)' },
        category_id: { type: 'number', description: 'ID категорії' },
        sku: { type: 'string', description: 'Артикул товару' },
        currency_code: { type: 'string', description: 'Валюта, напр. "UAH"' },
        pictures: { type: 'array', items: { type: 'string' }, description: 'Зображення, максимум 6, перше — головне' },
        custom_fields: {
          type: 'array',
          description: 'Користувацькі поля: [{ uuid, value }]',
          items: { type: 'object', properties: { uuid: { type: 'string' }, value: {} }, required: ['uuid', 'value'] }
        }
      },
      required: ['product_id']
    }
  },
  {
    name: 'list_orders',
    description: 'Гнучкий список замовлень з фільтрами (GET /order): статус, джерело, телефон покупця, наявність трекінгу, період створення. Вивід містить utm_campaign/utm_content/utm_term. Пагінація: page=N повертає одну сторінку + метадані (page/last_page/total) — для безпечного збору всіх даних частинами без ліміту підзапитів. fetch_all=true збирає все одним викликом (може впертись у ліміт Cloudflare на великих обсягах).',
    inputSchema: {
      type: 'object',
      properties: {
        date_from: { type: 'string', description: 'Дата початку YYYY-MM-DD (опціонально)' },
        date_to: { type: 'string', description: 'Дата кінця YYYY-MM-DD (опціонально)' },
        status_id: { type: 'number', description: 'ID статусу (опціонально)' },
        source_id: { type: 'number', description: 'ID джерела (опціонально)' },
        buyer_phone: { type: 'string', description: 'Телефон покупця (опціонально)' },
        has_tracking_code: { type: 'boolean', description: 'Тільки з трек-номером (опціонально)' },
        include: { type: 'string', description: 'Асоціації через кому. За замовчуванням "status,manager,products,marketing,tags"' },
        limit: { type: 'number', description: 'Записів на сторінку (макс 50)' },
        page: { type: 'number', description: 'Номер сторінки (для посторінкового збору). Якщо задано — повертає цю сторінку + last_page/total.' },
        fetch_all: { type: 'boolean', description: 'Зібрати всі сторінки одним викликом (обережно — ліміт підзапитів)' }
      }
    }
  },
  {
    name: 'update_order',
    description: 'Оновити існуюче замовлення (PUT /order/{id}): статус, коментарі, товари, доставку, користувацькі поля. Передавай лише потрібні поля. Увага: робота з живими замовленнями.',
    inputSchema: {
      type: 'object',
      properties: {
        order_id: { type: 'number', description: 'ID замовлення (обовʼязково)' },
        status_id: { type: 'number', description: 'Новий ID статусу' },
        manager_comment: { type: 'string', description: 'Коментар менеджера' },
        buyer_comment: { type: 'string', description: 'Коментар покупця' },
        discount_percent: { type: 'number', description: 'Знижка %' },
        discount_amount: { type: 'number', description: 'Знижка фіксована' },
        products: { type: 'array', items: { type: 'object' }, description: 'Масив товарів (ідентифікація по sku або id)' },
        shipping: { type: 'object', description: 'Обʼєкт доставки' },
        custom_fields: { type: 'array', items: { type: 'object' }, description: 'Користувацькі поля: [{uuid,value}]' }
      },
      required: ['order_id']
    }
  },
  {
    name: 'get_order',
    description: 'Повна картка одного замовлення за ID (GET /order/{id}) з усіма асоціаціями: покупець, товари, статус, менеджер, доставка, оплати, теги, маркетинг. Для детального розбору в КЦ.',
    inputSchema: {
      type: 'object',
      properties: {
        order_id: { type: 'number', description: 'ID замовлення (обовʼязково)' },
        include: { type: 'string', description: 'Асоціації через кому. За замовчуванням повний набір.' }
      },
      required: ['order_id']
    }
  },
  {
    name: 'update_offers',
    description: 'Редагувати варіанти товару (PUT /offers): ціна, закупівельна ціна, вага, габарити, картинка. Кожен елемент масиву ідентифікується по id або sku.',
    inputSchema: {
      type: 'object',
      properties: {
        offers: {
          type: 'array',
          description: 'Список варіантів для оновлення',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number', description: 'ID варіанту (або вкажи sku)' },
              sku: { type: 'string', description: 'Артикул варіанту (або вкажи id)' },
              price: { type: 'number' },
              purchased_price: { type: 'number' },
              weight: { type: 'number' },
              height: { type: 'number' },
              length: { type: 'number' },
              width: { type: 'number' },
              image_url: { type: 'string' }
            }
          }
        }
      },
      required: ['offers']
    }
  },
  {
    name: 'get_order_tags',
    description: 'Список усіх тегів замовлень у KeyCRM з їх ID та назвами (GET /order/tag).',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'add_order_tag',
    description: 'Додати тег до замовлення (POST /order/{id}/tag/{tagId}). Передай tag_id або tag_name (буде знайдено по назві).',
    inputSchema: {
      type: 'object',
      properties: {
        order_id: { type: 'number', description: 'ID замовлення (обовʼязково)' },
        tag_id: { type: 'number', description: 'ID тегу (або вкажи tag_name)' },
        tag_name: { type: 'string', description: 'Назва тегу (або вкажи tag_id)' }
      },
      required: ['order_id']
    }
  },
  {
    name: 'remove_order_tag',
    description: 'Зняти тег із замовлення (DELETE /order/{id}/tag/{tagId}). Передай tag_id або tag_name.',
    inputSchema: {
      type: 'object',
      properties: {
        order_id: { type: 'number', description: 'ID замовлення (обовʼязково)' },
        tag_id: { type: 'number', description: 'ID тегу (або вкажи tag_name)' },
        tag_name: { type: 'string', description: 'Назва тегу (або вкажи tag_id)' }
      },
      required: ['order_id']
    }
  },
  {
    name: 'list_buyers',
    description: 'Список покупців KeyCRM (GET /buyer) з фільтрами: телефон, email, період створення. Для аналізу повторних клієнтів і бази під ретеншн/апсейл.',
    inputSchema: {
      type: 'object',
      properties: {
        buyer_phone: { type: 'string', description: 'Телефон покупця (опціонально)' },
        buyer_email: { type: 'string', description: 'Email покупця (опціонально)' },
        date_from: { type: 'string', description: 'Дата створення від YYYY-MM-DD (опціонально)' },
        date_to: { type: 'string', description: 'Дата створення до YYYY-MM-DD (опціонально)' },
        include: { type: 'string', description: 'Асоціації: manager,shipping,company,loyalty,custom_fields' },
        limit: { type: 'number', description: 'Записів на сторінку (макс 50)' },
        fetch_all: { type: 'boolean', description: 'Зібрати всі сторінки' }
      }
    }
  },
  {
    name: 'get_buyer',
    description: 'Картка одного покупця за ID (GET /buyer/{id}) з асоціаціями (історія, лояльність, кастомні поля).',
    inputSchema: {
      type: 'object',
      properties: {
        buyer_id: { type: 'number', description: 'ID покупця (обовʼязково)' },
        include: { type: 'string', description: 'Асоціації через кому' }
      },
      required: ['buyer_id']
    }
  },
  {
    name: 'get_custom_fields',
    description: 'Список користувацьких полів KeyCRM з їх UUID (GET /custom-fields). Потрібно щоб коректно писати custom_fields у товари/замовлення. model фільтрує по сутності: crm_product, order, lead, client.',
    inputSchema: {
      type: 'object',
      properties: {
        model: { type: 'string', description: 'Фільтр по сутності: crm_product, order, lead, client (опціонально)' },
        with_options: { type: 'boolean', description: 'Підключити опції списочних полів (include=options)' }
      }
    }
  },
  {
    name: 'upload_file',
    description: 'Завантажити файл у сховище KeyCRM за URL (POST /storage/upload, multipart). Повертає запис файлу (id/url). Макс 10MB.',
    inputSchema: {
      type: 'object',
      properties: {
        file_url: { type: 'string', description: 'Пряме посилання на файл (обовʼязково)' },
        filename: { type: 'string', description: 'Імʼя файлу (опціонально, інакше з URL)' }
      },
      required: ['file_url']
    }
  },
  {
    name: 'create_category',
    description: 'Створити нову категорію товарів (POST /products/categories). Напр. при заведенні нового виробника.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Назва категорії (обовʼязково)' },
        parent_id: { type: 'number', description: 'ID батьківської категорії (опціонально)' }
      },
      required: ['name']
    }
  },
  {
    name: 'match_returns_to_pending',
    description: 'Зіставляє замовлення у статусі "Повернення назад" із замовленнями у статусі "Прийнято" за артикулом + кольором + розміром. Відповідає на питання "яку річ із повернення можна фізично перекинути на нове замовлення, щоб не замовляти у виробника". Усе порівняння відбувається ВСЕРЕДИНІ воркера — повертає лише пари збігів і підсумок. НЕ треба тягнути get_order по кожному замовленню окремо. ВАЖЛИВО при переказі результату: збіг закриває ОДНУ ПОЗИЦІЮ, а не все замовлення. У кожному match є pending_order_fully_covered — якщо false, замовлення НЕ можна закрити, бо в ньому є інші товари без покриття (список у pending_order_still_missing). Не пиши "можна закрити замовлення", поки цей прапорець не true.',
    inputSchema: {
      type: 'object',
      properties: {
        pending_status_id: { description: 'ID статусу(ів), які треба закрити. Число або масив. За замовчуванням 26 ("Прийнято"). Часті: 2 = Уточнення, 6 = Виготовляється, 26 = Прийнято. Напр. [2,6] — взяти обидва разом.' },
        return_status_id:  { description: 'ID статусу(ів) повернень. Число або масив. За замовчуванням 28 ("Повернення назад"). Ще релевантні: 32 = Відмова на пошті, 29 = Не підійшов/немає розміру.' },
        date_from: { type: 'string', description: 'Дата початку YYYY-MM-DD (опціонально)' },
        date_to:   { type: 'string', description: 'Дата кінця YYYY-MM-DD (опціонально)' }
      }
    }
  },
  {
    name: 'get_period_summary',
    description: 'Товарний підсумок періоду для фінансового закриття: виручка за типами (товар / Преміум / пакування), одиниці по виробниках і кількість по кожному артикулу. Замінює ручну вигрузку CRM у шаблон «Подсчеты». Уся агрегація — ВСЕРЕДИНІ воркера, повертає компактний підсумок, а не сирі замовлення. ЯК КОРИСТУВАТИСЬ: передай ttns — масив ТТН із реєстру NovaPay за період; це дає ТОЧНЕ зіставлення «гроші ↔ товар», бо гривня належить місяцю свого реєстру, а не дати замовлення. Без ttns фільтрує за датою створення — це наближення, придатне для оцінки, але не для закриття місяця. Виробник береться лише з відомих тегів (KORA / Minova / Seven / Lotran); сторонні теги на кшталт РОЗПРОДАЖ ігноруються.',
    inputSchema: {
      type: 'object',
      properties: {
        ttns:        { type: 'array', items: { type: 'string' }, description: 'ТТН із реєстру NovaPay за період — найточніший режим, рекомендований для закриття. Потребує ще й вікна дат (див. нижче), бо вибірка з API обмежується датою створення.' },
        closed_from: { type: 'string', description: 'Дата ЗАКРИТТЯ від, YYYY-MM-DD. В API KeyCRM такого фільтра немає — воркер фільтрує сам, а з API тягне створені за 60 днів до цієї дати.' },
        closed_to:   { type: 'string', description: 'Дата закриття до, YYYY-MM-DD' },
        date_from:   { type: 'string', description: 'Дата СТВОРЕННЯ від, YYYY-MM-DD (пряме вікно вибірки з API)' },
        date_to:     { type: 'string', description: 'Дата створення до, YYYY-MM-DD' },
        status_id:   { type: 'number', description: 'Статус замовлень. За замовчуванням 12 (Виконано/викуплено).' },
        rows:        { type: 'boolean', description: 'Додати масив «рядки» — сирі позиції замовлень (замовлення, ттн, товар, кількість, знижка, ціна, тег) для калькулятора. УВАГА: це сотні рядків, вони призначені машині, а не для переказу в чат. Не вмикай, якщо треба просто підсумок.' }
      }
    }
  },

  // ─── [НОВЕ v9] Ранні предиктори викупу ───
  {
    name: 'get_buyout_by_upsell',
    description: 'Чи передбачає взятий апсейл (Преміум / пакування) майбутній викуп. Рахує % викупу окремо для «без апсейлу» / «тільки пакування» / «Преміум». ГОЛОВНЕ — віддає стратифіковану оцінку: різницю ВСЕРЕДИНІ кожного артикула, а не по портфелю. Без цього результат був би хибним: Преміум частіше беруть на дорогих товарах, а дорогі товари викуповуються інакше — і портфельне порівняння показало б зв\'язок там, де його немає. Уся агрегація в воркері, два пулли замовлень.',
    inputSchema: {
      type: 'object',
      properties: {
        date_from:  { type: 'string', description: 'Дата створення від, YYYY-MM-DD. Бери ЗАКРИТУ когорту (усе фіналізоване), інакше свіжі замовлення зіпсують оцінку — відмови приходять пізніше за викупи.' },
        date_to:    { type: 'string', description: 'Дата створення до, YYYY-MM-DD' },
        min_orders: { type: 'number', description: 'Мінімум фіналізованих на артикул, щоб він потрапив у розріз. За замовчуванням 20.' }
      },
      required: ['date_from', 'date_to']
    }
  },
  {
    name: 'probe_order_history',
    description: 'ДІАГНОСТИКА, разовий запуск. Відповідає на питання «чи віддає KeyCRM історію змін статусів замовлення». Від цього залежить, чи можна взагалі порахувати викуп проти кількості дзвінків. Перебирає кандидатні ендпоінти й повертає, який працює + повний перелік полів картки замовлення. Дешево: 1 замовлення, кілька запитів.',
    inputSchema: {
      type: 'object',
      properties: { order_id: { type: 'number', description: 'ID будь-якого закритого замовлення' } },
      required: ['order_id']
    }
  },
  {
    name: 'get_buyout_by_calls',
    description: 'Чи передбачає «важкість дозвону» майбутній викуп: скільки разів замовлення падало в Недозвон/Передзвонити і скільки часу минуло від заявки до підтвердження. ПОТРЕБУЄ історії статусів — спершу запусти probe_order_history. Працює на ВИБІРЦІ (за замовчуванням 150+150 замовлень), бо суцільний скан 2000+ замовлень вийде за ліміт підзапитів Cloudflare.',
    inputSchema: {
      type: 'object',
      properties: {
        date_from:   { type: 'string', description: 'Дата створення від, YYYY-MM-DD' },
        date_to:     { type: 'string', description: 'Дата створення до, YYYY-MM-DD' },
        sample_size: { type: 'number', description: 'Скільки замовлень брати В КОЖНУ групу (викуплені / відмова на пошті). За замовчуванням 150. Більше 400 — ризик ліміту підзапитів.' },
        history_path:{ type: 'string', description: 'Шлях до історії, якщо probe_order_history знайшов нестандартний. Напр. "/order/{id}/history".' }
      },
      required: ['date_from', 'date_to']
    }
  }
];

// ─── Tool Router ─────────────────────────────────────────────

async function callTool(name, args, apiKey, npKey = '') {
  switch (name) {
    case 'get_order_statuses':     return getOrderStatuses();
    case 'get_orders_by_date':     return getOrdersByDate(apiKey, args);
    case 'get_funnel_by_campaign': return getFunnelByCampaign(apiKey, args);
    case 'get_funnel_by_creative': return getFunnelByCreative(apiKey, args);
    case 'get_funnel_by_product':  return getFunnelByProduct(apiKey, args);
    case 'get_product_pl':         return getProductPL(apiKey, args);
    case 'match_returns_to_pending': return matchReturnsToPending(apiKey, args);
    case 'get_period_summary':     return getPeriodSummary(apiKey, args);
    case 'get_manager_stats':      return getManagerStats(apiKey, args);
    case 'get_buyout_by_upsell':   return getBuyoutByUpsell(apiKey, args);
    case 'probe_order_history':    return probeOrderHistory(apiKey, args);
    case 'get_buyout_by_calls':    return getBuyoutByCalls(apiKey, args);
    case 'get_keycrm_categories':  return getKeyCrmCategories(apiKey);
    case 'get_delivery_services':  return getDeliveryServices(apiKey);
    case 'create_keycrm_product':  return createKeyCrmProduct(apiKey, args);
    case 'create_keycrm_offers':   return createKeyCrmOffers(apiKey, args);
    case 'get_product_offers':     return getProductOffers(apiKey, args);
    case 'create_order':           return createOrder(apiKey, args, npKey);
    case 'get_keycrm_users':       return getKeyCrmUsers(apiKey);
    case 'get_all_products':       return getAllProducts(apiKey, args);
    case 'update_product':         return updateProduct(apiKey, args);
    case 'list_orders':            return listOrders(apiKey, args);
    case 'update_order':           return updateOrder(apiKey, args);
    case 'get_order':              return getOrder(apiKey, args);
    case 'update_offers':          return updateOffers(apiKey, args);
    case 'get_order_tags':         return getOrderTags(apiKey);
    case 'add_order_tag':          return addOrderTag(apiKey, args);
    case 'remove_order_tag':       return removeOrderTag(apiKey, args);
    case 'list_buyers':            return listBuyers(apiKey, args);
    case 'get_buyer':              return getBuyer(apiKey, args);
    case 'get_custom_fields':      return getCustomFields(apiKey, args);
    case 'upload_file':            return uploadFile(apiKey, args);
    case 'create_category':        return createCategory(apiKey, args);
    default: throw new Error(`Невідомий інструмент: ${name}`);
  }
}

// ─── KeyCRM API ──────────────────────────────────────────────

const BASE_URL = 'https://openapi.keycrm.app/v1';

async function keycrmGet(apiKey, path, params = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  const res = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`KeyCRM API GET ${res.status}: ${text.slice(0,200)}`);
  }
  return res.json();
}

async function keycrmPost(apiKey, path, body = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`KeyCRM API POST ${res.status}: ${text.slice(0,200)}`);
  }
  return res.json();
}

async function keycrmPut(apiKey, path, body = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`KeyCRM API PUT ${res.status}: ${text.slice(0,300)}`);
  }
  return res.json();
}

async function keycrmDelete(apiKey, path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json'
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`KeyCRM API DELETE ${res.status}: ${text.slice(0,300)}`);
  }
  if (res.status === 204) return { status: true };
  try { return await res.json(); } catch { return { status: true }; }
}

// Завантажує файл за URL і відправляє його у KeyCRM як multipart/form-data.
async function keycrmUploadFile(apiKey, fileUrl, filename) {
  const fileRes = await fetch(fileUrl);
  if (!fileRes.ok) throw new Error(`Не вдалося завантажити файл за URL (${fileRes.status})`);
  const blob = await fileRes.blob();
  const name = filename || fileUrl.split('/').pop().split('?')[0] || 'file';
  const form = new FormData();
  form.append('file', blob, name);
  const res = await fetch(`${BASE_URL}/storage/upload`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json'
    },
    body: form
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`KeyCRM API UPLOAD ${res.status}: ${text.slice(0,300)}`);
  }
  return res.json();
}

// Універсальна пагінація: збирає всі сторінки списку (cap сторінок для безпеки).
async function getAllPages(apiKey, path, params = {}, maxPages = 100) {
  let all = [];
  let page = 1;
  while (page <= maxPages) {
    const data = await keycrmGet(apiKey, path, { ...params, page, limit: 50 });
    const batch = data.data || [];
    all = all.concat(batch);
    if (batch.length < 50 || page >= (data.last_page || 1)) break;
    page++;
  }
  return all;
}

// Завантажує ВСІ замовлення без жорсткого обмеження сторінок.
// Safety cap: 200 сторінок × 50 = 10 000 замовлень — достатньо для Malvia.
async function getAllOrders(apiKey, params) {
  let all = [];
  let page = 1;
  while (page <= 200) {
    const data = await keycrmGet(apiKey, '/order', { ...params, page, limit: 50 });
    const orders = data.data || [];
    all = all.concat(orders);
    if (orders.length === 0 || page >= (data.last_page || 1)) break;
    page++;
  }
  return all;
}

// Те саме, але з include=products для фільтрації по SKU
async function getAllOrdersWithProducts(apiKey, params) {
  const p = { ...params, 'include': 'status,manager,products,marketing' };
  return getAllOrders(apiKey, p);
}

// ─── [НОВЕ v8.1] Товарний підсумок періоду для фінзакриття ───
//
// НАВІЩО: закриття місяця потребує розрізу «скільки одиниць якого артикула
// продано, по яких виробниках, і скільки з цього — Преміум і пакування».
// Раніше це робилось ручною вигрузкою CRM у шаблон «Подсчеты».
//
// ЧОМУ ЧЕРЕЗ ТТН, А НЕ ЧЕРЕЗ ДАТУ: гривня належить місяцю СВОГО РЕЄСТРУ.
// Замовлення, створене 27.05 і закрите 01.06, оплачується у червні — і має
// потрапити в червень, а не в травень. Тому точний режим — передати ТТН
// із реєстру NovaPay за період; фільтр за датою лишається як наближення.
//
// ЧОМУ АГРЕГАЦІЯ ТУТ, А НЕ В МОДЕЛІ: 500+ замовлень сирими картками — це
// сотні тисяч токенів. Тут виходить компактний підсумок на кілька кілобайт.

const MANUFACTURER_TAGS = ['KORA', 'Minova', 'Seven', 'Lotran'];
const PACKAGING_MARK = 'пакуванн';   // у CRM назва з опискою: «пакуванняя»
const PREMIUM_MARK   = 'преміум';

// «Сукня софт 21-154» → «21-154»; «Халат 2486» → «2486»
function extractArticle(name) {
  const m = String(name || '').match(/(\d+-\d+|\b\d{3,4}\b)/);
  return m ? m[1] : null;
}

function pickManufacturer(tags) {
  const names = (tags || []).map(t => (typeof t === 'string' ? t : t?.name) || '');
  for (const known of MANUFACTURER_TAGS) {
    if (names.some(n => n.trim().toLowerCase() === known.toLowerCase())) return known;
  }
  return '(без тегу виробника)';
}

const LOOKBACK_DAYS = 60;   // замовлення закривається за 3–30 днів після створення
const MAX_PAGES = 40;       // Cloudflare рахує кожну сторінку як підзапит

function shiftDate(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function getPeriodSummary(apiKey, args) {
  const { ttns, date_from, date_to, closed_from, closed_to, status_id = 12,
          rows: wantRows = false } = args || {};
  const wanted = Array.isArray(ttns) && ttns.length
    ? new Set(ttns.map(t => String(t).trim()).filter(Boolean))
    : null;

  // Вікно ВИБІРКИ з API — завжди обмежене: KeyCRM фільтрує лише за датою
  // створення (closed_between в API не існує), а кожна сторінка коштує підзапит.
  let pullFrom = date_from, pullTo = date_to;
  if (!pullFrom || !pullTo) {
    if (closed_from && closed_to) {
      pullFrom = shiftDate(closed_from, -LOOKBACK_DAYS);
      pullTo = closed_to;
    } else if (wanted) {
      return { помилка: 'Передай або date_from+date_to, або closed_from+closed_to — ' +
               'разом із ttns. Без вікна дат вибірка з API не обмежена і впреться в ліміти Cloudflare.' };
    } else {
      return { помилка: 'Потрібен період: date_from+date_to (дата створення) ' +
               'або closed_from+closed_to (дата закриття, фільтрується у воркері).' };
    }
  }

  const params = { 'include': 'products,shipping,tags,status' };
  if (status_id) params['filter[status_id]'] = status_id;
  params['filter[created_between]'] = `${pullFrom} 00:00:00, ${pullTo} 23:59:59`;

  // Пагінація з явним стелею: краще голосно сказати про обрізку,
  // ніж тихо повернути неповний період і зіпсувати закриття.
  let orders = [];
  let page = 1;
  let truncated = false;
  while (true) {
    if (page > MAX_PAGES) { truncated = true; break; }
    const data = await keycrmGet(apiKey, '/order', { ...params, page, limit: 50 });
    const batch = data.data || [];
    orders = orders.concat(batch);
    if (batch.length === 0 || page >= (data.last_page || 1)) break;
    page++;
  }

  // Фільтр за датою ЗАКРИТТЯ — тільки тут: в API такого фільтра немає.
  if (closed_from && closed_to) {
    orders = orders.filter(o => {
      const c = String(o.closed_at || o.status_changed_at || '').slice(0, 10);
      return c && c >= closed_from && c <= closed_to;
    });
  }

  const bySku = new Map();          // артикул -> {name, manufacturer, qty, revenue}
  const byMfr = new Map();          // виробник -> {units, revenue, cogs_units}
  const seenTtn = new Set();
  let revGoods = 0, revPremium = 0, revPackaging = 0;
  let qtyPremium = 0, qtyPackaging = 0;
  let matchedOrders = 0, skippedNoTtn = 0;
  const packagingByMfr = {}, premiumByMfr = {};

  // [v8.2] Сирі рядки для калькулятора. Збираються по ВСІХ замовленнях вікна,
  // а не лише по тих, що збіглися з реєстром — інакше зникло б саме те, заради
  // чого потрібне покриття: рядки без платежу (відмови, повернення, гроші, що
  // прийдуть наступного місяця). Зіставлення з реєстром робить калькулятор.
  const rawRows = wantRows ? [] : null;

  for (const o of orders) {
    const ttn = String(o.shipping?.tracking_code || '').trim();
    const mfr = pickManufacturer(o.tags);

    if (rawRows) {
      for (const p of (o.products || [])) {
        rawRows.push({
          order: String(o.id ?? ''),
          // Дві дати, і головна тут — ДАТА ЗАКРИТТЯ. Вибірка з API навмисно
          // ширша за місяць (фільтрувати можна лише за створенням), тому
          // калькулятор мусить обрізати її сам. Обрізати за створенням було б
          // неправильно: замовлення належить місяцю, коли воно ЗАКРИЛОСЬ.
          // Створене 28 червня й викуплене 3 липня — це липень; створене
          // 25 травня й викуплене 4 червня — це червень.
          created: String(o.created_at || o.ordered_at || '').slice(0, 10),
          closed: String(o.closed_at || o.status_changed_at || '').slice(0, 10),
          ttn,
          product: String(p.name || '').trim(),
          qty: Number(p.quantity || 1),
          discount: Number(p.total_discount ?? p.discount_amount ?? 0) || 0,
          price: Number(p.price_sold ?? p.price ?? 0) || 0,
          // Порожній рядок, а не «(без тегу виробника)»: калькулятор уміє
          // добирати тег за назвою товару з інших рядків, але лише якщо
          // клітинка порожня. Заглушка зламала б це добирання.
          tag: mfr === '(без тегу виробника)' ? '' : mfr
        });
      }
    }

    if (wanted) {
      if (!ttn || !wanted.has(ttn)) continue;
      seenTtn.add(ttn);
    } else if (!ttn) {
      skippedNoTtn++;
    }
    matchedOrders++;

    if (!byMfr.has(mfr)) byMfr.set(mfr, { units: 0, revenue: 0 });

    for (const p of (o.products || [])) {
      const qty = Number(p.quantity || 1);
      const price = Number(p.price_sold ?? p.price ?? 0);
      const total = price * qty;
      const nameL = String(p.name || '').trim().toLowerCase();

      if (nameL.includes(PACKAGING_MARK)) {
        revPackaging += total; qtyPackaging += qty;
        packagingByMfr[mfr] = (packagingByMfr[mfr] || 0) + qty;
      } else if (nameL === PREMIUM_MARK) {
        revPremium += total; qtyPremium += qty;
        premiumByMfr[mfr] = (premiumByMfr[mfr] || 0) + qty;
      } else {
        revGoods += total;
        const rec = byMfr.get(mfr);
        rec.units += qty; rec.revenue += total;
        const art = extractArticle(p.name) || (p.sku ? String(p.sku) : '(без артикула)');
        const cur = bySku.get(art) || { article: art, name: p.name, manufacturer: mfr, qty: 0, revenue: 0 };
        cur.qty += qty; cur.revenue += total;
        bySku.set(art, cur);
      }
    }
  }

  const missingTtn = wanted ? [...wanted].filter(t => !seenTtn.has(t)) : [];
  const режим = wanted ? 'за ТТН реєстру (точний — гроші фактично прийшли)'
              : (closed_from ? 'за датою закриття (фільтр у воркері)'
                             : 'за датою створення (наближення)');

  return {
    режим,
    вікно_вибірки: `створені ${pullFrom} … ${pullTo}`,
    ...(closed_from ? { закриті: `${closed_from} … ${closed_to}` } : {}),
    ...(truncated ? { УВАГА: `Вибірку обрізано на ${MAX_PAGES} сторінках (${MAX_PAGES * 50} замовлень). ` +
                             'Період неповний — звузь вікно і виклич кількома частинами.' } : {}),
    статус: status_id,
    замовлень_у_підсумку: matchedOrders,
    виручка: {
      товар: Math.round(revGoods),
      преміум: Math.round(revPremium),
      пакування: Math.round(revPackaging),
      разом: Math.round(revGoods + revPremium + revPackaging)
    },
    преміум: { шт: qtyPremium, по_виробниках: premiumByMfr },
    пакування: { шт: qtyPackaging, по_виробниках: packagingByMfr },
    по_виробниках: Object.fromEntries(
      [...byMfr].map(([k, v]) => [k, { одиниць: v.units, виручка: Math.round(v.revenue) }])
    ),
    по_артикулах: [...bySku.values()]
      .sort((a, b) => b.qty - a.qty)
      .map(s => ({ артикул: s.article, назва: s.name, виробник: s.manufacturer,
                   шт: s.qty, виручка: Math.round(s.revenue) })),
    ттн_без_замовлення: missingTtn.length,
    ттн_без_замовлення_список: missingTtn.slice(0, 30),
    ...(skippedNoTtn ? { замовлень_без_ттн: skippedNoTtn } : {}),
    ...(rawRows ? {
      рядки_призначення: 'Машинні дані для калькулятора. Не переказувати вміст — ' +
                         'у відповідь бери лише підсумок вище.',
      рядків: rawRows.length,
      рядки: rawRows
    } : {})
  };
}

// ─── [НОВЕ] Зіставлення "Повернення назад" ↔ "Прийнято" ──────
//
// НАВІЩО: щоб дізнатись, яка фізична одиниця товару з повернення (вона вже
// їде назад або лежить на складі) може закрити нове підтверджене замовлення —
// і не замовляти цю позицію у виробника.
//
// ЧОМУ ОКРЕМА ФУНКЦІЯ: list_orders і get_orders_by_date отримують від KeyCRM
// properties (колір/розмір), але ВИКИДАЮТЬ їх рядком .map(p => p.sku || p.name).
// Через це для зіставлення за кольором і розміром доводилось смикати get_order
// на КОЖНЕ замовлення окремо (62 виклики ≈ 167 тис. токенів).
// Тут порівняння робиться всередині воркера — назовні йдуть лише пари збігів.

// Ключ варіанту: артикул + властивості (колір/розмір), без урахування регістру.
// "КОРАЛОВИЙ" і "Кораловий" — той самий варіант.
function variantKey(product) {
  const props = (product.properties || [])
    .map(pr => `${(pr.name || '').trim().toLowerCase()}:${(pr.value || '').trim().toLowerCase()}`)
    .sort()
    .join('|');
  const sku = (product.sku || product.name || '').trim().toLowerCase();
  return `${sku}::${props}`;
}

function variantProp(product, regex) {
  const hit = (product.properties || []).find(pr => regex.test(pr.name || ''));
  return hit ? hit.value : '';
}

// Розгортає замовлення в окремі ОДИНИЦІ товару (з урахуванням кількості).
// Позиції без властивостей (апсейл "Пакування", "Преміум") пропускаються —
// це не фізичний варіант одягу, перекривати там нічого.
function flattenVariantUnits(orders) {
  const units = [];
  let skipped = 0;
  for (const o of orders) {
    for (const p of (o.products || [])) {
      if (!p.properties || p.properties.length === 0) { skipped++; continue; }
      const qty = p.quantity || 1;
      for (let i = 0; i < qty; i++) {
        units.push({
          order_id:   o.id,
          created_at: o.created_at,
          manager:    (o.manager && o.manager.full_name) || '—',
          sku:        p.sku || '—',
          name:       p.name,
          color:      variantProp(p, /колір|цвет|color/i),
          size:       variantProp(p, /розмір|размер|size/i),
          key:        variantKey(p)
        });
      }
    }
  }
  return { units, skipped };
}

async function matchReturnsToPending(apiKey, args = {}) {
  const {
    pending_status_id = 26,   // "Прийнято"
    return_status_id  = 28,   // "Повернення назад"
    date_from, date_to
  } = args;

  const base = {};
  if (date_from && date_to) {
    base['filter[created_between]'] = `${date_from} 00:00:00, ${date_to} 23:59:59`;
  }

  // Статуси можна передати як число або як масив — напр. [2, 6] щоб узяти
  // "Уточнення" і "Виготовляється" разом. На кожен статус — свій запит.
  const asList = v => Array.isArray(v) ? v : [v];
  const fetchStatuses = ids => Promise.all(
    asList(ids).map(id => getAllOrdersWithProducts(apiKey, { ...base, 'filter[status_id]': id }))
  ).then(chunks => chunks.flat());

  // Кілька запитів замість десятків get_order. getAllOrdersWithProducts уже
  // ставить потрібний include — properties приходять разом із товарами.
  const [pendingOrders, returnOrders] = await Promise.all([
    fetchStatuses(pending_status_id),
    fetchStatuses(return_status_id)
  ]);

  const p = flattenVariantUnits(pendingOrders);
  const r = flattenVariantUnits(returnOrders);

  // Кожна одиниця повернення закриває максимум одне замовлення.
  const pool = r.units.map(u => ({ ...u, used: false }));
  const pairs = {};
  let matchedUnits = 0;

  for (const unit of p.units) {
    const hit = pool.find(x => !x.used && x.key === unit.key);
    if (!hit) continue;
    hit.used = true;
    unit.matched = true;
    matchedUnits++;

    const k = `${unit.order_id}::${hit.order_id}::${unit.key}`;
    if (!pairs[k]) {
      pairs[k] = {
        pending_order_id:   unit.order_id,
        pending_created_at: unit.created_at,
        pending_manager:    unit.manager,
        return_order_id:    hit.order_id,
        return_created_at:  hit.created_at,
        sku: unit.sku, name: unit.name,
        color: unit.color, size: unit.size,
        qty_matched: 0
      };
    }
    pairs[k].qty_matched++;
  }

  // Покриття ПО ЗАМОВЛЕННЮ. Збіг закриває одну ПОЗИЦІЮ, а не все замовлення.
  // Якщо в замовленні дві різні речі, а повернення знайшлось лише на одну —
  // замовлення закрити НЕ можна: другу річ усе одно шиє виробник.
  const byPending = {};
  for (const unit of p.units) {
    const o = byPending[unit.order_id] || (byPending[unit.order_id] = {
      pending_order_id: unit.order_id,
      units_total: 0, units_matched: 0, uncovered: []
    });
    o.units_total++;
    if (unit.matched) o.units_matched++;
    else o.uncovered.push({ sku: unit.sku, name: unit.name, color: unit.color, size: unit.size });
  }

  const matches = Object.values(pairs)
    .map(m => {
      const cov = byPending[m.pending_order_id];
      return {
        ...m,
        pending_order_units_total:   cov.units_total,
        pending_order_units_matched: cov.units_matched,
        pending_order_fully_covered: cov.units_matched === cov.units_total,
        pending_order_still_missing: cov.uncovered
      };
    })
    .sort((a, b) => a.pending_order_id - b.pending_order_id);

  const touched = Object.values(byPending).filter(o => o.units_matched > 0);
  const full    = touched.filter(o => o.units_matched === o.units_total);
  const partial = touched.filter(o => o.units_matched <  o.units_total);

  return {
    filter: {
      pending_status_id, return_status_id,
      date_range: (date_from && date_to) ? { from: date_from, to: date_to } : 'усі дати'
    },
    orders_scanned: {
      pending_orders: pendingOrders.length,
      return_orders:  returnOrders.length
    },
    summary: {
      matched_pairs:  matches.length,
      matched_units:  matchedUnits,
      pending_orders_fully_covered:     full.length,
      pending_orders_partially_covered: partial.length,
      pending_units_still_need_production: p.units.length - matchedUnits,
      return_units_unused: pool.filter(x => !x.used).length,
      skipped_items_without_variant: { pending: p.skipped, returns: r.skipped }
    },
    matches,
    partially_covered: partial,
    note: 'matches — пари, де одиниця з "Повернення" (той самий артикул + колір + розмір) фізично закриває ОДНУ ПОЗИЦІЮ з "Прийнято". УВАГА: збіг ≠ закрите замовлення. Дивись pending_order_fully_covered: якщо false — у замовленні є ще позиції без покриття (вони перелічені в pending_order_still_missing), і замовлення закрити не можна, поки виробник не пошиє решту. pending_orders_fully_covered — скільки замовлень закриваються повністю. pending_units_still_need_production — скільки одиниць усе одно треба замовляти у виробника. return_units_unused — залишок повернень, що не підійшов під жодне поточне замовлення.'
  };
}

// ─── Tool Implementations ────────────────────────────────────

function getOrderStatuses() {
  return {
    groups: {
      'Новий':        [{ id:1,  name:'Новий' }],
      'Погодження':   [
        { id:2,  name:'Уточнення' },
        { id:3,  name:'Очікування відповіді' },
        { id:4,  name:'Очікування передоплати' },
        { id:23, name:'Передзвонити' },
        { id:25, name:'Недозвон' },
        { id:26, name:'Прийнято ✓ (підтверджено оператором)' },
        { id:33, name:'Не відправлено' },
        { id:34, name:'Немає в наявності' },
      ],
      'Виробництво':  [{ id:6,  name:'Виготовляється' }],
      'Доставка':     [
        { id:9,  name:'Доставляється' },
        { id:20, name:'Прибув у відділення' },
        { id:28, name:'Повернення назад' },
        { id:32, name:'Відмова на пошті' },
      ],
      'Виконано':     [{ id:12, name:'Виконано 💰 (викуплено)' }],
      'Відмінено':    [
        { id:13, name:'Некоректні дані' },
        { id:15, name:'Немає в наявності' },
        { id:16, name:'Купив в іншому місці' },
        { id:17, name:'Не влаштувала доставка' },
        { id:18, name:'Не влаштувала ціна' },
        { id:19, name:'Скасовано' },
        { id:21, name:'Нелід' },
        { id:22, name:'Дубль' },
        { id:24, name:'Відмова КЦ' },
        { id:29, name:'Не підійшов / Немає розміру' },
        { id:31, name:'Не відправлено' },
      ],
    }
  };
}

async function getOrdersByDate(apiKey, args) {
  const { date_from, date_to, status_id, limit = 50 } = args;
  const params = {
    'filter[created_between]': `${date_from} 00:00:00, ${date_to} 23:59:59`,
    'include': 'status,manager,products,marketing',
    limit: Math.min(limit, 50)
  };
  if (status_id) params['filter[status_id]'] = status_id;
  const data = await keycrmGet(apiKey, '/order', params);
  const orders = data.data || [];
  return {
    date_range: { from: date_from, to: date_to },
    total_found: data.total || orders.length,
    returned: orders.length,
    orders: orders.map(o => ({
      id: o.id,
      created_at: o.created_at,
      status_id: o.status_id,
      status: o.status?.name || o.status_id,
      status_group: STATUS_GROUP[o.status_id] || '—',
      classification: classifyStatus(o.status_id),
      manager: o.manager?.full_name || '—',
      utm_campaign: o.marketing?.utm_campaign || '—',
      utm_content:  o.marketing?.utm_content  || '—',
      utm_term:     o.marketing?.utm_term     || '—',
      utm_source:   o.marketing?.utm_source   || '—',
      grand_total:  o.grand_total,
      products: (o.products || []).map(p => p.sku || p.name).join(', ')
    }))
  };
}

async function getFunnelByCampaign(apiKey, args) {
  const { date_from, date_to, campaign_name } = args;
  const params = {
    'filter[created_between]': `${date_from} 00:00:00, ${date_to} 23:59:59`,
    'include': 'status,manager,marketing'
  };
  // [ФІКС v8] НЕ передаємо filter[utm_campaign] в API (KeyCRM його не дозволяє → 400).
  // Фільтруємо виключно на стороні воркера нижче.
  const allOrders = await getAllOrders(apiKey, params);
  const orders = campaign_name
    ? allOrders.filter(o => (o.marketing?.utm_campaign || '').includes(campaign_name))
    : allOrders;
  const map = {};

  for (const order of orders) {
    const campaign = order.marketing?.utm_campaign || '(без utm)';
    if (!map[campaign]) {
      map[campaign] = {
        campaign,
        total: 0,
        confirmed: 0,
        production: 0,
        delivery: 0,
        completed: 0,
        cancelled: 0,
        returned: 0,
        in_progress: 0,
        revenue_completed: 0,
      };
    }

    const cls = classifyStatus(order.status_id);
    const bucket = cls === 'return' ? 'returned' : cls; // [ФІКС] повернення → returned
    map[campaign].total++;
    map[campaign][bucket] = (map[campaign][bucket] || 0) + 1;
    if (cls === 'completed') map[campaign].revenue_completed += parseFloat(order.grand_total || 0);
  }

  const result = Object.values(map)
    .map(c => {
      const sent = c.delivery + c.completed + c.returned;
      const totalConfirmed = c.confirmed + c.production + sent;
      return {
        ...c,
        revenue_completed:    Math.round(c.revenue_completed),
        avg_revenue_per_buyout: c.completed > 0 ? Math.round(c.revenue_completed / c.completed) : 0,
        confirmation_rate:    pct(totalConfirmed, c.total),
        buyout_rate:          pct(c.completed, c.total),
        np_buyout_rate:       pct(c.completed, sent),
        cost_hint: 'Зведи з Meta spend щоб отримати ціну підтвердженого/викупленого замовлення і ROAS'
      };
    })
    .sort((a, b) => b.total - a.total);

  return {
    date_range: { from: date_from, to: date_to },
    total_orders: orders.length,
    legend: {
      confirmed:   'Прийнято оператором (ID 26)',
      production:  'Виготовляється (ID 6)',
      delivery:    'Доставляється / Прибув (ID 9, 20)',
      completed:   'Виконано — гроші на рахунку (ID 12)',
      returned:    'Повернення / Відмова на пошті (ID 28, 32)',
      cancelled:   'Відмінено (ID 13,15,16,17,18,19,21,22,24,29,31)',
      in_progress: 'Ще в обробці КЦ (ID 2,3,4,23,25,33,34)',
    },
    campaigns: result
  };
}

// [НОВЕ v8] Воронка по конкретному КРЕАТИВУ (utm_content) + ID оголошення (utm_term).
async function getFunnelByCreative(apiKey, args) {
  const { date_from, date_to, campaign_name, creative_name } = args;
  const params = {
    'filter[created_between]': `${date_from} 00:00:00, ${date_to} 23:59:59`,
    'include': 'status,marketing'
  };
  let orders = await getAllOrders(apiKey, params);
  if (campaign_name) orders = orders.filter(o => (o.marketing?.utm_campaign || '').includes(campaign_name));
  if (creative_name) orders = orders.filter(o => (o.marketing?.utm_content || '').includes(creative_name));

  const map = {};
  for (const order of orders) {
    const key = order.marketing?.utm_content || '(без utm_content)';
    if (!map[key]) {
      map[key] = {
        creative:   key,
        ad_id:      order.marketing?.utm_term || '',
        campaign:   order.marketing?.utm_campaign || '',
        total: 0, confirmed: 0, production: 0, delivery: 0,
        completed: 0, returned: 0, cancelled: 0, in_progress: 0, new: 0,
        revenue_completed: 0,
      };
    }
    const cls = classifyStatus(order.status_id);
    const bucket = cls === 'return' ? 'returned' : cls; // [ФІКС] повернення → returned
    map[key].total++;
    map[key][bucket] = (map[key][bucket] || 0) + 1;
    if (cls === 'completed') map[key].revenue_completed += parseFloat(order.grand_total || 0);
  }

  const result = Object.values(map)
    .map(c => {
      const sent = c.delivery + c.completed + c.returned;
      const approved = c.confirmed + c.production + sent;
      return {
        ...c,
        revenue_completed:      Math.round(c.revenue_completed),
        avg_revenue_per_buyout: c.completed > 0 ? Math.round(c.revenue_completed / c.completed) : 0,
        kc_approval_rate:       pct(approved, c.total),
        np_buyout_rate:         pct(c.completed, sent),
        overall_rate:           pct(c.completed, c.total),
      };
    })
    .sort((a, b) => b.total - a.total);

  return {
    date_range: { from: date_from, to: date_to },
    total_orders: orders.length,
    note: 'overall_rate = викуп/ліди. Зведи revenue_completed з Meta spend → ROAS; spend/completed → CPO (ціна викупу).',
    creatives: result
  };
}

async function getFunnelByProduct(apiKey, args) {
  const { sku, date_from, date_to } = args;
  const params = {
    'filter[created_between]': `${date_from} 00:00:00, ${date_to} 23:59:59`,
  };
  const orders = await getAllOrdersWithProducts(apiKey, params);

  // Фільтруємо замовлення де є товар з потрібним SKU
  const filtered = orders.filter(o =>
    (o.products || []).some(p =>
      (p.sku || '').toLowerCase().includes(sku.toLowerCase()) ||
      (p.name || '').toLowerCase().includes(sku.toLowerCase())
    )
  );

  // Загальна воронка + розбивка по кампаніях — один прохід
  const funnel = { total:0, new:0, in_progress:0, confirmed:0, production:0, delivery:0, completed:0, returned:0, cancelled:0 };
  let revenueCompletedTotal = 0;
  const byCampaign = {};

  for (const order of filtered) {
    const cls = classifyStatus(order.status_id);
    const bucket = cls === 'return' ? 'returned' : cls; // [ФІКС] повернення → returned
    funnel.total++;
    funnel[bucket] = (funnel[bucket] || 0) + 1;
    if (cls === 'completed') revenueCompletedTotal += parseFloat(order.grand_total || 0);

    const camp = order.marketing?.utm_campaign || '(без utm)';
    if (!byCampaign[camp]) {
      byCampaign[camp] = { campaign:camp, total:0, confirmed:0, completed:0, cancelled:0, returned:0, delivery:0, production:0, in_progress:0, new:0, revenue_completed:0 };
    }
    byCampaign[camp].total++;
    byCampaign[camp][bucket] = (byCampaign[camp][bucket] || 0) + 1;
    if (cls === 'completed') byCampaign[camp].revenue_completed += parseFloat(order.grand_total || 0);
  }

  const sentToNP = funnel.delivery + funnel.completed + funnel.returned;
  const kcApproved = funnel.confirmed + funnel.production + sentToNP;

  const campaigns = Object.values(byCampaign)
    .map(c => {
      const sent = c.delivery + c.completed + c.returned;
      const approved = c.confirmed + c.production + sent;
      return {
        ...c,
        revenue_completed: Math.round(c.revenue_completed),
        kc_approval_rate: pct(approved, c.total),
        np_buyout_rate:   pct(c.completed, sent),
        np_return_rate:   pct(c.returned, sent),
        overall_rate:     pct(c.completed, c.total),
      };
    })
    .sort((a, b) => b.total - a.total);

  return {
    sku,
    date_range:   { from: date_from, to: date_to },
    total_orders: filtered.length,
    funnel: {
      ...funnel,
      kc_approved:       kcApproved,
      sent_to_np:        sentToNP,
      revenue_completed: Math.round(revenueCompletedTotal),
      avg_revenue_per_buyout: funnel.completed > 0 ? Math.round(revenueCompletedTotal / funnel.completed) : 0,
      kc_approval_rate:  pct(kcApproved, funnel.total),
      np_buyout_rate:    pct(funnel.completed, sentToNP),
      np_return_rate:    pct(funnel.returned, sentToNP),
      overall_conv_rate: pct(funnel.completed, funnel.total),
    },
    by_campaign: campaigns
  };
}

// ─── KC commission rules (Malvia) ───────────────────────────
// Базовий товар:  0 комісії
// пакуванняя:     6 грн flat з кожного (незалежно від ціни)
// Преміум:        23% від ціни
// Інші апсейли:   23% від ціни (за замовчуванням)
function kcCommission(productName, price) {
  const name = (productName || '').toLowerCase();
  if (name.includes('пакуванн')) return 6;
  if (name.includes('преміум') || name.includes('premium')) return price * 0.23;
  return price * 0.23; // default для невідомих апсейлів
}

function isBaseProduct(productName, sku) {
  const name = (productName || '').toLowerCase();
  if (name.includes('пакуванн')) return false;
  if (name.includes('преміум') || name.includes('premium')) return false;
  return true;
}

async function getProductPL(apiKey, args) {
  const { sku, date_from, date_to } = args;
  const params = { 'filter[created_between]': `${date_from} 00:00:00, ${date_to} 23:59:59` };
  const orders = await getAllOrdersWithProducts(apiKey, params);

  // Фільтруємо тільки замовлення де є цей товар
  const filtered = orders.filter(o =>
    (o.products || []).some(p =>
      (p.sku  || '').toLowerCase().includes(sku.toLowerCase()) ||
      (p.name || '').toLowerCase().includes(sku.toLowerCase())
    )
  );

  // Воронка (аналогічно getFunnelByProduct)
  const funnel = { total:0, new:0, in_progress:0, confirmed:0, production:0,
                   delivery:0, completed:0, returned:0, return:0, cancelled:0 };

  // Апсейл-агрегатори для ЗАВЕРШЕНИХ замовлень
  const upsellMap = {};   // { name -> { count, total_price, kc_commission } }
  let baseCount = 0, baseTotal = 0;
  let completedOrderIds = [];
  let returnOrderIds = [];

  for (const order of filtered) {
    const cls = classifyStatus(order.status_id);
    funnel.total++;
    if (cls === 'return') {
      funnel.return = (funnel.return || 0) + 1;
    } else {
      funnel[cls] = (funnel[cls] || 0) + 1;
    }

    // Детальна розбивка тільки для ЗАВЕРШЕНИХ (реальна виручка)
    if (cls === 'completed') {
      completedOrderIds.push(order.id);
      for (const p of (order.products || [])) {
        const qty   = p.quantity || 1;
        const price = parseFloat(p.price || p.unit_price || 0);
        const name  = p.name || p.sku || '?';

        if (isBaseProduct(name, sku)) {
          baseCount += qty;
          baseTotal += price * qty;
        } else {
          // Апсейл
          if (!upsellMap[name]) upsellMap[name] = { name, count:0, total_gross:0, kc_commission:0 };
          upsellMap[name].count       += qty;
          upsellMap[name].total_gross += price * qty;
          upsellMap[name].kc_commission += kcCommission(name, price) * qty;
        }
      }
    }

    if (cls === 'return') returnOrderIds.push(order.id);
  }

  const sentToNP   = funnel.delivery + funnel.completed + (funnel.return || 0);
  const kcApproved = funnel.confirmed + funnel.production + sentToNP;
  const completedCount = funnel.completed;
  const returnCount    = funnel.return || 0;

  // Активні замовлення: підтверджені але ще не закриті (можуть змінити P&L)
  const activeOrders = funnel.confirmed + funnel.production + funnel.delivery;
  const mode = activeOrders === 0 ? 'final' : 'live';

  // Підсумки по апсейлах
  const upsells = Object.values(upsellMap).map(u => ({
    ...u,
    avg_price:      u.count > 0 ? Math.round(u.total_gross / u.count) : 0,
    net_to_seller:  Math.round(u.total_gross - u.kc_commission),
    per_completed:  completedCount > 0 ? (u.count / completedCount * 100).toFixed(1) + '%' : '0%',
  }));

  const totalUpsellGross = upsells.reduce((s, u) => s + u.total_gross, 0);
  const totalKcUpsell    = upsells.reduce((s, u) => s + u.kc_commission, 0);
  const totalRevenue     = baseTotal + totalUpsellGross;

  return {
    sku,
    date_range: { from: date_from, to: date_to },

    funnel: {
      total:            funnel.total,
      cancelled:        funnel.cancelled,
      in_progress:      (funnel.in_progress || 0) + (funnel.new || 0),
      confirmed:        funnel.confirmed,
      production:       funnel.production,
      delivery:         funnel.delivery,
      completed:        completedCount,
      return_np:        returnCount,
      kc_approved:      kcApproved,
      sent_to_np:       sentToNP,
      kc_approval_rate: pct(kcApproved, funnel.total),
      np_buyout_rate:   pct(completedCount, completedCount + returnCount),
      np_return_rate:   pct(returnCount, completedCount + returnCount),
      overall_conv:     pct(completedCount, funnel.total),
      mode,
      active_orders:   activeOrders,
      mode_note: mode === 'final'
        ? 'Всі замовлення закриті — P&L фінальний ✅'
        : `⏳ ${activeOrders} замовлень ще активні — P&L зміниться`,
      active_breakdown: mode === 'live' ? {
        pryjniato_id26:         funnel.confirmed,
        vyhotovliayetsya_id6:   funnel.production,
        np_in_transit_id9_20:   funnel.delivery,
      } : undefined,
    },

    revenue: {
      completed_orders: completedCount,
      base_product: {
        name:        sku,
        count:       baseCount,
        total:       Math.round(baseTotal),
        avg_price:   baseCount > 0 ? Math.round(baseTotal / baseCount) : 0,
        kc_commission: 0,
      },
      upsells,
      totals: {
        gross_revenue:      Math.round(totalRevenue),
        avg_per_order:      completedCount > 0 ? Math.round(totalRevenue / completedCount) : 0,
        kc_upsell_commission: Math.round(totalKcUpsell),
        net_revenue:        Math.round(totalRevenue - totalKcUpsell),
      }
    },

    costs_reference: {
      kc_confirmation_base: `${kcApproved} підтверджених × 23 грн = ${kcApproved * 23} грн`,
      kc_upsell_commission: `${Math.round(totalKcUpsell)} грн (з виручки апсейлів)`,
      return_np_cost:       `${returnCount} × 94 грн = ${returnCount * 94} грн`,
      note_cogs:            'COGS (собівартість) — передай окремо: COGS_USD × курс × кількість викупів',
    },

    completed_order_ids: completedOrderIds.slice(0, 100),
  };
}

async function getManagerStats(apiKey, args) {
  const { date_from, date_to } = args;
  const params = {
    'filter[created_between]': `${date_from} 00:00:00, ${date_to} 23:59:59`,
    'include': 'status,manager,marketing'
  };
  const orders = await getAllOrders(apiKey, params);
  const map = {};

  for (const order of orders) {
    const manager = order.manager?.full_name || '(без менеджера)';
    if (!map[manager]) {
      map[manager] = { manager, total:0, confirmed:0, cancelled:0, completed:0, in_progress:0, other:0 };
    }
    const cls = classifyStatus(order.status_id);
    map[manager].total++;
    if (cls === 'confirmed' || cls === 'production' || cls === 'delivery' || cls === 'completed') {
      map[manager].confirmed++;
    } else if (cls === 'cancelled') {
      map[manager].cancelled++;
    } else if (cls === 'in_progress' || cls === 'new') {
      map[manager].in_progress++;
    } else {
      map[manager].other++;
    }
  }

  const result = Object.values(map)
    .map(m => ({ ...m, confirmation_rate: pct(m.confirmed, m.total) }))
    .sort((a, b) => b.total - a.total);

  return {
    date_range: { from: date_from, to: date_to },
    total_orders: orders.length,
    managers: result
  };
}

// ─── [НОВЕ v9] Ранні предиктори викупу ───────────────────────
//
// НАВІЩО. Між «Прийнято» і «Викуп/Відмова» проходить 7-10 днів, а рішення по
// рекламі треба ухвалювати раніше. Потрібна ознака, видима на 0-2 день, яка
// корелює з майбутнім викупом. Ці інструменти перевіряють дві гіпотези на
// закритій історії — щоб знати, чи можна на них спиратись у живих рішеннях.
//
// ⚠️ ПРО ЗМІЩЕННЯ ВИБІРКИ. Рахувати можна ТІЛЬКИ по повністю закритій когорті.
// Викуп стається за день-два після прибуття, відмова — аж коли скінчиться
// термін зберігання. Тому свіжа когорта складається переважно з викупів, і
// будь-яка оцінка по ній систематично завищена. Бери вікно, де все відпрацьовано.

const STATUS_BOUGHT   = 12;   // Виконано (викуплено)
const STATUS_REFUSED  = 32;   // Відмова на пошті
const STATUS_NODIAL   = [25, 23];  // Недозвон, Передзвонити
const STATUS_APPROVED = [26, 6];   // Прийнято ✓, Виготовляється

function upsellGroup(order) {
  let premium = false, packaging = false;
  for (const p of order.products || []) {
    const n = (p.name || '').toLowerCase();
    if (n.includes(PACKAGING_MARK)) packaging = true;
    else if (n.includes(PREMIUM_MARK)) premium = true;
  }
  if (premium)   return 'преміум';
  if (packaging) return 'тільки пакування';
  return 'без апсейлу';
}

function orderArticle(order) {
  for (const p of order.products || []) {
    if (isBaseProduct(p.name, p.sku)) {
      const a = extractArticle(p.name) || p.sku;
      if (a) return String(a);
    }
  }
  return '(без артикула)';
}

async function getBuyoutByUpsell(apiKey, args) {
  const { date_from, date_to, min_orders = 20 } = args;
  const base = { 'filter[created_between]': `${date_from} 00:00:00, ${date_to} 23:59:59` };

  const [bought, refused] = await Promise.all([
    getAllOrdersWithProducts(apiKey, { ...base, 'filter[status_id]': STATUS_BOUGHT }),
    getAllOrdersWithProducts(apiKey, { ...base, 'filter[status_id]': STATUS_REFUSED }),
  ]);

  const GROUPS = ['без апсейлу', 'тільки пакування', 'преміум'];
  const overall = {}, bySku = {};
  for (const g of GROUPS) overall[g] = { викуплено: 0, відмова: 0 };

  const tally = (orders, field) => {
    for (const o of orders) {
      const g = upsellGroup(o), sku = orderArticle(o);
      overall[g][field]++;
      if (!bySku[sku]) {
        bySku[sku] = {};
        for (const x of GROUPS) bySku[sku][x] = { викуплено: 0, відмова: 0 };
      }
      bySku[sku][g][field]++;
    }
  };
  tally(bought, 'викуплено');
  tally(refused, 'відмова');

  const rate = c => (c.викуплено + c.відмова) ? c.викуплено / (c.викуплено + c.відмова) : null;

  // ── Стратифікована оцінка: різниця «преміум − без преміуму» ВСЕРЕДИНІ артикула,
  //    зважена обсягом артикула. Це і є відповідь на питання; портфельна
  //    різниця нижче наведена лише для порівняння й довіряти їй не можна.
  let wSum = 0, wDiff = 0;
  const perSku = [];
  for (const [sku, g] of Object.entries(bySku)) {
    const withP = g['преміум'];
    const noP = {
      викуплено: g['без апсейлу'].викуплено + g['тільки пакування'].викуплено,
      відмова:   g['без апсейлу'].відмова   + g['тільки пакування'].відмова,
    };
    const nW = withP.викуплено + withP.відмова, nN = noP.викуплено + noP.відмова;
    if (nW + nN < min_orders || nW === 0 || nN === 0) continue;
    const rW = rate(withP), rN = rate(noP), diff = rW - rN;
    const w = nW + nN;
    wSum += w; wDiff += diff * w;
    perSku.push({
      артикул: sku, фіналізованих: w,
      'викуп з Преміумом': pct(withP.викуплено, nW), n_преміум: nW,
      'викуп без Преміуму': pct(noP.викуплено, nN), n_без: nN,
      різниця_пп: +(diff * 100).toFixed(1),
    });
  }
  perSku.sort((a, b) => b.фіналізованих - a.фіналізованих);

  const stratified = wSum ? (wDiff / wSum) * 100 : null;
  const naive = (() => {
    const p = overall['преміум'];
    const n = {
      викуплено: overall['без апсейлу'].викуплено + overall['тільки пакування'].викуплено,
      відмова:   overall['без апсейлу'].відмова   + overall['тільки пакування'].відмова,
    };
    const rP = rate(p), rN = rate(n);
    return (rP != null && rN != null) ? +((rP - rN) * 100).toFixed(1) : null;
  })();

  return {
    вікно: { from: date_from, to: date_to },
    всього_фіналізованих: bought.length + refused.length,
    по_групах: Object.fromEntries(GROUPS.map(g => [g, {
      ...overall[g],
      всього: overall[g].викуплено + overall[g].відмова,
      викуп: pct(overall[g].викуплено, overall[g].викуплено + overall[g].відмова),
    }])),
    ВІДПОВІДЬ: {
      різниця_всередині_артикула_пп: stratified != null ? +stratified.toFixed(1) : null,
      артикулів_у_розрахунку: perSku.length,
      як_читати: 'Наскільки більший (у пунктах) викуп у тих, хто взяв Преміум, ' +
                 'при порівнянні з покупцями ТОГО САМОГО товару. Це чиста цифра — ' +
                 'на неї можна спиратись. Приблизно 0 = сигналу немає, гіпотеза не працює.',
    },
    портфельна_різниця_пп: naive,
    ПОПЕРЕДЖЕННЯ: 'Портфельну різницю НЕ використовувати для висновків: Преміум ' +
                  'нерівномірно розподілений між товарами з різним викупом. Розбіжність ' +
                  'між нею і стратифікованою — це і є розмір спотворення від міксу товарів.',
    по_артикулах: perSku,
  };
}

// ── Діагностика: чи існує історія статусів у KeyCRM ──
async function probeOrderHistory(apiKey, args) {
  const { order_id } = args;
  const candidates = [
    `/order/${order_id}/history`,
    `/order/${order_id}/statuses`,
    `/order/${order_id}/activity`,
    `/order/${order_id}/timeline`,
    `/orders/${order_id}/history`,
  ];
  const results = [];
  for (const path of candidates) {
    try {
      const d = await keycrmGet(apiKey, path);
      results.push({ шлях: path, працює: true, зразок: JSON.stringify(d).slice(0, 400) });
    } catch (e) {
      results.push({ шлях: path, працює: false, помилка: String(e.message || e).slice(0, 120) });
    }
  }
  let card = null;
  try {
    card = await keycrmGet(apiKey, `/order/${order_id}`,
      { include: 'status,manager,products,marketing,tags,buyer,shipping,payments' });
  } catch (e) { /* ігноруємо — головне результат перебору вище */ }

  const working = results.filter(r => r.працює).map(r => r.шлях);
  return {
    перебір_ендпоінтів: results,
    поля_картки_замовлення: card ? Object.keys(card) : null,
    часові_поля: card ? Object.keys(card).filter(k => /_at$|date|time/i.test(k)) : null,
    ВИСНОВОК: working.length
      ? `Історія доступна: ${working.join(', ')}. Передай цей шлях у get_buyout_by_calls як history_path.`
      : 'Історії статусів немає в жодному кандидаті. Гіпотезу «викуп проти кількості дзвінків» ' +
        'наявними даними перевірити НЕ можна. Варіанти: (1) дивись «часові_поля» вище — якщо там ' +
        'є мітка часу зміни статусу, лишається проксі «швидкість підтвердження»; (2) просити ' +
        'OneCall фіксувати спроби дозвону тегом на замовленні.',
  };
}

async function getBuyoutByCalls(apiKey, args) {
  const { date_from, date_to, sample_size = 150, history_path } = args;
  const base = { 'filter[created_between]': `${date_from} 00:00:00, ${date_to} 23:59:59` };

  const [bought, refused] = await Promise.all([
    getAllOrders(apiKey, { ...base, 'filter[status_id]': STATUS_BOUGHT, include: 'status' }),
    getAllOrders(apiKey, { ...base, 'filter[status_id]': STATUS_REFUSED, include: 'status' }),
  ]);

  // Детермінована псевдовипадкова вибірка: та сама когорта дає той самий результат,
  // тож повторний запуск можна порівнювати з попереднім.
  const pick = (arr, n) => {
    const a = [...arr].sort((x, y) => ((x.id * 2654435761) % 4294967296) - ((y.id * 2654435761) % 4294967296));
    return a.slice(0, Math.min(n, a.length));
  };
  const sample = [
    ...pick(bought,  sample_size).map(o => ({ o, викуплено: true })),
    ...pick(refused, sample_size).map(o => ({ o, викуплено: false })),
  ];

  const tmpl = history_path || '/order/{id}/history';
  const buckets = {
    'з першого разу': { викуплено: 0, відмова: 0 },
    '1 недозвон':     { викуплено: 0, відмова: 0 },
    '2+ недозвони':   { викуплено: 0, відмова: 0 },
  };
  const hours = { викуплено: [], відмова: [] };
  let failed = 0, firstError = null;

  for (const { o, викуплено } of sample) {
    let hist;
    try {
      hist = await keycrmGet(apiKey, tmpl.replace('{id}', o.id));
    } catch (e) {
      failed++; if (!firstError) firstError = String(e.message || e).slice(0, 200);
      continue;
    }
    const events = Array.isArray(hist) ? hist : (hist.data || hist.history || []);
    let nodial = 0, approvedAt = null;
    for (const ev of events) {
      const sid = parseInt(ev.status_id ?? ev.to ?? ev.new_status_id);
      const at  = ev.created_at || ev.date || ev.changed_at;
      if (STATUS_NODIAL.includes(sid)) nodial++;
      if (!approvedAt && STATUS_APPROVED.includes(sid) && at) approvedAt = at;
    }
    const key = nodial === 0 ? 'з першого разу' : (nodial === 1 ? '1 недозвон' : '2+ недозвони');
    buckets[key][викуплено ? 'викуплено' : 'відмова']++;
    if (approvedAt && o.created_at) {
      const h = (new Date(approvedAt) - new Date(o.created_at)) / 3600000;
      if (h >= 0 && h < 720) hours[викуплено ? 'викуплено' : 'відмова'].push(h);
    }
  }

  if (failed === sample.length) {
    return {
      ПОМИЛКА: 'Жоден запит історії не пройшов — шлях невірний або історії немає.',
      пробували_шлях: tmpl, перша_помилка: firstError,
      що_робити: 'Запусти probe_order_history на будь-якому замовленні й передай сюди робочий history_path.',
    };
  }

  const med = a => a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null;
  return {
    вікно: { from: date_from, to: date_to },
    вибірка: { викуплених: pick(bought, sample_size).length, відмов: pick(refused, sample_size).length,
               не_вдалося_прочитати: failed },
    генеральна_сукупність: { викуплених: bought.length, відмов: refused.length },
    викуп_за_важкістю_дозвону: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, {
      ...v, всього: v.викуплено + v.відмова, викуп: pct(v.викуплено, v.викуплено + v.відмова),
    }])),
    медіана_годин_до_підтвердження: {
      'у тих, хто викупив':   med(hours.викуплено),
      'у тих, хто відмовився': med(hours.відмова),
    },
    як_читати: 'Якщо викуп по групах різниться слабо (менш ніж на 5 п.п.) — гіпотеза не працює, ' +
               'важкість дозвону майбутній викуп не передбачає. Це теж результат: не витрачай на неї час далі. ' +
               'Оцінка на вибірці — дрібні розбіжності в межах 3-4 п.п. є шумом.',
  };
}

async function getKeyCrmCategories(apiKey) {
  const data = await keycrmGet(apiKey, '/products/categories');
  return data;
}

async function getDeliveryServices(apiKey) {
  const data = await keycrmGet(apiKey, '/order/delivery-service');
  return data;
}

async function getKeyCrmUsers(apiKey) {
  const data = await keycrmGet(apiKey, '/users');
  return data;
}

// ─── v7.0 Tool Implementations ───────────────────────────────

async function getAllProducts(apiKey, args = {}) {
  const { category_id, query, is_archived, include_custom_fields, max_pages = 100 } = args;
  const params = {};
  if (category_id) params['filter[category_id]'] = category_id;
  if (is_archived !== undefined && is_archived !== '') params['filter[is_archived]'] = is_archived;
  if (include_custom_fields) params['include'] = 'custom_fields';
  let products = await getAllPages(apiKey, '/products', params, max_pages);
  if (query) {
    const q = String(query).toLowerCase();
    products = products.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q)
    );
  }
  return {
    total: products.length,
    products: products.map(p => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      price: p.price,
      purchased_price: p.purchased_price,
      category_id: p.category_id,
      has_offers: p.has_offers,
      description: p.description,
      custom_fields: include_custom_fields ? p.custom_fields : undefined
    }))
  };
}

async function updateProduct(apiKey, args) {
  const { product_id } = args;
  if (!product_id) throw new Error('product_id обовʼязковий');
  const body = {};
  for (const k of ['name', 'description', 'price', 'purchased_price', 'category_id', 'sku', 'currency_code', 'pictures', 'custom_fields']) {
    if (args[k] !== undefined) body[k] = args[k];
  }
  if (Object.keys(body).length === 0) throw new Error('Не передано жодного поля для оновлення');
  const result = await keycrmPut(apiKey, `/products/${product_id}`, body);
  return { success: true, product_id, updated_fields: Object.keys(body), result };
}

async function listOrders(apiKey, args = {}) {
  const { date_from, date_to, status_id, source_id, buyer_phone, has_tracking_code,
          include = 'status,manager,products,marketing,tags', limit = 50, page, fetch_all = false } = args;
  const params = { include };
  if (date_from && date_to) params['filter[created_between]'] = `${date_from} 00:00:00, ${date_to} 23:59:59`;
  if (status_id) params['filter[status_id]'] = status_id;
  if (source_id) params['filter[source_id]'] = source_id;
  if (buyer_phone) params['filter[buyer_phone]'] = buyer_phone;
  if (has_tracking_code !== undefined) params['filter[has_tracking_code]'] = has_tracking_code;

  let orders;
  let meta = {};
  if (fetch_all) {
    orders = await getAllOrders(apiKey, params);
    meta = { fetched_all: true };
  } else {
    // [НОВЕ v8] Посторінковий режим: одна сторінка + метадані пагінації.
    // Кожен виклик = 1 підзапит → можна обійти весь масив частинами без ліміту Cloudflare.
    const data = await keycrmGet(apiKey, '/order', { ...params, limit: Math.min(limit, 50), page: page || 1 });
    orders = data.data || [];
    meta = {
      page:      data.current_page || page || 1,
      last_page: data.last_page,
      total:     data.total,
      has_next:  (data.current_page || page || 1) < (data.last_page || 1),
    };
  }
  return {
    ...meta,
    returned: orders.length,
    orders: orders.map(o => ({
      id: o.id,
      created_at: o.created_at,
      status_id: o.status_id,
      status: o.status?.name || o.status_id,
      status_group: STATUS_GROUP[o.status_id] || '—',
      classification: classifyStatus(o.status_id),
      manager: o.manager?.full_name || '—',
      utm_campaign: o.marketing?.utm_campaign || '—',
      utm_content:  o.marketing?.utm_content  || '—',
      utm_term:     o.marketing?.utm_term     || '—',
      utm_medium:   o.marketing?.utm_medium   || '—',
      grand_total: o.grand_total,
      tags: (o.tags || []).map(t => t.name).join(', '),
      products: (o.products || []).map(p => p.sku || p.name).join(', ')
    }))
  };
}

async function updateOrder(apiKey, args) {
  const { order_id } = args;
  if (!order_id) throw new Error('order_id обовʼязковий');
  const body = {};
  for (const k of ['status_id', 'manager_comment', 'buyer_comment', 'discount_percent', 'discount_amount', 'products', 'shipping', 'custom_fields']) {
    if (args[k] !== undefined) body[k] = args[k];
  }
  if (Object.keys(body).length === 0) throw new Error('Не передано жодного поля для оновлення');
  const result = await keycrmPut(apiKey, `/order/${order_id}`, body);
  return { success: true, order_id, updated_fields: Object.keys(body), result };
}

async function getOrder(apiKey, args) {
  const { order_id, include = 'buyer,products.offer,manager,status,marketing,payments,shipping.deliveryService,tags,expenses,custom_fields' } = args;
  if (!order_id) throw new Error('order_id обовʼязковий');
  return keycrmGet(apiKey, `/order/${order_id}`, { include });
}

async function updateOffers(apiKey, args) {
  const { offers } = args;
  if (!Array.isArray(offers) || offers.length === 0) throw new Error('Передай масив offers');
  const result = await keycrmPut(apiKey, '/offers', { offers });
  return { success: true, updated: offers.length, result };
}

async function getOrderTags(apiKey) {
  const data = await keycrmGet(apiKey, '/order/tag', { limit: 100 });
  const tags = data.data || [];
  return { total: tags.length, tags: tags.map(t => ({ id: t.id, name: t.name })) };
}

async function resolveTagId(apiKey, tag_id, tag_name) {
  if (tag_id) return tag_id;
  if (!tag_name) throw new Error('Передай tag_id або tag_name');
  const data = await keycrmGet(apiKey, '/order/tag', { limit: 100 });
  const found = (data.data || []).find(t => (t.name || '').toLowerCase() === String(tag_name).toLowerCase());
  if (!found) throw new Error(`Тег "${tag_name}" не знайдено`);
  return found.id;
}

async function addOrderTag(apiKey, args) {
  const { order_id, tag_id, tag_name } = args;
  if (!order_id) throw new Error('order_id обовʼязковий');
  const id = await resolveTagId(apiKey, tag_id, tag_name);
  await keycrmPost(apiKey, `/order/${order_id}/tag/${id}`, {});
  return { success: true, order_id, tag_id: id };
}

async function removeOrderTag(apiKey, args) {
  const { order_id, tag_id, tag_name } = args;
  if (!order_id) throw new Error('order_id обовʼязковий');
  const id = await resolveTagId(apiKey, tag_id, tag_name);
  await keycrmDelete(apiKey, `/order/${order_id}/tag/${id}`);
  return { success: true, order_id, removed_tag_id: id };
}

async function listBuyers(apiKey, args = {}) {
  const { buyer_phone, buyer_email, date_from, date_to, include, limit = 50, fetch_all = false } = args;
  const params = {};
  if (include) params['include'] = include;
  if (buyer_phone) params['filter[buyer_phone]'] = buyer_phone;
  if (buyer_email) params['filter[buyer_email]'] = buyer_email;
  if (date_from && date_to) params['filter[created_between]'] = `${date_from} 00:00:00, ${date_to} 23:59:59`;
  let buyers;
  if (fetch_all) {
    buyers = await getAllPages(apiKey, '/buyer', params, 100);
  } else {
    const data = await keycrmGet(apiKey, '/buyer', { ...params, limit: Math.min(limit, 50) });
    buyers = data.data || [];
  }
  return { total: buyers.length, buyers };
}

async function getBuyer(apiKey, args) {
  const { buyer_id, include = 'manager,shipping,company,loyalty,custom_fields' } = args;
  if (!buyer_id) throw new Error('buyer_id обовʼязковий');
  return keycrmGet(apiKey, `/buyer/${buyer_id}`, { include });
}

async function getCustomFields(apiKey, args = {}) {
  const { model, with_options } = args;
  const params = {};
  if (with_options) params['include'] = 'options';
  if (model) params['filter[model]'] = model;
  return keycrmGet(apiKey, '/custom-fields', params);
}

async function uploadFile(apiKey, args) {
  const { file_url, filename } = args;
  if (!file_url) throw new Error('file_url обовʼязковий');
  const result = await keycrmUploadFile(apiKey, file_url, filename);
  return { success: true, file: result };
}

async function createCategory(apiKey, args) {
  const { name, parent_id } = args;
  if (!name) throw new Error('name обовʼязковий');
  const body = { name };
  if (parent_id) body.parent_id = parent_id;
  const result = await keycrmPost(apiKey, '/products/categories', body);
  return { success: true, category: result };
}

async function createKeyCrmProduct(apiKey, args) {
  const data = await keycrmPost(apiKey, '/products', args);
  return data;
}

async function createKeyCrmOffers(apiKey, args) {
  const { productId, offers } = args;
  const data = await keycrmPost(apiKey, `/products/${productId}/offers`, { offers });
  return data;
}

async function getProductOffers(apiKey, args) {
  const { query } = args;
  const q = query.toLowerCase();

  let allProducts = [];
  let page = 1;
  while (page <= 10) {
    const data = await keycrmGet(apiKey, '/products', { limit: 50, page });
    const batch = data.data || [];
    allProducts = allProducts.concat(batch);
    if (batch.length < 50 || page >= (data.last_page || 1)) break;
    page++;
  }

  const filtered = allProducts.filter(p =>
    (p.name || '').toLowerCase().includes(q) ||
    (p.sku  || '').toLowerCase().includes(q)
  );

  if (filtered.length === 0) {
    return {
      found: 0,
      message: `Товар "${query}" не знайдено серед ${allProducts.length} товарів.`,
      products: []
    };
  }

  const results = [];
  for (const p of filtered.slice(0, 5)) {
    let offers = [];
    try {
      const offersResp = await keycrmGet(apiKey, '/offers', {
        'filter[product_id]': p.id,
        'limit': 100
      });
      offers = offersResp.data || [];
    } catch (e) {
      offers = [];
    }
    results.push({
      product_id: p.id,
      product_name: p.name,
      offers: offers.map(o => ({
        offer_id: o.id,
        sku: o.sku || '',
        price: o.price,
        purchased_price: o.purchased_price,
        properties: (o.properties || []).map(pr => `${pr.name}: ${pr.value}`).join(', ')
      }))
    });
  }

  return {
    found: filtered.length,
    total_in_catalog: allProducts.length,
    products: results
  };
}

async function createOrder(apiKey, args, npKey = '') {
  const {
    buyer_name,
    buyer_phone,
    city,
    np_branch,
    offer_sku,
    product_name,
    price,
    quantity = 1,
    comment = '',
    tags = [],
    manager_name = ''
  } = args;

  let phone = String(buyer_phone).replace(/\s+/g, '');
  if (phone.startsWith('0')) phone = '+38' + phone;
  if (phone.startsWith('38') && !phone.startsWith('+')) phone = '+' + phone;

  const branchStr = String(np_branch).replace(/^відділення\s*№?\s*/i, '').trim();

  let warehouseRef = null;
  let warehouseLabel = `Відділення ${branchStr}`;
  let warehouseSettlement = city;
  let warehouseAmbiguous = false;
  let deliveryServiceId = null;

  try {
    const npWarehouse = await findNovaPoshtaWarehouse(city, branchStr, npKey);
    if (npWarehouse) {
      warehouseRef = npWarehouse.ref;
      warehouseLabel = npWarehouse.description;
      warehouseSettlement = npWarehouse.settlement || city;
      warehouseAmbiguous = !!npWarehouse.ambiguous;
      deliveryServiceId = 1;
    }
  } catch (e) {}

  const shippingObj = {
    shipping_address_city: city,
    shipping_address_country: 'UA',
    shipping_receive_point: warehouseLabel
  };

  if (deliveryServiceId && warehouseRef) {
    shippingObj.delivery_service_id = deliveryServiceId;
    shippingObj.warehouse_ref = warehouseRef;
  } else {
    shippingObj.shipping_service = 'Нова Пошта';
  }

  let managerId = 28;
  if (manager_name) {
    try {
      const usersResp = await keycrmGet(apiKey, '/users', { limit: 50 });
      const users = usersResp.data || [];
      const foundUser = users.find(u =>
        (u.full_name || '').toLowerCase().includes(manager_name.toLowerCase()) ||
        (u.username || '').toLowerCase().includes(manager_name.toLowerCase()) ||
        (u.email || '').toLowerCase().includes(manager_name.toLowerCase())
      );
      if (foundUser) {
        managerId = foundUser.id;
      }
    } catch (e) {}
  }

  const body = {
    source_id: 3,
    buyer: {
      full_name: buyer_name,
      phone
    },
    manager_comment: comment || null,
    shipping: shippingObj,
    products: [
      {
        sku: offer_sku,
        name: product_name,
        price,
        quantity
      }
    ],
    marketing: {
      utm_source:   'facebook',
      utm_medium:   'messenger',
      utm_campaign: 'messenger-operator'
    }
  };

  if (managerId) {
    body.manager_id = managerId;
  }

  const result = await keycrmPost(apiKey, '/order', body);

  let extractedTags = [];
  try {
    const offerResp = await keycrmGet(apiKey, '/offers', {
      'filter[sku]': offer_sku,
      'include': 'product'
    });

    if (offerResp && offerResp.data && offerResp.data.length > 0) {
      const offerData = offerResp.data[0];

      // 1) Основне: тег по КАТЕГОРІЇ товару (надійно — не залежить від тексту опису)
      let catId = offerData.product?.category_id;
      if ((catId === undefined || catId === null) && offerData.product?.id) {
        try {
          const prod = await keycrmGet(apiKey, `/products/${offerData.product.id}`);
          catId = prod?.category_id;
        } catch (e) {}
      }
      const CATEGORY_TAG = { 1: 'KORA', 2: 'Minova', 3: 'Seven', 6: 'Lotran' };
      if (catId && CATEGORY_TAG[catId]) extractedTags.push(CATEGORY_TAG[catId]);

      // 2) Запасне: пошук назви виробника в тексті картки
      const productDesc = offerData.product?.description || '';
      const productName = offerData.product?.name || '';
      const combinedText = (productDesc + ' ' + productName).toLowerCase();

      if (combinedText.includes('кора') || combinedText.includes('kora')) {
        extractedTags.push('KORA');
      }
      if (combinedText.includes('seven')) {
        extractedTags.push('Seven');
      }
      if (combinedText.includes('lotran')) {
        extractedTags.push('Lotran');
      }
      if (combinedText.includes('minova') || combinedText.includes('мінова')) {
        extractedTags.push('Minova');
      }

      extractedTags = [...new Set(extractedTags)];
    }
  } catch (e) {}

  let finalTags = [...extractedTags];
  if (tags && Array.isArray(tags)) {
    finalTags = [...new Set([...finalTags, ...tags])];
  } else if (tags && typeof tags === 'string') {
    finalTags = [...new Set([...finalTags, tags.trim()])];
  }

  let attachedTags = [];
  if (finalTags.length > 0) {
    try {
      attachedTags = await attachTagsToOrder(apiKey, result.id, finalTags);
    } catch (e) {}
  }

  const npFound = !!warehouseRef;
  let warning = null;
  if (!npFound) {
    warning = `⚠️ Відділення НП не знайдено для "${city}, ${branchStr}" — замовлення створено ТЕКСТОВОЮ адресою без прив'язки до складу, ТТН в один клік НЕ спрацює. Перевір назву міста та номер відділення вручну в KeyCRM.`;
  } else if (warehouseAmbiguous) {
    warning = `⚠️ Назва "${city}" неоднозначна — обрано "${warehouseSettlement}", але точного відділення №${branchStr} там немає (взято перше). Перевір район і відділення в KeyCRM.`;
  }

  return {
    success: true,
    order_id: result.id,
    source: 'Facebook Messenger (ID 3)',
    buyer: buyer_name,
    phone,
    city,
    np_settlement: warehouseSettlement,
    np_branch: warehouseLabel,
    np_warehouse_found: npFound,
    product: product_name,
    sku: offer_sku,
    price,
    quantity,
    grand_total: price * quantity,
    tags: attachedTags,
    keycrm_url: `https://app.keycrm.app/order/${result.id}`,
    warning,
    note: npFound
      ? 'Замовлення створено, відділення НП прив\'язане. ТТН генерується в один клік через блискавку.'
      : 'Замовлення створено, але відділення НП не визначено — дивись поле warning.'
  };
}

// ─── Helpers ─────────────────────────────────────────────────

function pct(part, total) {
  return total > 0 ? Math.round((part / total) * 100) + '%' : '0%';
}

// Один запит до API Нової Пошти. npKey порожній → анонімні довідники (працює,
// але недокументовано); зі справжнім ключем (env.NP_API_KEY) — стабільніше + ліміти.
async function npApi(methodProperties, calledMethod, modelName, npKey = '') {
  try {
    const res = await fetch('https://api.novaposhta.ua/v2.0/json/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: npKey, modelName, calledMethod, methodProperties })
    });
    if (!res.ok) return [];
    const json = await res.json();
    return (json.success && Array.isArray(json.data)) ? json.data : [];
  } catch (e) {
    return [];
  }
}

async function findNovaPoshtaWarehouse(cityName, branchNumber, npKey = '') {
  const bn = String(branchNumber);

  // 1) Прямий пошук по назві міста + номеру відділення (працює для міст)
  const direct = await npApi({ CityName: cityName, WarehouseId: bn }, 'getWarehouses', 'AddressGeneral', npKey);
  if (direct.length) {
    const wh = direct.find(w => String(w.Number) === bn) || direct[0];
    return { ref: wh.Ref, description: wh.Description, settlement: cityName, ambiguous: false };
  }

  // 2) Фолбек для сіл / малих НП: getWarehouses по CityName їх не бачить.
  //    Беремо ТОП-збіги населених пунктів і шукаємо серед них той, де реально
  //    є відділення з потрібним номером (щоб не сплутати однойменні села).
  const settlements = await npApi({ CityName: cityName, Limit: '5' }, 'searchSettlements', 'Address', npKey);
  const addresses = (settlements[0] && settlements[0].Addresses) || [];

  let fallback = null;
  for (const addr of addresses) {
    const whs = await npApi({ SettlementRef: addr.Ref }, 'getWarehouses', 'AddressGeneral', npKey);
    if (!whs.length) continue;
    const match = whs.find(w => String(w.Number) === bn);
    if (match) {
      return { ref: match.Ref, description: match.Description, settlement: addr.Present, ambiguous: false };
    }
    if (!fallback) fallback = { ref: whs[0].Ref, description: whs[0].Description, settlement: addr.Present, ambiguous: true };
  }

  return fallback;
}

async function attachTagsToOrder(apiKey, orderId, tagNames) {
  try {
    const tagsResp = await keycrmGet(apiKey, '/order/tag', { limit: 100 });
    const allTags = tagsResp.data || [];

    const tagIds = [];
    const attached = [];
    for (const name of tagNames) {
      const found = allTags.find(t => t.name.toLowerCase() === name.toLowerCase());
      if (found) {
        tagIds.push({ id: found.id, name: found.name });
      }
    }

    for (const tag of tagIds) {
      await keycrmPost(apiKey, `/order/${orderId}/tag/${tag.id}`, {});
      attached.push(tag.name);
    }
    return attached;
  } catch (e) {
    console.error('Помилка прив\'язки тегів:', e);
    return [];
  }
}

function corsResponse(body, status = 200) {
  // CORS-заголовків тут свідомо НЕМАЄ. Обидва клієнти (keycrm_bridge.py і
  // віддалений конектор) ходять із сервера, а не з браузера — CORS до них не
  // застосовується взагалі. Раніше стояв Allow-Origin: '*', і це означало, що
  // будь-яка сторінка могла смикати воркер із браузера відвідувача.
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
