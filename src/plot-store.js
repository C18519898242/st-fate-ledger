import {
    PlotValidationError,
    getCurrentNodeIndex,
    getNextNodeId,
    validatePlot,
} from './plot.js';

export const METADATA_KEY = 'st_fate_ledger';

function requireActiveChat(context) {
    if (typeof context.chatId !== 'string' || context.chatId.trim() === '') {
        throw new PlotValidationError('请先打开一个聊天');
    }
}

function getLedger(metadata) {
    if (!Object.hasOwn(metadata, METADATA_KEY)) {
        return null;
    }
    const ledger = metadata[METADATA_KEY];
    if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger) || ledger.version !== 1) {
        throw new PlotValidationError('st_fate_ledger.version 必须为 1');
    }
    return ledger;
}

export function readStoredPlot(metadata) {
    const ledger = getLedger(metadata);
    if (ledger == null) {
        return { plot: null };
    }
    return { plot: validatePlot(ledger.plot) };
}

export function readPlotState(metadata) {
    const ledger = getLedger(metadata);
    if (ledger == null) {
        return { plot: null, currentNodeId: null };
    }
    const plot = validatePlot(ledger.plot);
    getCurrentNodeIndex(plot, ledger.currentNodeId);
    return { plot, currentNodeId: ledger.currentNodeId };
}

async function persist(context, plotFields) {
    const metadata = context.chatMetadata;
    const hadPrevious = Object.hasOwn(metadata, METADATA_KEY);
    const previous = hadPrevious ? structuredClone(metadata[METADATA_KEY]) : undefined;
    const siblings = previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {};
    metadata[METADATA_KEY] = { ...siblings, ...plotFields };
    try {
        await context.saveMetadata();
    } catch (error) {
        if (hadPrevious) metadata[METADATA_KEY] = previous;
        else delete metadata[METADATA_KEY];
        throw error;
    }
}

export async function savePlotToCurrentChat(getContext, plotInput) {
    const context = getContext();
    requireActiveChat(context);
    const plot = validatePlot(plotInput);
    const previous = getLedger(context.chatMetadata);
    const previousId = typeof previous?.currentNodeId === 'string' && previous.currentNodeId.trim() !== ''
        ? previous.currentNodeId
        : null;
    const keepPrevious = previousId != null && plot.nodes.some(node => node.id === previousId);
    const currentNodeId = keepPrevious ? previousId : plot.nodes[0].id;
    const currentReset = previous != null && !keepPrevious;
    await persist(context, { version: 1, plot, currentNodeId });
    return { plot, currentNodeId, currentReset };
}

export async function advancePlotInCurrentChat(getContext) {
    const context = getContext();
    requireActiveChat(context);
    const { plot, currentNodeId } = readPlotState(context.chatMetadata);
    if (plot == null) {
        throw new PlotValidationError('当前聊天尚未保存剧情');
    }
    const nextId = getNextNodeId(plot, currentNodeId);
    if (nextId == null) {
        return { plot, currentNodeId, isLast: true };
    }
    await persist(context, { version: 1, plot, currentNodeId: nextId });
    return {
        plot,
        currentNodeId: nextId,
        isLast: getNextNodeId(plot, nextId) == null,
    };
}
