// Перевірка get_funnel_by_variant. Запуск: node test/variant-funnel.mjs
//
// Як у reserve-holders.mjs: код вирізається з воркера, без запитів до KeyCRM.
// Беруться таблиці статусів, variantProp, isBaseProduct, блок ⟪variant-funnel⟫
// і сама getFunnelByVariant — замість keycrmGet їй підставляється фейк, який
// віддає штучні замовлення сторінками по 4. Так перевіряється не лише підрахунок,
// а й гортання з бюджетом сторінок, cursor між викликами і обрив на 429.

import { readFileSync } from 'node:fs';

const src = readFileSync('src/keycrm-worker-v8.js', 'utf8');
const between = (a, b) => {
  const from = src.indexOf(a), to = src.indexOf(b, from);
  if (from < 0 || to < 0) {
    console.error(`✗ У воркері не знайдено «${a}» … «${b}» — тест не може працювати.`);
    process.exit(1);
  }
  return src.slice(from, to);
};
// Функція верхнього рівня — від заголовка до першої «}» на початку рядка.
const fn = head => between(head, '\n}\n') + '\n}\n';

const code = [
  between('const STATUS = {', '// ─── MCP Protocol'),
  fn('function variantProp('),
  fn('function isBaseProduct('),
  between('// ⟪variant-funnel⟫', '// ⟪/variant-funnel⟫'),
  fn('async function getFunnelByVariant('),
].join('\n');

let fakeGet = null;
const W = new Function('keycrmGet', code + `; return {
  variantFunnelEmpty, accumulateVariantFunnel, summarizeVariantFunnel,
  encodeVariantCursor, decodeVariantCursor, vfWilson, getFunnelByVariant };`)(
  (...a) => fakeGet(...a));

const errors = [];
const eq = (got, exp, what) => {
  if (JSON.stringify(got) !== JSON.stringify(exp)) errors.push(`${what}: очікували ${JSON.stringify(exp)}, отримали ${JSON.stringify(got)}`);
};
const throws = (f, re, what) => {
  try { f(); errors.push(`${what}: мало впасти, не впало`); }
  catch (e) { if (!re.test(e.message)) errors.push(`${what}: інша помилка — ${e.message}`); }
};

// ── Штучні замовлення у формі GET /order з include=products.offer ──
const coat = (color, size, quantity = 1, names = ['Колір', 'Розмір']) => ({
  sku: '170', name: 'Пальто 21-225', quantity,
  properties: [{ name: names[0], value: color }, { name: names[1], value: size }],
  offer: { sku: '170', properties: [] },
});
const other = { sku: '900', name: 'Сукня 17-276', quantity: 1,
                properties: [{ name: 'Колір', value: 'Чорний' }, { name: 'Розмір', value: '48' }] };
const premium = name => ({ sku: null, name, quantity: 1, properties: [] });
const order = (id, status_id, products, day = 1) => ({
  id, status_id, created_at: `2025-11-${String(day).padStart(2, '0')} 10:00:00`, products,
});

const ORDERS = [
  order(101, 12, [coat('Чорний', '56-58'), premium('Преміум'), premium('Преміум 21-225')]),  // апсейли не рахуються
  order(102, 28, [coat('Чорний', '48-50', 2)]),                     // quantity > 1
  order(103, 32, [coat('Бежевий', '48-50'), other]),               // інший товар у замовленні не рахується
  order(104, 35, [coat('Чорний', '52-54'), coat('Бежевий', '52-54')], 2),   // два кольори
  order(105, 9,  [coat('Бежевий', '56-58')], 3),
  order(106, 20, [coat('Чорний', '56-58')], 3),
  order(107, 29, [coat('Сірий', '44-46')], 4),                     // немає розміру
  order(108, 19, [coat('Сірий', '44-46')], 4),
  order(109, 26, [coat('Сірий', '48-50')], 5),
  order(110, 6,  [{ sku: '170', name: 'Пальто 21-225', quantity: 1, properties: [] }], 5),   // без кольору й розміру
  order(111, 1,  [{ sku: '170', name: 'Пальто 21-225', quantity: 1, properties: [],
                    offer: { sku: '170', properties: [{ name: 'Колір', value: 'КОРАЛОВИЙ ' },
                                                      { name: 'Розмір', value: '52-54' }] } }], 6),
  order(112, 99, [coat('Чорний', '48-50')], 6),                     // статус поза таблицею
  order(113, 12, [other], 7),                                       // товару немає — не рахується
  order(114, 13, [premium('Пакування 21-225')], 7),                 // замовлення є, штук немає
  order(115, 12, [coat('Бежевий', '56-58', 3, ['Цвет', 'Размер'])], 8),
  order(116, 12, [coat('Чорний', '48-50'), coat('Чорний', '52-54')], 9),   // два розміри
];

// ── 1. Підрахунок за один прохід ──
const acc = W.accumulateVariantFunnel(W.variantFunnelEmpty(), ORDERS, '21-225');
const s = W.summarizeVariantFunnel(acc);

eq(acc.orders, { total: 15, new: 1, in_progress: 0, confirmed: 1, production: 1, delivery: 2,
                 completed: 3, returned: 3, cancelled: 3, unknown: 1 },
   'розбивка замовлень (ключі get_funnel_by_product)');
eq(acc.scanned, 16, 'проскановано всі 16 замовлень');
eq(acc.unknown_statuses, { 99: 1 }, 'невідомий статус не губиться');
eq([acc.multi_color, acc.multi_color_ids, acc.multi_size], [1, [104], 1], 'замовлення з 2+ кольорами / розмірами');
eq(acc.no_units, 1, 'замовлення лише з «Пакування 21-225» — без штук');
eq(acc.covered_to, '2025-11-09', 'covered_to — дата останнього прочитаного');

eq(s.total, { ordered: 19, cancelled: 2, no_size_29: 1, pending: 3, in_transit: 2, completed: 6,
              refused: 5, sent: 11, buyout_rate: '55%', ci95: '28–79%', low_n: true, unknown: 1 },
   'підсумок у штуках');
eq(s.by_color.map(r => r.color), ['Бежевий', 'Чорний', 'Сірий', 'Кораловий', '(не вказано)'],
   'кольори: за викупом, без відправлених — у кінці, «(не вказано)» — останнім');
eq(s.by_color[0], { color: 'Бежевий', ordered: 6, cancelled: 0, no_size_29: 0, pending: 0, in_transit: 1,
                    completed: 3, refused: 2, sent: 5, buyout_rate: '60%', ci95: '23–88%', low_n: true },
   'Бежевий: «Цвет/Размер» теж читаються, quantity 3');
eq(s.by_color[1].completed + s.by_color[1].refused + s.by_color[1].in_transit + (s.by_color[1].unknown || 0),
   8, 'Чорний: 8 штук');
eq([s.by_color[2].sent, s.by_color[2].buyout_rate, s.by_color[2].ci95], [0, null, null],
   'нічого не відправлено — викупу немає, а не 0%');
eq(s.by_size.map(r => r.size), ['44-46', '48-50', '52-54', '56-58', '(не вказано)'], 'розміри по порядку');
eq(s.by_size.map(r => r.ordered), [2, 6, 4, 6, 1], 'штук по розмірах');
eq(s.by_size[3].buyout_rate, '100%', '56-58: 4 з 4');
eq(s.by_color_size['Чорний']['48-50'], 'зам 4 · невідомий статус 1 · викуп 1/3 = 33% [6–79%] мало', 'клітинка рядком');
eq(s.by_color_size['Сірий']['44-46'], 'зам 2 · скас 2 (29: 1) · не відправлялось', 'клітинка без відправлених');
eq(Object.keys(s.by_color_size['Чорний']), ['48-50', '52-54', '56-58'], 'у клітинках лише наявні розміри, по порядку');
eq(s.by_color_size['(не вказано)'], { '(не вказано)': 'зам 1 · чекає 1 · не відправлялось' }, 'позиція без властивостей');

// ── 2. Інтервал Вілсона: відомі межі для 0 з 10 і 10 з 10 (27.75%) ──
eq(W.vfWilson(0, 10).map(x => +x.toFixed(4)), [0, 0.2775], 'Вілсон 0/10');
eq(W.vfWilson(10, 10).map(x => +x.toFixed(4)), [0.7225, 1], 'Вілсон 10/10');

// ── 3. cursor: по сторінці за раз = те саме, що за один прохід ──
let a = W.variantFunnelEmpty();
for (let i = 0; i < ORDERS.length; i += 4) {
  a = W.accumulateVariantFunnel(a, ORDERS.slice(i, i + 4), '21-225');
  const c = W.encodeVariantCursor(a, '21-225', '2025-11-01', '2025-11-20');
  a = W.decodeVariantCursor(c, '21-225', '2025-11-01', '2025-11-20');
}
eq(W.summarizeVariantFunnel(a), s, 'через cursor — той самий розріз');
eq([a.orders, a.multi_color_ids, a.unknown_statuses, a.covered_to],
   [acc.orders, acc.multi_color_ids, acc.unknown_statuses, acc.covered_to], 'через cursor — ті самі службові поля');

const cur = W.encodeVariantCursor(acc, '21-225', '2025-11-01', '2025-11-20');
throws(() => W.decodeVariantCursor(cur.replace('o=15', 'o=16'), '21-225', '2025-11-01', '2025-11-20'),
       /пошкоджено/, 'змінена цифра в cursor');
throws(() => W.decodeVariantCursor(cur, '21-226', '2025-11-01', '2025-11-20'), /пошкоджено/, 'cursor від іншого sku');
throws(() => W.decodeVariantCursor('abc', '21-225', '2025-11-01', '2025-11-20'), /формат/, 'не cursor');

// Назви з роздільниками cursor мають пережити кодування.
const odd = W.accumulateVariantFunnel(W.variantFunnelEmpty(),
  [order(1, 12, [coat('Синій; т.~темний: 50%', 'XL=2,')])], '21-225');
const odd2 = W.decodeVariantCursor(W.encodeVariantCursor(odd, '21-225', 'a', 'b'), '21-225', 'a', 'b');
eq(Object.keys(odd2.cells), Object.keys(odd.cells), 'спецсимволи в назвах кольору й розміру');

// ── 4. Зсув сторінок і неправильне сортування ──
const dup = W.accumulateVariantFunnel(W.accumulateVariantFunnel(W.variantFunnelEmpty(), ORDERS.slice(0, 4), '21-225'),
                                      ORDERS.slice(3), '21-225');
eq([dup.dup_skipped, W.summarizeVariantFunnel(dup)], [1, s], 'замовлення, що переїхало на наступну сторінку, не рахується вдруге');
throws(() => W.accumulateVariantFunnel(W.variantFunnelEmpty(), [ORDERS[1], ORDERS[0]], '21-225'),
       /не за зростанням id/, 'сторінка не за зростанням id');

// ── 5. getFunnelByVariant з фейковим KeyCRM: бюджет сторінок, cursor, 429 ──
const PAGE = 4;
let calls = [], failOnce = null;
fakeGet = async (_key, path, params) => {
  calls.push(params.page);
  if (path !== '/order' || params.sort !== 'id' || params.include !== 'products.offer'
      || !params['filter[created_between]']) throw new Error('KeyCRM API GET 400: неочікувані параметри');
  if (failOnce === params.page) { failOnce = null; throw new Error('KeyCRM API GET 429: Too Many Attempts.'); }
  const last = Math.ceil(ORDERS.length / PAGE);
  return { data: ORDERS.slice((params.page - 1) * PAGE, params.page * PAGE), last_page: last, current_page: params.page };
};
const args = { sku: '21-225', date_from: '2025-11-01', date_to: '2025-11-20' };

const full = await W.getFunnelByVariant('k', args);
eq([full.complete, full.orders_total, full.scan.pages, calls], [true, 15, 4, [1, 2, 3, 4]], 'один виклик гортає всі сторінки');
eq([full.total, full.by_color, full.by_size, full.by_color_size], [s.total, s.by_color, s.by_size, s.by_color_size],
   'відповідь інструмента = чиста агрегація');
eq([full.multi_variant_orders, full.multi_variant_order_ids, full.multi_size_orders, full.unknown_statuses, full.orders_without_units],
   [1, [104], 1, { 99: 1 }, 1], 'службові поля у відповіді');

calls = [];
let r = await W.getFunnelByVariant('k', { ...args, max_pages: 1 });
const steps = [r.complete];
eq([r.next.pages_left, r.covered_to, r.total_so_far.ordered], [3, '2025-11-02', 6], 'частковий результат після 1 сторінки');
failOnce = 3;   // 429 на першому ж запиті виклику — помилка; повторюємо з тим самим cursor
while (!r.complete) {
  try { r = await W.getFunnelByVariant('k', { ...args, max_pages: 1, cursor: r.next.cursor }); }
  catch (e) { if (/дійсним/.test(e.message)) { steps.push('429'); continue; } throw e; }
  steps.push(r.complete);
}
eq(calls, [1, 2, 3, 3, 4], 'по сторінці за виклик; сторінку з 429 повторено');
eq(steps, [false, false, '429', false, true], 'чотири вдалі виклики й один повтор після 429');
eq([r.total, r.by_color, r.by_size, r.by_color_size, r.orders_by_class],
   [full.total, full.by_color, full.by_size, full.by_color_size, full.orders_by_class], 'частинами — той самий підсумок');
eq(r.scan.calls, 4, 'лічильник викликів переживає cursor');

// 429 посеред виклику: прочитане не губиться, cursor веде на ту саму сторінку.
calls = []; failOnce = 2;
const part = await W.getFunnelByVariant('k', { ...args, max_pages: 3 });
eq([part.complete, /429/.test(part.stopped_reason || ''), part.next.pages_left, calls], [false, true, 3, [1, 2]],
   '429 після першої сторінки — частковий результат, не помилка');
const rest = await W.getFunnelByVariant('k', { ...args, cursor: part.next.cursor });
eq([rest.complete, rest.total], [true, full.total], 'продовження після 429 дає повний підсумок');

// 429 на першому ж запиті — помилка, але з підказкою, що cursor дійсний.
failOnce = 2;
try { await W.getFunnelByVariant('k', { ...args, cursor: part.next.cursor }); errors.push('429 на першому запиті: мало впасти'); }
catch (e) { if (!/дійсним/.test(e.message)) errors.push(`429 на першому запиті: ${e.message}`); }

await W.getFunnelByVariant('k', { ...args, date_from: '01.11.2025' })
  .then(() => errors.push('дата не в форматі YYYY-MM-DD: мало впасти'), () => {});

const size = JSON.stringify(full, null, 2).length;
if (size > 8000) errors.push(`відповідь роздулась: ${size} символів`);

if (errors.length) {
  console.error('✗ get_funnel_by_variant:\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log(`✓ get_funnel_by_variant: штуки, групи, Вілсон, cursor, зсув сторінок і 429 — ок (відповідь ${size} символів)`);
