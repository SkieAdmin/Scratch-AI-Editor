import BridgeClient, {getActiveBridge, setActiveBridge} from '../../../../src/lib/ai/bridge-client';
import {BRIDGE_STATUS} from '../../../../src/lib/ai/constants';
import {FakeSocket, flushMicrotasks, installFakeSocket, lastSocket} from './fake-bridge-socket';

describe('BridgeClient', () => {
    let restoreWebSocket;

    beforeEach(() => {
        restoreWebSocket = installFakeSocket();
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
        restoreWebSocket();
        setActiveBridge(null);
    });

    const build = overrides => new BridgeClient({
        url: 'ws://127.0.0.1:8610/editor',
        onStatusChange: jest.fn(),
        onToolInvoke: jest.fn(),
        ...overrides
    });

    const openClient = overrides => {
        const client = build(overrides);
        client.connect();
        lastSocket().open();
        return client;
    };

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
        openClient();
        lastSocket().receive({type: 'ping'});

        expect(lastSocket().sent).toContainEqual({type: 'pong'});
    });

    test('runs an invoked tool and returns its result', async () => {
        const onToolInvoke = jest.fn().mockResolvedValue({sprites: ['Buddy']});
        openClient({onToolInvoke});

        lastSocket().receive({type: 'invoke', id: '7', name: 'list_sprites', args: {}});
        await flushMicrotasks();

        expect(onToolInvoke).toHaveBeenCalledWith('list_sprites', {});
        const result = lastSocket().sent.find(m => m.type === 'result');
        expect(result).toMatchObject({id: '7', ok: true, result: {sprites: ['Buddy']}});
        expect(result.durationMs).toEqual(expect.any(Number));
    });

    test('reports a failing tool back to the bridge instead of throwing', async () => {
        const onToolInvoke = jest.fn().mockRejectedValue(new Error('no such sprite'));
        openClient({onToolInvoke});

        lastSocket().receive({type: 'invoke', id: '8', name: 'delete_sprite', args: {}});
        await flushMicrotasks();

        expect(lastSocket().sent.find(m => m.type === 'result')).toMatchObject({
            id: '8',
            ok: false,
            error: 'no such sprite'
        });
    });

    test('names the provider in the field the bridge reads', () => {
        const client = openClient();
        client.chat({provider: 'deepseek', model: 'deepseek-chat', messages: []});

        const request = lastSocket().sentOfType('chat')[0];
        expect(request.provider).toBe('deepseek');
        expect(request).not.toHaveProperty('providerId');
    });

    test('leaves unknown request fields off the wire', () => {
        const client = openClient();
        client.chat({provider: 'ollama', model: 'llama3', messages: [], providerId: 'ollama', signal: 'nonsense'});

        expect(Object.keys(lastSocket().sentOfType('chat')[0]).sort()).toEqual(
            ['id', 'messages', 'model', 'provider', 'type']
        );
    });

    test('routes a streamed delta to content and reasoning separately', async () => {
        const client = openClient();
        const onContentDelta = jest.fn();
        const onReasoningDelta = jest.fn();

        const pending = client.chat(
            {provider: 'deepseek', model: 'deepseek-reasoner', messages: []},
            {onContentDelta, onReasoningDelta}
        );

        const {id} = lastSocket().sentOfType('chat')[0];
        lastSocket().receive({type: 'chat-delta', id, delta: {reasoning: 'let me think'}});
        lastSocket().receive({type: 'chat-delta', id, delta: {content: 'Hel'}});
        lastSocket().receive({type: 'chat-delta', id, delta: {content: 'lo'}});
        lastSocket().receive({type: 'chat-done', id, ok: true, result: {content: 'Hello'}});

        await expect(pending).resolves.toEqual({content: 'Hello'});
        expect(onContentDelta.mock.calls.map(call => call[0])).toEqual(['Hel', 'lo']);
        expect(onReasoningDelta).toHaveBeenCalledWith('let me think');
    });

    test('resolves with the tool calls the bridge assembled, raw arguments included', async () => {
        const client = openClient();
        const pending = client.chat({provider: 'ollama', model: 'llama3', messages: []}, {});

        const {id} = lastSocket().sentOfType('chat')[0];
        lastSocket().receive({
            type: 'chat-done',
            id,
            ok: true,
            result: {
                content: '',
                reasoning: '',
                finishReason: 'tool_calls',
                toolCalls: [{
                    id: 'call-1',
                    name: 'create_sprite',
                    args: {name: 'Cat'},
                    rawArguments: '{"name":"Cat"}'
                }]
            }
        });

        await expect(pending).resolves.toMatchObject({
            toolCalls: [{id: 'call-1', name: 'create_sprite', args: {name: 'Cat'}, rawArguments: '{"name":"Cat"}'}]
        });
    });

    test('rejects a chat request when the bridge reports a failure', async () => {
        const client = openClient();

        const pending = client.chat({provider: 'deepseek', messages: []}, {});
        const {id} = lastSocket().sentOfType('chat')[0];
        lastSocket().receive({type: 'chat-done', id, ok: false, error: 'bad key'});

        await expect(pending).rejects.toThrow('bad key');
    });

    test('rejects a chat request made while disconnected', async () => {
        const client = build();
        await expect(client.chat({provider: 'ollama', messages: []}, {})).rejects.toThrow(/not connected/);
    });

    test('cancels an in-flight chat on the bridge when the caller aborts', async () => {
        const client = openClient();
        const controller = new AbortController();

        const pending = client.chat(
            {provider: 'deepseek', model: 'deepseek-chat', messages: []},
            {signal: controller.signal}
        );
        const {id} = lastSocket().sentOfType('chat')[0];

        controller.abort();

        await expect(pending).rejects.toMatchObject({name: 'AbortError'});
        expect(lastSocket().sentOfType('chat-cancel')).toEqual([{type: 'chat-cancel', id}]);
    });

    test('rejects straight away when the signal is already aborted', async () => {
        const client = openClient();
        const controller = new AbortController();
        controller.abort();

        await expect(client.chat(
            {provider: 'deepseek', messages: []},
            {signal: controller.signal}
        )).rejects.toMatchObject({name: 'AbortError'});
        expect(lastSocket().sentOfType('chat')).toEqual([]);
    });

    test('lists a provider models through the bridge', async () => {
        const client = openClient();
        const pending = client.listModels('openrouter');

        const request = lastSocket().sentOfType('models')[0];
        expect(request).toMatchObject({type: 'models', provider: 'openrouter'});

        lastSocket().receive({
            type: 'models-done',
            id: request.id,
            ok: true,
            models: [{id: 'anthropic/claude', label: 'Claude'}]
        });

        await expect(pending).resolves.toEqual([{id: 'anthropic/claude', label: 'Claude'}]);
    });

    test('rejects a model listing the bridge could not complete', async () => {
        const client = openClient();
        const pending = client.listModels('openrouter');

        const {id} = lastSocket().sentOfType('models')[0];
        lastSocket().receive({type: 'models-done', id, ok: false, error: 'no API key configured'});

        await expect(pending).rejects.toThrow('no API key configured');
    });

    test('reconnects after an unexpected close', () => {
        openClient();
        expect(FakeSocket.instances).toHaveLength(1);

        lastSocket().emit('close', {reason: 'bridge went away'});
        jest.advanceTimersByTime(1000);

        expect(FakeSocket.instances).toHaveLength(2);
    });

    test('does not reconnect after an explicit disconnect', () => {
        const client = openClient();

        client.disconnect();
        lastSocket().emit('close', {});
        jest.advanceTimersByTime(60000);

        expect(FakeSocket.instances).toHaveLength(1);
    });

    test('rejects in-flight chats and model listings when the connection drops', async () => {
        const client = openClient();

        const chat = client.chat({provider: 'ollama', messages: []}, {});
        const models = client.listModels('ollama');
        lastSocket().emit('close', {});

        await expect(chat).rejects.toThrow(/connection closed/);
        await expect(models).rejects.toThrow(/connection closed/);
    });

    test('discards an unparseable message without throwing', () => {
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        openClient();

        expect(() => lastSocket().emit('message', {data: 'not json'})).not.toThrow();
        // eslint-disable-next-line no-console
        expect(console.warn).toHaveBeenCalled();
        // eslint-disable-next-line no-console
        console.warn.mockRestore();
    });

    test('publishes the open client so the settings modal can reach it', () => {
        const client = build();
        expect(getActiveBridge()).toBeNull();

        setActiveBridge(client);
        expect(getActiveBridge()).toBe(client);

        setActiveBridge(null);
        expect(getActiveBridge()).toBeNull();
    });
});
