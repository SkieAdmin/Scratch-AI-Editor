import {createOpenAiProvider} from '../../../../../src/lib/ai/providers/base-provider';
import {errorResponse, streamingResponse} from './fake-responses';

const BASE_URL = 'http://example.test/v1';

const testProvider = createOpenAiProvider({
    id: 'test-provider',
    name: 'Test Provider',
    defaultBaseUrl: BASE_URL,
    requiresApiKey: false,
    supportsModelListing: true
});

const chat = options => testProvider.chat({messages: [{role: 'user', content: 'hi'}], model: 'test-model', ...options});

describe('AI base provider', () => {
    beforeEach(() => {
        global.fetch = jest.fn();
    });

    test('reassembles an event whose JSON is split across chunks', async () => {
        global.fetch.mockResolvedValue(streamingResponse([
            'data: {"choices":[{"delta":{"con',
            'tent":"Hel"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
            'data: [DONE]\n\n'
        ]));

        const onContentDelta = jest.fn();
        const result = await chat({onContentDelta});

        expect(onContentDelta.mock.calls).toEqual([['Hel'], ['lo']]);
        expect(result.content).toBe('Hello');
    });

    test('stops reading at [DONE]', async () => {
        global.fetch.mockResolvedValue(streamingResponse([
            'data: {"choices":[{"delta":{"content":"done"}}]}\n\n',
            'data: [DONE]\n\n',
            'data: {"choices":[{"delta":{"content":"ignored"}}]}\n\n'
        ]));

        const result = await chat({});

        expect(result.content).toBe('done');
    });

    test('handles an event that arrives without a terminating blank line', async () => {
        global.fetch.mockResolvedValue(streamingResponse([
            'data: {"choices":[{"delta":{"content":"tail"}}]}'
        ]));

        expect((await chat({})).content).toBe('tail');
    });

    test('skips an unparseable event and keeps reading', async () => {
        global.fetch.mockResolvedValue(streamingResponse([
            'data: not json\n\ndata: {"choices":[{"delta":{"content":"ok"}}]}\n\n'
        ]));
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

        expect((await chat({})).content).toBe('ok');
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('not json'));

        warn.mockRestore();
    });

    test('accumulates tool call fragments across chunks, by index', async () => {
        global.fetch.mockResolvedValue(streamingResponse([
            'data: {"choices":[{"delta":{"tool_calls":[' +
                '{"index":0,"id":"call_a","function":{"name":"add_sprite","arguments":"{\\"na"}}]}}]}\n\n',
            'data: {"choices":[{"delta":{"tool_calls":[' +
                '{"index":0,"function":{"arguments":"me\\":\\"Cat\\"}"}}]}}]}\n\n',
            'data: {"choices":[{"delta":{"tool_calls":[' +
                '{"index":1,"id":"call_b","function":{"name":"play_project","arguments":"{}"}}]}}]}\n\n',
            'data: [DONE]\n\n'
        ]));

        const onToolCallDelta = jest.fn();
        const result = await chat({onToolCallDelta});

        expect(result.toolCalls).toEqual([
            {id: 'call_a', name: 'add_sprite', args: {name: 'Cat'}, rawArguments: '{"name":"Cat"}'},
            {id: 'call_b', name: 'play_project', args: {}, rawArguments: '{}'}
        ]);
        expect(onToolCallDelta).toHaveBeenCalledTimes(3);
        expect(onToolCallDelta).toHaveBeenNthCalledWith(2, expect.objectContaining({
            index: 0,
            name: 'add_sprite',
            argumentsDelta: 'me":"Cat"}',
            rawArguments: '{"name":"Cat"}'
        }));
    });

    test('names a tool call by its position when the server omits the id', async () => {
        global.fetch.mockResolvedValue(streamingResponse([
            'data: {"choices":[{"delta":{"tool_calls":[{"function":{"name":"stop_project","arguments":""}}]}}]}\n\n'
        ]));

        expect((await chat({})).toolCalls[0].id).toBe('tool_call_0');
    });

    test('sends only the wire fields of each message', async () => {
        global.fetch.mockResolvedValue(streamingResponse(['data: [DONE]\n\n']));

        await testProvider.chat({
            model: 'test-model',
            messages: [
                {id: 'm1', role: 'user', content: 'hi', createdAt: 1, attachments: []},
                {id: 'm2', role: 'assistant', content: 'hello', reasoning: 'the user said hi'}
            ],
            tools: [{type: 'function', function: {name: 'add_sprite'}}]
        });

        const body = JSON.parse(global.fetch.mock.calls[0][1].body);
        expect(body.messages).toEqual([
            {role: 'user', content: 'hi'},
            {role: 'assistant', content: 'hello'}
        ]);
        expect(body.stream).toBe(true);
        expect(body.tools).toHaveLength(1);
        expect(body.stream_options).toBeUndefined();
    });

    test('reports the status and body of a failed request', async () => {
        global.fetch.mockResolvedValue(errorResponse(402, 'Payment Required', 'Insufficient Balance'));

        await expect(chat({})).rejects.toThrow(
            'Test Provider request to http://example.test/v1/chat/completions failed: ' +
            'HTTP 402 Payment Required -- Insufficient Balance'
        );
    });

    test('carries the status on the thrown error', async () => {
        global.fetch.mockResolvedValue(errorResponse(401, 'Unauthorized', 'bad key'));

        await expect(chat({})).rejects.toMatchObject({status: 401, body: 'bad key'});
    });

    test('passes an abort through untouched', async () => {
        const aborted = new Error('The user aborted a request.');
        aborted.name = 'AbortError';
        global.fetch.mockRejectedValue(aborted);

        await expect(chat({})).rejects.toBe(aborted);
    });

    test('refuses to start a turn with no model selected', async () => {
        await expect(testProvider.chat({messages: [], model: ''})).rejects.toThrow(
            'No model is selected for Test Provider.'
        );
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('trims a trailing slash from a user-supplied base URL', async () => {
        global.fetch.mockResolvedValue(streamingResponse(['data: [DONE]\n\n']));

        await chat({baseUrl: 'http://elsewhere.test/v1/'});

        expect(global.fetch.mock.calls[0][0]).toBe('http://elsewhere.test/v1/chat/completions');
    });
});
