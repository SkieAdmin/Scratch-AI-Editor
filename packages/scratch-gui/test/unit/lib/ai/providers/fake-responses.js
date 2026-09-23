import {TextDecoder, TextEncoder} from 'util';

// jsdom does not define the encoding globals that the SSE reader relies on.
global.TextDecoder = global.TextDecoder ?? TextDecoder;

const encoder = new TextEncoder();

/**
 * A response whose body streams the given chunks, byte for byte, so a test can
 * place a chunk boundary wherever it likes.
 * @param {Array<string>} chunks the text of each network chunk, in order
 * @returns {object} a stand-in for a streaming `fetch` response
 */
const streamingResponse = chunks => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    body: {
        getReader: () => {
            let next = 0;
            return {
                read: () => Promise.resolve(next < chunks.length ?
                    {done: false, value: encoder.encode(chunks[next++])} :
                    {done: true}),
                cancel: () => Promise.resolve()
            };
        }
    }
});

/**
 * A successful JSON response.
 * @param {object} payload the decoded body
 * @returns {object} a stand-in for a `fetch` response
 */
const jsonResponse = payload => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(payload)
});

/**
 * A failed response.
 * @param {number} status the HTTP status
 * @param {string} statusText the HTTP status text
 * @param {string} body the response body
 * @returns {object} a stand-in for a `fetch` response
 */
const errorResponse = (status, statusText, body) => ({
    ok: false,
    status,
    statusText,
    text: () => Promise.resolve(body)
});

export {
    errorResponse,
    jsonResponse,
    streamingResponse
};
