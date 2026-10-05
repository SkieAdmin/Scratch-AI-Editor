import {BRANCH_INPUT_PREFIX} from './serialize';

/*
 * Block heights in workspace units, after the editor's renderer: a stack
 * block is at least 48 tall, a hat adds its cap, and a C-block's mouth wraps
 * its branch. They err on the tall side, because too much space between
 * scripts only looks loose, while too little makes them overlap.
 */
const STACK_BLOCK_HEIGHT = 56;
const HAT_CAP_HEIGHT = 32;
const EMPTY_BRANCH_HEIGHT = 24;
const C_BLOCK_FOOT_HEIGHT = 32;

/** The space Clean up Blocks leaves between scripts: the renderer's minimum block height. */
const SCRIPT_GAP = 48;

/**
 * How much a script's x position counts when Clean up orders scripts: Blockly
 * reads them top to bottom along a line tilted by 3 degrees.
 */
const X_WEIGHT = Math.sin(3 * Math.PI / 180);

/** A custom block's "define" block is drawn as a hat, though the runtime does not start it as one. */
const HAT_SHAPED = ['procedures_definition'];

/**
 * Lay a target's scripts out the way right-click > Clean up Blocks does: in
 * one column at the left edge, in their current top-to-bottom order, with a
 * gap between each.
 *
 * The VM knows nothing about how big a block is drawn, so heights are
 * estimated from each script's shape.
 * @param {object} blocks the target's Blocks container
 * @param {Function} isHat whether an opcode is a hat block
 * @returns {Array<{topBlockId: string, x: number, y: number}>} where each script goes
 */
const cleanUpLayout = (blocks, isHat) => {
    const hatShaped = opcode => isHat(opcode) || HAT_SHAPED.includes(opcode);

    const stackHeight = firstBlockId => {
        let height = 0;
        for (let blockId = firstBlockId; blockId; blockId = blocks.getNextBlock(blockId)) {
            height += blockHeight(blocks.getBlock(blockId));
        }
        return height;
    };

    const blockHeight = block => {
        const branches = Object.keys(block.inputs).filter(name => name.startsWith(BRANCH_INPUT_PREFIX));
        let height = STACK_BLOCK_HEIGHT * Math.max(1, branches.length);
        branches.forEach(name => {
            const first = block.inputs[name].block;
            height += first ? stackHeight(first) : EMPTY_BRANCH_HEIGHT;
        });
        if (branches.length > 0) height += C_BLOCK_FOOT_HEIGHT;
        if (hatShaped(block.opcode)) height += HAT_CAP_HEIGHT;
        return height;
    };

    const position = block => (block.y || 0) + (X_WEIGHT * (block.x || 0));
    const ordered = blocks.getScripts()
        .map(topBlockId => blocks.getBlock(topBlockId))
        .sort((a, b) => position(a) - position(b));

    let y = 0;
    return ordered.map(block => {
        const placed = {topBlockId: block.id, x: 0, y};
        y += stackHeight(block.id) + SCRIPT_GAP;
        return placed;
    });
};

export {cleanUpLayout};
