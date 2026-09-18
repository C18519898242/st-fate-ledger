/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { METADATA_KEY } from '../src/plot-store.js';
import { mountLedgerUi } from '../src/ui.js';

const plot = {
    summary: '王宫宴会期间，有人准备刺杀王储。',
    nodes: [
        { id: '1', title: '宴会开始', description: '玩家进入宴会厅。' },
        { id: '2', title: '识破卫队暗号', description: '门外卫队使用了错误暗号。' },
        { id: '3', title: '揭穿冒牌卫队', description: '玩家寻找证据。' },
        { id: '4', title: '逃离王宫', description: '众人护送王储撤离。' },
    ],
};

class PopupMock {
    static instances = [];

    constructor(content, type, inputValue = '') {
        this.type = type;
        this.inputValue = inputValue;
        this.dlg = document.createElement('dialog');
        this.content = document.createElement('div');
        this.content.className = 'popup-content';
        if (content instanceof Node) this.content.append(content);
        this.completed = false;
        /** @type {((value: null) => void) | null} */
        this._resolveShow = null;
        this.show = vi.fn(() => new Promise(resolve => {
            this._resolveShow = resolve;
        }));
        this.completeCancelled = vi.fn(async () => {
            this.completed = true;
            const resolve = this._resolveShow;
            this._resolveShow = null;
            if (resolve) resolve(null);
        });
        PopupMock.instances.push(this);
    }
}

function installFixture() {
    document.body.innerHTML = '';
    const sheld = document.createElement('div');
    sheld.id = 'sheld';
    Object.defineProperty(sheld, 'getBoundingClientRect', {
        value: () => ({ width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600 }),
    });
    const leftSendForm = document.createElement('div');
    leftSendForm.id = 'leftSendForm';
    document.body.append(sheld, leftSendForm);
}

function makeContext(metadata = {
    [METADATA_KEY]: { version: 1, plot, currentNodeId: '2' },
}) {
    const systemMessages = [];
    const handlers = new Map();
    const eventSource = {
        on: vi.fn((event, handler) => {
            const list = handlers.get(event) ?? [];
            list.push(handler);
            handlers.set(event, list);
        }),
        emit(event, ...args) {
            for (const handler of handlers.get(event) ?? []) handler(...args);
        },
    };
    return {
        chatId: 'chat-1',
        chatMetadata: metadata,
        saveMetadata: vi.fn(async () => {}),
        Popup: PopupMock,
        POPUP_TYPE: { DISPLAY: 'DISPLAY' },
        eventSource,
        eventTypes: { CHAT_CHANGED: 'chat_id_changed' },
        SlashCommandParser: {
            commands: {
                sys: {
                    callback: vi.fn(async (_args, text) => {
                        systemMessages.push(text);
                    }),
                },
            },
        },
        systemMessages,
    };
}

describe('mountLedgerUi', () => {
    let notify;
    let context;
    let getContext;

    beforeEach(() => {
        PopupMock.instances = [];
        installFixture();
        notify = { info: vi.fn(), error: vi.fn() };
        context = makeContext();
        getContext = vi.fn(() => context);
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('inserts exactly one accessible #st-fate-ledger-trigger', async () => {
        const first = await mountLedgerUi({ getContext, documentRef: document, notify });
        const second = await mountLedgerUi({ getContext, documentRef: document, notify });
        const triggers = document.querySelectorAll('#st-fate-ledger-trigger');
        expect(triggers).toHaveLength(1);
        expect(first.trigger).toBe(triggers[0]);
        expect(second.trigger).toBe(triggers[0]);
        expect(triggers[0].getAttribute('role')).toBe('button');
        expect(triggers[0].getAttribute('aria-label')).toBe('命运账本');
        expect(document.querySelector('#leftSendForm').contains(triggers[0])).toBe(true);
    });

    it('toggles a single-level menu with 操作台, separator, 剧情设置, and D&D 设置', async () => {
        const { trigger } = await mountLedgerUi({ getContext, documentRef: document, notify });
        trigger.click();
        const menu = document.querySelector('[data-role="ledger-menu"]');
        expect(menu).not.toBeNull();
        expect(menu.classList.contains('stfl-menu')).toBe(true);

        const children = [...menu.children];
        expect(children).toHaveLength(4);
        expect(children[0].tagName).toBe('BUTTON');
        expect(children[0].dataset.action).toBe('operation');
        expect(children[0].textContent).toContain('操作台');
        expect(children[1].tagName).not.toBe('BUTTON');
        expect(children[2].dataset.action).toBe('plot-settings');
        expect(children[2].textContent).toContain('剧情设置');
        expect(children[3].dataset.action).toBe('dnd-settings');
        expect(children[3].textContent).toContain('D&D 设置');

        trigger.click();
        expect(document.querySelector('[data-role="ledger-menu"]')).toBeNull();
    });

    it('does not open plot settings without an active chat', async () => {
        context.chatId = null;
        const { trigger } = await mountLedgerUi({ getContext, documentRef: document, notify });

        trigger.click();
        document.querySelector('[data-action="plot-settings"]').click();

        expect(PopupMock.instances).toHaveLength(0);
        expect(notify.error).toHaveBeenCalledWith('请先打开一个聊天');
    });

    it('opens operation popup from the menu with all plot rows and no 编辑剧情', async () => {
        const { trigger } = await mountLedgerUi({ getContext, documentRef: document, notify });
        trigger.click();
        document.querySelector('[data-action="operation"]').click();

        expect(document.querySelector('[data-role="ledger-menu"]')).toBeNull();
        expect(PopupMock.instances).toHaveLength(1);
        expect(PopupMock.instances[0].type).toBe('DISPLAY');
        expect(PopupMock.instances[0].show).toHaveBeenCalledOnce();
        expect(PopupMock.instances[0].completed).toBe(false);

        const body = PopupMock.instances[0].content;
        expect(body.querySelectorAll('[data-role="plot-node"]')).toHaveLength(4);
        expect(body.textContent).not.toContain('编辑剧情');
        expect(body.querySelector('[data-action="advance"]')).not.toBeNull();
    });

    it('advances the open operation view while show() is still pending', async () => {
        const { trigger } = await mountLedgerUi({ getContext, documentRef: document, notify });
        trigger.click();
        document.querySelector('[data-action="operation"]').click();

        const popup = PopupMock.instances[0];
        expect(popup.completed).toBe(false);
        expect(context.chatMetadata[METADATA_KEY].currentNodeId).toBe('2');

        popup.content.querySelector('[data-action="advance"]').click();

        await vi.waitFor(() => {
            expect(context.chatMetadata[METADATA_KEY].currentNodeId).toBe('3');
            expect(popup.content.querySelector('[data-node-id="3"]').dataset.status).toBe('active');
        });
        expect(popup.content.querySelector('[data-role="plot-progress"]').textContent).toContain('3 / 4');
        expect(notify.error).not.toHaveBeenCalled();
        expect(popup.completed).toBe(false);
    });

    it('starts with the summary, then enters node 01 on the next click', async () => {
        context = makeContext({
            [METADATA_KEY]: { version: 1, plot, phase: 'ready', currentNodeId: null },
        });
        getContext = vi.fn(() => context);

        const { trigger } = await mountLedgerUi({ getContext, documentRef: document, notify });
        trigger.click();
        document.querySelector('[data-action="operation"]').click();

        const popup = PopupMock.instances[0];
        expect(popup.content.querySelector('[data-action="advance"]').textContent).toBe('开始剧情');

        popup.content.querySelector('[data-action="advance"]').click();
        await vi.waitFor(() => {
            expect(context.chatMetadata[METADATA_KEY].phase).toBe('summary');
            expect(popup.content.querySelector('[data-action="advance"]').textContent).toBe('进入下一剧情');
        });
        expect(context.systemMessages).toEqual([plot.summary]);
        expect(popup.content.querySelector('[data-status="active"]')).toBeNull();

        popup.content.querySelector('[data-action="advance"]').click();
        await vi.waitFor(() => {
            expect(context.chatMetadata[METADATA_KEY]).toMatchObject({
                phase: 'node',
                currentNodeId: '1',
            });
            expect(popup.content.querySelector('[data-node-id="1"]').dataset.status).toBe('active');
        });
        expect(context.systemMessages).toEqual([plot.summary, plot.nodes[0].description]);
        expect(notify.error).not.toHaveBeenCalled();
    });

    it('opens 剧情设置 when currentNodeId is missing and saving resets to ready', async () => {
        context = makeContext({
            [METADATA_KEY]: { version: 1, plot, currentNodeId: 'missing' },
        });
        getContext = vi.fn(() => context);

        const { trigger } = await mountLedgerUi({ getContext, documentRef: document, notify });
        trigger.click();
        document.querySelector('[data-action="plot-settings"]').click();

        expect(notify.error).not.toHaveBeenCalled();
        expect(PopupMock.instances).toHaveLength(1);
        const popup = PopupMock.instances[0];
        const textarea = popup.content.querySelector('[data-role="plot-json"]');
        expect(textarea).not.toBeNull();
        expect(JSON.parse(textarea.value)).toEqual(plot);

        popup.content.querySelector('[data-action="save"]').click();

        await vi.waitFor(() => {
            expect(context.saveMetadata).toHaveBeenCalledOnce();
            expect(context.chatMetadata[METADATA_KEY]).toMatchObject({
                phase: 'ready',
                currentNodeId: null,
            });
            expect(notify.info).toHaveBeenCalledWith('原当前节点已删除，剧情已重置为未开始');
        });
        await vi.waitFor(() => {
            expect(popup.completeCancelled).toHaveBeenCalledOnce();
            expect(popup.completed).toBe(true);
        });
    });

    it('ignores overlapping advance clicks so only one node is persisted', async () => {
        let releaseSave;
        const saveGate = new Promise(resolve => {
            releaseSave = resolve;
        });
        context.saveMetadata = vi.fn(async () => {
            await saveGate;
        });

        const { trigger } = await mountLedgerUi({ getContext, documentRef: document, notify });
        trigger.click();
        document.querySelector('[data-action="operation"]').click();

        const popup = PopupMock.instances[0];
        const advance = popup.content.querySelector('[data-action="advance"]');
        expect(context.chatMetadata[METADATA_KEY].currentNodeId).toBe('2');

        advance.click();
        advance.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        advance.click();

        releaseSave();

        await vi.waitFor(() => {
            expect(popup.content.querySelector('[data-node-id="3"]').dataset.status).toBe('active');
        });
        expect(context.chatMetadata[METADATA_KEY].currentNodeId).toBe('3');
        expect(context.saveMetadata).toHaveBeenCalledOnce();
        expect(notify.error).not.toHaveBeenCalled();
    });

    it('opens plot settings, saves valid JSON via saveMetadata, and closes the popup', async () => {
        const { trigger } = await mountLedgerUi({ getContext, documentRef: document, notify });
        trigger.click();
        document.querySelector('[data-action="plot-settings"]').click();

        expect(PopupMock.instances).toHaveLength(1);
        const popup = PopupMock.instances[0];
        const textarea = popup.content.querySelector('[data-role="plot-json"]');
        const nextPlot = {
            summary: '更新后的剧情',
            nodes: [{ id: '1', title: '开场', description: '新的描述。' }],
        };
        textarea.value = JSON.stringify(nextPlot, null, 2);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        popup.content.querySelector('[data-action="save"]').click();

        await vi.waitFor(() => {
            expect(context.saveMetadata).toHaveBeenCalledOnce();
        });
        await vi.waitFor(() => {
            expect(popup.completeCancelled).toHaveBeenCalledOnce();
            expect(popup.completed).toBe(true);
        });
        expect(context.chatMetadata[METADATA_KEY].plot).toEqual(nextPlot);
    });

    it('treats D&D settings as a placeholder without opening a popup', async () => {
        const { trigger } = await mountLedgerUi({ getContext, documentRef: document, notify });
        trigger.click();
        document.querySelector('[data-action="dnd-settings"]').click();

        expect(document.querySelector('[data-role="ledger-menu"]')).toBeNull();
        expect(PopupMock.instances).toHaveLength(0);
        expect(notify.info).toHaveBeenCalledWith('D&D 设置尚未实现');
    });

    it('closes only the menu on outside click and Escape', async () => {
        const { trigger } = await mountLedgerUi({ getContext, documentRef: document, notify });
        trigger.click();
        expect(document.querySelector('[data-role="ledger-menu"]')).not.toBeNull();

        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(document.querySelector('[data-role="ledger-menu"]')).toBeNull();
        expect(PopupMock.instances).toHaveLength(0);

        trigger.click();
        expect(document.querySelector('[data-role="ledger-menu"]')).not.toBeNull();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(document.querySelector('[data-role="ledger-menu"]')).toBeNull();
        expect(PopupMock.instances).toHaveLength(0);
    });

    it('closes menu and active popup on CHAT_CHANGED so unsaved text cannot cross chats', async () => {
        const { trigger } = await mountLedgerUi({ getContext, documentRef: document, notify });
        trigger.click();
        document.querySelector('[data-action="plot-settings"]').click();

        const popup = PopupMock.instances[0];
        const textarea = popup.content.querySelector('[data-role="plot-json"]');
        textarea.value = '{ "unsaved": true }';

        trigger.click();
        expect(document.querySelector('[data-role="ledger-menu"]')).not.toBeNull();

        context.eventSource.emit(context.eventTypes.CHAT_CHANGED);

        await vi.waitFor(() => {
            expect(popup.completeCancelled).toHaveBeenCalledOnce();
            expect(popup.completed).toBe(true);
        });
        expect(document.querySelector('[data-role="ledger-menu"]')).toBeNull();
    });

    it('does not duplicate trigger, menu, popup, or CHAT_CHANGED subscription on remount or repeat open', async () => {
        await mountLedgerUi({ getContext, documentRef: document, notify });
        await mountLedgerUi({ getContext, documentRef: document, notify });

        expect(document.querySelectorAll('#st-fate-ledger-trigger')).toHaveLength(1);
        expect(context.eventSource.on).toHaveBeenCalledTimes(1);
        expect(context.eventSource.on).toHaveBeenCalledWith(
            context.eventTypes.CHAT_CHANGED,
            expect.any(Function),
        );

        const trigger = document.getElementById('st-fate-ledger-trigger');
        trigger.click();
        document.querySelector('[data-action="operation"]').click();
        expect(PopupMock.instances).toHaveLength(1);
        expect(PopupMock.instances[0].completed).toBe(false);

        trigger.click();
        expect(document.querySelectorAll('[data-role="ledger-menu"]')).toHaveLength(1);
        document.querySelector('[data-action="operation"]').click();
        expect(document.querySelector('[data-role="ledger-menu"]')).toBeNull();
        expect(PopupMock.instances).toHaveLength(1);
        expect(PopupMock.instances[0].show).toHaveBeenCalledOnce();
    });

    it('constructs a new Popup after native close when show() has fulfilled', async () => {
        const { trigger } = await mountLedgerUi({ getContext, documentRef: document, notify });
        trigger.click();
        document.querySelector('[data-action="operation"]').click();

        const first = PopupMock.instances[0];
        expect(first.completed).toBe(false);
        await first.completeCancelled();
        await vi.waitFor(() => {
            expect(first.completed).toBe(true);
        });

        trigger.click();
        document.querySelector('[data-action="operation"]').click();

        expect(PopupMock.instances).toHaveLength(2);
        expect(PopupMock.instances[1].show).toHaveBeenCalledOnce();
        expect(PopupMock.instances[1].completed).toBe(false);
        expect(PopupMock.instances[1].content.querySelectorAll('[data-role="plot-node"]')).toHaveLength(4);
    });
});
