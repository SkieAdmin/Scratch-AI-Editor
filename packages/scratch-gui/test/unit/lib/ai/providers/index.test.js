import {PROVIDER_IDS} from '../../../../../src/lib/ai/constants';
import {getAllProviders, getProvider} from '../../../../../src/lib/ai/providers';

describe('AI provider registry', () => {
    test('has a provider for every id, with the full interface', () => {
        for (const providerId of Object.values(PROVIDER_IDS)) {
            const provider = getProvider(providerId);
            expect(provider.id).toBe(providerId);
            expect(typeof provider.name).toBe('string');
            expect(typeof provider.requiresApiKey).toBe('boolean');
            expect(typeof provider.supportsModelListing).toBe('boolean');
            expect(typeof provider.listModels).toBe('function');
            expect(typeof provider.chat).toBe('function');
        }
    });

    test('lists the providers in presentation order', () => {
        expect(getAllProviders().map(provider => provider.id)).toEqual([
            PROVIDER_IDS.DEEPSEEK,
            PROVIDER_IDS.OPENROUTER,
            PROVIDER_IDS.LM_STUDIO,
            PROVIDER_IDS.OLLAMA
        ]);
    });

    test('names the unknown provider it was asked for', () => {
        expect(() => getProvider('gpt5')).toThrow('No AI provider is registered for "gpt5".');
    });
});
