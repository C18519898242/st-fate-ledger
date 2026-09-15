# 手动剧情流程 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在命运账本插件中实现按聊天保存的剧情 JSON、完整流程操作台、手动节点推进，以及只向 AI 注入过去和当前节点的隐藏上下文。

**Architecture:** 将纯剧情规则、聊天 metadata 持久化、生成前注入和 DOM 界面分成四个小模块，`index.js` 只负责组装。所有剧情数据以当前 `SillyTavern.getContext().chatMetadata` 为准；生成拦截器在每次请求前重新读取 metadata，再通过 `setExtensionPrompt` 写入临时 system prompt。

**Tech Stack:** SillyTavern UI Extension API、浏览器原生 ES modules/DOM、Vitest 3.2.4、jsdom 26.1.0、CSS。

**Spec:** `docs/2026-09-13-st-plot-progress-design.md`

## Global Constraints

- 本计划只实现剧情流程子系统，不实现公开旁白、演员选择、演员隐藏指令、顺序生成和 D&D 骰子。
- 完整剧情和 `currentNodeId` 只保存在当前聊天的 `chatMetadata.st_fate_ledger` 中。
- 操作台供人类导演查看全部节点；已完成节点置灰，当前节点突出，未来节点正常显示。
- AI 每次生成时只能收到剧情简介、已完成节点和当前节点；未来节点不得复制、序列化或注入。
- 剧情设置使用 JSON 文本编辑器，不增加表格、拖拽、分支图或表单式编辑器。
- 操作台不出现“编辑剧情”按钮；剧情设置只能从书本入口菜单进入。
- 第一版只允许顺序推进，不自动推进、不回退、不跳转。
- DOM 中所有用户剧情文本都通过 `textContent` 写入，不使用 `innerHTML`。
- SillyTavern 最低版本保持 `1.18.0`，运行时代码不引入第三方依赖。

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/plot.js` | JSON 校验、节点状态计算、下一节点计算、AI 可见上下文裁剪 |
| `src/plot-store.js` | 从当前聊天 metadata 读取、保存和推进剧情，并在保存失败时回滚 |
| `src/plot-prompt.js` | 每次生成前刷新隐藏 system prompt，异常状态阻止生成 |
| `src/views.js` | 构造操作台和剧情设置两个页面的 DOM 内容 |
| `src/ui.js` | 挂载书本按钮、入口菜单、Popup 生命周期和聊天切换清理 |
| `index.js` | 注册全局生成拦截器并初始化 UI |
| `style.css` | 菜单、Popup、剧情列表滚动区和节点状态样式 |
| `tests/*.test.js` | 对应模块的 Vitest/jsdom 自动化测试 |
| `docs/testing/2026-09-13-plot-progress-smoke.md` | SillyTavern 1.18.0 真机检查步骤 |

## Task 1: 剧情模型与测试环境

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `src/plot.js`
- Create: `tests/plot.test.js`
- Test: `tests/worldbook.test.mjs`

**Interfaces:**
- Produces: `PlotValidationError`, `parsePlotJson(text)`, `validatePlot(value)`, `getCurrentNodeIndex(plot, currentNodeId)`, `buildPlotRows(plot, currentNodeId)`, `getNextNodeId(plot, currentNodeId)`, `buildActorPlotContext(plot, currentNodeId)`.

- [ ] **Step 1: Add the test runner without runtime dependencies**

Create `package.json` exactly as follows, then run `npm install` to generate `package-lock.json`:

```json
{
  "name": "st-fate-ledger",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "jsdom": "26.1.0",
    "vitest": "3.2.4"
  }
}
```

Run: `npm install`

- [ ] **Step 2: Verify the existing test still runs under Vitest**

Run: `npm test -- tests/worldbook.test.mjs`

Expected: one passing test named `DND status worldbook satisfies the MVP contract`.

- [ ] **Step 3: Write failing plot-domain tests**

Create `tests/plot.test.js` with a four-node fixture and these assertions:

```js
import { describe, expect, it } from 'vitest';
import {
    buildActorPlotContext,
    buildPlotRows,
    getNextNodeId,
    parsePlotJson,
} from '../src/plot.js';

const plot = {
    summary: '王宫宴会期间，有人准备刺杀王储。',
    nodes: [
        { id: '1', title: '宴会开始', description: '玩家进入宴会厅。' },
        { id: '2', title: '识破卫队暗号', description: '门外卫队使用了错误暗号。' },
        { id: '3', title: '揭穿冒牌卫队', description: '玩家寻找证据。' },
        { id: '4', title: '逃离王宫', description: '众人护送王储撤离。' },
    ],
};

describe('plot model', () => {
    it('accepts the supported JSON shape and rejects status or duplicate ids', () => {
        expect(parsePlotJson(JSON.stringify(plot))).toEqual(plot);
        expect(() => parsePlotJson(JSON.stringify({
            ...plot,
            nodes: [{ ...plot.nodes[0], status: 'active' }],
        }))).toThrow(/status/);
        expect(() => parsePlotJson(JSON.stringify({
            ...plot,
            nodes: [plot.nodes[0], { ...plot.nodes[1], id: '1' }],
        }))).toThrow(/重复.*1/);
    });

    it('calculates completed, active, and future rows for the director', () => {
        expect(buildPlotRows(plot, '2').map(node => node.status)).toEqual([
            'completed', 'active', 'future', 'future',
        ]);
    });

    it('returns the next id and stops at the last node', () => {
        expect(getNextNodeId(plot, '2')).toBe('3');
        expect(getNextNodeId(plot, '4')).toBeNull();
    });

    it('never serializes future nodes for the actor', () => {
        const visible = buildActorPlotContext(plot, '2');
        expect(visible.nodes).toEqual([
            { title: '宴会开始', description: '玩家进入宴会厅。', status: 'completed' },
            { title: '识破卫队暗号', description: '门外卫队使用了错误暗号。', status: 'active' },
        ]);
        expect(JSON.stringify(visible)).not.toContain('揭穿冒牌卫队');
        expect(JSON.stringify(visible)).not.toContain('逃离王宫');
    });
});
```

- [ ] **Step 4: Run the domain test to verify it fails**

Run: `npm test -- tests/plot.test.js`

Expected: FAIL because `src/plot.js` does not exist.

- [ ] **Step 5: Implement the pure plot rules**

Create `src/plot.js`. Keep validation and projection pure: reject non-object roots, blank strings, empty `nodes`, duplicate IDs and any node containing `status`; return only `summary`, `id`, `title`, and `description` fields. Use these exact status values and actor projection:

```js
export class PlotValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PlotValidationError';
    }
}

function requireText(value, path) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new PlotValidationError(`${path} 必须是非空字符串`);
    }
    return value;
}

export function validatePlot(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new PlotValidationError('剧情必须是 JSON 对象');
    }
    const summary = requireText(value.summary, 'summary');
    if (!Array.isArray(value.nodes) || value.nodes.length === 0) {
        throw new PlotValidationError('nodes 至少需要一个节点');
    }
    const ids = new Set();
    const nodes = value.nodes.map((node, index) => {
        if (!node || typeof node !== 'object' || Array.isArray(node)) {
            throw new PlotValidationError(`nodes[${index}] 必须是对象`);
        }
        if (Object.hasOwn(node, 'status')) {
            throw new PlotValidationError(`nodes[${index}].status 不允许写入剧情 JSON`);
        }
        const id = requireText(node.id, `nodes[${index}].id`);
        if (ids.has(id)) throw new PlotValidationError(`节点 id 重复：${id}`);
        ids.add(id);
        return {
            id,
            title: requireText(node.title, `nodes[${index}].title`),
            description: requireText(node.description, `nodes[${index}].description`),
        };
    });
    return { summary, nodes };
}

export function parsePlotJson(text) {
    let value;
    try {
        value = JSON.parse(text);
    } catch (error) {
        throw new PlotValidationError(`JSON 语法错误：${error.message}`);
    }
    return validatePlot(value);
}

export function getCurrentNodeIndex(plot, currentNodeId) {
    const index = plot.nodes.findIndex(node => node.id === currentNodeId);
    if (index < 0) throw new PlotValidationError(`当前节点不存在：${currentNodeId ?? '未设置'}`);
    return index;
}

export function buildPlotRows(plot, currentNodeId) {
    const activeIndex = getCurrentNodeIndex(plot, currentNodeId);
    return plot.nodes.map((node, index) => ({
        ...node,
        status: index < activeIndex ? 'completed' : index === activeIndex ? 'active' : 'future',
    }));
}

export function getNextNodeId(plot, currentNodeId) {
    const index = getCurrentNodeIndex(plot, currentNodeId);
    return plot.nodes[index + 1]?.id ?? null;
}

export function buildActorPlotContext(plot, currentNodeId) {
    const activeIndex = getCurrentNodeIndex(plot, currentNodeId);
    return {
        summary: plot.summary,
        nodes: plot.nodes.slice(0, activeIndex + 1).map((node, index) => ({
            title: node.title,
            description: node.description,
            status: index === activeIndex ? 'active' : 'completed',
        })),
    };
}
```

- [ ] **Step 6: Run the domain and existing tests**

Run: `npm test -- tests/plot.test.js tests/worldbook.test.mjs`

Expected: all tests pass.

- [ ] **Step 7: Commit the model**

```bash
git add package.json package-lock.json src/plot.js tests/plot.test.js
git commit -m "feat: add plot progression model"
```

## Task 2: 当前聊天 Metadata 持久化

**Files:**
- Create: `src/plot-store.js`
- Create: `tests/plot-store.test.js`

**Interfaces:**
- Consumes: `validatePlot(plot)`, `getCurrentNodeIndex(plot, id)`, `getNextNodeId(plot, id)` from Task 1.
- Produces: `METADATA_KEY`, `readPlotState(metadata)`, `savePlotToCurrentChat(getContext, plot)`, `advancePlotInCurrentChat(getContext)`.

- [ ] **Step 1: Write failing persistence tests**

Create `tests/plot-store.test.js` using a context mock whose `chatMetadata` is a mutable object and whose `saveMetadata` is a spy. Cover these exact cases:

```js
import { describe, expect, it, vi } from 'vitest';
import {
    advancePlotInCurrentChat,
    readPlotState,
    savePlotToCurrentChat,
} from '../src/plot-store.js';

const plot = {
    summary: '王宫宴会期间，有人准备刺杀王储。',
    nodes: [
        { id: '1', title: '宴会开始', description: '玩家进入宴会厅。' },
        { id: '2', title: '识破卫队暗号', description: '门外卫队使用了错误暗号。' },
    ],
};

function makeContext(metadata = {}) {
    return { chatMetadata: metadata, saveMetadata: vi.fn(async () => {}) };
}

describe('plot store', () => {
    it('starts a newly saved plot at its first node', async () => {
        const context = makeContext();
        const result = await savePlotToCurrentChat(() => context, plot);
        expect(result).toMatchObject({ plot, currentNodeId: '1', currentReset: false });
        expect(readPlotState(context.chatMetadata)).toEqual({ plot, currentNodeId: '1' });
        expect(context.saveMetadata).toHaveBeenCalledOnce();
    });

    it('keeps an existing current id, but resets a deleted id', async () => {
        const context = makeContext({
            st_fate_ledger: { version: 1, plot, currentNodeId: '2' },
        });
        expect((await savePlotToCurrentChat(() => context, plot)).currentReset).toBe(false);
        const shorter = { ...plot, nodes: [plot.nodes[0]] };
        expect((await savePlotToCurrentChat(() => context, shorter))).toMatchObject({
            currentNodeId: '1', currentReset: true,
        });
    });

    it('advances once and does not save at the last node', async () => {
        const context = makeContext({
            st_fate_ledger: { version: 1, plot, currentNodeId: '1' },
        });
        expect((await advancePlotInCurrentChat(() => context))).toMatchObject({ currentNodeId: '2', isLast: true });
        expect(context.saveMetadata).toHaveBeenCalledOnce();
        await advancePlotInCurrentChat(() => context);
        expect(context.saveMetadata).toHaveBeenCalledOnce();
    });

    it('restores the original metadata when persistence fails', async () => {
        const metadata = { st_fate_ledger: { version: 1, plot, currentNodeId: '1' } };
        const context = makeContext(metadata);
        context.saveMetadata.mockRejectedValue(new Error('disk full'));
        await expect(advancePlotInCurrentChat(() => context)).rejects.toThrow('disk full');
        expect(metadata.st_fate_ledger.currentNodeId).toBe('1');
    });
});
```

- [ ] **Step 2: Run the store test to verify it fails**

Run: `npm test -- tests/plot-store.test.js`

Expected: FAIL because `src/plot-store.js` does not exist.

- [ ] **Step 3: Implement transactional metadata access**

Create `src/plot-store.js` with `METADATA_KEY = 'st_fate_ledger'`. `readPlotState` returns `{ plot: null, currentNodeId: null }` when the key is absent; otherwise it requires `version === 1`, validates the stored plot, and verifies that `currentNodeId` exists. Both mutations must call `getContext()` at action time, snapshot only the ledger key with `structuredClone`, mutate it, await `saveMetadata()`, and restore the snapshot on failure.

Use this shared mutation shape:

```js
async function persist(context, nextLedger) {
    const metadata = context.chatMetadata;
    const hadPrevious = Object.hasOwn(metadata, METADATA_KEY);
    const previous = hadPrevious ? structuredClone(metadata[METADATA_KEY]) : undefined;
    metadata[METADATA_KEY] = nextLedger;
    try {
        await context.saveMetadata();
    } catch (error) {
        if (hadPrevious) metadata[METADATA_KEY] = previous;
        else delete metadata[METADATA_KEY];
        throw error;
    }
}
```

`savePlotToCurrentChat` returns `{ plot, currentNodeId, currentReset }`. It must preserve the prior ID when it remains in the new plot, otherwise choose `plot.nodes[0].id`; `currentReset` is `true` only when an existing ID was removed. `advancePlotInCurrentChat` returns `{ plot, currentNodeId, isLast }` and must return the unchanged state without saving when `getNextNodeId` returns `null`.

- [ ] **Step 4: Run persistence tests**

Run: `npm test -- tests/plot-store.test.js tests/plot.test.js`

Expected: all tests pass.

- [ ] **Step 5: Commit persistence**

```bash
git add src/plot-store.js tests/plot-store.test.js
git commit -m "feat: persist plot progress per chat"
```

## Task 3: 每次生成前的隐藏剧情注入

**Files:**
- Create: `src/plot-prompt.js`
- Create: `tests/plot-prompt.test.js`
- Modify: `manifest.json`
- Modify: `index.js`

**Interfaces:**
- Consumes: `readPlotState(metadata)` and `buildActorPlotContext(plot, currentNodeId)`.
- Produces: `PLOT_PROMPT_KEY`, `formatPlotPrompt(value)`, `createPlotGenerateInterceptor(getContext, notifyError)` and global function `globalThis.stFateLedgerGenerateInterceptor`.

- [ ] **Step 1: Write failing interceptor tests**

Create `tests/plot-prompt.test.js`. Mock `setExtensionPrompt` and verify:

```js
import { describe, expect, it, vi } from 'vitest';
import { createPlotGenerateInterceptor } from '../src/plot-prompt.js';

const plot = {
    summary: '王宫宴会期间，有人准备刺杀王储。',
    nodes: [
        { id: '1', title: '宴会开始', description: '玩家进入宴会厅。' },
        { id: '2', title: '识破卫队暗号', description: '门外卫队使用了错误暗号。' },
        { id: '3', title: '揭穿冒牌卫队', description: '玩家寻找证据。' },
    ],
};

describe('plot prompt interceptor', () => {
    it('refreshes a system prompt containing no future nodes on every call', async () => {
        const context = {
            chatMetadata: { st_fate_ledger: { version: 1, plot, currentNodeId: '2' } },
            setExtensionPrompt: vi.fn(),
        };
        const interceptor = createPlotGenerateInterceptor(() => context, vi.fn());
        await interceptor([], 8192, vi.fn(), 'normal');
        await interceptor([], 8192, vi.fn(), 'regenerate');
        expect(context.setExtensionPrompt).toHaveBeenCalledTimes(2);
        const prompt = context.setExtensionPrompt.mock.calls[1][1];
        expect(prompt).toContain('宴会开始');
        expect(prompt).toContain('识破卫队暗号');
        expect(prompt).not.toContain('揭穿冒牌卫队');
        expect(context.setExtensionPrompt.mock.calls[1].slice(2)).toEqual([1, 0, false, 0]);
    });

    it('clears the prompt when the chat has no plot', async () => {
        const context = { chatMetadata: {}, setExtensionPrompt: vi.fn() };
        await createPlotGenerateInterceptor(() => context, vi.fn())([], 8192, vi.fn(), 'normal');
        expect(context.setExtensionPrompt).toHaveBeenCalledWith('st-fate-ledger-plot', '', 1, 0, false, 0);
    });

    it('clears stale content and aborts when currentNodeId is invalid', async () => {
        const context = {
            chatMetadata: { st_fate_ledger: { version: 1, plot, currentNodeId: 'missing' } },
            setExtensionPrompt: vi.fn(),
        };
        const abort = vi.fn();
        const notify = vi.fn();
        await createPlotGenerateInterceptor(() => context, notify)([], 8192, abort, 'normal');
        expect(context.setExtensionPrompt).toHaveBeenCalledWith('st-fate-ledger-plot', '', 1, 0, false, 0);
        expect(abort).toHaveBeenCalledWith(true);
        expect(notify).toHaveBeenCalledWith(expect.stringContaining('当前节点不存在'));
    });
});
```

- [ ] **Step 2: Run the interceptor test to verify it fails**

Run: `npm test -- tests/plot-prompt.test.js`

Expected: FAIL because `src/plot-prompt.js` does not exist.

- [ ] **Step 3: Implement prompt formatting and interception**

Create `src/plot-prompt.js`. `formatPlotPrompt` must serialize only the already-cropped value:

```js
export const PLOT_PROMPT_KEY = 'st-fate-ledger-plot';

export function formatPlotPrompt(value) {
    return [
        '以下是本次生成可用的剧情信息。未来剧情未提供。',
        JSON.stringify(value, null, 2),
        '只依据已完成和当前节点演绎，不要自行假设或推进未知剧情。',
    ].join('\n');
}
```

`createPlotGenerateInterceptor` must call `getContext()` on every invocation, read the current chat, clear the prompt for a chat with no plot, and otherwise call:

```js
await context.setExtensionPrompt(
    PLOT_PROMPT_KEY,
    formatPlotPrompt(buildActorPlotContext(state.plot, state.currentNodeId)),
    1,
    0,
    false,
    0,
);
```

If reading or injecting throws, attempt to clear the same prompt key, call `notifyError(error.message)`, and call `abort(true)` so stale or invalid剧情不能继续生成。

- [ ] **Step 4: Register the global interceptor**

Add this field to `manifest.json`:

```json
"generate_interceptor": "stFateLedgerGenerateInterceptor"
```

At module scope in `index.js`, import the factory and register the function before `init()` is called:

```js
import { createPlotGenerateInterceptor } from './src/plot-prompt.js';

const getContext = () => SillyTavern.getContext();

globalThis.stFateLedgerGenerateInterceptor = createPlotGenerateInterceptor(
    getContext,
    message => globalThis.toastr?.error(message, '命运账本'),
);
```

- [ ] **Step 5: Run interceptor and manifest tests**

Run: `npm test -- tests/plot-prompt.test.js tests/plot-store.test.js tests/plot.test.js`

Expected: all tests pass. Also run `node -e "const m=require('./manifest.json'); if(m.generate_interceptor!=='stFateLedgerGenerateInterceptor') process.exit(1)"` and expect exit code 0.

- [ ] **Step 6: Commit prompt injection**

```bash
git add manifest.json index.js src/plot-prompt.js tests/plot-prompt.test.js
git commit -m "feat: inject current plot context before generation"
```

## Task 4: 操作台和剧情设置内容

**Files:**
- Create: `src/views.js`
- Create: `tests/views.test.js`

**Interfaces:**
- Consumes: `parsePlotJson(text)` and `buildPlotRows(plot, currentNodeId)`.
- Produces: `createOperationView(documentRef, state, onAdvance)` and `createPlotSettingsView(documentRef, plot, onSave, onCancel)`.

- [ ] **Step 1: Write failing jsdom view tests**

Create `tests/views.test.js` with `/** @vitest-environment jsdom */`. Assert all of the following in separate tests:

```js
const operation = createOperationView(document, { plot, currentNodeId: '2' }, vi.fn());
expect(operation.querySelector('[data-role="plot-progress"]').textContent).toContain('2 / 4');
expect([...operation.querySelectorAll('[data-role="plot-node"]')]).toHaveLength(4);
expect(operation.querySelector('[data-node-id="1"]').dataset.status).toBe('completed');
expect(operation.querySelector('[data-node-id="2"]').dataset.status).toBe('active');
expect(operation.querySelector('[data-node-id="3"]').dataset.status).toBe('future');
expect(operation.textContent).not.toContain('编辑剧情');
expect(operation.querySelector('[data-action="advance"]')).not.toBeNull();
```

For the settings view, enter malformed JSON and expect `[data-role="validation"]` to show `JSON 语法错误` with the save button disabled; then enter valid JSON, dispatch `input`, expect `JSON 格式正确`, click save, and expect `onSave` to receive the validated plot object rather than raw text.

- [ ] **Step 2: Run the view tests to verify they fail**

Run: `npm test -- tests/views.test.js`

Expected: FAIL because `src/views.js` does not exist.

- [ ] **Step 3: Build the operation view with a fixed scroll region**

In `createOperationView`, build this DOM tree using `createElement`, `className`, `dataset`, and `textContent`:

```text
section.stfl-page.stfl-operation
  header.stfl-page-header                     操作台
  div[data-role=plot-progress]                剧情进度 2 / 4
  section.stfl-summary                        剧情简介 + summary
  section.stfl-flow
    h3                                         剧情流程
    div.stfl-node-scroll[data-role=node-scroll]
      article.stfl-node[data-role=plot-node][data-node-id][data-status] × N
  button[data-action=advance]                 进入下一剧情
```

Each row contains its 1-based sequence number, title, description, and either `已完成` or `当前`; future rows have no status label. When the view is connected, call `scrollIntoView({ block: 'nearest' })` on `[data-status="active"]`. At the last node, disable the button and set its text to `已到最后节点`. With no plot, show `尚未设置剧情` and a disabled advance button.

- [ ] **Step 4: Build the JSON settings view**

`createPlotSettingsView` must use a `<textarea spellcheck="false">`, initialize it with `JSON.stringify(plot ?? { summary: '', nodes: [] }, null, 2)`, validate on every `input`, and expose these stable selectors:

```text
textarea[data-role=plot-json]
div[data-role=validation]
button[data-action=cancel]
button[data-action=save]
```

Disable save until `parsePlotJson` succeeds. On valid input show `JSON 格式正确`; on failure show the exact `PlotValidationError.message`. On save, await `onSave(validatedPlot)` and keep the textarea open with `保存失败：<message>` if the promise rejects.

- [ ] **Step 5: Run the view tests**

Run: `npm test -- tests/views.test.js tests/plot.test.js`

Expected: all tests pass.

- [ ] **Step 6: Commit the views**

```bash
git add src/views.js tests/views.test.js
git commit -m "feat: add plot operation and settings views"
```

## Task 5: 入口菜单、Popup 和聊天切换生命周期

**Files:**
- Create: `src/ui.js`
- Create: `tests/ui.test.js`
- Modify: `index.js`

**Interfaces:**
- Consumes: both view factories from Task 4 and both store mutations from Task 2.
- Produces: `mountLedgerUi({ getContext, documentRef, notify })`, returning `{ trigger, closeAll }`.

- [ ] **Step 1: Write failing UI integration tests**

Create `tests/ui.test.js` with `/** @vitest-environment jsdom */`, a `PopupMock`, and a fixture containing `#sheld` and `#leftSendForm`. Verify:

1. `mountLedgerUi` inserts exactly one accessible `#st-fate-ledger-trigger`.
2. Clicking the trigger toggles one `[data-role="ledger-menu"]` with `操作台`, a separator, `剧情设置`, and `D&D 设置` in that order.
3. Clicking `操作台` closes the menu and opens one `POPUP_TYPE.DISPLAY` containing all plot rows and no `编辑剧情` button.
4. Clicking `剧情设置` opens a separate popup; saving valid JSON calls `saveMetadata()` and closes it.
5. Clicking `D&D 设置` closes the menu and calls `notify.info('D&D 设置尚未实现')` without opening a popup.
6. Outside click and `Escape` close only the menu.
7. `CHAT_CHANGED` closes the menu and active popup, so unsaved text cannot cross chats.
8. Repeated mounting and repeated popup clicks do not duplicate the trigger, menu, popup, or event subscription.

- [ ] **Step 2: Run the UI test to verify it fails**

Run: `npm test -- tests/ui.test.js`

Expected: FAIL because `src/ui.js` does not exist.

- [ ] **Step 3: Implement the single-level menu**

Create `src/ui.js`. Append the trigger to `#leftSendForm`, matching the existing location, and create the menu only on click. Use buttons with these stable action values:

```js
const items = [
    { action: 'operation', label: '操作台', icon: 'fa-sliders' },
    { separator: true },
    { action: 'plot-settings', label: '剧情设置', icon: 'fa-book-open' },
    { action: 'dnd-settings', label: 'D&D 设置', icon: 'fa-dice-d20' },
];
```

Give the menu `className = 'stfl-menu'` and position it above the trigger from `trigger.getBoundingClientRect()`. Register one document click listener and one keydown listener while the menu exists, and remove both when it closes.

- [ ] **Step 4: Implement Popup opening and actions**

For each popup action, call `getContext()` immediately before reading metadata or constructing `new context.Popup(...)`. Size the dialog to 75% of `#sheld`, capped by `calc(100dvw - 2rem)` and `calc(100dvh - 2rem)` through CSS variables already used by the extension.

Operation popup behavior:

```js
let popup;
const render = () => createOperationView(
    documentRef,
    readPlotState(getContext().chatMetadata),
    async () => {
        await advancePlotInCurrentChat(getContext);
        popup.content.replaceChildren(render());
    },
);
popup = new context.Popup(render(), context.POPUP_TYPE.DISPLAY, '');
```

Settings popup behavior:

```js
async function closeActivePopup() {
    const popup = activePopup;
    activePopup = null;
    if (popup) await popup.completeCancelled();
}

const state = readPlotState(getContext().chatMetadata);
const content = createPlotSettingsView(
    documentRef,
    state.plot,
    async plot => {
        const saved = await savePlotToCurrentChat(getContext, plot);
        if (saved.currentReset) notify.info('原当前节点已删除，已回到第一个节点');
        await closeActivePopup();
    },
    closeActivePopup,
);
```

Catch read/advance failures, keep the popup state unchanged, and show `notify.error(error.message)`. Do not cache `chatMetadata` or a context object between user actions.

- [ ] **Step 5: Wire lifecycle from `index.js`**

Replace the existing direct button mount with a guarded initialization:

```js
let initPromise;

export function init() {
    if (!initPromise) {
        initPromise = mountLedgerUi({
            getContext,
            documentRef: document,
            notify: globalThis.toastr ?? { info() {}, error() {} },
        }).catch(error => {
            initPromise = undefined;
            throw error;
        });
    }
    return initPromise;
}
```

Inside `mountLedgerUi`, subscribe once to `context.eventSource.on(context.eventTypes.CHAT_CHANGED, closeAll)`. `closeAll` removes the menu and calls `activePopup.completeCancelled()`; the cached context is used only for this stable event emitter, never for later metadata reads or writes.

- [ ] **Step 6: Run UI and integration tests**

Run: `npm test -- tests/ui.test.js tests/views.test.js tests/plot-store.test.js tests/plot-prompt.test.js`

Expected: all tests pass.

- [ ] **Step 7: Commit UI orchestration**

```bash
git add index.js src/ui.js tests/ui.test.js
git commit -m "feat: add fate ledger menu and plot popups"
```

## Task 6: Visual states and end-to-end verification

**Files:**
- Modify: `style.css`
- Create: `tests/style.test.js`
- Create: `docs/testing/2026-09-13-plot-progress-smoke.md`

**Interfaces:**
- Consumes: stable classes and `data-status` attributes from Tasks 4–5.
- Produces: the fixed-height scroll behavior and final manual acceptance checklist.

- [ ] **Step 1: Write a failing CSS contract test**

Create `tests/style.test.js` that reads `style.css` and asserts the presence of selectors for the menu, scroll viewport, completed row, active row, future row, disabled action and narrow screens:

```js
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('plot UI stylesheet', () => {
    it('defines the required menu, scroll, and node states', async () => {
        const css = await readFile('style.css', 'utf8');
        for (const selector of [
            '.stfl-menu',
            '.stfl-node-scroll',
            '[data-status="completed"]',
            '[data-status="active"]',
            '[data-status="future"]',
            '[data-action="advance"]:disabled',
            '@media (max-width:',
        ]) expect(css).toContain(selector);
    });
});
```

- [ ] **Step 2: Run the style test to verify it fails**

Run: `npm test -- tests/style.test.js`

Expected: FAIL because the required selectors are absent.

- [ ] **Step 3: Implement the approved visual hierarchy**

Extend `style.css` while preserving SillyTavern theme variables. The key behavior must be explicit:

```css
.stfl-node-scroll {
    min-height: 12rem;
    max-height: min(22rem, 42dvh);
    overflow-y: auto;
    overscroll-behavior: contain;
}

.stfl-node[data-status="completed"] {
    opacity: 0.5;
}

.stfl-node[data-status="active"] {
    border-color: #35d06f;
    box-shadow: inset 0.2rem 0 0 #35d06f;
}

.stfl-node[data-status="future"] {
    opacity: 1;
}

.stfl-operation [data-action="advance"] {
    flex: 0 0 auto;
}

.stfl-operation [data-action="advance"]:disabled {
    opacity: 0.55;
    cursor: not-allowed;
}
```

Keep the advance button outside `.stfl-node-scroll`. Add focus-visible states, a scrollable settings textarea, and an `@media (max-width: 700px)` rule that reduces popup padding without hiding node descriptions.

- [ ] **Step 4: Run automated verification**

Run: `npm test`

Expected: all plot, UI, worldbook and stylesheet tests pass.

Run: `git diff --check`

Expected: no output and exit code 0.

- [ ] **Step 5: Write the SillyTavern smoke checklist**

Create `docs/testing/2026-09-13-plot-progress-smoke.md` with these exact checks:

1. Reload SillyTavern 1.18.0 and confirm one book icon appears in the left chat toolbar.
2. Open the menu and confirm `操作台 / separator / 剧情设置 / D&D 设置` order.
3. In 剧情设置, paste the four-node JSON from the design doc; confirm malformed JSON cannot save and valid JSON can.
4. Reopen 操作台; confirm all four nodes are visible in one fixed-height scroll region, node 1 is grey, node 2 is highlighted, and the advance button does not scroll.
5. Click 进入下一剧情; confirm node 2 becomes grey, node 3 becomes current, and reopening the chat preserves that state.
6. Inspect one normal generation request and one regenerate request; confirm the hidden plot prompt contains summary + nodes 1–3 and does not contain node 4.
7. Switch to another chat; confirm its plot is independent and no stale prompt or unsaved editor text follows the switch.
8. Delete the current node in JSON, save, and confirm the UI reports reset to the first node.
9. Reach the last node and confirm the button reads `已到最后节点` and cannot save another advance.

- [ ] **Step 6: Commit styling and verification docs**

```bash
git add style.css tests/style.test.js docs/testing/2026-09-13-plot-progress-smoke.md
git commit -m "feat: finish plot progress interface"
```

## Final Verification

- [ ] Run `npm ci` from a clean dependency directory.
- [ ] Run `npm test` and confirm zero failed tests.
- [ ] Run `git diff --check` and confirm exit code 0.
- [ ] Complete every item in `docs/testing/2026-09-13-plot-progress-smoke.md` on SillyTavern 1.18.0.
- [ ] Inspect captured generation payloads and search for every future node title and description; the search must return no matches.
- [ ] Run `git status --short` and confirm only intentionally uncommitted files remain.

## SillyTavern API Basis

- [UI Extensions and `generate_interceptor`](https://docs.sillytavern.app/for-contributors/writing-extensions/)
- [`getContext()` exposes `chatMetadata`, `saveMetadata`, events and `setExtensionPrompt`](https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/st-context.js)
- [`CHAT_CHANGED` and related event names](https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/events.js)
- [`runGenerationInterceptors` runs before extension prompts are collected](https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/extensions.js)
- [`Popup.completeCancelled()` lifecycle](https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/popup.js)
