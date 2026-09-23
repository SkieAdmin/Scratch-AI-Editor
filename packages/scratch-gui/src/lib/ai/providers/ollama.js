import {DEFAULT_BASE_URLS, PROVIDER_IDS} from '../constants';
import {createOpenAiProvider, fetchProviderJson, looksLikeReasoningModel, trimTrailingSlash} from './base-provider';

const DEFAULT_BASE_URL = DEFAULT_BASE_URLS[PROVIDER_IDS.OLLAMA];

/** Identity used when reporting a failed request, before the provider is built. */
const DESCRIPTOR = {id: PROVIDER_IDS.OLLAMA, name: 'Ollama'};

/**
 * List the models Ollama has pulled.
 *
 * Chat runs through Ollama's OpenAI-compatible surface under `/v1`, but that
 * surface does not report which models this installation actually has, so the
 * listing uses the native `/api/tags` endpoint.
 * @param {object} [options] the request options
 * @param {string} [options.baseUrl] where this Ollama server lives
 * @param {AbortSignal} [options.signal] cancels the request
 * @returns {Promise<Array<object>>} the installed models
 */
const listOllamaModels = async ({baseUrl, signal} = {}) => {
    const url = `${trimTrailingSlash(baseUrl || DEFAULT_BASE_URL)}/api/tags`;
    const payload = await fetchProviderJson(DESCRIPTOR, url, {signal});
    return (payload.models ?? []).map(model => ({
        id: model.name,
        label: model.name,
        reasoning: looksLikeReasoningModel(model.name)
    }));
};

/**
 * A local Ollama server.
 *
 * It rejects requests from a browser page unless the editor's origin is listed
 * in `OLLAMA_ORIGINS`; the base provider explains that when a request cannot be
 * made.
 */
const ollamaProvider = createOpenAiProvider({
    id: DESCRIPTOR.id,
    name: DESCRIPTOR.name,
    defaultBaseUrl: DEFAULT_BASE_URL,
    requiresApiKey: false,
    supportsModelListing: true,
    chatPath: '/v1/chat/completions',
    listModels: listOllamaModels
});

export {ollamaProvider};
