/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { createOperationView, createPlotSettingsView } from '../src/views.js';

const plot = {
    summary: '王宫宴会期间，有人准备刺杀王储。',
    nodes: [
        { id: '1', title: '宴会开始', description: '玩家进入宴会厅。' },
        { id: '2', title: '识破卫队暗号', description: '门外卫队使用了错误暗号。' },
        { id: '3', title: '揭穿冒牌卫队', description: '玩家寻找证据。' },
        { id: '4', title: '逃离王宫', description: '众人护送王储撤离。' },
    ],
};

describe('createOperationView', () => {
    it('shows progress, node statuses, advance control, and never 编辑剧情', () => {
        const operation = createOperationView(document, { plot, currentNodeId: '2' }, vi.fn());
        expect(operation.querySelector('[data-role="plot-progress"]').textContent).toContain('2 / 4');
        expect([...operation.querySelectorAll('[data-role="plot-node"]')]).toHaveLength(4);
        expect(operation.querySelector('[data-node-id="1"]').dataset.status).toBe('completed');
        expect(operation.querySelector('[data-node-id="2"]').dataset.status).toBe('active');
        expect(operation.querySelector('[data-node-id="3"]').dataset.status).toBe('future');
        expect(operation.textContent).not.toContain('编辑剧情');
        expect(operation.querySelector('[data-action="advance"]')).not.toBeNull();
    });

    it('labels completed and active rows, leaves future unlabeled, and uses textContent for plot text', () => {
        const hostile = {
            summary: '<b>简介</b>',
            nodes: [
                { id: '1', title: '<i>标题</i>', description: '<img src=x onerror=alert(1)>' },
                { id: '2', title: '下一', description: '描述' },
            ],
        };
        const operation = createOperationView(document, { plot: hostile, currentNodeId: '1' }, vi.fn());
        expect(operation.querySelector('[data-node-id="1"]').textContent).toContain('当前');
        expect(operation.querySelector('[data-node-id="1"]').textContent).not.toContain('已完成');
        expect(operation.querySelector('[data-node-id="2"]').textContent).not.toContain('当前');
        expect(operation.querySelector('[data-node-id="2"]').textContent).not.toContain('已完成');
        expect(operation.querySelectorAll('b, i, img')).toHaveLength(0);
        expect(operation.textContent).toContain('<b>简介</b>');
        expect(operation.textContent).toContain('<i>标题</i>');

        const mid = createOperationView(document, { plot, currentNodeId: '2' }, vi.fn());
        expect(mid.querySelector('[data-node-id="1"]').textContent).toContain('已完成');
        expect(mid.querySelector('[data-node-id="2"]').textContent).toContain('当前');
        expect(mid.querySelector('[data-node-id="3"]').textContent).not.toContain('已完成');
        expect(mid.querySelector('[data-node-id="3"]').textContent).not.toContain('当前');
    });

    it('disables advance at the last node', () => {
        const operation = createOperationView(document, { plot, currentNodeId: '4' }, vi.fn());
        const advance = operation.querySelector('[data-action="advance"]');
        expect(advance.disabled).toBe(true);
        expect(advance.textContent).toBe('已到最后节点');
    });

    it('shows 尚未设置剧情 and a disabled advance button with no plot', () => {
        const operation = createOperationView(document, { plot: null, currentNodeId: null }, vi.fn());
        expect(operation.textContent).toContain('尚未设置剧情');
        const advance = operation.querySelector('[data-action="advance"]');
        expect(advance.disabled).toBe(true);
    });

    it('calls onAdvance when the advance button is clicked', () => {
        const onAdvance = vi.fn();
        const operation = createOperationView(document, { plot, currentNodeId: '2' }, onAdvance);
        operation.querySelector('[data-action="advance"]').click();
        expect(onAdvance).toHaveBeenCalledOnce();
    });

    it('scrolls the active node into view when the operation view is connected', async () => {
        Element.prototype.scrollIntoView = vi.fn();
        const operation = createOperationView(document, { plot, currentNodeId: '2' }, vi.fn());
        const active = operation.querySelector('[data-status="active"]');
        document.body.appendChild(operation);
        await vi.waitFor(() => {
            expect(active.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
        });
        operation.remove();
        delete Element.prototype.scrollIntoView;
    });
});

describe('createPlotSettingsView', () => {
    it('shows a valid one-node JSON example above the editor', () => {
        const view = createPlotSettingsView(document, null, vi.fn(), vi.fn());
        const example = view.querySelector('[data-role="plot-json-example"]');
        const textarea = view.querySelector('[data-role="plot-json"]');

        expect(example).not.toBeNull();
        expect(example.compareDocumentPosition(textarea) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(JSON.parse(example.textContent)).toEqual({
            summary: '王宫宴会期间，有人准备刺杀王储。',
            nodes: [
                {
                    id: '1',
                    title: '宴会开始',
                    description: '玩家进入宴会厅。',
                },
            ],
        });
    });

    it('validates JSON on input, enables save only when valid, and saves the parsed plot', async () => {
        const onSave = vi.fn(async () => {});
        const onCancel = vi.fn();
        const view = createPlotSettingsView(document, plot, onSave, onCancel);
        const textarea = view.querySelector('[data-role="plot-json"]');
        const validation = view.querySelector('[data-role="validation"]');
        const save = view.querySelector('[data-action="save"]');
        const cancel = view.querySelector('[data-action="cancel"]');

        expect(textarea.getAttribute('spellcheck')).toBe('false');
        expect(textarea.value).toBe(JSON.stringify(plot, null, 2));
        expect(save.textContent).toBe('保存剧情');
        expect(validation.textContent).toBe('JSON 格式正确');
        expect(save.disabled).toBe(false);

        textarea.value = '{';
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        expect(validation.textContent).toContain('JSON 语法错误');
        expect(save.disabled).toBe(true);

        textarea.value = JSON.stringify(plot, null, 2);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        expect(validation.textContent).toBe('JSON 格式正确');
        expect(save.disabled).toBe(false);

        save.click();
        await vi.waitFor(() => {
            expect(onSave).toHaveBeenCalledWith(plot);
        });
        expect(onSave.mock.calls[0][0]).not.toBe(textarea.value);

        cancel.click();
        expect(onCancel).toHaveBeenCalledOnce();
    });

    it('keeps the editor open and shows 保存失败 when onSave rejects', async () => {
        const onSave = vi.fn(async () => {
            throw new Error('disk full');
        });
        const view = createPlotSettingsView(document, plot, onSave, vi.fn());
        document.body.append(view);
        const textarea = view.querySelector('[data-role="plot-json"]');
        const validation = view.querySelector('[data-role="validation"]');
        const save = view.querySelector('[data-action="save"]');
        const before = textarea.value;

        save.click();
        await vi.waitFor(() => {
            expect(validation.textContent).toBe('保存失败：disk full');
        });
        expect(save.disabled).toBe(false);
        expect(textarea.value).toBe(before);
        view.remove();
    });

    it('disables save during onSave and ignores overlapping clicks', async () => {
        let release;
        const pending = new Promise(resolve => {
            release = resolve;
        });
        const onSave = vi.fn(() => pending);
        const view = createPlotSettingsView(document, plot, onSave, vi.fn());
        document.body.append(view);
        const save = view.querySelector('[data-action="save"]');

        save.click();
        await vi.waitFor(() => {
            expect(onSave).toHaveBeenCalledOnce();
        });
        expect(save.disabled).toBe(true);

        save.click();
        save.click();
        expect(onSave).toHaveBeenCalledOnce();

        release();
        await pending;
        await vi.waitFor(() => {
            expect(save.disabled).toBe(false);
        });
        expect(onSave).toHaveBeenCalledOnce();
        view.remove();
    });

    it('initializes an empty template when plot is null and disables save', () => {
        const view = createPlotSettingsView(document, null, vi.fn(), vi.fn());
        const textarea = view.querySelector('[data-role="plot-json"]');
        const save = view.querySelector('[data-action="save"]');
        expect(textarea.value).toBe(JSON.stringify({ summary: '', nodes: [] }, null, 2));
        expect(save.disabled).toBe(true);
    });
});
