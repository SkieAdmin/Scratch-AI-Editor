import {BRIDGE_STATUS} from './constants';

const PROTOCOL_VERSION = 1;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;

/**
 * Connects the editor to a local `@skieadmin/scratch-ai-bridge` process.
 *
 * The editor is the client here, not the server: a browser page cannot listen on
 * a port, so the bridge listens and the editor dials out. Once attached, the
 * bridge drives the editor -- it forwards MCP tool calls from an external AI
 * client, and the editor executes them against the VM and answers.
 */
class BridgeClient {
    constructor ({url, onStatusChange, onToolInvoke, onChatDelta}) {
        this.url = url;
        this.onStatusChange = onStatusChange;
        this.onToolInvoke = onToolInvoke;
        this.onChatDelta = onChatDelta;

        this.socket = null;
        this.toolDefinitions = [];
        this.reconnectAttempts = 0;
        this.reconnectTimer = null;
        this.shouldReconnect = false;
        this.pendingChats = new Map();
        this.nextRequestId = 1;
    }

    /**
     * Announce the tools the editor can run. Sent on every (re)connection.
     * @param {Array<object>} definitions the tool catalogue
     */
    setToolDefinitions (definitions) {
        this.toolDefinitions = definitions;
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
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
     * @param {object} request provider, model, messages and tools
     * @param {Function} onDelta called with each streamed fragment
     * @returns {Promise<object>} the completed message
     */
    chat (request, onDelta) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            return Promise.reject(new Error('The Scratch AI bridge is not connected.'));
        }
        const id = String(this.nextRequestId++);
        return new Promise((resolve, reject) => {
            this.pendingChats.set(id, {resolve, reject, onDelta});
            this._send({type: 'chat', id, ...request});
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
            this._rejectPendingChats(new Error('The bridge connection closed.'));
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
        case 'chat-delta': {
            const pending = this.pendingChats.get(message.id);
            if (pending) pending.onDelta(message.delta);
            break;
        }
        case 'chat-done': {
            const pending = this.pendingChats.get(message.id);
            if (pending) {
                this.pendingChats.delete(message.id);
                if (message.ok) {
                    pending.resolve(message.result);
                } else {
                    pending.reject(new Error(message.error));
                }
            }
            break;
        }
        default:
            // eslint-disable-next-line no-console
            console.warn(`BridgeClient: ignoring unknown message type "${message.type}"`);
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

    _rejectPendingChats (error) {
        this.pendingChats.forEach(pending => pending.reject(error));
        this.pendingChats.clear();
    }

    _send (payload) {
        this.socket.send(JSON.stringify(payload));
    }

    _setStatus (status, detail) {
        this.onStatusChange(status, detail);
    }
}

export default BridgeClient;
