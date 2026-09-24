/**
 * A stand-in for the browser WebSocket that lets a test drive the bridge
 * connection by hand instead of opening a real socket.
 */
class FakeSocket {
    constructor (url) {
        this.url = url;
        this.readyState = FakeSocket.CONNECTING;
        this.sent = [];
        this.listeners = {};
        FakeSocket.instances.push(this);
    }

    addEventListener (type, handler) {
        this.listeners[type] = (this.listeners[type] || []).concat([handler]);
    }

    send (data) {
        this.sent.push(JSON.parse(data));
    }

    close () {
        this.readyState = FakeSocket.CLOSED;
    }

    emit (type, event) {
        (this.listeners[type] || []).forEach(handler => handler(event));
    }

    open () {
        this.readyState = FakeSocket.OPEN;
        this.emit('open', {});
    }

    receive (payload) {
        this.emit('message', {data: JSON.stringify(payload)});
    }

    /**
     * Every envelope of one type the editor sent.
     * @param {string} type the envelope type to filter for
     * @returns {Array<object>} the matching envelopes, oldest first
     */
    sentOfType (type) {
        return this.sent.filter(envelope => envelope.type === type);
    }
}
FakeSocket.CONNECTING = 0;
FakeSocket.OPEN = 1;
FakeSocket.CLOSED = 3;
FakeSocket.instances = [];

/**
 * The socket most recently constructed.
 * @returns {FakeSocket} the newest socket
 */
const lastSocket = () => FakeSocket.instances[FakeSocket.instances.length - 1];

/**
 * Put `FakeSocket` in place of the browser WebSocket and forget earlier sockets.
 * @returns {Function} restores the real WebSocket
 */
const installFakeSocket = () => {
    const realWebSocket = global.WebSocket;
    global.WebSocket = FakeSocket;
    FakeSocket.instances = [];

    return () => {
        global.WebSocket = realWebSocket;
    };
};

// jsdom has no setImmediate, and fake timers would intercept one anyway.
// Draining microtasks is enough: nothing here awaits a real timer.
const flushMicrotasks = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
};

export {FakeSocket, flushMicrotasks, installFakeSocket, lastSocket};
