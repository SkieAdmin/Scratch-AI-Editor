import BridgeClient from '../../../../src/lib/ai/bridge-client';
import {runChatTurn} from '../../../../src/lib/ai/chat-session';
import {flushMicrotasks, installFakeSocket, lastSocket} from './fake-bridge-socket';

const noop = () => {};

const baseOptions = overrides => ({
    model: 'test-model',
    history: [{id: 'u1', role: 'user', content: 'hello'}],
    systemPrompt: 'be helpful',
    toolDefinitions: [],
    runTool: jest.fn(),
    maxRounds: 12,
    onMessageStart: noop,
    onContentDelta: noop,
    onReasoningDelta: noop,
    onToolCallStart: noop,
    onToolCallEnd: noop,
    onMessageEnd: noop,
    ...overrides
});

describe('runChatTurn', () => {
    test('finishes after one round when the model answers in prose', async () => {
        const transport = {chat: jest.fn().mockResolvedValue({content: 'hi there', toolCalls: []})};
        const onMessageEnd = jest.fn();

        await runChatTurn(baseOptions({transport, onMessageEnd}));

        expect(transport.chat).toHaveBeenCalledTimes(1);
        expect(onMessageEnd).toHaveBeenCalledTimes(1);
    });

    test('sends the system prompt ahead of the history', async () => {
        const transport = {chat: jest.fn().mockResolvedValue({content: 'ok', toolCalls: []})};

        await runChatTurn(baseOptions({transport}));

        const sent = transport.chat.mock.calls[0][0].messages;
        expect(sent[0]).toEqual({role: 'system', content: 'be helpful'});
        expect(sent[1]).toEqual({role: 'user', content: 'hello'});
    });

    test('runs a requested tool and feeds its result back to the model', async () => {
        const transport = {
            chat: jest.fn()
                .mockResolvedValueOnce({
                    content: '',
                    toolCalls: [{
                        id: 'call-1',
                        name: 'list_sprites',
                        args: {},
                        rawArguments: '{}'
                    }]
                })
                .mockResolvedValueOnce({content: 'There is one sprite.', toolCalls: []})
        };
        const runTool = jest.fn().mockResolvedValue({sprites: ['Buddy']});

        await runChatTurn(baseOptions({transport, runTool}));

        expect(runTool).toHaveBeenCalledWith('list_sprites', {});
        expect(transport.chat).toHaveBeenCalledTimes(2);

        const secondCall = transport.chat.mock.calls[1][0].messages;
        const toolMessage = secondCall.find(m => m.role === 'tool');
        expect(toolMessage).toEqual({
            role: 'tool',
            tool_call_id: 'call-1',
            content: JSON.stringify({sprites: ['Buddy']})
        });
    });

    test('never echoes reasoning content back to the provider', async () => {
        const transport = {
            chat: jest.fn()
                .mockResolvedValueOnce({
                    content: 'working',
                    reasoning: 'internal chain of thought',
                    toolCalls: [{id: 'c1', name: 'green_flag', args: {}, rawArguments: '{}'}]
                })
                .mockResolvedValueOnce({content: 'done', toolCalls: []})
        };

        await runChatTurn(baseOptions({transport, runTool: jest.fn().mockResolvedValue({ok: true})}));

        const serialized = JSON.stringify(transport.chat.mock.calls[1][0].messages);
        expect(serialized).not.toContain('internal chain of thought');
    });

    test('reports a failing tool to the model instead of aborting the turn', async () => {
        const transport = {
            chat: jest.fn()
                .mockResolvedValueOnce({
                    content: '',
                    toolCalls: [{id: 'c1', name: 'delete_sprite', args: {id: 'nope'}, rawArguments: '{}'}]
                })
                .mockResolvedValueOnce({content: 'I could not find that sprite.', toolCalls: []})
        };
        const runTool = jest.fn().mockRejectedValue(new Error('No sprite with id "nope"'));
        const onToolCallEnd = jest.fn();

        await runChatTurn(baseOptions({transport, runTool, onToolCallEnd}));

        expect(onToolCallEnd).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
            status: 'error',
            error: 'No sprite with id "nope"'
        }));

        const toolMessage = transport.chat.mock.calls[1][0].messages.find(m => m.role === 'tool');
        expect(JSON.parse(toolMessage.content)).toEqual({error: 'No sprite with id "nope"'});
    });

    test('reports each tool call as running and then done', async () => {
        const transport = {
            chat: jest.fn()
                .mockResolvedValueOnce({
                    content: '',
                    toolCalls: [{id: 'c1', name: 'green_flag', args: {}, rawArguments: '{}'}]
                })
                .mockResolvedValueOnce({content: 'Running!', toolCalls: []})
        };
        const onToolCallStart = jest.fn();
        const onToolCallEnd = jest.fn();

        await runChatTurn(baseOptions({
            transport,
            runTool: jest.fn().mockResolvedValue({ok: true}),
            onToolCallStart,
            onToolCallEnd
        }));

        expect(onToolCallStart).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
            id: 'c1',
            name: 'green_flag'
        }));
        expect(onToolCallEnd).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
            id: 'c1',
            status: 'done',
            durationMs: expect.any(Number)
        }));
    });

    test('works for as many rounds as it was given', async () => {
        const transport = {
            chat: jest.fn().mockResolvedValue({
                content: '',
                toolCalls: [{id: 'c', name: 'green_flag', args: {}, rawArguments: '{}'}]
            })
        };

        await expect(runChatTurn(baseOptions({
            transport,
            maxRounds: 30,
            runTool: jest.fn().mockResolvedValue({ok: true})
        }))).rejects.toThrow(/30 rounds/);

        expect(transport.chat).toHaveBeenCalledTimes(30);
    });

    test('says the work so far is kept when it runs out of rounds', async () => {
        const transport = {
            chat: jest.fn().mockResolvedValue({
                content: '',
                toolCalls: [{id: 'c', name: 'green_flag', args: {}, rawArguments: '{}'}]
            })
        };

        await expect(runChatTurn(baseOptions({
            transport,
            maxRounds: 5,
            runTool: jest.fn().mockResolvedValue({ok: true})
        }))).rejects.toThrow(/built so far is kept/);
    });

    test('gives up rather than looping forever on tools', async () => {
        const transport = {
            chat: jest.fn().mockResolvedValue({
                content: '',
                toolCalls: [{id: 'c', name: 'green_flag', args: {}, rawArguments: '{}'}]
            })
        };

        await expect(runChatTurn(baseOptions({
            transport,
            runTool: jest.fn().mockResolvedValue({ok: true})
        }))).rejects.toThrow(/rounds of tools without finishing/);
    });
});

describe('runChatTurn over the bridge', () => {
    let restoreWebSocket;

    beforeEach(() => {
        restoreWebSocket = installFakeSocket();
    });

    afterEach(() => {
        restoreWebSocket();
    });

    /**
     * Open a bridge client on a socket a test can drive.
     * @returns {object} the connected client
     */
    const openBridge = () => {
        const client = new BridgeClient({
            url: 'ws://127.0.0.1:8610/editor',
            onStatusChange: jest.fn(),
            onToolInvoke: jest.fn()
        });
        client.connect();
        lastSocket().open();
        return client;
    };

    /**
     * The transport the AI panel builds when the bridge is switched on.
     * @param {object} client the connected bridge client
     * @returns {object} an object exposing a `chat` method
     */
    const bridgeTransport = client => ({
        chat: request => client.chat(
            {
                provider: 'deepseek',
                model: request.model,
                messages: request.messages,
                tools: request.tools
            },
            {
                onContentDelta: request.onContentDelta,
                onReasoningDelta: request.onReasoningDelta,
                signal: request.signal
            }
        )
    });

    /**
     * Answer each chat envelope the editor sends with one scripted round.
     * @param {Array<object>} rounds the deltas and result to send back, in order
     * @returns {Promise<Array<object>>} the chat envelopes the editor sent
     */
    const playBridge = async rounds => {
        const requests = [];
        for (const round of rounds) {
            await flushMicrotasks();
            const request = lastSocket().sentOfType('chat')[requests.length];
            requests.push(request);
            round.deltas.forEach(delta => lastSocket().receive({type: 'chat-delta', id: request.id, delta}));
            lastSocket().receive({type: 'chat-done', id: request.id, ok: true, result: round.result});
        }
        return requests;
    };

    test('runs a tool-calling turn end to end', async () => {
        const client = openBridge();
        const runTool = jest.fn().mockResolvedValue({id: 'sprite-1'});
        const onContentDelta = jest.fn();
        const onReasoningDelta = jest.fn();

        const turn = runChatTurn(baseOptions({
            transport: bridgeTransport(client),
            runTool,
            onContentDelta,
            onReasoningDelta
        }));

        const requests = await playBridge([
            {
                deltas: [{reasoning: 'a cat would help'}],
                result: {
                    content: '',
                    reasoning: 'a cat would help',
                    finishReason: 'tool_calls',
                    toolCalls: [{
                        id: 'call-1',
                        name: 'create_sprite',
                        args: {name: 'Cat'},
                        rawArguments: '{"name":"Cat"}'
                    }]
                }
            },
            {
                deltas: [{content: 'Added '}, {content: 'Cat.'}],
                result: {content: 'Added Cat.', reasoning: '', toolCalls: [], finishReason: 'stop'}
            }
        ]);

        await turn;

        expect(requests[0].provider).toBe('deepseek');
        expect(runTool).toHaveBeenCalledWith('create_sprite', {name: 'Cat'});

        // The assistant turn has to carry the argument text the model produced,
        // or the provider rejects the tool result that answers it.
        const assistant = requests[1].messages.find(message => message.tool_calls);
        expect(assistant.tool_calls).toEqual([{
            id: 'call-1',
            type: 'function',
            function: {name: 'create_sprite', arguments: '{"name":"Cat"}'}
        }]);
        expect(requests[1].messages).toContainEqual({
            role: 'tool',
            tool_call_id: 'call-1',
            content: JSON.stringify({id: 'sprite-1'})
        });

        expect(onContentDelta.mock.calls.map(call => call[1])).toEqual(['Added ', 'Cat.']);
        expect(onReasoningDelta.mock.calls.map(call => call[1])).toEqual(['a cat would help']);
    });

    test('surfaces the bridge failure that a misconfigured provider produces', async () => {
        const client = openBridge();
        const turn = runChatTurn(baseOptions({transport: bridgeTransport(client)}));
        const rejects = expect(turn).rejects.toThrow('Unknown AI provider "undefined".');

        await flushMicrotasks();
        const request = lastSocket().sentOfType('chat')[0];
        lastSocket().receive({
            type: 'chat-done',
            id: request.id,
            ok: false,
            error: 'Unknown AI provider "undefined". Known providers: deepseek, openrouter, lmstudio, ollama.'
        });

        await rejects;
    });
});
