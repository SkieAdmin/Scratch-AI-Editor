/**
 * Build a tool result that carries a picture.
 *
 * The result is shaped as MCP tool content, which the bridge hands to the
 * client unchanged, so the picture reaches the model as an image rather than
 * as a very long string.
 * @param {{data: string, mimeType: string}} image the picture, base64-encoded, and its media type
 * @param {object} details what else the model should know about the picture
 * @returns {{content: Array<object>}} the result
 */
const imageResult = (image, details) => ({
    content: [
        {type: 'image', data: image.data, mimeType: image.mimeType},
        {type: 'text', text: JSON.stringify(details)}
    ]
});

/**
 * Split a base64 data URL, such as a canvas snapshot, into its data and media type.
 * @param {string} dataUrl the URL
 * @returns {{data: string, mimeType: string}} the picture
 */
const parseDataUrl = dataUrl => {
    const match = /^data:([^;,]+);base64,(.*)$/.exec(dataUrl);
    if (!match) {
        throw new Error(`Expected a base64 data URL, got one starting "${String(dataUrl).slice(0, 30)}".`);
    }
    return {mimeType: match[1], data: match[2]};
};

export {imageResult, parseDataUrl};
