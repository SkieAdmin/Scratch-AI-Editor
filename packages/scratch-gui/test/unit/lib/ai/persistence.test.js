import {
    clampWidth,
    defaultConfig,
    loadConfig,
    providerNeedsApiKey,
    saveConfig
} from '../../../../src/lib/ai/persistence';
import {
    DEFAULT_BASE_URLS,
    PANEL_MAX_WIDTH,
    PANEL_MIN_WIDTH,
    PROVIDER_IDS
} from '../../../../src/lib/ai/constants';

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
            useBridge: true,
            panelWidth: 420
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

    test('clamps a stored width that is out of range', () => {
        writeRaw({panelWidth: 99999});
        expect(loadConfig().panelWidth).toBe(PANEL_MAX_WIDTH);
    });

    test('survives corrupt storage', () => {
        localStorage.setItem(STORAGE_KEY, 'not json at all');
        expect(loadConfig()).toEqual(defaultConfig());
    });

    test('clampWidth bounds both ends', () => {
        expect(clampWidth(0)).toBe(PANEL_MIN_WIDTH);
        expect(clampWidth(100000)).toBe(PANEL_MAX_WIDTH);
        expect(clampWidth(400)).toBe(400);
    });

    test('only the internet-facing providers need an API key', () => {
        expect(providerNeedsApiKey(PROVIDER_IDS.DEEPSEEK)).toBe(true);
        expect(providerNeedsApiKey(PROVIDER_IDS.OPENROUTER)).toBe(true);
        expect(providerNeedsApiKey(PROVIDER_IDS.OLLAMA)).toBe(false);
        expect(providerNeedsApiKey(PROVIDER_IDS.LM_STUDIO)).toBe(false);
    });
});
