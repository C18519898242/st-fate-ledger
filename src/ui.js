import {
    advancePlotInCurrentChat,
    readPlotState,
    readStoredPlot,
    savePlotToCurrentChat,
} from './plot-store.js';
import { createOperationView, createPlotSettingsView } from './views.js';

const TRIGGER_ID = 'st-fate-ledger-trigger';

const MENU_ITEMS = [
    { action: 'operation', label: '操作台', icon: 'fa-sliders' },
    { separator: true },
    { action: 'plot-settings', label: '剧情设置', icon: 'fa-book-open' },
    { action: 'dnd-settings', label: 'D&D 设置', icon: 'fa-dice-d20' },
];

/** @type {{ trigger: HTMLElement, closeAll: () => Promise<void>, documentRef: Document } | null} */
let mounted = null;
/** @type {{ closeAll: () => Promise<void> } | null} */
let lifecycle = null;
/** @type {WeakSet<object>} */
const subscribedEmitters = new WeakSet();

function sizePopup(popup, documentRef) {
    const chatRect = documentRef.querySelector('#sheld')?.getBoundingClientRect();
    const viewport = documentRef.defaultView ?? globalThis;
    const width = Math.round((chatRect?.width ?? viewport.innerWidth) * 0.75);
    const height = Math.round((chatRect?.height ?? viewport.innerHeight) * 0.75);
    popup.dlg.classList.add('st-fate-ledger-popup');
    popup.dlg.style.setProperty('--st-fate-ledger-width', `${width}px`);
    popup.dlg.style.setProperty('--st-fate-ledger-height', `${height}px`);
}

function createTrigger(documentRef) {
    const trigger = documentRef.createElement('div');
    trigger.id = TRIGGER_ID;
    trigger.className = 'fa-solid fa-book-open interactable';
    trigger.title = '命运账本';
    trigger.tabIndex = 0;
    trigger.setAttribute('role', 'button');
    trigger.setAttribute('aria-label', '命运账本');
    return trigger;
}

/**
 * @param {{ getContext: () => any, documentRef: Document, notify: { info: Function, error: Function } }} options
 * @returns {Promise<{ trigger: HTMLElement, closeAll: () => Promise<void> }>}
 */
export async function mountLedgerUi({ getContext, documentRef, notify }) {
    if (mounted && mounted.documentRef === documentRef && documentRef.getElementById(TRIGGER_ID)) {
        return { trigger: mounted.trigger, closeAll: mounted.closeAll };
    }

    const context = getContext();
    if (typeof context.Popup !== 'function' || context.POPUP_TYPE?.DISPLAY == null) {
        throw new Error('SillyTavern Popup API is unavailable');
    }

    const toolbar = documentRef.querySelector('#leftSendForm');
    if (!toolbar) {
        throw new Error('SillyTavern chat toolbar is unavailable');
    }

    let activePopup = null;
    let menu = null;
    let onDocClick = null;
    let onKeyDown = null;
    let advancing = false;

    const removeMenuListeners = () => {
        if (onDocClick) {
            documentRef.removeEventListener('click', onDocClick, true);
            onDocClick = null;
        }
        if (onKeyDown) {
            documentRef.removeEventListener('keydown', onKeyDown, true);
            onKeyDown = null;
        }
    };

    const closeMenu = () => {
        if (!menu) return;
        menu.remove();
        menu = null;
        removeMenuListeners();
    };

    const closeActivePopup = async () => {
        const popup = activePopup;
        activePopup = null;
        if (popup) await popup.completeCancelled();
    };

    const closeAll = async () => {
        closeMenu();
        await closeActivePopup();
    };

    // Assign synchronously; do not await show() — it resolves only when the popup completes.
    const presentContent = content => {
        if (activePopup) {
            activePopup.content.replaceChildren(content);
            sizePopup(activePopup, documentRef);
            return activePopup;
        }
        const fresh = getContext();
        const popup = new fresh.Popup(content, fresh.POPUP_TYPE.DISPLAY, '');
        sizePopup(popup, documentRef);
        activePopup = popup;
        void popup.show().finally(() => {
            if (activePopup === popup) activePopup = null;
        });
        return popup;
    };

    const openOperation = () => {
        let popup = activePopup;
        const render = () => createOperationView(
            documentRef,
            readPlotState(getContext().chatMetadata),
            async () => {
                if (advancing) return;
                advancing = true;
                try {
                    try {
                        await advancePlotInCurrentChat(getContext);
                    } catch (error) {
                        notify.error(error.message);
                        return;
                    }
                    try {
                        popup.content.replaceChildren(render());
                    } catch (error) {
                        notify.error(error.message);
                    }
                } finally {
                    advancing = false;
                }
            },
        );
        try {
            popup = presentContent(render());
        } catch (error) {
            notify.error(error.message);
        }
    };

    const openPlotSettings = () => {
        try {
            const context = getContext();
            if (typeof context.chatId !== 'string' || context.chatId.trim() === '') {
                throw new Error('请先打开一个聊天');
            }
            const { plot } = readStoredPlot(context.chatMetadata);
            const content = createPlotSettingsView(
                documentRef,
                plot,
                async plot => {
                    const saved = await savePlotToCurrentChat(getContext, plot);
                    if (saved.currentReset) {
                        notify.info('原当前节点已删除，剧情已重置为未开始');
                    }
                    await closeActivePopup();
                },
                closeActivePopup,
            );
            presentContent(content);
        } catch (error) {
            notify.error(error.message);
        }
    };

    const handleAction = async action => {
        closeMenu();
        if (action === 'operation') {
            openOperation();
            return;
        }
        if (action === 'plot-settings') {
            openPlotSettings();
            return;
        }
        if (action === 'dnd-settings') {
            notify.info('D&D 设置尚未实现');
        }
    };

    const existing = documentRef.getElementById(TRIGGER_ID);
    const trigger = existing ?? createTrigger(documentRef);
    if (!existing) toolbar.append(trigger);

    const openMenu = () => {
        closeMenu();
        menu = documentRef.createElement('div');
        menu.className = 'stfl-menu';
        menu.dataset.role = 'ledger-menu';

        for (const item of MENU_ITEMS) {
            if (item.separator) {
                const sep = documentRef.createElement('hr');
                sep.className = 'stfl-menu-separator';
                menu.append(sep);
                continue;
            }
            const button = documentRef.createElement('button');
            button.type = 'button';
            button.dataset.action = item.action;
            button.className = 'stfl-menu-item';
            const icon = documentRef.createElement('i');
            icon.className = `fa-solid ${item.icon}`;
            const label = documentRef.createElement('span');
            label.textContent = item.label;
            button.append(icon, label);
            button.addEventListener('click', event => {
                event.stopPropagation();
                void handleAction(item.action);
            });
            menu.append(button);
        }

        const rect = trigger.getBoundingClientRect();
        const viewportHeight = documentRef.defaultView?.innerHeight ?? 0;
        menu.style.position = 'fixed';
        menu.style.left = `${Math.round(rect.left)}px`;
        menu.style.bottom = `${Math.round(viewportHeight - rect.top + 4)}px`;
        documentRef.body.append(menu);

        onDocClick = event => {
            if (menu?.contains(event.target) || trigger.contains(event.target)) return;
            closeMenu();
        };
        onKeyDown = event => {
            if (event.key === 'Escape') closeMenu();
        };
        documentRef.addEventListener('click', onDocClick, true);
        documentRef.addEventListener('keydown', onKeyDown, true);
    };

    const toggleMenu = () => {
        if (menu) closeMenu();
        else openMenu();
    };

    trigger.onclick = event => {
        event.stopPropagation();
        toggleMenu();
    };
    trigger.onkeydown = event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleMenu();
        }
    };

    lifecycle = { closeAll };
    if (!subscribedEmitters.has(context.eventSource)) {
        context.eventSource.on(context.eventTypes.CHAT_CHANGED, () => {
            void lifecycle?.closeAll();
        });
        subscribedEmitters.add(context.eventSource);
    }

    mounted = { trigger, closeAll, documentRef };
    return { trigger, closeAll };
}
