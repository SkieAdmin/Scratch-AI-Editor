import {PROVIDER_IDS} from '../constants';
import {deepseekProvider} from './deepseek';
import {lmStudioProvider} from './lm-studio';
import {ollamaProvider} from './ollama';
import {openrouterProvider} from './openrouter';

/**
 * The providers the editor can talk to directly from the browser, in the order
 * they are offered in the settings.
 */
const PROVIDERS = {
    [PROVIDER_IDS.DEEPSEEK]: deepseekProvider,
    [PROVIDER_IDS.OPENROUTER]: openrouterProvider,
    [PROVIDER_IDS.LM_STUDIO]: lmStudioProvider,
    [PROVIDER_IDS.OLLAMA]: ollamaProvider
};

/**
 * Look up a provider by its identifier.
 * @param {string} providerId one of `PROVIDER_IDS`
 * @returns {object} the provider
 */
const getProvider = providerId => {
    const provider = PROVIDERS[providerId];
    if (!provider) throw new Error(`No AI provider is registered for "${providerId}".`);
    return provider;
};

/**
 * Every provider, for building the provider picker.
 * @returns {Array<object>} the providers in presentation order
 */
const getAllProviders = () => Object.values(PROVIDERS);

export {
    getAllProviders,
    getProvider
};
