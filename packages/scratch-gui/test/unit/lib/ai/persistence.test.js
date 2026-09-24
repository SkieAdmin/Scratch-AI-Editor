import {
    defaultConfig,
    loadConfig,
    providerNeedsApiKey,
    saveConfig
} from '../../../../src/lib/ai/persistence';
import {DEFAULT_BASE_URLS, PROVIDER_IDS} from '../../../../src/lib/ai/constants';

const STORAGE_KEY = 'scratch-gui:ai-assist';

const writeRaw = value => localStorage.setItem(STORAGE_KEY, JSON.stringify({config: value}));

describe('ai persistence', () => {
    beforeEach(() => localStorage.clear());

    test('falls back to defaults when nothing is stored', () => {
        expect(loadConfig()).toEqual(defaultConfig());
    });

    test('round-trips a saved config', () => {
        const config = {
            ...defaultConfig(),
            providerId: PROVIDER_IDS.OPENROUTER,
            modelId: 'some/model',
            useBridge: true
        };
        saveConfig(config);

        expect(loadConfig()).toEqual(config);
    });

    test('round-trips API keys so the user does not retype them', () => {
        saveConfig({...defaultConfig(), apiKeys: {[PROVIDER_IDS.DEEPSEEK]: 'sk-typed'}});

        expect(loadConfig().apiKeys).toEqual({[PROVIDER_IDS.DEEPSEEK]: 'sk-typed'});
    });

    test('drops stored keys for providers that no longer exist', () => {
        writeRaw({apiKeys: {'retired-provider': 'sk-stale', [PROVIDER_IDS.OPENROUTER]: 'sk-good'}});

        expect(loadConfig().apiKeys).toEqual({[PROVIDER_IDS.OPENROUTER]: 'sk-good'});
    });

    test('ignores a stored key that is not a string', () => {
        writeRaw({apiKeys: {[PROVIDER_IDS.DEEPSEEK]: {nested: 'object'}}});

        expect(loadConfig().apiKeys).toEqual({});
    });

    test('replaces an unknown provider with the default', () => {
        writeRaw({providerId: 'some-provider-that-was-removed'});
        expect(loadConfig().providerId).toBe(defaultConfig().providerId);
    });

    test('keeps default base URLs for providers the stored config does not mention', () => {
        writeRaw({baseUrls: {[PROVIDER_IDS.OLLAMA]: 'http://192.168.1.5:11434'}});

        const loaded = loadConfig();
        expect(loaded.baseUrls[PROVIDER_IDS.OLLAMA]).toBe('http://192.168.1.5:11434');
        expect(loaded.baseUrls[PROVIDER_IDS.DEEPSEEK]).toBe(DEFAULT_BASE_URLS[PROVIDER_IDS.DEEPSEEK]);
    });

    test('reads and writes the desktop config file when the shell provides one', () => {
        const file = {};
        window.scratchAiDesktop = {
            bridgeUrl: 'ws://127.0.0.1:1/editor?token=x',
            readConfig: () => file.saved,
            writeConfig: config => {
                file.saved = config;
            }
        };

        saveConfig({...defaultConfig(), modelId: 'deepseek-chat', apiKeys: {deepseek: 'sk-file'}});

        expect(file.saved.modelId).toBe('deepseek-chat');
        expect(file.saved.apiKeys).toEqual({deepseek: 'sk-file'});
        // Nothing reaches local storage while the shell owns the settings.
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
        expect(loadConfig().modelId).toBe('deepseek-chat');

        delete window.scratchAiDesktop;
    });

    test('never stores the desktop bridge URL, whose token changes each launch', () => {
        const file = {};
        window.scratchAiDesktop = {
            bridgeUrl: 'ws://127.0.0.1:1/editor?token=x',
            readConfig: () => file.saved,
            writeConfig: config => {
                file.saved = config;
            }
        };

        saveConfig(defaultConfig());

        expect(file.saved).not.toHaveProperty('bridgeUrl');

        delete window.scratchAiDesktop;
    });

    test('survives corrupt storage', () => {
        localStorage.setItem(STORAGE_KEY, 'not json at all');
        expect(loadConfig()).toEqual(defaultConfig());
    });

    test('only the internet-facing providers need an API key', () => {
        expect(providerNeedsApiKey(PROVIDER_IDS.DEEPSEEK)).toBe(true);
        expect(providerNeedsApiKey(PROVIDER_IDS.OPENROUTER)).toBe(true);
        expect(providerNeedsApiKey(PROVIDER_IDS.OLLAMA)).toBe(false);
        expect(providerNeedsApiKey(PROVIDER_IDS.LM_STUDIO)).toBe(false);
    });
});
