import connectScratchBlocks from '../../../../../src/lib/blocks';
import {describeBlockType, isScratchBlocksType} from '../../../../../src/lib/ai/scratch-tools/block-definitions';

/*
 * These run against the real scratch-blocks definitions, so they show that
 * every way a core block defines itself can be read without a workspace.
 */
describe('reading scratch-blocks definitions', () => {
    test('knows the menus the VM has no primitive for', () => {
        ['looks_backdrops', 'looks_costume', 'sensing_touchingobjectmenu', 'sensing_keyoptions']
            .forEach(opcode => expect(isScratchBlocksType(opcode)).toBe(true));
        expect(isScratchBlocksType('looks_backdrop')).toBe(false);
    });

    test('finds a C-block\'s condition and branches', () => {
        expect(describeBlockType('control_if').inputs).toEqual([
            {name: 'CONDITION', kind: 'boolean'},
            {name: 'SUBSTACK', kind: 'branch'}
        ]);
        expect(describeBlockType('control_if_else').inputs).toEqual([
            {name: 'CONDITION', kind: 'boolean'},
            {name: 'SUBSTACK', kind: 'branch'},
            {name: 'SUBSTACK2', kind: 'branch'}
        ]);
    });

    test('finds a hat\'s dropdown and its options', () => {
        const [keyOption] = describeBlockType('event_whenkeypressed').fields;

        expect(keyOption.name).toBe('KEY_OPTION');
        const values = keyOption.options.map(([, value]) => value);
        expect(values).toEqual(expect.arrayContaining(['space', 'left arrow', 'any', 'a', '7']));
    });

    test('reads a block built one input at a time rather than from JSON', () => {
        const [stopOption] = describeBlockType('control_stop').fields;

        expect(stopOption.name).toBe('STOP_OPTION');
        expect(stopOption.options.map(([, value]) => value))
            .toEqual(['all', 'this script', 'other scripts in sprite']);
    });

    test('marks a variable field and a menu input', () => {
        expect(describeBlockType('data_setvariableto')).toEqual({
            inputs: [{name: 'VALUE', kind: 'value'}],
            fields: [{name: 'VARIABLE', variable: 'variable'}]
        });
        expect(describeBlockType('looks_switchbackdropto').inputs).toEqual([{name: 'BACKDROP', kind: 'value'}]);
        expect(describeBlockType('operator_and').inputs.map(input => input.kind)).toEqual(['boolean', 'boolean']);
    });

    test('answers null for a block it does not know', () => {
        expect(describeBlockType('not_a_block')).toBeNull();
    });

    /*
     * scratch-blocks leaves the backdrop hat undefined; the editor defines it,
     * with a menu it fills from the project each time it opens.
     */
    test('reads the menus the editor defines once it has connected scratch-blocks to the VM', () => {
        expect(describeBlockType('event_whenbackdropswitchesto')).toBeNull();

        connectScratchBlocks({runtime: {}});

        expect(describeBlockType('event_whenbackdropswitchesto').fields)
            .toEqual([{name: 'BACKDROP', options: 'dynamic'}]);
        expect(describeBlockType('looks_costume').fields).toEqual([{name: 'COSTUME', options: 'dynamic'}]);
    });
});
