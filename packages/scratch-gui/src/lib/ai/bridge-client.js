import {BRIDGE_STATUS} from './constants';

const PROTOCOL_VERSION = 1;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;

/**
 * The connected client, published so the settings screen can list models
 * through the bridge without the panel having to hand its client around.
 */
let activeBridge = null;

const getActiveBridge = () => activeBridge;

const setActiveBridge = client => {
    activeBridge = client;
};

const abortError = () => {
    const error = new Error('The request was aborted.');
    error.name = 'AbortError';
    return error;
};

/**
 * Connects the editor to a local `@skieadmin/scratch-ai-bridge` process.
 *
 * The editor is the client here, not the server: a browser page cannot listen
 * on a port, so the bridge listens and the editor dials out. Once attached, the
 * bridge drives the editor -- it forwards MCP tool calls from an external AI
 * client -- and the editor asks the bridge for chat completions, so provider
 * API keys never have to reach the page.
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
        this.pending = new Map();
        this.nextRequestId = 1;
    }

    /**
     * Announce the tools the editor can run. Sent on every (re)connection.
     * @param {Array<object>} definitions the tool catalogue
     */
    setToolDefinitions (definitions) {
        this.toolDefinitions = definitions;
        if (this.isOpen()) this._sendHello();
    }

    isOpen () {
        return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
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
     * Run a chat completion on the bridge.
     *
     * Only the fields the bridge's protocol defines go on the wire; anything
     * else the caller passes stays here, so a stray property cannot be mistaken
     * for part of the request.
     * @param {object} request provider, model, messages and optional tools
     * @param {object} handlers streaming callbacks and an optional abort signal
     * @returns {Promise<object>} the completed message
     */
    chat (request, handlers = {}) {
        const {onContentDelta, onReasoningDelta, signal} = handlers;

        if (signal && signal.aborted) return Promise.reject(abortError());
        if (!this.isOpen()) {
            return Promise.reject(new Error('The Scratch AI bridge is not connected.'));
        }

        const id = String(this.nextRequestId++);
        const envelope = {
            type: 'chat',
            id,
            provider: request.provider,
            model: request.model,
            messages: request.messages
        };
        if (request.tools) envelope.tools = request.tools;
        if (request.apiKey) envelope.apiKey = request.apiKey;

        return new Promise((resolve, reject) => {
            const onAbort = () => {
                this.pending.delete(id);
                if (this.isOpen()) this._send({type: 'chat-cancel', id});
                reject(abortError());
            };
            if (signal) signal.addEventListener('abort', onAbort, {once: true});

            this.pending.set(id, {
                resolve,
                reject,
                onContentDelta,
                onReasoningDelta,
                cleanup: () => {
                    if (signal) signal.removeEventListener('abort', onAbort);
                }
            });

            this._send(envelope);
        });
    }

    /**
     * Ask the bridge which models a provider offers. The bridge holds the API
     * key, so it can list models the page has no credentials for.
     * @param {string} provider the provider to list
     * @param {string} [apiKey] the key the user entered, if this provider needs one
     * @returns {Promise<Array<object>>} the available models
     */
    listModels (provider, apiKey) {
        if (!this.isOpen()) {
            return Promise.reject(new Error('The Scratch AI bridge is not connected.'));
        }

        const id = String(this.nextRequestId++);
        return new Promise((resolve, reject) => {
            this.pending.set(id, {resolve, reject, cleanup: () => {}});
            const envelope = {type: 'models', id, provider};
            if (apiKey) envelope.apiKey = apiKey;
            this._send(envelope);
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
            this._sendHello();
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

    _sendHello () {
        this._send({type: 'hello', protocolVersion: PROTOCOL_VERSION, tools: this.toolDefinitions});
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
            this._settle(message.id, message.ok, message.result, message.error);
            break;
        case 'models-done':
            this._settle(message.id, message.ok, message.models, message.error);
            break;
        default:
            // eslint-disable-next-line no-console
            console.warn(`BridgeClient: ignoring unknown message type "${message.type}"`);
        }
    }

    /**
     * Route one streamed fragment. The bridge sends content and the model's
     * thinking as separate fields of the same delta, and they are shown
     * differently, so they are kept apart here rather than concatenated.
     * @param {object} message the `chat-delta` envelope
     */
    _handleChatDelta (message) {
        const request = this.pending.get(message.id);
        if (!request) return;

        const delta = message.delta || {};
        if (delta.content && request.onContentDelta) request.onContentDelta(delta.content);
        if (delta.reasoning && request.onReasoningDelta) request.onReasoningDelta(delta.reasoning);
    }

    _settle (id, ok, value, error) {
        const request = this.pending.get(id);
        if (!request) return;

        this.pending.delete(id);
        request.cleanup();
        if (ok) {
            request.resolve(value);
        } else {
            request.reject(new Error(error));
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
        this.pending.forEach(request => {
            request.cleanup();
            request.reject(error);
        });
        this.pending.clear();
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
