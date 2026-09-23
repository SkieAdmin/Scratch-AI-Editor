import {BRIDGE_STATUS} from './constants';

const PROTOCOL_VERSION = 1;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;

/**
 * The single client the AI panel currently has open, so the settings modal can
 * reach the same connection. Only the panel opens a bridge, and only one may be
 * attached, so a module-level reference is the whole registry that is needed.
 */
let activeBridge = null;

/**
 * The bridge client the AI panel currently has open.
 * @returns {?BridgeClient} the open client, or null when the bridge is off
 */
const getActiveBridge = () => activeBridge;

/**
 * Publish the client the AI panel just opened, or clear it on disconnect.
 * @param {?BridgeClient} client the open client, or null
 */
const setActiveBridge = client => {
    activeBridge = client;
};

/**
 * Build the rejection used when the caller aborts a request.
 *
 * Callers tell a cancellation from a failure by the `AbortError` name, the same
 * way `fetch` reports one, so the browser-direct and bridge transports behave
 * alike.
 * @returns {Error} an error named `AbortError`
 */
const createAbortError = () => {
    const error = new Error('The chat request was aborted.');
    error.name = 'AbortError';
    return error;
};

/**
 * Connects the editor to a local `@skieadmin/scratch-ai-bridge` process.
 *
 * The editor is the client here, not the server: a browser page cannot listen on
 * a port, so the bridge listens and the editor dials out. Once attached, the
 * bridge drives the editor -- it forwards MCP tool calls from an external AI
 * client, and the editor executes them against the VM and answers.
 */
class BridgeClient {
    constructor ({url, onStatusChange, onToolInvoke}) {
        this.url = url;
        this.onStatusChange = onStatusChange;
        this.onToolInvoke = onToolInvoke;

        this.socket = null;
        this.toolDefinitions = [];
        this.reconnectAttempts = 0;
        this.reconnectTimer = null;
        this.shouldReconnect = false;
        this.pendingChats = new Map();
        this.pendingModels = new Map();
        this.nextRequestId = 1;
    }

    /**
     * Announce the tools the editor can run. Sent on every (re)connection.
     * @param {Array<object>} definitions the tool catalogue
     */
    setToolDefinitions (definitions) {
        this.toolDefinitions = definitions;
        if (this._isOpen()) {
            this._send({type: 'hello', protocolVersion: PROTOCOL_VERSION, tools: this.toolDefinitions});
        }
    }

    connect () {
        this.shouldReconnect = true;
        this._openSocket();
    }

    disconnect () {
        this.shouldReconnect = false;
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
        this._setStatus(BRIDGE_STATUS.DISABLED);
    }

    /**
     * Run a chat completion through the bridge so the API key never reaches the
     * browser.
     *
     * The envelope is built field by field rather than spread from `request`,
     * because a field the bridge does not recognise would be dropped silently on
     * the far side.
     * @param {object} request the completion to run
     * @param {string} request.provider the provider id the bridge holds a key for
     * @param {string} request.model the model to run
     * @param {Array<object>} request.messages the conversation so far
     * @param {Array<object>} [request.tools] the tools the model may call
     * @param {number} [request.temperature] sampling temperature
     * @param {number} [request.maxTokens] cap on the reply length
     * @param {object} [callbacks] how to report progress and cancellation
     * @param {function(string): void} [callbacks.onContentDelta] called with each piece of the answer
     * @param {function(string): void} [callbacks.onReasoningDelta] called with each piece of the reasoning
     * @param {AbortSignal} [callbacks.signal] cancels the request, in the editor and on the bridge
     * @returns {Promise<object>} the completed reply
     */
    chat (request, {onContentDelta, onReasoningDelta, signal} = {}) {
        if (!this._isOpen()) {
            return Promise.reject(new Error('The Scratch AI bridge is not connected.'));
        }
        if (signal && signal.aborted) return Promise.reject(createAbortError());

        const id = String(this.nextRequestId++);
        const envelope = {
            type: 'chat',
            id,
            provider: request.provider,
            model: request.model,
            messages: request.messages
        };
        if (request.tools && request.tools.length > 0) envelope.tools = request.tools;
        if (typeof request.temperature !== 'undefined') envelope.temperature = request.temperature;
        if (typeof request.maxTokens !== 'undefined') envelope.maxTokens = request.maxTokens;

        return new Promise((resolve, reject) => {
            const pending = {resolve, reject, onContentDelta, onReasoningDelta, detach: () => {}};

            if (signal) {
                const handleAbort = () => {
                    this.pendingChats.delete(id);
                    // Tell the bridge to stop the provider request, so an
                    // abandoned turn stops costing tokens.
                    if (this._isOpen()) this._send({type: 'chat-cancel', id});
                    reject(createAbortError());
                };
                signal.addEventListener('abort', handleAbort);
                pending.detach = () => signal.removeEventListener('abort', handleAbort);
            }

            this.pendingChats.set(id, pending);
            this._send(envelope);
        });
    }

    /**
     * Ask the bridge which models a provider offers, so a provider whose key
     * lives on the bridge can still be listed.
     * @param {string} provider the provider id to ask about
     * @returns {Promise<Array<object>>} the models, as `{id, label}`
     */
    listModels (provider) {
        if (!this._isOpen()) {
            return Promise.reject(new Error('The Scratch AI bridge is not connected.'));
        }
        const id = String(this.nextRequestId++);
        return new Promise((resolve, reject) => {
            this.pendingModels.set(id, {resolve, reject});
            this._send({type: 'models', id, provider});
        });
    }

    _openSocket () {
        clearTimeout(this.reconnectTimer);
        this._setStatus(BRIDGE_STATUS.CONNECTING);

        let socket;
        try {
            socket = new WebSocket(this.url);
        } catch (e) {
            // An unparseable URL throws synchronously rather than firing onerror.
            this._setStatus(BRIDGE_STATUS.ERROR, e.message);
            return;
        }
        this.socket = socket;

        socket.addEventListener('open', () => {
            this.reconnectAttempts = 0;
            this._setStatus(BRIDGE_STATUS.CONNECTED);
            this._send({type: 'hello', protocolVersion: PROTOCOL_VERSION, tools: this.toolDefinitions});
        });

        socket.addEventListener('message', event => this._handleMessage(event));

        socket.addEventListener('close', event => {
            this._rejectPending(new Error('The bridge connection closed.'));
            if (this.shouldReconnect) {
                this._setStatus(BRIDGE_STATUS.DISCONNECTED, event.reason);
                this._scheduleReconnect();
            } else {
                this._setStatus(BRIDGE_STATUS.DISABLED);
            }
        });

        socket.addEventListener('error', () => {
            // The close handler runs next and owns reconnection; this only
            // distinguishes a failed connection from a clean shutdown.
            this._setStatus(BRIDGE_STATUS.ERROR);
        });
    }

    _scheduleReconnect () {
        const delay = Math.min(
            RECONNECT_MAX_DELAY_MS,
            RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts)
        );
        this.reconnectAttempts++;
        this.reconnectTimer = setTimeout(() => this._openSocket(), delay);
    }

    async _handleMessage (event) {
        let message;
        try {
            message = JSON.parse(event.data);
        } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('BridgeClient: discarding unparseable message from bridge', event.data);
            return;
        }

        switch (message.type) {
        case 'ping':
            this._send({type: 'pong'});
            break;
        case 'invoke':
            await this._handleInvoke(message);
            break;
        case 'chat-delta':
            this._handleChatDelta(message);
            break;
        case 'chat-done':
            this._settle(this.pendingChats, message, message.result);
            break;
        case 'models-done':
            this._settle(this.pendingModels, message, message.models);
            break;
        default:
            // eslint-disable-next-line no-console
            console.warn(`BridgeClient: ignoring unknown message type "${message.type}"`);
        }
    }

    /**
     * Route one streamed fragment to the callback for the kind of text it holds.
     *
     * The bridge sends a whole `ChatDelta` object, not a string: a reasoning
     * model interleaves its chain of thought with its answer, and the two are
     * rendered differently.
     * @param {object} message the `chat-delta` envelope
     */
    _handleChatDelta (message) {
        const pending = this.pendingChats.get(message.id);
        if (!pending) return;

        const delta = message.delta;
        if (delta.content && pending.onContentDelta) pending.onContentDelta(delta.content);
        if (delta.reasoning && pending.onReasoningDelta) pending.onReasoningDelta(delta.reasoning);
    }

    /**
     * Finish the request a `*-done` envelope answers.
     * @param {Map<string, object>} pendingRequests the requests of that kind still waiting
     * @param {object} message the envelope, carrying `id` and `ok`
     * @param {*} value what to resolve with when the bridge succeeded
     */
    _settle (pendingRequests, message, value) {
        const pending = pendingRequests.get(message.id);
        if (!pending) return;

        pendingRequests.delete(message.id);
        if (pending.detach) pending.detach();

        if (message.ok) {
            pending.resolve(value);
        } else {
            pending.reject(new Error(message.error));
        }
    }

    async _handleInvoke (message) {
        const startedAt = Date.now();
        try {
            const result = await this.onToolInvoke(message.name, message.args);
            this._send({
                type: 'result',
                id: message.id,
                ok: true,
                result,
                durationMs: Date.now() - startedAt
            });
        } catch (e) {
            this._send({
                type: 'result',
                id: message.id,
                ok: false,
                error: e.message,
                durationMs: Date.now() - startedAt
            });
        }
    }

    _rejectPending (error) {
        [this.pendingChats, this.pendingModels].forEach(pendingRequests => {
            pendingRequests.forEach(pending => {
                if (pending.detach) pending.detach();
                pending.reject(error);
            });
            pendingRequests.clear();
        });
    }

    _isOpen () {
        return Boolean(this.socket) && this.socket.readyState === WebSocket.OPEN;
    }

    _send (payload) {
        this.socket.send(JSON.stringify(payload));
    }

    _setStatus (status, detail) {
        this.onStatusChange(status, detail);
    }
}

export default BridgeClient;
export {getActiveBridge, setActiveBridge};
