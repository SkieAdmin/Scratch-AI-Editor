/**
 * Shared identifiers and defaults for the AI assistant.
 */

/** Identifiers for the supported AI providers. */
const PROVIDER_IDS = {
    DEEPSEEK: 'deepseek',
    OPENROUTER: 'openrouter',
    LM_STUDIO: 'lmstudio',
    OLLAMA: 'ollama'
};

/**
 * Providers whose endpoints are reachable over the public internet and therefore
 * require an API key. Keys for these providers are only ever sent to the bridge,
 * never stored in the browser.
 */
const REMOTE_PROVIDER_IDS = [PROVIDER_IDS.DEEPSEEK, PROVIDER_IDS.OPENROUTER];

/** Default base URLs, used when the user has not overridden them in settings. */
const DEFAULT_BASE_URLS = {
    [PROVIDER_IDS.DEEPSEEK]: 'https://api.deepseek.com',
    [PROVIDER_IDS.OPENROUTER]: 'https://openrouter.ai/api/v1',
    [PROVIDER_IDS.LM_STUDIO]: 'http://127.0.0.1:1234/v1',
    [PROVIDER_IDS.OLLAMA]: 'http://127.0.0.1:11434'
};

/**
 * DeepSeek does not expose a model-listing endpoint that distinguishes reasoning
 * models, so its two modes are enumerated here. `deepseek-chat` and
 * `deepseek-reasoner` are stable aliases that always point at the current
 * generation, so this list does not go stale when a new version ships.
 */
const DEEPSEEK_MODELS = [
    {id: 'deepseek-chat', label: 'deepseek-chat', reasoning: false},
    {id: 'deepseek-reasoner', label: 'deepseek-reasoner', reasoning: true}
];

/** Where the bridge process listens by default. */
const DEFAULT_BRIDGE_URL = 'ws://127.0.0.1:8610/editor';

/** Connection states reported by the bridge client. */
const BRIDGE_STATUS = {
    DISABLED: 'disabled',
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    DISCONNECTED: 'disconnected',
    ERROR: 'error'
};

/**
 * How wide the assistant panel is, in pixels. Keep in sync with
 * `$ai-assist-panel-width` in css/units.css.
 */
const PANEL_WIDTH = 380;

export {
    BRIDGE_STATUS,
    DEEPSEEK_MODELS,
    DEFAULT_BASE_URLS,
    DEFAULT_BRIDGE_URL,
    PANEL_WIDTH,
    PROVIDER_IDS,
    REMOTE_PROVIDER_IDS
};
