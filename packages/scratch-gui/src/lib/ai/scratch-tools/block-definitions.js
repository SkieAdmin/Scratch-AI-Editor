import * as ScratchBlocks from 'scratch-blocks';

import {describeDefinition} from './block-shapes';

/** Shapes already read, by opcode. A block type's inputs and fields never change once defined. */
const shapes = new Map();

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

/**
 * The inputs and fields of a block type, read from its scratch-blocks definition.
 * @param {string} opcode the block type
 * @returns {?{inputs: Array<object>, fields: Array<object>}} the shape, or null
 *   when scratch-blocks has no definition it can read
 */
const describeBlockType = opcode => {
    if (shapes.has(opcode)) return shapes.get(opcode);
    if (!isScratchBlocksType(opcode)) return null;

    const shape = describeDefinition(opcode, ScratchBlocks.Blocks[opcode]);
    if (shape) shapes.set(opcode, shape);
    return shape;
};

export {describeBlockType, isScratchBlocksType};
