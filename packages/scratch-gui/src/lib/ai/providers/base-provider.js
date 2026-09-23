import {PROVIDER_IDS} from '../constants';

/** Separator between Server-Sent Events, and the payload that ends a stream. */
const EVENT_SEPARATOR = '\n\n';
const DONE_PAYLOAD = '[DONE]';

/** How much of an error response body to quote back to the user. */
const ERROR_BODY_LIMIT = 500;

/** Fields of a chat message that the OpenAI-compatible APIs understand. */
const WIRE_MESSAGE_FIELDS = ['role', 'content', 'name', 'tool_calls', 'tool_call_id'];

/**
 * Model families that expose a chain-of-thought summary. Model listings rarely
 * flag this, so the name is the only signal available for a local server.
 */
const REASONING_MODEL_PATTERN = /(^|[^a-z])(r1|o1|o3|qwq|reason|think)/i;

const trimTrailingSlash = url => url.replace(/\/+$/, '');

/**
 * Whether a model name suggests the model streams reasoning alongside its answer.
 * @param {string} modelId the provider's identifier for the model
 * @returns {boolean} true if the name matches a known reasoning family
 */
const looksLikeReasoningModel = modelId => REASONING_MODEL_PATTERN.test(modelId);

/**
 * Copy the fields of a chat message that belong on the wire.
 *
 * Reasoning text is deliberately not among them: DeepSeek rejects a request whose
 * history contains the reasoning it produced on an earlier turn.
 * @param {object} message a chat message
 * @returns {object} the message as the chat API expects it
 */
const toWireMessage = message => {
    const wire = {};
    for (const field of WIRE_MESSAGE_FIELDS) {
        if (typeof message[field] !== 'undefined') wire[field] = message[field];
    }
    return wire;
};

/**
 * Build the error thrown when the browser could not reach a provider at all.
 *
 * `fetch` reports a blocked cross-origin request as a bare `TypeError` with no
 * status and no readable body, which is indistinguishable from the server being
 * down. Local servers refuse browser requests until their CORS setting is
 * changed, so their messages name that fix.
 * @param {Error} error the rejection from `fetch`
 * @param {object} provider the provider descriptor
 * @param {string} url the URL that was requested
 * @returns {Error} the error to surface to the user
 */
const describeUnreachable = (error, provider, url) => {
    if (!(error instanceof TypeError)) return error;

    const origin = window.location.origin;
    switch (provider.id) {
    case PROVIDER_IDS.OLLAMA:
        return new Error(
            `Could not reach Ollama at ${url}. If Ollama is running, it is refusing requests from this ` +
            `page: set OLLAMA_ORIGINS to include ${origin} and restart Ollama.`
        );
    case PROVIDER_IDS.LM_STUDIO:
        return new Error(
            `Could not reach LM Studio at ${url}. If the local server is running, it is refusing requests ` +
            `from this page: turn on CORS in the LM Studio local server settings and restart the server.`
        );
    default:
        return new Error(`Could not reach ${provider.name} at ${url}. Check your internet connection.`);
    }
};

/**
 * Turn a non-ok response into an error that carries the status and the body.
 * @param {Response} response the failed response
 * @param {object} provider the provider descriptor
 * @param {string} url the URL that was requested
 * @returns {Promise<Error>} the error to throw
 */
const describeHttpFailure = async (response, provider, url) => {
    const body = (await response.text()).slice(0, ERROR_BODY_LIMIT);
    const detail = body ? ` -- ${body}` : '';
    const error = new Error(
        `${provider.name} request to ${url} failed: HTTP ${response.status} ${response.statusText}${detail}`
    );
    error.status = response.status;
    error.body = body;
    return error;
};

/**
 * Send one request to a provider, turning both transport and HTTP failures into
 * errors that say what the user can do about them.
 * @param {object} provider the provider descriptor
 * @param {string} url the URL to request
 * @param {object} init the `fetch` options
 * @returns {Promise<Response>} the successful response
 */
const sendRequest = async (provider, url, init) => {
    let response;
    try {
        response = await fetch(url, init);
    } catch (e) {
        // An abort is the caller cancelling, not a failure to reach the provider.
        if (e.name === 'AbortError') throw e;
        throw describeUnreachable(e, provider, url);
    }

    if (!response.ok) throw await describeHttpFailure(response, provider, url);

    return response;
};

/**
 * Read one Server-Sent Event block and hand its payload to the consumer.
 * @param {string} block the event text, without its terminating blank line
 * @param {function(object): void} onPayload called with each decoded event object
 * @returns {boolean} false once the stream has signalled that it is complete
 */
const handleEventBlock = (block, onPayload) => {
    const dataLines = block
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice('data:'.length).trim());

    if (dataLines.length === 0) return true;

    const data = dataLines.join('\n');
    if (data === DONE_PAYLOAD) return false;

    let payload;
    try {
        payload = JSON.parse(data);
    } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`AI provider: discarding unparseable stream event: ${data}`);
        return true;
    }

    onPayload(payload);
    return true;
};

/**
 * Read a Server-Sent Events response to completion.
 *
 * A network chunk can end anywhere, including the middle of a JSON payload, so
 * text is buffered and only handed on once the blank line that terminates an
 * event has arrived.
 * @param {Response} response a streaming response
 * @param {function(object): void} onPayload called with each decoded event object
 * @returns {Promise<void>} resolves when the stream ends
 */
const readEventStream = async (response, onPayload) => {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
        const {done, value} = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, {stream: true}).replace(/\r\n/g, '\n');

        let separator = buffer.indexOf(EVENT_SEPARATOR);
        while (separator !== -1) {
            const block = buffer.slice(0, separator);
            buffer = buffer.slice(separator + EVENT_SEPARATOR.length);
            if (!handleEventBlock(block, onPayload)) {
                // Release the connection rather than leave the rest of the body unread.
                await reader.cancel();
                return;
            }
            separator = buffer.indexOf(EVENT_SEPARATOR);
        }
    }

    const tail = buffer + decoder.decode();
    if (tail.trim()) handleEventBlock(tail, onPayload);
};

/**
 * Assemble the streamed fragments of one completion.
 * @param {object} callbacks the caller's per-fragment callbacks
 * @param {function(string): void} [callbacks.onContentDelta] called with each piece of the answer
 * @param {function(string): void} [callbacks.onReasoningDelta] called with each piece of the reasoning
 * @param {function(object): void} [callbacks.onToolCallDelta] called as each tool call is assembled
 * @returns {object} an accumulator exposing `accept` and `result`
 */
const createCompletionAccumulator = ({onContentDelta, onReasoningDelta, onToolCallDelta}) => {
    const toolCalls = new Map();
    let content = '';
    let reasoning = '';
    let usage = null;

    const acceptToolCallFragment = fragment => {
        const index = fragment.index ?? 0;
        let call = toolCalls.get(index);
        if (!call) {
            call = {index, id: '', name: '', rawArguments: ''};
            toolCalls.set(index, call);
        }

        if (fragment.id) call.id = fragment.id;
        // Most providers send the name whole and some send it in pieces; the
        // arguments always arrive in pieces, so both are concatenated.
        if (fragment.function?.name) call.name += fragment.function.name;
        const argumentsDelta = fragment.function?.arguments ?? '';
        call.rawArguments += argumentsDelta;

        onToolCallDelta?.({
            index,
            id: call.id,
            name: call.name,
            argumentsDelta,
            rawArguments: call.rawArguments
        });
    };

    const finalizeToolCall = call => {
        let args = {};
        if (call.rawArguments) {
            try {
                args = JSON.parse(call.rawArguments);
            } catch (e) {
                // eslint-disable-next-line no-console
                console.warn(
                    `AI provider: tool call "${call.name}" has unparseable arguments: ${call.rawArguments}`
                );
            }
        }

        return {
            // A local server sometimes omits the id, but a tool result has to name
            // the call it answers, so the position in the stream stands in for it.
            id: call.id || `tool_call_${call.index}`,
            name: call.name,
            args,
            rawArguments: call.rawArguments
        };
    };

    return {
        accept: payload => {
            if (payload.usage) usage = payload.usage;

            const delta = payload.choices?.[0]?.delta;
            if (!delta) return;

            if (delta.content) {
                content += delta.content;
                onContentDelta?.(delta.content);
            }

            // DeepSeek streams its thinking as `reasoning_content`; OpenRouter
            // normalizes the same thing to `reasoning`.
            const reasoningDelta = delta.reasoning_content ?? delta.reasoning;
            if (reasoningDelta) {
                reasoning += reasoningDelta;
                onReasoningDelta?.(reasoningDelta);
            }

            if (delta.tool_calls) delta.tool_calls.forEach(acceptToolCallFragment);
        },
        result: () => ({
            content,
            reasoning,
            toolCalls: Array.from(toolCalls.values())
                .sort((a, b) => a.index - b.index)
                .map(finalizeToolCall),
            usage
        })
    };
};

/**
 * Build a provider that speaks the OpenAI chat-completions protocol.
 * @param {object} options the endpoints, headers and capabilities of one provider
 * @param {string} options.id the provider's identifier, one of `PROVIDER_IDS`
 * @param {string} options.name the provider's name, used in error messages
 * @param {string} options.defaultBaseUrl where the provider lives until the user overrides it
 * @param {boolean} options.requiresApiKey whether a chat request needs a key
 * @param {boolean} options.supportsModelListing whether the settings UI can offer a model list
 * @param {boolean} [options.supportsStreamUsage] whether the provider reports token usage while streaming
 * @param {function(object): object} [options.buildHeaders] the provider-specific request headers
 * @param {string} [options.chatPath] the chat endpoint, relative to the base URL
 * @param {string} [options.modelsPath] the model-listing endpoint, relative to the base URL
 * @param {function(object): object} [options.mapModel] turns one listing entry into `{id, label, reasoning}`
 * @param {function(object): Promise<Array<object>>} [options.listModels] replaces the default model listing
 * @returns {object} the provider
 */
const createOpenAiProvider = ({
    id,
    name,
    defaultBaseUrl,
    requiresApiKey,
    supportsModelListing,
    supportsStreamUsage = false,
    buildHeaders = () => ({}),
    chatPath = '/chat/completions',
    modelsPath = '/models',
    mapModel = entry => ({id: entry.id, label: entry.id, reasoning: looksLikeReasoningModel(entry.id)}),
    listModels
}) => {
    const provider = {id, name, requiresApiKey, supportsModelListing};

    const endpoint = (baseUrl, path) => `${trimTrailingSlash(baseUrl || defaultBaseUrl)}${path}`;

    provider.listModels = listModels ?? (async ({baseUrl, apiKey, signal} = {}) => {
        const url = endpoint(baseUrl, modelsPath);
        const response = await sendRequest(provider, url, {headers: buildHeaders({apiKey}), signal});
        const payload = await response.json();
        return (payload.data ?? []).map(mapModel);
    });

    provider.chat = async ({
        messages,
        model,
        tools,
        apiKey,
        baseUrl,
        signal,
        onContentDelta,
        onReasoningDelta,
        onToolCallDelta
    }) => {
        if (!model) throw new Error(`No model is selected for ${name}. Choose one in the AI settings.`);
        if (requiresApiKey && !apiKey) throw new Error(`${name} needs an API key. Add one in the AI settings.`);

        const body = {
            model,
            messages: messages.map(toWireMessage),
            stream: true
        };
        if (tools?.length) body.tools = tools;
        // Only the hosted providers report token usage on a streamed response.
        if (supportsStreamUsage) body.stream_options = {include_usage: true};

        const url = endpoint(baseUrl, chatPath);
        const response = await sendRequest(provider, url, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', ...buildHeaders({apiKey})},
            body: JSON.stringify(body),
            signal
        });

        const accumulator = createCompletionAccumulator({onContentDelta, onReasoningDelta, onToolCallDelta});
        await readEventStream(response, accumulator.accept);
        return accumulator.result();
    };

    return provider;
};

/**
 * Fetch and decode JSON from a provider endpoint outside the OpenAI-compatible
 * surface, with the same failure reporting as the rest of the provider.
 * @param {object} provider the provider descriptor
 * @param {string} url the URL to request
 * @param {object} init the `fetch` options
 * @returns {Promise<object>} the decoded body
 */
const fetchProviderJson = async (provider, url, init) => {
    const response = await sendRequest(provider, url, init);
    return response.json();
};

export {
    createOpenAiProvider,
    fetchProviderJson,
    looksLikeReasoningModel,
    trimTrailingSlash
};
