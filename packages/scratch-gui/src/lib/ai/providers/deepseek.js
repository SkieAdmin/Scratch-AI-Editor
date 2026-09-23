import {DEEPSEEK_MODELS, DEFAULT_BASE_URLS, PROVIDER_IDS} from '../constants';
import {createOpenAiProvider} from './base-provider';

/**
 * DeepSeek's hosted API, which is OpenAI-compatible.
 *
 * There is no model-listing call worth making here: the two published aliases
 * always point at the current generation, so the static pair keeps "the latest
 * DeepSeek, chat or reasoning" working without naming a dated version.
 *
 * `deepseek-reasoner` streams its thinking as `reasoning_content`, which the
 * base provider routes to `onReasoningDelta` and keeps out of later requests.
 */
const deepseekProvider = createOpenAiProvider({
    id: PROVIDER_IDS.DEEPSEEK,
    name: 'DeepSeek',
    defaultBaseUrl: DEFAULT_BASE_URLS[PROVIDER_IDS.DEEPSEEK],
    requiresApiKey: true,
    supportsModelListing: false,
    supportsStreamUsage: true,
    buildHeaders: ({apiKey}) => (apiKey ? {Authorization: `Bearer ${apiKey}`} : {}),
    listModels: () => Promise.resolve(DEEPSEEK_MODELS)
});

export {deepseekProvider};
