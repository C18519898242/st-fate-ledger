import { describe, expect, it, vi } from 'vitest';
import {
    advancePlotInCurrentChat,
    readPlotState,
    readStoredPlot,
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
    return { chatId: 'chat-1', chatMetadata: metadata, saveMetadata: vi.fn(async () => {}) };
}

describe('plot store', () => {
    it('refuses to save without an active chat', async () => {
        const context = makeContext();
        context.chatId = null;

        await expect(savePlotToCurrentChat(() => context, plot)).rejects.toThrow('请先打开一个聊天');
        expect(context.chatMetadata).not.toHaveProperty('st_fate_ledger');
        expect(context.saveMetadata).not.toHaveBeenCalled();
    });

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

    it('recovers a missing current id by saving the plot again', async () => {
        const context = makeContext({
            st_fate_ledger: { version: 1, plot, currentNodeId: 'missing' },
        });
        const result = await savePlotToCurrentChat(() => context, plot);
        expect(result).toMatchObject({ plot, currentNodeId: '1', currentReset: true });
        expect(readPlotState(context.chatMetadata)).toEqual({ plot, currentNodeId: '1' });
    });

    it('reads a stored plot without requiring a live current node', () => {
        const metadata = { st_fate_ledger: { version: 1, plot, currentNodeId: 'missing' } };
        expect(readStoredPlot(metadata)).toEqual({ plot });
        expect(() => readPlotState(metadata)).toThrow('当前节点不存在：missing');
    });

    it('preserves unknown sibling fields in the ledger namespace', async () => {
        const context = makeContext({
            st_fate_ledger: {
                version: 1,
                plot,
                currentNodeId: '1',
                __sentinel: 'keep-me',
            },
        });
        await advancePlotInCurrentChat(() => context);
        expect(context.chatMetadata.st_fate_ledger).toMatchObject({
            currentNodeId: '2',
            __sentinel: 'keep-me',
        });
        await savePlotToCurrentChat(() => context, plot);
        expect(context.chatMetadata.st_fate_ledger.__sentinel).toBe('keep-me');
    });
});
