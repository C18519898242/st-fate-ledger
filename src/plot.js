export class PlotValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PlotValidationError';
    }
}

function requireText(value, path) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new PlotValidationError(`${path} 必须是非空字符串`);
    }
    return value;
}

export function validatePlot(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new PlotValidationError('剧情必须是 JSON 对象');
    }
    const summary = requireText(value.summary, 'summary');
    if (!Array.isArray(value.nodes) || value.nodes.length === 0) {
        throw new PlotValidationError('nodes 至少需要一个节点');
    }
    const ids = new Set();
    const nodes = value.nodes.map((node, index) => {
        if (!node || typeof node !== 'object' || Array.isArray(node)) {
            throw new PlotValidationError(`nodes[${index}] 必须是对象`);
        }
        if (Object.hasOwn(node, 'status')) {
            throw new PlotValidationError(`nodes[${index}].status 不允许写入剧情 JSON`);
        }
        const id = requireText(node.id, `nodes[${index}].id`);
        if (ids.has(id)) throw new PlotValidationError(`节点 id 重复：${id}`);
        ids.add(id);
        return {
            id,
            title: requireText(node.title, `nodes[${index}].title`),
            description: requireText(node.description, `nodes[${index}].description`),
        };
    });
    return { summary, nodes };
}

export function parsePlotJson(text) {
    let value;
    try {
        value = JSON.parse(text);
    } catch (error) {
        throw new PlotValidationError(`JSON 语法错误：${error.message}`);
    }
    return validatePlot(value);
}

export function getCurrentNodeIndex(plot, currentNodeId) {
    const index = plot.nodes.findIndex(node => node.id === currentNodeId);
    if (index < 0) throw new PlotValidationError(`当前节点不存在：${currentNodeId ?? '未设置'}`);
    return index;
}

export function buildPlotRows(plot, currentNodeId) {
    const activeIndex = getCurrentNodeIndex(plot, currentNodeId);
    return plot.nodes.map((node, index) => ({
        ...node,
        status: index < activeIndex ? 'completed' : index === activeIndex ? 'active' : 'future',
    }));
}

export function getNextNodeId(plot, currentNodeId) {
    const index = getCurrentNodeIndex(plot, currentNodeId);
    return plot.nodes[index + 1]?.id ?? null;
}

export function buildActorPlotContext(plot, currentNodeId) {
    const activeIndex = getCurrentNodeIndex(plot, currentNodeId);
    return {
        summary: plot.summary,
        nodes: plot.nodes.slice(0, activeIndex + 1).map((node, index) => ({
            title: node.title,
            description: node.description,
            status: index === activeIndex ? 'active' : 'completed',
        })),
    };
}
