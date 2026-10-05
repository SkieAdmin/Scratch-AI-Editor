import * as ScratchBlocks from 'scratch-blocks';

/**
 * Whether scratch-blocks has a definition for a block type.
 *
 * This is the registry the editor draws blocks from. It knows every core
 * block, including the menus that sit in an input as a shadow and that the VM
 * implements no primitive for, and the editor adds each extension's blocks to
 * it when the extension loads.
 * @param {string} opcode the block type
 * @returns {boolean} true if the editor can draw a block of this type
 */
const isScratchBlocksType = opcode => Object.prototype.hasOwnProperty.call(ScratchBlocks.Blocks, opcode);

export {isScratchBlocksType};
