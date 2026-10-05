import {cleanUpLayout} from '../../../../../src/lib/ai/scratch-tools/layout';

/**
 * A Blocks container holding the given records, as the layout reads it.
 * @param {Array<object>} records the blocks, with `id`, `opcode`, `next`, `inputs`, and `x`/`y` on top blocks
 * @returns {object} the container
 */
const blocksOf = records => {
    const byId = Object.fromEntries(records.map(record => [record.id, {inputs: {}, next: null, ...record}]));
    return {
        getBlock: id => byId[id],
        getNextBlock: id => byId[id].next,
        getScripts: () => records.filter(record => 'x' in record).map(record => record.id)
    };
};

const isHat = opcode => opcode.startsWith('event_when');

describe('cleanUpLayout', () => {
    test('stacks scripts at the left edge in their top-to-bottom order', () => {
        const blocks = blocksOf([
            {id: 'low', opcode: 'motion_movesteps', x: 300, y: 400},
            {id: 'high', opcode: 'motion_movesteps', x: 50, y: 10}
        ]);

        const layout = cleanUpLayout(blocks, isHat);

        expect(layout.map(placed => placed.topBlockId)).toEqual(['high', 'low']);
        expect(layout.every(placed => placed.x === 0)).toBe(true);
        expect(layout[0].y).toBe(0);
    });

    test('leaves room for every block of a script, its branches included', () => {
        const blocks = blocksOf([
            {id: 'hat', opcode: 'event_whenflagclicked', next: 'loop', x: 0, y: 0},
            {id: 'loop', opcode: 'control_forever', inputs: {SUBSTACK: {block: 'step'}}},
            {id: 'step', opcode: 'motion_movesteps', next: 'turn'},
            {id: 'turn', opcode: 'motion_turnright'},
            {id: 'other', opcode: 'motion_movesteps', x: 0, y: 50}
        ]);

        const [first, second] = cleanUpLayout(blocks, isHat);

        // A hat, a forever loop wrapping two blocks and its foot: well over four plain blocks.
        expect(second.y - first.y).toBeGreaterThan(4 * 48);
    });

    test('puts more room under a taller script', () => {
        const short = cleanUpLayout(blocksOf([
            {id: 'a', opcode: 'motion_movesteps', x: 0, y: 0},
            {id: 'b', opcode: 'motion_movesteps', x: 0, y: 10}
        ]), isHat);
        const tall = cleanUpLayout(blocksOf([
            {id: 'a', opcode: 'motion_movesteps', next: 'a2', x: 0, y: 0},
            {id: 'a2', opcode: 'motion_movesteps', next: 'a3'},
            {id: 'a3', opcode: 'motion_movesteps'},
            {id: 'b', opcode: 'motion_movesteps', x: 0, y: 10}
        ]), isHat);

        expect(tall[1].y).toBeGreaterThan(short[1].y);
    });

    test('counts both branches of an if-else, and gives an empty branch some room', () => {
        const ifElse = cleanUpLayout(blocksOf([
            {id: 'if', opcode: 'control_if_else', x: 0, y: 0, inputs: {SUBSTACK: {block: null}, SUBSTACK2: {block: null}}},
            {id: 'next', opcode: 'motion_movesteps', x: 0, y: 10}
        ]), isHat);
        const plain = cleanUpLayout(blocksOf([
            {id: 'if', opcode: 'motion_movesteps', x: 0, y: 0},
            {id: 'next', opcode: 'motion_movesteps', x: 0, y: 10}
        ]), isHat);

        expect(ifElse[1].y).toBeGreaterThan(plain[1].y + (2 * 24));
    });
});
