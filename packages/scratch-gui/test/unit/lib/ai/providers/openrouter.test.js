import {openrouterProvider} from '../../../../../src/lib/ai/providers/openrouter';
import {jsonResponse, streamingResponse} from './fake-responses';

describe('OpenRouter provider', () => {
    beforeEach(() => {
        global.fetch = jest.fn();
    });

    test('marks reasoning models from the listing', async () => {
        global.fetch.mockResolvedValue(jsonResponse({
            data: [
                {id: 'openai/gpt-4.1-mini', name: 'GPT-4.1 Mini', supported_parameters: ['tools']},
                {
                    id: 'deepseek/deepseek-chat',
                    name: 'DeepSeek V3',
                    supported_parameters: ['tools', 'include_reasoning', 'reasoning']
                },
                {id: 'qwen/qwq-32b', name: 'QwQ 32B'}
            ]
        }));

        const models = await openrouterProvider.listModels();

        expect(global.fetch.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/models');
        expect(models).toEqual([
            {id: 'openai/gpt-4.1-mini', label: 'GPT-4.1 Mini', reasoning: false},
            {id: 'deepseek/deepseek-chat', label: 'DeepSeek V3', reasoning: true},
            {id: 'qwen/qwq-32b', label: 'QwQ 32B', reasoning: true}
        ]);
    });

    test('lists the public catalogue without an API key', async () => {
        global.fetch.mockResolvedValue(jsonResponse({data: []}));

        await openrouterProvider.listModels();

        const {headers} = global.fetch.mock.calls[0][1];
        expect(headers.Authorization).toBeUndefined();
        expect(headers['HTTP-Referer']).toBe(window.location.origin);
        expect(headers['X-Title']).toBe('Scratch AI Editor');
    });

    test('identifies the editor on a chat request', async () => {
        global.fetch.mockResolvedValue(streamingResponse(['data: [DONE]\n\n']));

        await openrouterProvider.chat({
            messages: [{role: 'user', content: 'hi'}],
            model: 'deepseek/deepseek-chat',
            apiKey: 'sk-or-test'
        });

        const [url, request] = global.fetch.mock.calls[0];
        expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
        expect(request.headers).toMatchObject({
            'Authorization': 'Bearer sk-or-test',
            'Content-Type': 'application/json',
            'HTTP-Referer': window.location.origin,
            'X-Title': 'Scratch AI Editor'
        });
    });

    test('routes the normalized reasoning field', async () => {
        global.fetch.mockResolvedValue(streamingResponse([
            'data: {"choices":[{"delta":{"reasoning":"weighing options"}}]}\n\n',
            'data: [DONE]\n\n'
        ]));

        const onReasoningDelta = jest.fn();
        const result = await openrouterProvider.chat({
            messages: [{role: 'user', content: 'hi'}],
            model: 'deepseek/deepseek-r1',
            apiKey: 'sk-or-test',
            onReasoningDelta
        });

        expect(onReasoningDelta).toHaveBeenCalledWith('weighing options');
        expect(result.reasoning).toBe('weighing options');
    });
});
