import {TOOL_DEFINITIONS, toChatTools} from '../../../../../src/lib/ai/scratch-tools/definitions';

describe('toChatTools', () => {
    /*
     * DeepSeek answers a raw MCP tool with
     * "tools[0]: missing field `type`" and an HTTP 422, so every tool has to be
     * wrapped before it reaches a chat-completions endpoint.
     */
    test('wraps every tool the way a chat-completions API expects', () => {
        const wrapped = toChatTools(TOOL_DEFINITIONS);

        expect(wrapped).toHaveLength(TOOL_DEFINITIONS.length);
        wrapped.forEach(tool => {
            expect(tool.type).toBe('function');
            expect(typeof tool.function.name).toBe('string');
            expect(typeof tool.function.description).toBe('string');
            expect(tool.function.parameters.type).toBe('object');
            expect(tool).not.toHaveProperty('inputSchema');
        });
    });

    test('carries the MCP input schema through as the function parameters', () => {
        const source = TOOL_DEFINITIONS.find(tool => tool.name === 'get_project_summary');
        const wrapped = toChatTools([source]);

        expect(wrapped[0]).toEqual({
            type: 'function',
            function: {
                name: source.name,
                description: source.description,
                parameters: source.inputSchema
            }
        });
    });
});
