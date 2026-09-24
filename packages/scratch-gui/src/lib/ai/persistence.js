import {getLocalStorageValue, setLocalStorageValue} from '../local-storage';
import {getDesktopBridgeUrl, getDesktopConfigStore} from './desktop';
import {
    DEFAULT_BASE_URLS,
    DEFAULT_BRIDGE_URL,
    DEFAULT_MAX_TOOL_ROUNDS,
    MAX_TOOL_ROUNDS,
    MIN_TOOL_ROUNDS,
    PROVIDER_IDS,
    REMOTE_PROVIDER_IDS
} from './constants';

const STORAGE_KEY = 'scratch-gui:ai-assist';
const CONFIG_ID = 'config';

const clampRounds = rounds => Math.min(MAX_TOOL_ROUNDS, Math.max(MIN_TOOL_ROUNDS, Math.round(rounds)));

const isKnownProvider = providerId => Object.values(PROVIDER_IDS).includes(providerId);

const defaultConfig = () => {
    const desktopBridgeUrl = getDesktopBridgeUrl();

    return {
        providerId: PROVIDER_IDS.OLLAMA,
        modelId: '',
        baseUrls: {...DEFAULT_BASE_URLS},
        bridgeUrl: desktopBridgeUrl ?? DEFAULT_BRIDGE_URL,
        useBridge: desktopBridgeUrl !== null,
        maxToolRounds: DEFAULT_MAX_TOOL_ROUNDS,
        apiKeys: {}
    };
};

/**
 * Keep only string keys for providers that exist, so a hand-edited or stale
 * storage entry cannot put junk into a request header.
 * @param {*} stored whatever was in storage
 * @returns {object} provider id to key
 */
const readApiKeys = stored => {
    if (!stored || typeof stored !== 'object') return {};

    return Object.fromEntries(
        Object.entries(stored).filter(
            ([providerId, key]) => isKnownProvider(providerId) && typeof key === 'string' && key !== ''
        )
    );
};

/**
 * Read the persisted assistant configuration, falling back to defaults for any
 * value that is missing or no longer valid.
 * @returns {object} the configuration to initialize the reducer with
 */
/**
 * Read whatever was stored last time, from wherever this build keeps it.
 * @returns {?object} the stored settings, or null when there are none
 */
const readStored = () => {
    const store = getDesktopConfigStore();
    if (store) return store.readConfig();

    return getLocalStorageValue(STORAGE_KEY, CONFIG_ID);
};

const loadConfig = () => {
    const defaults = defaultConfig();
    const stored = readStored();

    if (!stored || typeof stored !== 'object') return defaults;

    // The desktop shell picks a fresh port and token every launch, so its bridge
    // URL overrides a stored one instead of merging with it.
    const desktopBridgeUrl = getDesktopBridgeUrl();

    return {
        providerId: isKnownProvider(stored.providerId) ? stored.providerId : defaults.providerId,
        modelId: typeof stored.modelId === 'string' ? stored.modelId : defaults.modelId,
        baseUrls: {...defaults.baseUrls, ...(stored.baseUrls || {})},
        bridgeUrl: desktopBridgeUrl ?? (typeof stored.bridgeUrl === 'string' ? stored.bridgeUrl : defaults.bridgeUrl),
        useBridge: desktopBridgeUrl === null ? Boolean(stored.useBridge) : true,
        maxToolRounds: clampRounds(Number(stored.maxToolRounds) || DEFAULT_MAX_TOOL_ROUNDS),
        apiKeys: readApiKeys(stored.apiKeys)
    };
};

/**
 * Persist the assistant configuration, including API keys.
 *
 * The desktop build writes `Documents/Scratch3_Config.json`, which the user can
 * open, back up and edit. A browser has no such place, so it falls back to
 * local storage for this origin.
 * @param {object} config the configuration to persist
 */
const saveConfig = config => {
    const stored = {
        providerId: config.providerId,
        modelId: config.modelId,
        baseUrls: config.baseUrls,
        useBridge: config.useBridge,
        maxToolRounds: config.maxToolRounds,
        apiKeys: config.apiKeys
    };

    const store = getDesktopConfigStore();
    if (store) {
        // The desktop bridge URL carries a token that changes every launch, so
        // it is never written; the shell supplies a fresh one each time.
        store.writeConfig(stored);
        return;
    }

    setLocalStorageValue(STORAGE_KEY, CONFIG_ID, {...stored, bridgeUrl: config.bridgeUrl});
};

/**
 * Whether the given provider authenticates with an API key.
 * @param {string} providerId the provider to check
 * @returns {boolean} true if the provider needs an API key
 */
const providerNeedsApiKey = providerId => REMOTE_PROVIDER_IDS.includes(providerId);

export {
    clampRounds,
    defaultConfig,
    loadConfig,
    providerNeedsApiKey,
    saveConfig
};
