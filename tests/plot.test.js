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
