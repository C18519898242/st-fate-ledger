import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const worldbookUrl = new URL('../worldbooks/DND状态演绎-MVP.json', import.meta.url);
const worldbookPath = fileURLToPath(worldbookUrl);

describe('worldbook', () => {
    it('DND status worldbook satisfies the MVP contract', () => {
        expect(existsSync(worldbookPath), 'worldbook file should exist').toBe(true);

        const worldbook = JSON.parse(readFileSync(worldbookPath, 'utf8'));
        expect(Object.keys(worldbook.entries)).toEqual(['0', '1', '2']);

        const protocol = worldbook.entries['0'];
        const paralysis = worldbook.entries['1'];
        const exhaustion = worldbook.entries['2'];

        expect(protocol.uid).toBe(0);
        expect(protocol.constant).toBe(true);
        expect(protocol.key).toEqual([]);

        expect(paralysis.uid).toBe(1);
        expect(paralysis.constant).toBe(false);
        expect(paralysis.key).toEqual(['麻痹']);

        expect(exhaustion.uid).toBe(2);
        expect(exhaustion.constant).toBe(false);
        expect(exhaustion.key).toEqual(['力竭']);

        for (const entry of [protocol, paralysis, exhaustion]) {
            expect(entry.position).toBe(1);
            expect(entry.probability).toBe(100);
            expect(entry.useProbability).toBe(true);
            expect(entry.disable).toBe(false);
            expect(entry.excludeRecursion).toBe(true);
            expect(entry.preventRecursion).toBe(true);
        }

        for (const phrase of ['最新', '当前状态', '解除状态', '唯一权威', '不替用户']) {
            expect(protocol.content).toMatch(new RegExp(phrase));
        }

        for (const phrase of ['保持清醒', '失去自主控制', '当前状态', '解除状态', '不得自行延长']) {
            expect(paralysis.content).toMatch(new RegExp(phrase));
        }

        for (const phrase of ['仍可行动', '体力', '动作', '当前状态', '解除状态', '不得自行升级']) {
            expect(exhaustion.content).toMatch(new RegExp(phrase));
        }
    });
});
