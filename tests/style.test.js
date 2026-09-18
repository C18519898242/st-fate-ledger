import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('plot UI stylesheet', () => {
    it('defines the required menu, scroll, and node states', async () => {
        const css = await readFile('style.css', 'utf8');
        for (const selector of [
            '.stfl-menu',
            '.stfl-operation-header',
            '.stfl-operation-footer',
            '.stfl-node-scroll',
            '[data-status="completed"]',
            '[data-status="active"]',
            '[data-status="future"]',
            '[data-action="advance"]:disabled',
            '@media (max-width:',
        ]) expect(css).toContain(selector);
    });
});
