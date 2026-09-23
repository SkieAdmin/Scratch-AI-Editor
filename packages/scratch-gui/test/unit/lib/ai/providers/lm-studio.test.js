import {lmStudioProvider} from '../../../../../src/lib/ai/providers/lm-studio';
import {jsonResponse} from './fake-responses';

describe('LM Studio provider', () => {
    beforeEach(() => {
        global.fetch = jest.fn();
    });

    test('lists loaded models from the OpenAI-compatible endpoint', async () => {
        global.fetch.mockResolvedValue(jsonResponse({
            data: [
                {id: 'qwen2.5-7b-instruct', object: 'model'},
                {id: 'qwq-32b', object: 'model'}
            ]
        }));

        const models = await lmStudioProvider.listModels();

        expect(global.fetch.mock.calls[0][0]).toBe('http://127.0.0.1:1234/v1/models');
        expect(models).toEqual([
            {id: 'qwen2.5-7b-instruct', label: 'qwen2.5-7b-instruct', reasoning: false},
            {id: 'qwq-32b', label: 'qwq-32b', reasoning: true}
        ]);
    });

    test('needs no API key', () => {
        expect(lmStudioProvider.requiresApiKey).toBe(false);
    });

    test('explains the CORS setting when the browser is blocked', async () => {
        global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));

        await expect(lmStudioProvider.listModels()).rejects.toThrow(
            'Could not reach LM Studio at http://127.0.0.1:1234/v1/models. If the local server is ' +
            'running, it is refusing requests from this page: turn on CORS in the LM Studio local ' +
            'server settings and restart the server.'
        );
    });
});
