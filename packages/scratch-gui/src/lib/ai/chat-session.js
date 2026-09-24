import {DEFAULT_MAX_TOOL_ROUNDS} from './constants';

const createId = () => `${Date.now().toString(36)}-${Math.random().toString(36)
    .slice(2, 8)}`;

/**
 * Drives one assistant turn: call the model, run any tools it asks for, feed the
 * results back, and repeat until it answers in prose.
 *
 * The caller owns all rendering; this reports progress through callbacks so the
 * same loop serves both the in-browser provider and the bridge.
 * @param {object} options the turn's inputs and callbacks
 * @param options.transport
 * @param options.model
 * @param options.history
 * @param options.systemPrompt
 * @param options.toolDefinitions
 * @param options.runTool
 * @param options.maxRounds
 * @param options.signal
 * @param options.onMessageStart
 * @param options.onContentDelta
 * @param options.onReasoningDelta
 * @param options.onToolCallStart
 * @param options.onToolCallEnd
 * @param options.onMessageEnd
 * @returns {Promise<void>} resolves when the assistant has produced a final answer
 */
const runChatTurn = async ({
    transport,
    model,
    history,
    systemPrompt,
    toolDefinitions,
    runTool,
    maxRounds = DEFAULT_MAX_TOOL_ROUNDS,
    signal,
    onMessageStart,
    onContentDelta,
    onReasoningDelta,
    onToolCallStart,
    onToolCallEnd,
    onMessageEnd
}) => {
    const wireMessages = [{role: 'system', content: systemPrompt}].concat(
        history.map(message => ({role: message.role, content: message.content}))
    );

    for (let round = 0; round < maxRounds; round++) {
        const messageId = createId();
        onMessageStart(messageId);

        const completion = await transport.chat({
            model,
            messages: wireMessages,
            tools: toolDefinitions,
            signal,
            onContentDelta: delta => onContentDelta(messageId, delta),
            onReasoningDelta: delta => onReasoningDelta(messageId, delta)
        });

        const toolCalls = completion.toolCalls || [];

        if (toolCalls.length === 0) {
            onMessageEnd(messageId, completion);
            return;
        }

        // Reasoning content must not be echoed back to the provider; DeepSeek
        // rejects a history that contains it.
        wireMessages.push({
            role: 'assistant',
            content: completion.content || '',
            tool_calls: toolCalls.map(call => ({
                id: call.id,
                type: 'function',
                function: {name: call.name, arguments: call.rawArguments}
            }))
        });

        for (const call of toolCalls) {
            const startedAt = Date.now();
            onToolCallStart(messageId, {id: call.id, name: call.name, args: call.args});

            let payload;
            let ok = true;
            try {
                payload = await runTool(call.name, call.args);
            } catch (e) {
                ok = false;
                payload = {error: e.message};
            }

            const outcome = {
                id: call.id,
                status: ok ? 'done' : 'error',
                durationMs: Date.now() - startedAt
            };
            if (ok) {
                outcome.result = payload;
            } else {
                outcome.error = payload.error;
            }
            onToolCallEnd(messageId, outcome);

            wireMessages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: JSON.stringify(payload)
            });
        }

        onMessageEnd(messageId, completion);
    }

    throw new Error(
        `The assistant worked through ${maxRounds} rounds of tools without finishing. What it built so ` +
        'far is kept. Ask it to carry on, or raise the limit in Settings.'
    );
};

export {createId, runChatTurn};
