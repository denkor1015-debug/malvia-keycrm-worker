# KeyCRM MCP Worker

*A Cloudflare Worker that lets Claude operate a real e-commerce business through its CRM.*

**English** · [Українською ↓](#keycrm-mcp-воркер-українська-версія)

## What this is

This is one of the MCP servers I built so that Claude (via Claude Code) can run my
clothing e-commerce business end to end. This particular worker is the bridge between
Claude and **KeyCRM** — the CRM we run the business on — plus **Nova Poshta**, Ukraine's
main delivery service.

Through it, Claude answers questions like *"what's the buyout rate for product 21-183 this
month"*, *"show me the sales funnel by ad campaign"*, or *"P&L for this product"* — by
calling tools that aggregate the data **server-side** and hand back a compact answer,
instead of pulling thousands of raw orders into the model's context. Doing the counting
inside the worker is the whole point: one `get_order` card is ~2,700 tokens, so 70 orders
would burn a quarter of a session's window; the aggregators return ~2,000 for the same job.

It runs in production at `https://keycrm-mcp.malviainua.workers.dev` and is protected by a
shared secret — the server **refuses every request** if that secret isn't configured
(fail-closed).

## ⚠️ This is the single source of truth for the worker code

Old copies of this file live in the business repo (`Malvia Business/tools/`). **They are
not deployed and not maintained.** The worker code is edited only here.

This was decided on 2026-08-24, after we found three copies had drifted apart (v8.3 in git,
v8.4 in production, an uncommitted v8.5 in the working folder) and nobody knew which was
live. The uncommitted v8.5, with OAuth authorization, still sits in the business repo — if
we ever finish it, it moves here.

## How deployment works

A push to `main` that touches the worker code or `wrangler.toml` runs
[.github/workflows/deploy.yml](.github/workflows/deploy.yml):

1. syntax check;
2. `test/status-tables.mjs` — the status tables must be complete;
3. `wrangler deploy` to Cloudflare;
4. the worker is polled until it returns the expected version. If it hasn't within a
   minute, the step fails.

Code is no longer copied by hand in the Cloudflare dashboard.

### One-time setup

| Where | What |
|---|---|
| Cloudflare → Manage Account → API Tokens | a token with `Account → Workers Scripts → Edit` + `Account Settings → Read`, with an expiry |
| GitHub → Settings → Secrets → Actions | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| `wrangler.toml` | `compatibility_date` — copy it from the worker dashboard, Settings → Runtime |

The token is never stored in the code. It's deleted with a button in GitHub; after that
it's worth revoking in Cloudflare too, so any stale copy becomes dead text.

### Making a deploy wait for approval

GitHub → Settings → Environments → `production` → Required reviewers. Then every deploy
queues until someone approves it by hand.

### Rollback

Cloudflare → worker → Deployments → Rollback. Or `git revert` the commit — the rollback
then travels the same automated path and passes the same checks.

## The worker's own secrets

`KEYCRM_API_KEY`, `NP_API_KEY`, `MCP_SHARED_SECRET` live in Cloudflare and are untouched by
code deploys. They are not in the repository and must not be.

## Why the status-tables test exists

On 2026-08-24 we found that status 35 ("Refused" at the post office) wasn't registered in
either `STATUS_GROUP` or `STATUS.RETURN`. `classifyStatus` returned `unknown`, and 216
orders from July–August silently fell out of **every** aggregate. July's buyout rate read
as 69.6% instead of 56.4% — the bug broke nothing, it just made the numbers wrong, quietly.

`test/status-tables.mjs` checks that every status that actually appears in orders has a
label and lands in some category. A new status in the CRM → the test fails **before**
deploy, not a month later in the reports.

One hole stays open on purpose (documented, not yet closed): `STATUS_REFUSED = 32` in
`getBuyoutByUpsell` and `getBuyoutByCalls` — those two tools count refusals only by status
32 and don't yet see 35 or 28.

---

# KeyCRM MCP-воркер (українська версія)

Cloudflare-воркер, через який Claude ходить у KeyCRM: воронки, P&L по товарах,
підсумки періоду, статистика КЦ. Живе за адресою
`https://keycrm-mcp.malviainua.workers.dev`.

## ⚠️ Це єдине джерело правди для коду воркера

У бізнес-репозиторії (`Malvia Business/tools/`) лежать старі копії цього файлу.
**Вони не деплояться і не оновлюються.** Правити код воркера — тільки тут.

Так вирішено після 24.08.2026, коли виявилось, що копій розвелось три
(v8.3 у git, v8.4 у проді, v8.5 незакоммічена в робочій папці), і ніхто вже
не знав, яка з них жива. Незакоммічена v8.5 з OAuth-авторизацією досі лежить
у бізнес-репо — якщо колись доводитимемо її до розуму, переносити сюди.

## Як відбувається деплой

Пуш у `main`, який зачіпає код воркера або `wrangler.toml`, запускає
[.github/workflows/deploy.yml](.github/workflows/deploy.yml):

1. перевірка синтаксису;
2. `test/status-tables.mjs` — таблиці статусів цілі;
3. `wrangler deploy` у Cloudflare;
4. воркер опитується, поки не віддасть очікувану версію. Не віддав за хвилину — крок падає.

Руками в дашборді Cloudflare код більше не копіюємо.

### Що потрібно один раз налаштувати

| Де | Що |
|---|---|
| Cloudflare → Manage Account → API Tokens | токен із правами `Account → Workers Scripts → Edit` + `Account Settings → Read`, з датою протухання |
| GitHub → Settings → Secrets → Actions | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| `wrangler.toml` | `compatibility_date` — переписати з дашборда воркера, Settings → Runtime |

Токен ніде в коді не зберігається. Видаляється кнопкою в GitHub; після цього
його ще варто відкликати в Cloudflare — тоді стара копія стає мертвим текстом.

### Щоб деплой чекав підтвердження

GitHub → Settings → Environments → `production` → Required reviewers.
Тоді кожна заливка стоятиме в черзі, доки її не схвалять руками.

### Відкат

Cloudflare → воркер → Deployments → Rollback. Або `git revert` коміта — тоді
відкат поїде тим самим автоматичним шляхом і пройде ті самі перевірки.

## Секрети самого воркера

`KEYCRM_API_KEY`, `NP_API_KEY`, `MCP_SHARED_SECRET` живуть у Cloudflare і
деплоєм коду не зачіпаються. У репозиторії їх немає й бути не повинно.

## Навіщо тест таблиць статусів

24.08.2026 знайшли, що статус 35 («Відмова» на пошті) не був заведений
ні в `STATUS_GROUP`, ні в `STATUS.RETURN`. `classifyStatus` повертав `unknown`,
і 216 замовлень за липень-серпень тихо випадали з **усіх** агрегатів. Викуп за
липень читався як 69.6% замість 56.4% — помилка нічого не ламала, просто робила
числа неправильними.

`test/status-tables.mjs` перевіряє, що кожен статус, який реально зустрічається
в замовленнях, має підпис і потрапляє в якусь категорію. Новий статус у CRM →
тест упаде до деплою, а не через місяць у звітах.

Окремо лишається незакрита діра: `STATUS_REFUSED = 32` в `getBuyoutByUpsell`
і `getBuyoutByCalls` — ці два інструменти рахують відмови лише по статусу 32
і не бачать 35 та 28.
