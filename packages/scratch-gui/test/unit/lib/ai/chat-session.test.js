import {runChatTurn} from '../../../../src/lib/ai/chat-session';

const noop = () => {};

const baseOptions = overrides => ({
    model: 'test-model',
    history: [{id: 'u1', role: 'user', content: 'hello'}],
    systemPrompt: 'be helpful',
    toolDefinitions: [],
    runTool: jest.fn(),
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
