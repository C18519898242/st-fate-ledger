import { createPlotGenerateInterceptor } from './src/plot-prompt.js';
import { mountLedgerUi } from './src/ui.js';

const getContext = () => SillyTavern.getContext();

globalThis.stFateLedgerGenerateInterceptor = createPlotGenerateInterceptor(
    getContext,
    message => globalThis.toastr?.error(message, '命运账本'),
);

let initPromise;

export function init() {
    if (!initPromise) {
        initPromise = mountLedgerUi({
            getContext,
            documentRef: document,
            notify: globalThis.toastr ?? { info() {}, error() {} },
        }).catch(error => {
            initPromise = undefined;
            throw error;
        });
    }
    return initPromise;
}
