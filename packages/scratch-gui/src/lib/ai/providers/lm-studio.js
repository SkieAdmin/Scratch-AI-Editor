import {DEFAULT_BASE_URLS, PROVIDER_IDS} from '../constants';
import {createOpenAiProvider} from './base-provider';

/**
 * LM Studio's local server, which serves the OpenAI-compatible surface on
 * `/v1` and needs no key.
 *
 * It rejects requests from a browser page until CORS is turned on in its server
 * settings; the base provider explains that when a request cannot be made.
 */
const lmStudioProvider = createOpenAiProvider({
    id: PROVIDER_IDS.LM_STUDIO,
    name: 'LM Studio',
    defaultBaseUrl: DEFAULT_BASE_URLS[PROVIDER_IDS.LM_STUDIO],
    requiresApiKey: false,
    supportsModelListing: true
});

export {lmStudioProvider};
