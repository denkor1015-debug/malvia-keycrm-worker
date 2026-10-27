// ============================================================
// KeyCRM MCP Server для Cloudflare Workers
// Версія 8.4 — закрито відкритий ендпоінт.
//
// v8.4.11 (тільки додано):
//   [НОВЕ] виробник Тимофеева (з 27.10.2026; категорія KeyCRM 10, тег Timofeeva):
//          у MANUFACTURER_TAGS (get_period_summary) і CATEGORY_TAG (create_order),
//          так само, як Бонаеми у v8.4.10.
//
// v8.4.10 (тільки додано):
//   [НОВЕ] виробник Бонаеми (з 23.10.2026; категорія KeyCRM 9, тег BM):
//          у MANUFACTURER_TAGS (get_period_summary) і CATEGORY_TAG (create_order),
//          так само, як Люда-Лёня у v8.4.7.
//
// v8.4.9 (тільки додано):
//   [НОВЕ] get_funnel_by_variant: воронка і викуп по кольорах, розмірах і колір×розмір
//          у штуках, з інтервалом Вілсона. Довгий період — кількома викликами через
//          cursor: фільтра за товаром у GET /order немає, а 50 підзапитів на виклик
//          вистачає лише на ~45 сторінок замовлень.
//
// v8.4.8 (тільки додано):
//   [НОВЕ] get_offer_reserve_holders: які замовлення тримають резерв на SKU.
//          Вечірній прогін показує SKU «у мінусі», але не каже, чиї це замовлення —
//          раніше лишалось смикати get_order на кожне (146 лише у «Виготовляється»).
//
// v8.4.7 (тільки додано):
//   [НОВЕ] виробник Люда-Лёня (з 14.10.2026; категорія KeyCRM 8, тег Люда-Лёня):
//          у MANUFACTURER_TAGS (get_period_summary) і CATEGORY_TAG (create_order),
//          так само, як MaxiFashion у v8.4.6.
//
// v8.4.6 (тільки додано):
//   [НОВЕ] виробник MaxiFashion (з 12.10.2026; категорія KeyCRM 7, тег MaxiFashion):
//          у MANUFACTURER_TAGS — інакше get_period_summary клав його продажі в
//          «(без тегу виробника)» і місяць закривався неправильно; і в CATEGORY_TAG
//          для create_order.
//
// v8.4.5 (тільки додано):
//   [НОВЕ] get_offer_stocks: залишок і резерв по списку SKU (GET /offers/stocks,
//          пачками по 50). Потрібен вечірній перевірці складу в бізнес-репо:
//          щоб помітити, коли залишок складського товару росте без заливки
//          (масове закриття повернень → фантомні штуки на сайтах).
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
      return corsResponse(JSON.stringify({ status: 'KeyCRM MCP Server v8.4.11 running ✓' }), 200);
    }
    // /mcp або /mcp/<секрет> — друге для клієнтів, де можна задати лише URL.
    if (request.method === 'POST' && (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/'))) {
      if (!isAuthorized(request, url, env)) return unauthorized(env);
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

function isAuthorized(request, url, env) {
  const expected = env.MCP_SHARED_SECRET;
  if (!expected) return false;

  const headerKey = request.headers.get('X-MCP-Key');
  if (headerKey) return safeEqual(headerKey, expected);

  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) return safeEqual(auth.slice(7), expected);

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

function unauthorized(env) {
  const reason = env.MCP_SHARED_SECRET
    ? 'Forbidden: missing or invalid MCP secret'
    : 'Server misconfigured: MCP_SHARED_SECRET is not set';
  // 403, а НЕ 401. У MCP 401 — це протокольне запрошення пройти OAuth: клієнт
  // піде шукати /.well-known/oauth-* , не знайде, і покаже користувачу помилку
  // реєстрації в неіснуючому "sign-in service". Ми на спільному секреті, OAuth
  // не буде — тож кажемо прямо "не пущу", без запрошення автентифікуватись.
  return corsResponse(JSON.stringify({
    jsonrpc: '2.0', id: null, error: { code: -32001, message: reason }
  }), 403);
}

// ─── Статуси Malvia ──────────────────────────────────────────

const STATUS = {
  NEW: [1],
  IN_PROGRESS: [2, 3, 4, 23, 25, 33, 34],
  CONFIRMED_BY_OPERATOR: [26],
  PRODUCTION: [6],
  DELIVERY: [9, 20],
  // 35 — «Відмова» на пошті: 216 замовлень за лип–серп 2026, усі з трек-номером.
  // Знайдено 24.08.2026 — у довіднику CRM його не було взагалі. Довідник
  // get_order_statuses тепер його містить, і тест стежить, щоб не розійшлись.
  RETURN: [28, 32, 35],
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
  28: 'Повернення', 32: 'Повернення', 35: 'Повернення',
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
          serverInfo:{name:'keycrm-mcp',version:'8.4.11'}
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
    name: 'get_funnel_by_variant',
    description: 'Воронка і ВИКУП по варіантах товару: колір, розмір, колір×розмір — за період (дата створення замовлення). Рахує ШТУКИ (позиція × кількість), лише позиції цього товару: інші товари в замовленні й апсейли (Преміум, пакування) не рахуються; статус штуки = статус її замовлення. Викуп (забір на пошті) = виконано (12) ÷ (виконано + відмови на пошті 28+32+35); у дорозі (9, 20) у викуп не входять. Для підсумку і кожної групи: ordered, cancelled, no_size_29 (скасовано «Не підійшов / Немає розміру» — варіанта не було), pending (ще до відправки), in_transit, completed, refused, sent, buyout_rate, ci95 (95% інтервал Вілсона), low_n (sent < 20). Кольори — за викупом, розміри — по порядку. Службове: orders_total і orders_by_class (як у get_funnel_by_product — для звірки), multi_variant_orders (2+ кольори в замовленні — частковий викуп CRM не бачить), unknown_statuses. Рахує на сервері, відповідь — кілька КБ. ДОВГИЙ ПЕРІОД: один виклик гортає до 45 сторінок по 50 замовлень магазину; якщо complete: false — виклич ще раз з тими самими sku/date_from/date_to і cursor = next.cursor. Повний розріз прийде в останньому виклику.',
    inputSchema: {
      type:'object',
      properties:{
        sku:       { type:'string', description:'Артикул товару (шукається в назві або SKU позиції, як у get_funnel_by_product). Приклад: "21-225"' },
        date_from: { type:'string', description:'Дата початку YYYY-MM-DD (дата створення замовлення)' },
        date_to:   { type:'string', description:'Дата кінця YYYY-MM-DD' },
        cursor:    { type:'string', description:'Лише для продовження довгого періоду: next.cursor з попередньої відповіді, без змін. Перший виклик — без нього.' },
        max_pages: { type:'number', description:'Скільки сторінок по 50 замовлень гортати за виклик, 1–45 (за замовчуванням 45). Менше — якщо клієнт обриває довгий виклик.' }
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
    name: 'get_offer_stocks',
    description: 'Залишок і резерв на складі по списку SKU варіантів (офферів). Повертає {sku: {quantity, reserve, free}}, де free = quantity − reserve. Пачками по 50 SKU на запит, до 1500 SKU за виклик. SKU, яких немає в CRM, — у полі missing.',
    inputSchema: {
      type: 'object',
      properties: {
        skus: { type: 'array', items: { type: 'string' }, description: 'SKU офферів. Приклад: ["1144","1145"]' }
      },
      required: ['skus']
    }
  },
  {
    name: 'get_offer_reserve_holders',
    description: 'Які замовлення тримають резерв на SKU варіантів (офферів) — для SKU «у мінусі» з вечірнього прогону. По кожному SKU: залишок/резерв і список замовлень (статус, дата зміни статусу, кількість, stock_status рядка, ТТН, служба доставки), найраніше підтверджені першими. over_stock: true — рядок, на який штуки не вистачає (виліт найпізніше підтверджених). Рядки зі stock_status fulfilled (уже списані при відправці) не показуються. Сканує статуси до відправки; рахує на сервері, повних карток не віддає.',
    inputSchema: {
      type: 'object',
      properties: {
        skus: { type: 'array', items: { type: 'string' }, description: 'SKU офферів (до 200). Приклад: ["1983","887"]' },
        status_ids: { type: 'array', items: { type: 'number' }, description: 'Статуси, які сканувати (опціонально). За замовчуванням усі до відправки: [1,2,3,4,23,25,26,33,34,6]' }
      },
      required: ['skus']
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
        category_id: { type: 'number', description: 'ID категорії (опціонально). Seven=3, Lotran=6, Minova=2, KORA=1, MaxiFashion=7, Люда-Лёня=8, Бонаеми (тег BM)=9, Тимофеева (тег Timofeeva)=10' },
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
        return_status_id:  { description: 'ID статусу(ів) повернень. Число або масив. За замовчуванням 28 ("Повернення назад"). ВАЖЛИВО: відмова на пошті писалась трьома статусами за літо 2026 — 32 (черв–лип), 35 (лип–серп), 28 (серп→). Щоб побачити всі повернення за період, передавай [28, 32, 35], інакше частина не потрапить у вибірку. Ще релевантний: 29 = Не підійшов/немає розміру.' },
        date_from: { type: 'string', description: 'Дата початку YYYY-MM-DD (опціонально)' },
        date_to:   { type: 'string', description: 'Дата кінця YYYY-MM-DD (опціонально)' }
      }
    }
  },
  {
    name: 'get_period_summary',
    description: 'Товарний підсумок періоду для фінансового закриття: виручка за типами (товар / Преміум / пакування), одиниці по виробниках і кількість по кожному артикулу. Замінює ручну вигрузку CRM у шаблон «Подсчеты». Уся агрегація — ВСЕРЕДИНІ воркера, повертає компактний підсумок, а не сирі замовлення. ЯК КОРИСТУВАТИСЬ: передай ttns — масив ТТН із реєстру NovaPay за період; це дає ТОЧНЕ зіставлення «гроші ↔ товар», бо гривня належить місяцю свого реєстру, а не дати замовлення. Без ttns фільтрує за датою створення — це наближення, придатне для оцінки, але не для закриття місяця. Виробник береться лише з відомих тегів (KORA / Minova / Seven / MaxiFashion / Люда-Лёня / BM / Timofeeva / Lotran); сторонні теги на кшталт РОЗПРОДАЖ ігноруються.',
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
    case 'get_funnel_by_variant':  return getFunnelByVariant(apiKey, args);
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
    case 'get_offer_stocks':       return getOfferStocks(apiKey, args);
    case 'get_offer_reserve_holders': return getOfferReserveHolders(apiKey, args);
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

const MANUFACTURER_TAGS = ['KORA', 'Minova', 'Seven', 'MaxiFashion', 'Люда-Лёня', 'BM', 'Timofeeva', 'Lotran'];
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
        // Відмова на пошті писалась трьома статусами за літо 2026 —
        // це один і той самий результат, рахувати треба всі три.
        { id:28, name:'Повернення назад (відмова на пошті, серп→)' },
        { id:32, name:'Відмова на пошті (черв–лип)' },
        { id:35, name:'Відмова (лип–серп)' },
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
      returned:    'Повернення / Відмова на пошті (ID 28, 32, 35 — три статуси за різні місяці)',
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

// ─── [НОВЕ v8.4.9] Воронка і викуп по варіантах товару ───
//
// НАВІЩО: питання «які кольори й розміри краще замовляють і, головне, краще
// ЗАБИРАЮТЬ на пошті» не мало інструмента. get_funnel_by_product і get_product_pl
// ріжуть лише по кампаніях, а тягнути сирі замовлення в модель — ~2 700 токенів
// за кожен get_order. Тут рахуємо на сервері, назовні — зведення на кілька КБ.
//
// ЧОМУ ШТУКИ, А НЕ ЗАМОВЛЕННЯ: в одному замовленні бувають два кольори того самого
// пальто або дві штуки одного варіанта. Рахуємо позицію × quantity; статус штуки =
// статус її замовлення. Інші товари в замовленні й апсейли не рахуються.
//
// ЧОМУ КУРСОР: фільтра за товаром у GET /order немає (docs.keycrm.app, api.yaml
// v1.2.0, звірено 16.10.2026: лише status_id, source_id, source_uuid, buyer_phone,
// buyer_email, created/updated/shipping_between, payment_status, has_tracking_code),
// тож гортаємо ВСІ замовлення вікна по 50. Безкоштовний Cloudflare дає 50 підзапитів
// на виклик — get_funnel_by_product на 01.01–16.10.2026 падав «Too many subrequests».
// Тому один виклик гортає не більше VARIANT_PAGE_BUDGET сторінок, а якщо не встиг —
// віддає cursor: рядок із проміжними лічильниками і контрольною сумою. Наступний
// виклик із ним продовжує з тієї ж сторінки; повний підсумок — в останньому.
// Сортування за id (зростання): нові замовлення падають у кінець вікна і не
// зсувають уже прочитані сторінки.

// ⟪variant-funnel⟫ чисті функції без запитів — test/variant-funnel.mjs вирізає їх за цією міткою
const VARIANT_PAGE_BUDGET = 45;   // 50 підзапитів на виклик мінус запас
const VF_NOT_SET = '(не вказано)';
const VF_LOW_N = 20;              // менше відправлених — різниці між групами в межах шуму
const VF_NO_SIZE_STATUS = 29;     // «Не підійшов / Немає розміру» — варіанта не було в наявності
const VF_MAX_IDS = 10;
// Ключі розбивки замовлень — ті самі, що в get_funnel_by_product, щоб звіряти один в один.
const VF_ORDER_KEYS = ['total', 'new', 'in_progress', 'confirmed', 'production',
                       'delivery', 'completed', 'returned', 'cancelled', 'unknown'];
// Порядок лічильників штуки — і в пам'яті, і в cursor.
const VF_UNIT_KEYS = ['ordered', 'cancelled', 'no_size_29', 'pending',
                      'in_transit', 'completed', 'refused', 'unknown'];
const VF_SEP = '\u0001';          // колір + VF_SEP + розмір — ключ клітинки

function variantFunnelEmpty() {
  return {
    page: 1, last_id: 0, pages: 0, scanned: 0, calls: 0, dup_skipped: 0,
    orders: Object.fromEntries(VF_ORDER_KEYS.map(k => [k, 0])),
    unknown_statuses: {},
    multi_color: 0, multi_color_ids: [], multi_size: 0, no_units: 0,
    covered_to: null,
    cells: {},   // 'колір␁розмір' → лічильники в порядку VF_UNIT_KEYS
  };
}

// «КОРАЛОВИЙ» і «кораловий» — той самий колір; розміри — великими («xl» → «XL»).
function vfColor(v) {
  const s = String(v || '').trim().replace(/\s+/g, ' ').toLowerCase();
  return s ? s[0].toUpperCase() + s.slice(1) : VF_NOT_SET;
}
function vfSize(v) {
  const s = String(v || '').trim().replace(/\s+/g, ' ').toUpperCase();
  return s || VF_NOT_SET;
}

// Буває, що властивості лежать лише в offer.properties (див. test/reserve-holders.mjs).
function vfProps(p) {
  return (p.properties && p.properties.length) ? p : { properties: (p.offer && p.offer.properties) || [] };
}

function vfUnitBucket(cls) {
  switch (cls) {
    case 'completed': return 'completed';
    case 'return':    return 'refused';      // 28 + 32 + 35 — відмова на пошті
    case 'delivery':  return 'in_transit';   // 9, 20 — ще не закрились
    case 'cancelled': return 'cancelled';
    case 'unknown':   return 'unknown';
    default:          return 'pending';      // новий, погодження, прийнято, виробництво
  }
}

// Додає одну сторінку замовлень до лічильників acc. Замовлення має бути
// з include=products(.offer); товар шукається так само, як у get_funnel_by_product.
function accumulateVariantFunnel(acc, orders, query) {
  const q = String(query || '').trim().toLowerCase();
  const matches = p => (p.sku || '').toLowerCase().includes(q) || (p.name || '').toLowerCase().includes(q);

  // Курсор тримається на тому, що id ростуть. Якщо KeyCRM проігнорував sort=id —
  // краще впасти на першій сторінці, ніж тихо порахувати не те.
  for (let i = 1; i < orders.length; i++) {
    if (!(orders[i].id > orders[i - 1].id)) {
      throw new Error('KeyCRM віддав сторінку замовлень не за зростанням id — курсор був би ненадійний, нічого не пораховано.');
    }
  }

  for (const o of orders) {
    // Якщо між викликами у вікні з'явилось замовлення, частина вже прочитаних
    // переїжджає на наступну сторінку. Удруге їх не рахуємо.
    if (o.id <= acc.last_id) { acc.dup_skipped++; continue; }
    acc.last_id = o.id;
    acc.scanned++;
    if (o.created_at) acc.covered_to = String(o.created_at).slice(0, 10);

    const lines = (o.products || []).filter(matches);
    if (!lines.length) continue;

    const cls = classifyStatus(o.status_id);
    acc.orders.total++;
    acc.orders[cls === 'return' ? 'returned' : cls]++;
    if (cls === 'unknown') acc.unknown_statuses[o.status_id] = (acc.unknown_statuses[o.status_id] || 0) + 1;

    const at = VF_UNIT_KEYS.indexOf(vfUnitBucket(cls));
    const noSize = Number(o.status_id) === VF_NO_SIZE_STATUS;
    const colors = new Set(), sizes = new Set();
    let units = 0;
    for (const p of lines) {
      if (!isBaseProduct(p.name, p.sku)) continue;   // «Преміум …», «Пакування …»
      const src = vfProps(p);
      const color = vfColor(variantProp(src, /колір|цвет|color/i));
      const size  = vfSize(variantProp(src, /розмір|размер|size/i));
      const qty = Number(p.quantity) > 0 ? Number(p.quantity) : 1;
      const key = color + VF_SEP + size;
      const c = acc.cells[key] || (acc.cells[key] = VF_UNIT_KEYS.map(() => 0));
      c[0] += qty;
      c[at] += qty;
      if (noSize) c[2] += qty;
      units += qty;
      if (color !== VF_NOT_SET) colors.add(color);
      if (size !== VF_NOT_SET) sizes.add(size);
    }
    if (!units) acc.no_units++;
    // Частковий викуп (один колір забрали, другий повернули) CRM не бачить:
    // усе замовлення отримує один статус. Тому такі замовлення лічимо окремо.
    if (colors.size > 1) {
      acc.multi_color++;
      if (acc.multi_color_ids.length < VF_MAX_IDS) acc.multi_color_ids.push(o.id);
    }
    if (sizes.size > 1) acc.multi_size++;
  }
  return acc;
}

// 95% інтервал Вілсона для частки k з n. На малих n він чесніший за «±»:
// не вилазить за 0–100% і не стягується в точку при 0 або n успіхів.
function vfWilson(k, n) {
  const z = 1.96, z2 = z * z, p = k / n, den = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / den;
  const half = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / den;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

function vfAdd(into, c) {
  const out = into || VF_UNIT_KEYS.map(() => 0);
  for (let i = 0; i < out.length; i++) out[i] += c[i] || 0;
  return out;
}

function vfRate(c) {
  const sent = c[5] + c[6];
  return sent ? c[5] / sent : -1;   // -1: нічого не відправлено — в кінець списку
}

function vfRow(c) {
  const [ordered, cancelled, no_size_29, pending, in_transit, completed, refused, unknown] = c;
  const sent = completed + refused;
  const row = { ordered, cancelled, no_size_29, pending, in_transit, completed, refused, sent,
                buyout_rate: null, ci95: null, low_n: sent < VF_LOW_N };
  if (sent) {
    const [lo, hi] = vfWilson(completed, sent);
    row.buyout_rate = Math.round(completed / sent * 100) + '%';
    row.ci95 = `${Math.round(lo * 100)}–${Math.round(hi * 100)}%`;
  }
  if (unknown) row.unknown = unknown;
  return row;
}

// Клітинка колір×розмір — одним рядком, щоб 24+ клітинки не роздували відповідь.
function vfCell(c) {
  const r = vfRow(c);
  const parts = [`зам ${r.ordered}`];
  if (r.cancelled)  parts.push(`скас ${r.cancelled}` + (r.no_size_29 ? ` (29: ${r.no_size_29})` : ''));
  if (r.pending)    parts.push(`чекає ${r.pending}`);
  if (r.in_transit) parts.push(`дорога ${r.in_transit}`);
  if (r.unknown)    parts.push(`невідомий статус ${r.unknown}`);
  parts.push(r.sent
    ? `викуп ${r.completed}/${r.sent} = ${r.buyout_rate} [${r.ci95}]${r.low_n ? ' мало' : ''}`
    : 'не відправлялось');
  return parts.join(' · ');
}

// Розміри — природним порядком (44-46, 48-50, …): так видно, де саме «не сідає».
function vfSizeOrder(a, b) {
  if (a === VF_NOT_SET || b === VF_NOT_SET) return (a === VF_NOT_SET) - (b === VF_NOT_SET);
  const na = parseFloat(a), nb = parseFloat(b);
  if (isNaN(na) !== isNaN(nb)) return isNaN(na) ? 1 : -1;
  if (!isNaN(na) && na !== nb) return na - nb;
  return a.localeCompare(b, 'uk');
}

// Кольори — за викупом, потім за кількістю відправлених; «(не вказано)» — останнім.
function vfColorOrder(a, b) {
  return (a.name === VF_NOT_SET) - (b.name === VF_NOT_SET)
    || vfRate(b.c) - vfRate(a.c)
    || (b.c[5] + b.c[6]) - (a.c[5] + a.c[6])
    || b.c[0] - a.c[0]
    || a.name.localeCompare(b.name, 'uk');
}

function summarizeVariantFunnel(acc) {
  const byColor = {}, bySize = {};
  let total = VF_UNIT_KEYS.map(() => 0);
  for (const [key, c] of Object.entries(acc.cells)) {
    const [color, size] = key.split(VF_SEP);
    byColor[color] = vfAdd(byColor[color], c);
    bySize[size] = vfAdd(bySize[size], c);
    total = vfAdd(total, c);
  }
  const colors = Object.entries(byColor).map(([name, c]) => ({ name, c })).sort(vfColorOrder);
  const sizes = Object.keys(bySize).sort(vfSizeOrder);
  const byColorSize = {};
  for (const { name } of colors) {
    byColorSize[name] = {};
    for (const size of sizes) {
      const c = acc.cells[name + VF_SEP + size];
      if (c) byColorSize[name][size] = vfCell(c);
    }
  }
  return {
    total: vfRow(total),
    by_color: colors.map(({ name, c }) => ({ color: name, ...vfRow(c) })),
    by_size: sizes.map(size => ({ size, ...vfRow(bySize[size]) })),
    by_color_size: byColorSize,
  };
}

// ── cursor: проміжні лічильники одним рядком ──
// Формат читабельний (кольори кирилицею, без base64), щоб модель переносила його
// між викликами без «екранування». Контрольна сума рахується разом із sku і датами:
// пошкоджений рядок або cursor від іншого запиту — помилка, а не тихо криві числа.
function vfHash(s) {   // FNV-1a, 32 біти
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
const vfEsc = s => String(s).replace(/[%;,~:=]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase());

function encodeVariantCursor(acc, sku, from, to) {
  const cells = Object.entries(acc.cells).map(([key, c]) => {
    const [color, size] = key.split(VF_SEP);
    return `${vfEsc(color)}~${vfEsc(size)}:${c.join('.')}`;
  });
  const body = [
    'v1',
    `p=${acc.page}`, `l=${acc.last_id}`, `g=${acc.pages}`, `s=${acc.scanned}`,
    `k=${acc.calls}`, `d=${acc.dup_skipped}`,
    `o=${VF_ORDER_KEYS.map(k => acc.orders[k]).join('.')}`,
    `x=${Object.entries(acc.unknown_statuses).map(([id, n]) => `${id}:${n}`).join(',')}`,
    `m=${acc.multi_color}`, `mi=${acc.multi_color_ids.join('.')}`,
    `ms=${acc.multi_size}`, `nu=${acc.no_units}`, `cv=${acc.covered_to || ''}`,
    `c=${cells.join(',')}`,
  ].join(';');
  return `${body};h=${vfHash(`${sku}|${from}|${to}|${body}`)}`;
}

function decodeVariantCursor(cursor, sku, from, to) {
  const s = String(cursor || '').trim();
  const at = s.lastIndexOf(';h=');
  const fail = why => { throw new Error(`cursor не підходить: ${why}. Почни спочатку без cursor.`); };
  if (!s.startsWith('v1;') || at < 0) fail('невідомий формат');
  const body = s.slice(0, at);
  if (vfHash(`${sku}|${from}|${to}|${body}`) !== s.slice(at + 3)) {
    fail('рядок пошкоджено або він від інших sku/date_from/date_to');
  }
  const f = {};
  for (const part of body.split(';').slice(1)) {
    const i = part.indexOf('=');
    f[part.slice(0, i)] = part.slice(i + 1);
  }
  const int = v => parseInt(v, 10) || 0;
  const acc = variantFunnelEmpty();
  acc.page = int(f.p) || 1;
  acc.last_id = int(f.l); acc.pages = int(f.g); acc.scanned = int(f.s);
  acc.calls = int(f.k); acc.dup_skipped = int(f.d);
  const ov = (f.o || '').split('.');
  VF_ORDER_KEYS.forEach((k, i) => { acc.orders[k] = int(ov[i]); });
  for (const pair of (f.x ? f.x.split(',') : [])) {
    const [id, n] = pair.split(':');
    acc.unknown_statuses[id] = int(n);
  }
  acc.multi_color = int(f.m);
  acc.multi_color_ids = f.mi ? f.mi.split('.').map(int) : [];
  acc.multi_size = int(f.ms); acc.no_units = int(f.nu);
  acc.covered_to = f.cv || null;
  for (const cell of (f.c ? f.c.split(',') : [])) {
    const i = cell.lastIndexOf(':');
    const [color, size] = cell.slice(0, i).split('~').map(decodeURIComponent);
    acc.cells[color + VF_SEP + size] = cell.slice(i + 1).split('.').map(int);
  }
  return acc;
}
// ⟪/variant-funnel⟫

async function getFunnelByVariant(apiKey, args = {}) {
  const sku = String(args.sku || '').trim();
  const { date_from, date_to, cursor } = args;
  const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
  if (!sku) throw new Error('Передай sku — артикул товару, напр. "21-225"');
  if (!isDate(date_from) || !isDate(date_to)) throw new Error('date_from і date_to — у форматі YYYY-MM-DD');
  const budget = Math.min(Math.max(parseInt(args.max_pages, 10) || VARIANT_PAGE_BUDGET, 1), VARIANT_PAGE_BUDGET);

  const acc = cursor ? decodeVariantCursor(cursor, sku, date_from, date_to) : variantFunnelEmpty();
  acc.calls++;
  const params = {
    'filter[created_between]': `${date_from} 00:00:00, ${date_to} 23:59:59`,
    include: 'products.offer', sort: 'id', limit: 50,
  };

  // Послідовно, не Promise.all: ліміт KeyCRM спільний із лендінгами.
  const started = Date.now();
  let used = 0, done = false, lastPage = null, stopped = null;
  while (used < budget) {
    let data;
    try {
      data = await keycrmGet(apiKey, '/order', { ...params, page: acc.page });
    } catch (e) {
      // У цьому виклику ще нічого не прочитано — віддаємо помилку як є:
      // cursor, з яким прийшли, лишається дійсним.
      if (used === 0) throw new Error(e.message + (cursor ? ' (cursor лишається дійсним — повтори виклик із ним)' : ''));
      stopped = e.message;   // напр. 429 від KeyCRM: прочитане не губимо, віддаємо cursor
      break;
    }
    used++;
    const batch = data.data || [];
    accumulateVariantFunnel(acc, batch, sku);
    acc.pages++;
    lastPage = data.last_page || 1;
    if (batch.length === 0 || acc.page >= lastPage) { done = true; break; }
    acc.page++;
  }

  const { total: _t, ...byClass } = acc.orders;
  const head = {
    sku,
    date_range: { from: date_from, to: date_to },
    complete: done,
    scan: { calls: acc.calls, pages: acc.pages, orders_scanned: acc.scanned,
            this_call: { pages: used, seconds: Math.round((Date.now() - started) / 1000) } },
    orders_total: acc.orders.total,
    orders_by_class: byClass,
  };

  if (!done) {
    const pagesLeft = Math.max(lastPage - acc.page + 1, 0);
    return {
      ...head,
      covered_to: acc.covered_to,
      total_so_far: summarizeVariantFunnel(acc).total,
      ...(stopped ? { stopped_reason: stopped } : {}),
      next: {
        cursor: encodeVariantCursor(acc, sku, date_from, date_to),
        pages_left: pagesLeft,
        calls_left_estimate: Math.ceil(pagesLeft / VARIANT_PAGE_BUDGET),
        how: 'Виклич get_funnel_by_variant ще раз з тими самими sku, date_from, date_to і cursor = next.cursor (рядок без змін). ' +
             'Розріз по кольорах і розмірах прийде в останньому виклику (complete: true). covered_to — до якої дати створення вже пораховано.',
      },
    };
  }

  const s = summarizeVariantFunnel(acc);
  return {
    ...head,
    unknown_statuses: acc.unknown_statuses,
    multi_variant_orders: acc.multi_color,
    ...(acc.multi_color_ids.length ? { multi_variant_order_ids: acc.multi_color_ids } : {}),
    multi_size_orders: acc.multi_size,
    ...(acc.no_units ? { orders_without_units: acc.no_units } : {}),
    ...(acc.dup_skipped ? { dup_skipped: acc.dup_skipped } : {}),
    total: s.total,
    by_color: s.by_color,
    by_size: s.by_size,
    by_color_size: s.by_color_size,
    note: 'Одиниця — штука (позиція × кількість), лише позиції цього товару без апсейлів; статус штуки = статус замовлення. ' +
          'buyout_rate = completed ÷ (completed + refused) — забір на пошті; refused = відмови на пошті 28+32+35; ' +
          'in_transit (9, 20) ще не закрились і у викуп не входять. Свіжий період завищує викуп: викуп стається за 1–2 дні, ' +
          'відмова — лише після терміну зберігання. ci95 — інтервал Вілсона; low_n: sent < 20 — різниці в межах інтервалів не значущі. ' +
          'no_size_29 — скасовано зі статусом 29 «Не підійшов / Немає розміру». pending — ще до відправки (новий, погодження, прийнято, виробництво). ' +
          'multi_variant_orders — замовлення з 2+ кольорами (multi_size_orders — з 2+ розмірами): частковий викуп CRM не бачить, усі штуки отримують статус замовлення. ' +
          'orders_by_class — у ключах get_funnel_by_product, для звірки. ' +
          'by_color_size: «зам · скас (29: …) · чекає · дорога · викуп виконано/відправлено = % [ci95] мало».',
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

// Відмова на пошті писалась трьома різними статусами за літо 2026:
// 32 «Відмова на пошті» (черв–лип) → 35 «Відмова» (лип–серп) → 28 «Повернення
// назад» (серп). Рахувати тільки 32 означає не бачити частину відмов: за липень
// 201 з 356, за серпень — жодної з 180, тобто викуп читався б як 100%.
// Тримати цей список синхронним зі STATUS.RETURN — test/status-tables.mjs перевіряє.
const STATUS_REFUSED  = [32, 35, 28];
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

// filter[status_id] в KeyCRM приймає рівно один статус, тому по кожному статусу
// відмови йде свій запит, а результати склеюються. Послідовно, а не Promise.all:
// три паралельні пагінації разом із вибіркою викуплених швидше впираються
// в ліміт підзапитів Cloudflare.
async function getOrdersForStatuses(apiKey, params, statuses, withProducts) {
  const fetchOne = withProducts ? getAllOrdersWithProducts : getAllOrders;
  const out = [];
  for (const id of statuses) {
    out.push(...await fetchOne(apiKey, { ...params, 'filter[status_id]': id }));
  }
  return out;
}

async function getBuyoutByUpsell(apiKey, args) {
  const { date_from, date_to, min_orders = 20 } = args;
  const base = { 'filter[created_between]': `${date_from} 00:00:00, ${date_to} 23:59:59` };

  const [bought, refused] = await Promise.all([
    getAllOrdersWithProducts(apiKey, { ...base, 'filter[status_id]': STATUS_BOUGHT }),
    getOrdersForStatuses(apiKey, base, STATUS_REFUSED, true),
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
    getOrdersForStatuses(apiKey, { ...base, include: 'status' }, STATUS_REFUSED, false),
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

async function getOfferStocks(apiKey, args) {
  const skus = [...new Set((args.skus || []).map(s => String(s).trim()).filter(Boolean))];
  if (!skus.length) throw new Error('Передай skus — непорожній список SKU');
  // 30 пачок = 30 підзапитів; безкоштовний Cloudflare дає 50 на виклик
  if (skus.length > 1500) throw new Error(`Забагато SKU (${skus.length}), максимум 1500 за виклик`);

  const stocks = {};
  for (let i = 0; i < skus.length; i += 50) {
    const chunk = skus.slice(i, i + 50);
    const data = await keycrmGet(apiKey, '/offers/stocks', {
      limit: 50, 'filter[offers_sku]': chunk.join(',')
    });
    for (const r of (data.data || [])) {
      const quantity = Number(r.quantity) || 0;
      const reserve  = Number(r.reserve)  || 0;
      stocks[String(r.sku)] = { quantity, reserve, free: quantity - reserve };
    }
  }
  return { count: Object.keys(stocks).length, stocks,
           missing: skus.filter(s => !(s in stocks)) };
}

// ─── [НОВЕ v8.4.8] Хто тримає резерв на SKU ───
//
// НАВІЩО: вечірній прогін (stock_check.py у бізнес-репо) показує SKU, де резерв
// більший за залишок, але не каже, ЯКІ замовлення його тримають. Список замовлень
// KeyCRM віддає товар назвою, без SKU варіанта, тож лишалось смикати get_order на
// кожне — ~2 700 токенів за картку. Тут зіставлення робиться всередині воркера.
//
// ЩО ПЕРЕВІРЕНО (14.10.2026, замовлення 15306): при переході в «Доставляється» (9)
// рядки стають stock_status 'fulfilled' — штуку списано, резерву вже немає. Тому
// за замовчуванням скануються лише статуси ДО відправки, а 'fulfilled' пропускається.
// SKU з від'ємним залишком і нульовим резервом (459, 1405 того вечора) — це вже
// списані штуки: тримачів резерву в нього не буде, і це правильна відповідь.

const RESERVE_SCAN_STATUSES = [1, 2, 3, 4, 23, 25, 26, 33, 34, 6];
// Безкоштовний Cloudflare дає 50 підзапитів на виклик — лишаємо запас.
const RESERVE_SCAN_BUDGET = 45;

// ⟪reserve-holders⟫ чиста функція без запитів — test/reserve-holders.mjs вирізає її за цією міткою
function findReserveHolders(orders, skus, stocks, statusNames = {}) {
  const prop = (p, re) => {
    const list = (p.properties && p.properties.length) ? p.properties : (p.offer?.properties || []);
    const hit = list.find(pr => re.test(pr.name || ''));
    return hit ? hit.value : '';
  };
  const bySku = {};
  for (const sku of skus) bySku[sku] = [];

  for (const o of orders) {
    for (const p of (o.products || [])) {
      const sku = String(p.offer?.sku || p.sku || '');
      if (!(sku in bySku) || p.stock_status === 'fulfilled') continue;
      bySku[sku].push({
        order_id: o.id,
        status_id: o.status_id,
        status_name: statusNames[o.status_id] || String(o.status_id),
        created_at: o.created_at,
        status_changed_at: o.status_changed_at || null,
        qty: Number(p.quantity) || 1,
        stock_status: p.stock_status || null,
        name: p.name,
        color: prop(p, /колір|цвет|color/i),
        size: prop(p, /розмір|размер|size/i),
        ttn: o.shipping?.tracking_code || null,
        delivery_service_id: o.shipping?.delivery_service_id ?? null,
      });
    }
  }

  const out = {};
  for (const sku of skus) {
    const st = stocks[sku] || { quantity: 0, reserve: 0, free: 0 };
    // Штука дістається тому, хто раніше підтверджений — те саме правило, що в stock_check.py.
    const holders = bySku[sku].sort((a, b) =>
      String(a.status_changed_at || '').localeCompare(String(b.status_changed_at || '')));
    let left = Math.max(st.quantity, 0);
    for (const h of holders) {
      h.over_stock = left < h.qty;
      left = Math.max(left - h.qty, 0);
    }
    const reservedFound = holders.filter(h => h.stock_status === 'reserved')
                                 .reduce((s, h) => s + h.qty, 0);
    out[sku] = {
      ...st,
      reserved_found: reservedFound,
      ...(reservedFound !== st.reserve
          ? { reserve_mismatch: `у CRM резерв ${st.reserve}, у просканованих статусах знайдено ${reservedFound}` }
          : {}),
      over_stock_order_ids: holders.filter(h => h.over_stock).map(h => h.order_id),
      holders,
    };
  }
  return out;
}
// ⟪/reserve-holders⟫

async function getOfferReserveHolders(apiKey, args = {}) {
  const skus = [...new Set((args.skus || []).map(s => String(s).trim()).filter(Boolean))];
  if (!skus.length) throw new Error('Передай skus — непорожній список SKU');
  if (skus.length > 200) throw new Error(`Забагато SKU (${skus.length}), максимум 200 за виклик`);
  const statusIds = (Array.isArray(args.status_ids) && args.status_ids.length
    ? args.status_ids : RESERVE_SCAN_STATUSES).map(Number);

  const { stocks, missing } = await getOfferStocks(apiKey, { skus });
  let used = Math.ceil(skus.length / 50);

  // Послідовно, не Promise.all: ліміт KeyCRM спільний із лендінгами.
  const orders = [];
  const scanned = {};
  const incomplete = [];
  for (const id of statusIds) {
    scanned[id] = 0;
    for (let page = 1; ; page++) {
      if (used >= RESERVE_SCAN_BUDGET) { incomplete.push(id); break; }
      const data = await keycrmGet(apiKey, '/order', {
        'filter[status_id]': id, include: 'products.offer,shipping', limit: 50, page
      });
      used++;
      const batch = data.data || [];
      orders.push(...batch);
      scanned[id] += batch.length;
      if (batch.length < 50 || page >= (data.last_page || 1)) break;
    }
  }

  const statusNames = {};
  for (const list of Object.values(getOrderStatuses().groups)) {
    for (const s of list) statusNames[s.id] = s.name;
  }

  return {
    statuses_scanned: scanned,
    orders_scanned: orders.length,
    ...(incomplete.length ? { incomplete_statuses: incomplete,
        warning: 'Вичерпано ліміт підзапитів Cloudflare — ці статуси проскановано не повністю. Передай менше status_ids.' } : {}),
    ...(missing.length ? { missing_skus: missing } : {}),
    skus: findReserveHolders(orders, skus, stocks, statusNames),
    note: 'holders — замовлення з рядком на цей SKU, найраніше підтверджені першими. over_stock: true — на цей рядок штуки не вистачає (залишок уже покрив раніших). Рядки fulfilled (списані при відправці) не показуються. reserve_mismatch — частину резерву тримають замовлення в статусах, яких не скановано.'
  };
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
      const CATEGORY_TAG = { 1: 'KORA', 2: 'Minova', 3: 'Seven', 6: 'Lotran', 7: 'MaxiFashion', 8: 'Люда-Лёня', 9: 'BM', 10: 'Timofeeva' };
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
