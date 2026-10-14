// Перевірка findReserveHolders (get_offer_reserve_holders). Запуск: node test/reserve-holders.mjs
//
// Чиста функція вирізається з воркера за мітками ⟪reserve-holders⟫, як у status-tables.mjs:
// без запитів до KeyCRM, на штучних замовленнях у формі, яку віддає GET /order
// з include=products.offer,shipping (звірено з карткою 15306, 14.10.2026).

import { readFileSync } from 'node:fs';

const src = readFileSync('src/keycrm-worker-v8.js', 'utf8');
const from = src.indexOf('// ⟪reserve-holders⟫');
const to = src.indexOf('// ⟪/reserve-holders⟫');
if (from < 0 || to < 0) {
  console.error('✗ У воркері не знайдено міток ⟪reserve-holders⟫ — тест не може працювати.');
  process.exit(1);
}
const findReserveHolders = new Function(src.slice(from, to) + '; return findReserveHolders;')();

const line = (sku, stock_status, extra = {}) => ({
  sku, name: 'Сукня 17-276', quantity: 1, stock_status,
  properties: [{ name: 'Колір', value: 'Чорний' }, { name: 'Розмір', value: '48' }],
  offer: { sku, properties: [] }, ...extra,
});
const order = (id, status_id, changed, products, ttn = null) => ({
  id, status_id, created_at: changed, status_changed_at: changed, products,
  shipping: { tracking_code: ttn, delivery_service_id: 3 },
});

const orders = [
  order(3, 6,  '2026-10-12T10:00:00Z', [line('1983', 'reserved')], '2045'),
  order(1, 26, '2026-10-10T10:00:00Z', [line('1983', 'reserved'), line('999', 'reserved')]),
  order(2, 2,  '2026-10-11T10:00:00Z', [line('887', 'reserved', { quantity: 2 })]),
  order(4, 6,  '2026-10-09T10:00:00Z', [line('887', 'fulfilled')]),            // уже списано
  order(5, 26, '2026-10-13T10:00:00Z', [{ sku: null, name: 'Преміум', quantity: 1,
                                          stock_status: 'reserved', offer: { sku: null } }]),
  // властивості лише в offer.properties — теж мають читатись
  order(6, 2,  '2026-10-08T10:00:00Z', [{ sku: '1405', name: 'Халат', quantity: 1,
     stock_status: 'reserved', properties: [],
     offer: { sku: '1405', properties: [{ name: 'Розмір', value: '52' }] } }]),
];
const stocks = {
  '1983': { quantity: 0, reserve: 2, free: -2 },
  '887':  { quantity: 1, reserve: 3, free: -2 },
  '1405': { quantity: -2, reserve: 0, free: -2 },
};
const r = findReserveHolders(orders, ['1983', '887', '1405', '459'], stocks, { 6: 'Виготовляється' });

const errors = [];
const eq = (got, exp, what) => {
  if (JSON.stringify(got) !== JSON.stringify(exp)) errors.push(`${what}: очікували ${JSON.stringify(exp)}, отримали ${JSON.stringify(got)}`);
};

eq(r['1983'].holders.map(h => h.order_id), [1, 3], '1983: найраніше підтверджені першими');
eq(r['1983'].over_stock_order_ids, [1, 3], '1983: залишок 0 — обидва без штуки');
eq(r['1983'].reserved_found, 2, '1983: знайдено весь резерв');
eq('reserve_mismatch' in r['1983'], false, '1983: розбіжності немає');
eq(r['1983'].holders[1].status_name, 'Виготовляється', 'назва статусу');
eq(r['1983'].holders[1].ttn, '2045', 'ТТН');
eq([r['1983'].holders[0].color, r['1983'].holders[0].size], ['Чорний', '48'], 'колір і розмір');

eq(r['887'].holders.map(h => h.order_id), [2], '887: списаний рядок (fulfilled) не показується');
eq(r['887'].over_stock_order_ids, [2], '887: 2 шт на залишок 1 — рядок не покрито');
eq(r['887'].reserve_mismatch !== undefined, true, '887: резерв 3, знайдено 2 — розбіжність видно');

eq(r['1405'].holders[0].size, '52', 'властивості з offer.properties');
eq(r['1405'].over_stock_order_ids, [6], '1405: від\'ємний залишок рахується як 0');

eq(r['459'].holders, [], 'SKU без замовлень — порожній список, не падіння');
eq(r['459'].quantity, 0, 'SKU без даних складу — нулі');

if (errors.length) {
  console.error('✗ findReserveHolders:\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log('✓ findReserveHolders: тримачі, порядок, over_stock, fulfilled і розбіжність резерву — ок');
