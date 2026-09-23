import {ollamaProvider} from '../../../../../src/lib/ai/providers/ollama';
import {jsonResponse, streamingResponse} from './fake-responses';

describe('Ollama provider', () => {
    beforeEach(() => {
        global.fetch = jest.fn();
    });

    test('lists installed models from the native tags endpoint', async () => {
        global.fetch.mockResolvedValue(jsonResponse({
            models: [
                {name: 'llama3.2:3b', size: 2019393189},
                {name: 'deepseek-r1:8b', size: 4920738717}
            ]
        }));

        const models = await ollamaProvider.listModels();

        expect(global.fetch.mock.calls[0][0]).toBe('http://127.0.0.1:11434/api/tags');
        expect(models).toEqual([
            {id: 'llama3.2:3b', label: 'llama3.2:3b', reasoning: false},
            {id: 'deepseek-r1:8b', label: 'deepseek-r1:8b', reasoning: true}
        ]);
    });

    test('lists from a user-supplied base URL', async () => {
        global.fetch.mockResolvedValue(jsonResponse({models: []}));

        await ollamaProvider.listModels({baseUrl: 'http://pi.local:11434/'});

        expect(global.fetch.mock.calls[0][0]).toBe('http://pi.local:11434/api/tags');
    });

    test('chats through the OpenAI-compatible endpoint', async () => {
        global.fetch.mockResolvedValue(streamingResponse(['data: [DONE]\n\n']));

        await ollamaProvider.chat({messages: [{role: 'user', content: 'hi'}], model: 'llama3.2:3b'});

        const [url, request] = global.fetch.mock.calls[0];
        expect(url).toBe('http://127.0.0.1:11434/v1/chat/completions');
        expect(request.headers.Authorization).toBeUndefined();
        // Ollama does not report usage on a streamed response, so it is not requested.
        expect(JSON.parse(request.body).stream_options).toBeUndefined();
    });

    test('explains the OLLAMA_ORIGINS fix when the browser is blocked', async () => {
        global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));

        await expect(ollamaProvider.listModels()).rejects.toThrow(
            `Could not reach Ollama at http://127.0.0.1:11434/api/tags. If Ollama is running, it is ` +
            `refusing requests from this page: set OLLAMA_ORIGINS to include ${window.location.origin} ` +
            `and restart Ollama.`
        );
    });
});
