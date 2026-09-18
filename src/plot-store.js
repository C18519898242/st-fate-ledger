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
        return { plot: null, phase: 'ready', currentNodeId: null };
    }
    const plot = validatePlot(ledger.plot);
    if (ledger.phase === 'ready' || ledger.phase === 'summary') {
        return { plot, phase: ledger.phase, currentNodeId: null };
    }
    getCurrentNodeIndex(plot, ledger.currentNodeId);
    return { plot, phase: 'node', currentNodeId: ledger.currentNodeId };
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
    const previousPhase = previous?.phase ?? (previous == null ? null : 'node');
    const keepPreNodePhase = previousPhase === 'ready' || previousPhase === 'summary';
    const phase = keepPreNodePhase ? previousPhase : keepPrevious ? 'node' : 'ready';
    const currentNodeId = phase === 'node' ? previousId : null;
    const currentReset = previous != null && !keepPreNodePhase && !keepPrevious;
    await persist(context, { version: 1, plot, phase, currentNodeId });
    return { plot, phase, currentNodeId, currentReset };
}

async function persistAndSendSystemMessage(context, plotFields, text) {
    const sendSystemMessage = context.SlashCommandParser?.commands?.sys?.callback;
    if (typeof sendSystemMessage !== 'function') {
        throw new Error('SillyTavern /sys 命令不可用');
    }
    const previous = structuredClone(context.chatMetadata[METADATA_KEY]);
    await persist(context, plotFields);
    try {
        await sendSystemMessage({}, text);
    } catch (error) {
        context.chatMetadata[METADATA_KEY] = previous;
        await context.saveMetadata();
        throw error;
    }
}

export async function advancePlotInCurrentChat(getContext) {
    const context = getContext();
    requireActiveChat(context);
    const { plot, phase, currentNodeId } = readPlotState(context.chatMetadata);
    if (plot == null) {
        throw new PlotValidationError('当前聊天尚未保存剧情');
    }
    if (phase === 'ready') {
        await persistAndSendSystemMessage(
            context,
            { version: 1, plot, phase: 'summary', currentNodeId: null },
            plot.summary,
        );
        return { plot, phase: 'summary', currentNodeId: null, isLast: false };
    }
    const nextId = getNextNodeId(plot, currentNodeId);
    if (nextId == null) {
        return { plot, phase, currentNodeId, isLast: true };
    }
    const nextNode = plot.nodes.find(node => node.id === nextId);
    await persistAndSendSystemMessage(
        context,
        { version: 1, plot, phase: 'node', currentNodeId: nextId },
        nextNode.description,
    );
    return {
        plot,
        phase: 'node',
        currentNodeId: nextId,
        isLast: getNextNodeId(plot, nextId) == null,
    };
}
