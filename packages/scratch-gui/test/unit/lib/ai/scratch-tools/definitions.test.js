import {
    TOOL_DEFINITIONS,
    selectToolDefinitions,
    toChatTools
} from '../../../../../src/lib/ai/scratch-tools/definitions';

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

describe('selectToolDefinitions', () => {
    const names = tools => tools.map(tool => tool.name);

    /*
     * The editor's chat hands tool results to the model as JSON text, so a
     * picture would arrive as tens of thousands of characters of base64.
     */
    test('keeps the picture tools out of the editor\'s own chat', () => {
        const chat = names(selectToolDefinitions({desktop: true, editorChat: true}));

        expect(chat).not.toContain('capture_stage');
        expect(chat).not.toContain('capture_editor');
        expect(chat).toContain('get_runtime_state');
    });

    test('offers the desktop-only tools only in the desktop app', () => {
        expect(names(selectToolDefinitions({desktop: false, editorChat: false}))).not.toContain('capture_editor');
        expect(names(selectToolDefinitions({desktop: true, editorChat: false}))).toContain('capture_editor');
    });

    test('offers an MCP client in the desktop app the whole catalogue', () => {
        expect(selectToolDefinitions({desktop: true, editorChat: false})).toEqual(TOOL_DEFINITIONS);
    });
});
