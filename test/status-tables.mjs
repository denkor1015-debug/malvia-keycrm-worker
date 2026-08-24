// Перевірка таблиць статусів воркера. Запуск: node test/status-tables.mjs
//
// НАВІЩО. 24.08.2026 з'ясувалось, що статус 35 («Відмова» на пошті) не був
// заведений ні в STATUS_GROUP, ні в STATUS.RETURN. classifyStatus повертав
// 'unknown', і 216 замовлень за липень-серпень тихо випадали з усіх звітів:
// викуп за липень читався як 69.6% замість 56.4%. Помилка не падала — просто
// числа були неправильні. Цей тест ловить рівно цей клас помилок до деплою.

import { readFileSync } from 'node:fs';

const FILE = 'src/keycrm-worker-v8.js';

const src = readFileSync(FILE, 'utf8');
const from = src.indexOf('const STATUS = {');
const to = src.indexOf('// ─── MCP Protocol');
if (from < 0 || to < 0) {
  console.error(`✗ У ${FILE} не знайдено блок статусів — тест не може працювати.`);
  process.exit(1);
}
const { STATUS, STATUS_GROUP, classifyStatus } =
  new Function(src.slice(from, to) + '; return { STATUS, STATUS_GROUP, classifyStatus };')();

const errors = [];

// 1. Кожен id зі списків STATUS має мати підпис у STATUS_GROUP.
for (const [bucket, ids] of Object.entries(STATUS)) {
  for (const id of ids) {
    if (!STATUS_GROUP[id]) errors.push(`статус ${id} є в STATUS.${bucket}, але не має підпису в STATUS_GROUP`);
  }
}

// 2. І навпаки: кожен підпис має належати якомусь списку, інакше classifyStatus
//    поверне 'unknown' і замовлення випаде зі звітів.
const inLists = new Set(Object.values(STATUS).flat());
for (const id of Object.keys(STATUS_GROUP)) {
  if (!inLists.has(Number(id))) errors.push(`статус ${id} має підпис '${STATUS_GROUP[id]}', але не входить у жоден список STATUS`);
}

// 3. Статуси, реально зустрінуті в проді (4132 замовлення, 01.06–24.08.2026),
//    з очікуваною класифікацією. Новий статус у CRM → тест впаде тут, і це
//    саме те, що треба: спершу завести його в таблицях, потім деплоїти.
const PRODUCTION = {
  1: 'new',
  4: 'in_progress', 23: 'in_progress', 25: 'in_progress', 34: 'in_progress',
  26: 'confirmed',
  6: 'production',
  9: 'delivery', 20: 'delivery',
  28: 'return', 32: 'return', 35: 'return',   // 35 — див. коментар угорі файлу
  12: 'completed',
  13: 'cancelled', 15: 'cancelled', 16: 'cancelled', 18: 'cancelled',
  19: 'cancelled', 21: 'cancelled', 22: 'cancelled', 24: 'cancelled', 29: 'cancelled', 31: 'cancelled',
};
for (const [id, expected] of Object.entries(PRODUCTION)) {
  const got = classifyStatus(Number(id));
  if (got !== expected) errors.push(`статус ${id}: очікували '${expected}', отримали '${got}'`);
}

// 4. Відмови на пошті писались трьома статусами за літо 2026 — усі три мають
//    рахуватись як повернення, інакше викуп завищується.
for (const id of [28, 32, 35]) {
  if (classifyStatus(id) !== 'return') errors.push(`статус ${id} — це відмова на пошті, має бути 'return'`);
}

if (errors.length) {
  console.error('✗ Таблиці статусів неповні:\n' + errors.map(e => '  • ' + e).join('\n'));
  process.exit(1);
}
console.log(`✓ Таблиці статусів цілі: ${Object.keys(PRODUCTION).length} прод-статусів класифікуються правильно, 'unknown' немає.`);
