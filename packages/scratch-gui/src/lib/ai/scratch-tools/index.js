/**
 * The Scratch tool layer: the operations an AI assistant can perform against
 * the live VM. Both the in-editor chat and the MCP bridge call through here, so
 * a capability added to this layer is available to both at once.
 */

export {TOOL_DEFINITIONS, WRITE_TOOL_NAMES, toChatTools} from './definitions';
export {createToolRunner} from './runner';
export {
    buildBlockCatalog,
    parseToolboxCatalog,
    serializeScript,
    summarizeProject,
    summarizeTarget
} from './serialize';
