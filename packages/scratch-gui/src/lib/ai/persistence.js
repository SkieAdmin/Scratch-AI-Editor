import {getLocalStorageValue, setLocalStorageValue} from '../local-storage';
import {getDesktopBridgeUrl} from './desktop';
import {
    DEFAULT_BASE_URLS,
    DEFAULT_BRIDGE_URL,
    PANEL_DEFAULT_WIDTH,
    PANEL_MAX_WIDTH,
    PANEL_MIN_WIDTH,
    PROVIDER_IDS,
    REMOTE_PROVIDER_IDS
} from './constants';

const STORAGE_KEY = 'scratch-gui:ai-assist';
const CONFIG_ID = 'config';

const isKnownProvider = providerId => Object.values(PROVIDER_IDS).includes(providerId);

const defaultConfig = () => {
    const desktopBridgeUrl = getDesktopBridgeUrl();

    return {
        providerId: PROVIDER_IDS.OLLAMA,
        modelId: '',
        baseUrls: {...DEFAULT_BASE_URLS},
        bridgeUrl: desktopBridgeUrl ?? DEFAULT_BRIDGE_URL,
        useBridge: desktopBridgeUrl !== null,
        panelWidth: PANEL_DEFAULT_WIDTH,
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

const clampWidth = width => Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, width));

/**
 * Read the persisted assistant configuration, falling back to defaults for any
 * value that is missing or no longer valid.
 * @returns {object} the configuration to initialize the reducer with
 */
const loadConfig = () => {
    const defaults = defaultConfig();
    const stored = getLocalStorageValue(STORAGE_KEY, CONFIG_ID);

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
        panelWidth: clampWidth(Number(stored.panelWidth) || defaults.panelWidth),
        apiKeys: readApiKeys(stored.apiKeys)
    };
};

/**
 * Persist the assistant configuration, including API keys.
 *
 * Keys are stored in this browser profile's local storage so the user does not
 * have to retype them. That storage is readable by any script running on this
 * origin, so the settings screen says as much and offers the bridge, which
 * keeps keys in a separate process, as the safer option.
 * @param {object} config the configuration to persist
 */
const saveConfig = config => {
    setLocalStorageValue(STORAGE_KEY, CONFIG_ID, {
        providerId: config.providerId,
        modelId: config.modelId,
        baseUrls: config.baseUrls,
        bridgeUrl: config.bridgeUrl,
        useBridge: config.useBridge,
        panelWidth: config.panelWidth,
        apiKeys: config.apiKeys
    });
};

/**
 * Whether the given provider authenticates with an API key.
 * @param {string} providerId the provider to check
 * @returns {boolean} true if the provider needs an API key
 */
const providerNeedsApiKey = providerId => REMOTE_PROVIDER_IDS.includes(providerId);

export {
    clampWidth,
    defaultConfig,
    loadConfig,
    providerNeedsApiKey,
    saveConfig
};
