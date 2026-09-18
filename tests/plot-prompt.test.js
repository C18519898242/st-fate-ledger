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

    it('clears the prompt while a saved plot is still ready to start', async () => {
        const context = {
            chatMetadata: {
                st_fate_ledger: { version: 1, plot, phase: 'ready', currentNodeId: null },
            },
            setExtensionPrompt: vi.fn(),
        };

        await createPlotGenerateInterceptor(() => context, vi.fn())([], 8192, vi.fn(), 'normal');

        expect(context.setExtensionPrompt).toHaveBeenCalledWith('st-fate-ledger-plot', '', 1, 0, false, 0);
    });

    it('injects the summary without node 01 after the plot has started', async () => {
        const context = {
            chatMetadata: {
                st_fate_ledger: { version: 1, plot, phase: 'summary', currentNodeId: null },
            },
            setExtensionPrompt: vi.fn(),
        };

        await createPlotGenerateInterceptor(() => context, vi.fn())([], 8192, vi.fn(), 'normal');

        const prompt = context.setExtensionPrompt.mock.calls[0][1];
        expect(prompt).toContain(plot.summary);
        expect(prompt).not.toContain(plot.nodes[0].title);
        expect(prompt).not.toContain(plot.nodes[0].description);
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
