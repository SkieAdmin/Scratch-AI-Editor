import BridgeClient from '../../../../src/lib/ai/bridge-client';
import {BRIDGE_STATUS} from '../../../../src/lib/ai/constants';

/**
 * A stand-in for the browser WebSocket that lets a test drive the connection by
 * hand instead of opening a real socket.
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
}
FakeSocket.CONNECTING = 0;
FakeSocket.OPEN = 1;
FakeSocket.CLOSED = 3;
FakeSocket.instances = [];

const lastSocket = () => FakeSocket.instances[FakeSocket.instances.length - 1];

// jsdom has no setImmediate, and the fake timers here would intercept one
// anyway. Draining microtasks is enough: the invoke handler only awaits
// already-resolved promises before it replies.
const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('BridgeClient', () => {
    let originalWebSocket;

    beforeEach(() => {
        originalWebSocket = global.WebSocket;
        global.WebSocket = FakeSocket;
        FakeSocket.instances = [];
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
        global.WebSocket = originalWebSocket;
    });

    const build = overrides => new BridgeClient({
        url: 'ws://127.0.0.1:8610/editor',
        onStatusChange: jest.fn(),
        onToolInvoke: jest.fn(),
        ...overrides
    });

    test('announces its tools as soon as the socket opens', () => {
        const client = build();
        const tools = [{name: 'list_sprites'}];
        client.setToolDefinitions(tools);
        client.connect();

        lastSocket().open();

        expect(lastSocket().sent[0]).toEqual({
            type: 'hello',
            protocolVersion: 1,
            tools
        });
    });

    test('reports connecting then connected', () => {
        const onStatusChange = jest.fn();
        const client = build({onStatusChange});
        client.connect();
        expect(onStatusChange.mock.calls.map(call => call[0])).toContain(BRIDGE_STATUS.CONNECTING);

        lastSocket().open();
        expect(onStatusChange.mock.calls.map(call => call[0])).toContain(BRIDGE_STATUS.CONNECTED);
    });

    test('answers a ping with a pong', () => {
        const client = build();
        client.connect();
        lastSocket().open();
        lastSocket().receive({type: 'ping'});

        expect(lastSocket().sent).toContainEqual({type: 'pong'});
    });

    test('runs an invoked tool and returns its result', async () => {
        const onToolInvoke = jest.fn().mockResolvedValue({sprites: ['Buddy']});
        const client = build({onToolInvoke});
        client.connect();
        lastSocket().open();

        lastSocket().receive({type: 'invoke', id: '7', name: 'list_sprites', args: {}});
        await flush();

        expect(onToolInvoke).toHaveBeenCalledWith('list_sprites', {});
        const result = lastSocket().sent.find(m => m.type === 'result');
        expect(result).toMatchObject({id: '7', ok: true, result: {sprites: ['Buddy']}});
        expect(result.durationMs).toEqual(expect.any(Number));
    });

    test('reports a failing tool back to the bridge instead of throwing', async () => {
        const onToolInvoke = jest.fn().mockRejectedValue(new Error('no such sprite'));
        const client = build({onToolInvoke});
        client.connect();
        lastSocket().open();

        lastSocket().receive({type: 'invoke', id: '8', name: 'delete_sprite', args: {}});
        await flush();

        expect(lastSocket().sent.find(m => m.type === 'result')).toMatchObject({
            id: '8',
            ok: false,
            error: 'no such sprite'
        });
    });

    test('resolves a chat request when the bridge finishes it', async () => {
        const client = build();
        client.connect();
        lastSocket().open();

        const onDelta = jest.fn();
        const pending = client.chat({providerId: 'ollama', model: 'llama3', messages: []}, onDelta);

        const request = lastSocket().sent.find(m => m.type === 'chat');
        lastSocket().receive({type: 'chat-delta', id: request.id, delta: 'Hel'});
        lastSocket().receive({type: 'chat-delta', id: request.id, delta: 'lo'});
        lastSocket().receive({type: 'chat-done', id: request.id, ok: true, result: {content: 'Hello'}});

        await expect(pending).resolves.toEqual({content: 'Hello'});
        expect(onDelta.mock.calls.map(call => call[0])).toEqual(['Hel', 'lo']);
    });

    test('rejects a chat request when the bridge reports a failure', async () => {
        const client = build();
        client.connect();
        lastSocket().open();

        const pending = client.chat({providerId: 'deepseek', messages: []}, jest.fn());
        const request = lastSocket().sent.find(m => m.type === 'chat');
        lastSocket().receive({type: 'chat-done', id: request.id, ok: false, error: 'bad key'});

        await expect(pending).rejects.toThrow('bad key');
    });

    test('rejects a chat request made while disconnected', async () => {
        const client = build();
        await expect(client.chat({}, jest.fn())).rejects.toThrow(/not connected/);
    });

    test('reconnects after an unexpected close', () => {
        const client = build();
        client.connect();
        lastSocket().open();
        expect(FakeSocket.instances).toHaveLength(1);

        lastSocket().emit('close', {reason: 'bridge went away'});
        jest.advanceTimersByTime(1000);

        expect(FakeSocket.instances).toHaveLength(2);
    });

    test('does not reconnect after an explicit disconnect', () => {
        const client = build();
        client.connect();
        lastSocket().open();

        client.disconnect();
        lastSocket().emit('close', {});
        jest.advanceTimersByTime(60000);

        expect(FakeSocket.instances).toHaveLength(1);
    });

    test('rejects in-flight chats when the connection drops', async () => {
        const client = build();
        client.connect();
        lastSocket().open();

        const pending = client.chat({messages: []}, jest.fn());
        lastSocket().emit('close', {});

        await expect(pending).rejects.toThrow(/connection closed/);
    });

    test('discards an unparseable message without throwing', () => {
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        const client = build();
        client.connect();
        lastSocket().open();

        expect(() => lastSocket().emit('message', {data: 'not json'})).not.toThrow();
        // eslint-disable-next-line no-console
        expect(console.warn).toHaveBeenCalled();
        // eslint-disable-next-line no-console
        console.warn.mockRestore();
    });
});
