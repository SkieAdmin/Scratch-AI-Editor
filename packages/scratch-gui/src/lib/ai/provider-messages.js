import {defineMessages} from 'react-intl';

import {PROVIDER_IDS} from './constants';

/**
 * Display names for the AI providers, keyed by provider id.
 *
 * These live here rather than beside each provider so the panel header and the
 * settings picker name a provider the same way, from one set of message ids.
 */
const providerMessages = defineMessages({
    [PROVIDER_IDS.DEEPSEEK]: {
        id: 'gui.aiAssist.provider.deepseek',
        defaultMessage: 'DeepSeek',
        description: 'Display name for the DeepSeek AI provider'
    },
    [PROVIDER_IDS.OPENROUTER]: {
        id: 'gui.aiAssist.provider.openrouter',
        defaultMessage: 'OpenRouter',
        description: 'Display name for the OpenRouter AI provider'
    },
    [PROVIDER_IDS.LM_STUDIO]: {
        id: 'gui.aiAssist.provider.lmStudio',
        defaultMessage: 'LM Studio',
        description: 'Display name for the LM Studio AI provider'
    },
    [PROVIDER_IDS.OLLAMA]: {
        id: 'gui.aiAssist.provider.ollama',
        defaultMessage: 'Ollama',
        description: 'Display name for the Ollama AI provider'
    }
});

export {providerMessages};
