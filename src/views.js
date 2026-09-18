import { buildPlotRows, parsePlotJson } from './plot.js';

const PLOT_JSON_EXAMPLE = `{
  "summary": "王宫宴会期间，有人准备刺杀王储。",
  "nodes": [
    { "id": "1", "title": "宴会开始", "description": "玩家进入宴会厅。" }
  ]
}`;

function el(documentRef, tag, props = {}, children = []) {
    const node = documentRef.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (key === 'className') node.className = value;
        else if (key === 'textContent') node.textContent = value;
        else if (key === 'dataset') Object.assign(node.dataset, value);
        else if (key === 'disabled') node.disabled = value;
        else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
        else if (value != null) node.setAttribute(key, value);
    }
    for (const child of children) {
        if (child != null) node.append(child);
    }
    return node;
}

function scrollActiveWhenConnected(root, documentRef) {
    const run = () => {
        root.querySelector('[data-status="active"]')?.scrollIntoView?.({ block: 'nearest' });
    };
    if (root.isConnected) {
        run();
        return;
    }
    const target = documentRef.documentElement ?? documentRef;
    const observer = new MutationObserver(() => {
        if (root.isConnected) {
            observer.disconnect();
            run();
        }
    });
    observer.observe(target, { childList: true, subtree: true });
}

function createNodeArticle(documentRef, row, index) {
    const children = [
        el(documentRef, 'div', { className: 'stfl-node-index', textContent: String(index + 1).padStart(2, '0') }),
        el(documentRef, 'div', { className: 'stfl-node-main' }, [
            el(documentRef, 'div', { className: 'stfl-node-title', textContent: row.title }),
            el(documentRef, 'div', { className: 'stfl-node-description', textContent: row.description }),
        ]),
    ];
    if (row.status === 'completed') {
        children.push(el(documentRef, 'div', { className: 'stfl-node-badge', textContent: '已完成' }));
    } else if (row.status === 'active') {
        children.push(el(documentRef, 'div', { className: 'stfl-node-badge', textContent: '当前' }));
    }
    return el(documentRef, 'article', {
        className: 'stfl-node',
        dataset: { role: 'plot-node', nodeId: row.id, status: row.status },
    }, children);
}

function createOperationHeader(documentRef, progressText) {
    return el(documentRef, 'header', { className: 'stfl-operation-header' }, [
        el(documentRef, 'div', { className: 'stfl-operation-heading' }, [
            el(documentRef, 'div', { className: 'stfl-operation-title-row' }, [
                el(documentRef, 'h2', { className: 'stfl-page-header', textContent: '操作台' }),
                el(documentRef, 'div', {
                    className: 'stfl-progress-count',
                    dataset: { role: 'plot-progress' },
                    textContent: progressText,
                }),
            ]),
            el(documentRef, 'p', {
                className: 'stfl-operation-subtitle',
                textContent: '命运账本 · 当前剧情概览',
            }),
        ]),
    ]);
}

function createOperationFooter(documentRef, advance, completed) {
    const children = [];
    if (completed) {
        children.push(el(documentRef, 'div', {
            className: 'stfl-completion-note',
            dataset: { role: 'completion-note' },
            textContent: '当前已是最终剧情节点',
        }));
    }
    children.push(advance);
    return el(documentRef, 'footer', { className: 'stfl-operation-footer' }, children);
}

export function createOperationView(documentRef, state, onAdvance) {
    const { plot, currentNodeId, phase = 'node' } = state ?? {};
    const root = el(documentRef, 'section', { className: 'stfl-page stfl-operation' });

    const advance = el(documentRef, 'button', {
        type: 'button',
        dataset: { action: 'advance' },
        textContent: phase === 'ready' ? '开始剧情' : '进入下一剧情',
        onClick: async () => {
            if (advance.disabled) return;
            advance.disabled = true;
            try {
                await onAdvance?.();
            } finally {
                if (advance.isConnected) advance.disabled = false;
            }
        },
    });

    if (!plot) {
        root.append(createOperationHeader(documentRef, '未设置'));
        const content = el(documentRef, 'div', { className: 'stfl-operation-content' });
        content.append(el(documentRef, 'div', {
            className: 'stfl-operation-empty',
            textContent: '尚未设置剧情',
        }));
        advance.disabled = true;
        content.append(createOperationFooter(documentRef, advance, false));
        root.append(content);
        return root;
    }

    const rows = buildPlotRows(plot, currentNodeId);
    const activeIndex = rows.findIndex(row => row.status === 'active');
    root.append(createOperationHeader(documentRef, `${activeIndex + 1} / ${rows.length}`));
    const content = el(documentRef, 'div', { className: 'stfl-operation-content' });

    content.append(el(documentRef, 'section', { className: 'stfl-summary' }, [
        el(documentRef, 'h3', { textContent: '剧情简介' }),
        el(documentRef, 'p', { textContent: plot.summary }),
    ]));

    const scroll = el(documentRef, 'div', {
        className: 'stfl-node-scroll',
        dataset: { role: 'node-scroll' },
    }, rows.map((row, index) => createNodeArticle(documentRef, row, index)));

    content.append(el(documentRef, 'section', { className: 'stfl-flow' }, [
        el(documentRef, 'div', { className: 'stfl-flow-heading' }, [
            el(documentRef, 'h3', { textContent: '剧情流程' }),
            el(documentRef, 'span', {
                className: 'stfl-flow-hint',
                textContent: '当前节点自动保持可见',
            }),
        ]),
        scroll,
    ]));

    const completed = activeIndex >= rows.length - 1;
    if (completed) {
        advance.disabled = true;
        advance.textContent = '已到最后节点';
    }

    content.append(createOperationFooter(documentRef, advance, completed));
    root.append(content);
    scrollActiveWhenConnected(root, documentRef);
    return root;
}

export function createPlotSettingsView(documentRef, plot, onSave, onCancel) {
    const root = el(documentRef, 'section', { className: 'stfl-page stfl-settings' });
    root.append(el(documentRef, 'header', { className: 'stfl-page-header', textContent: '剧情设置' }));

    const example = el(documentRef, 'section', { className: 'stfl-json-example' }, [
        el(documentRef, 'div', { className: 'stfl-json-example-title', textContent: 'JSON 示例' }),
        el(documentRef, 'pre', {
            dataset: { role: 'plot-json-example' },
            textContent: PLOT_JSON_EXAMPLE,
        }),
    ]);

    const textarea = el(documentRef, 'textarea', {
        dataset: { role: 'plot-json' },
        spellcheck: 'false',
    });
    textarea.value = JSON.stringify(plot ?? { summary: '', nodes: [] }, null, 2);

    const validation = el(documentRef, 'div', { dataset: { role: 'validation' } });
    const save = el(documentRef, 'button', {
        type: 'button',
        dataset: { action: 'save' },
        textContent: '保存剧情',
    });
    const cancel = el(documentRef, 'button', {
        type: 'button',
        dataset: { action: 'cancel' },
        textContent: '取消',
        onClick: () => { onCancel?.(); },
    });

    let validatedPlot = null;
    let saving = false;

    const runValidation = () => {
        try {
            validatedPlot = parsePlotJson(textarea.value);
            validation.textContent = 'JSON 格式正确';
            save.disabled = saving;
        } catch (error) {
            validatedPlot = null;
            validation.textContent = error.message;
            save.disabled = true;
        }
    };

    textarea.addEventListener('input', runValidation);
    save.addEventListener('click', async () => {
        if (saving || !validatedPlot || save.disabled) return;
        saving = true;
        save.disabled = true;
        try {
            await onSave(validatedPlot);
        } catch (error) {
            validation.textContent = `保存失败：${error.message}`;
        } finally {
            saving = false;
            if (save.isConnected) save.disabled = !validatedPlot;
        }
    });

    root.append(example, textarea, validation, el(documentRef, 'div', { className: 'stfl-settings-actions' }, [cancel, save]));
    runValidation();
    return root;
}
