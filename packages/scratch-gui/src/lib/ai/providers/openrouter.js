import {DEFAULT_BASE_URLS, PROVIDER_IDS} from '../constants';
import {createOpenAiProvider, looksLikeReasoningModel} from './base-provider';

/** What OpenRouter shows as the source of the request in its dashboards. */
const APP_TITLE = 'Scratch AI Editor';

/**
 * Whether an entry from `GET /models` describes a model that can reason.
 * @param {object} entry one model from the listing
 * @returns {boolean} true if the model exposes reasoning
 */
const entrySupportsReasoning = entry =>
    (entry.supported_parameters ?? []).includes('reasoning') ||
    (entry.supported_parameters ?? []).includes('include_reasoning') ||
    looksLikeReasoningModel(entry.id);

/**
 * OpenRouter, a hosted gateway in front of many models.
 *
 * `HTTP-Referer` and `X-Title` are how OpenRouter attributes traffic to an app;
 * they are optional to the API but expected of a well-behaved client.
 */
const openrouterProvider = createOpenAiProvider({
    id: PROVIDER_IDS.OPENROUTER,
    name: 'OpenRouter',
    defaultBaseUrl: DEFAULT_BASE_URLS[PROVIDER_IDS.OPENROUTER],
    requiresApiKey: true,
    supportsModelListing: true,
    supportsStreamUsage: true,
    buildHeaders: ({apiKey}) => {
        const headers = {
            'HTTP-Referer': window.location.origin,
            'X-Title': APP_TITLE
        };
        // The catalogue is public, so a listing without a key still works.
        if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
        return headers;
    },
    mapModel: entry => ({
        id: entry.id,
        label: entry.name || entry.id,
        reasoning: entrySupportsReasoning(entry)
    })
});

export {openrouterProvider};
