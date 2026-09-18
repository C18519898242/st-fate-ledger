import { buildActorPlotContext } from './plot.js';
import { readPlotState } from './plot-store.js';

export const PLOT_PROMPT_KEY = 'st-fate-ledger-plot';

export function formatPlotPrompt(value) {
    return [
        '以下是本次生成可用的剧情信息。未来剧情未提供。',
        JSON.stringify(value, null, 2),
        '只依据已完成和当前节点演绎，不要自行假设或推进未知剧情。',
    ].join('\n');
}

export function createPlotGenerateInterceptor(getContext, notifyError) {
    return async function stFateLedgerGenerateInterceptor(_chat, _contextSize, abort, _type) {
        const context = getContext();
        try {
            const state = readPlotState(context.chatMetadata);
            if (state.plot == null || state.phase === 'ready') {
                await context.setExtensionPrompt(PLOT_PROMPT_KEY, '', 1, 0, false, 0);
                return;
            }
            await context.setExtensionPrompt(
                PLOT_PROMPT_KEY,
                formatPlotPrompt(buildActorPlotContext(state.plot, state.currentNodeId)),
                1,
                0,
                false,
                0,
            );
        } catch (error) {
            try {
                await context.setExtensionPrompt(PLOT_PROMPT_KEY, '', 1, 0, false, 0);
            } catch {
                // best-effort clear
            }
            notifyError(error.message);
            abort(true);
        }
    };
}
