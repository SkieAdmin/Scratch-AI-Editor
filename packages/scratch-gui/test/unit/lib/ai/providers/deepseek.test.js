import {deepseekProvider} from '../../../../../src/lib/ai/providers/deepseek';
import {streamingResponse} from './fake-responses';

const chat = options => deepseekProvider.chat({
    messages: [{role: 'user', content: 'hi'}],
    model: 'deepseek-reasoner',
    apiKey: 'sk-test',
    ...options
});

describe('DeepSeek provider', () => {
    beforeEach(() => {
        global.fetch = jest.fn();
    });

    test('offers the two published aliases instead of a listing call', async () => {
        expect(deepseekProvider.supportsModelListing).toBe(false);

        const models = await deepseekProvider.listModels();

        expect(models).toEqual([
            {id: 'deepseek-chat', label: 'deepseek-chat', reasoning: false},
            {id: 'deepseek-reasoner', label: 'deepseek-reasoner', reasoning: true}
        ]);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('routes reasoning_content and content to separate callbacks', async () => {
        global.fetch.mockResolvedValue(streamingResponse([
            'data: {"choices":[{"delta":{"reasoning_content":"The user "}}]}\n\n',
            'data: {"choices":[{"delta":{"reasoning_content":"said hi."}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"Hi!"}}]}\n\n',
            'data: {"choices":[{"delta":{}}],"usage":{"total_tokens":42}}\n\n',
            'data: [DONE]\n\n'
        ]));

        const onContentDelta = jest.fn();
        const onReasoningDelta = jest.fn();
        const result = await chat({onContentDelta, onReasoningDelta});

        expect(onReasoningDelta.mock.calls).toEqual([['The user '], ['said hi.']]);
        expect(onContentDelta.mock.calls).toEqual([['Hi!']]);
        expect(result).toEqual({
            content: 'Hi!',
            reasoning: 'The user said hi.',
            toolCalls: [],
            usage: {total_tokens: 42}
        });
    });

    test('never sends reasoning back in the history', async () => {
        global.fetch.mockResolvedValue(streamingResponse(['data: [DONE]\n\n']));

        await chat({
            messages: [
                {role: 'user', content: 'hi'},
                {role: 'assistant', content: 'Hi!', reasoning: 'The user said hi.'}
            ]
        });

        const request = global.fetch.mock.calls[0][1];
        expect(request.body).not.toContain('reasoning');
        expect(JSON.parse(request.body).messages[1]).toEqual({role: 'assistant', content: 'Hi!'});
    });

    test('posts to the chat completions endpoint with the API key', async () => {
        global.fetch.mockResolvedValue(streamingResponse(['data: [DONE]\n\n']));

        await chat({});

        const [url, request] = global.fetch.mock.calls[0];
        expect(url).toBe('https://api.deepseek.com/chat/completions');
        expect(request.headers.Authorization).toBe('Bearer sk-test');
        expect(JSON.parse(request.body).stream_options).toEqual({include_usage: true});
    });

    test('asks for a key rather than sending an unauthenticated request', async () => {
        await expect(chat({apiKey: ''})).rejects.toThrow('DeepSeek needs an API key.');
        expect(global.fetch).not.toHaveBeenCalled();
    });
});
