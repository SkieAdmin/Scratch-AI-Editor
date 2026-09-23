import {buildBlockCatalog, parseToolboxCatalog} from '../../../../../src/lib/ai/scratch-tools/serialize';

const TOOLBOX_XML = `<xml>
    <category name="Motion" toolboxitemid="motion">
        <block type="motion_movesteps">
            <value name="STEPS">
                <shadow type="math_number">
                    <field name="NUM">10</field>
                </shadow>
            </value>
        </block>
        <block type="motion_pointindirection">
            <value name="DIRECTION">
                <shadow type="math_angle">
                    <field name="NUM">90</field>
                </shadow>
            </value>
        </block>
    </category>
    <category name="Control" toolboxitemid="control">
        <block type="control_repeat">
            <value name="TIMES">
                <shadow type="math_whole_number">
                    <field name="NUM">10</field>
                </shadow>
            </value>
        </block>
        <block type="control_stop">
            <field name="STOP_OPTION">all</field>
        </block>
    </category>
</xml>`;

describe('parseToolboxCatalog', () => {
    test('reports every block type once, with its category', () => {
        const entries = parseToolboxCatalog(TOOLBOX_XML);

        expect(entries.map(entry => entry.opcode)).toEqual([
            'motion_movesteps',
            'motion_pointindirection',
            'control_repeat',
            'control_stop'
        ]);
        expect(entries[0].category).toBe('motion');
        expect(entries[2].category).toBe('control');
    });

    test('reports each input with the slot type and default value it expects', () => {
        const [movesteps] = parseToolboxCatalog(TOOLBOX_XML);

        expect(movesteps.inputs).toEqual([
            {name: 'STEPS', shadow: 'math_number', default: '10'}
        ]);
        expect(movesteps.fields).toEqual([]);
    });

    test('reports dropdown fields separately from inputs', () => {
        const stop = parseToolboxCatalog(TOOLBOX_XML)
            .find(entry => entry.opcode === 'control_stop');

        expect(stop.inputs).toEqual([]);
        expect(stop.fields).toEqual([{name: 'STOP_OPTION', default: 'all'}]);
    });
});

describe('buildBlockCatalog', () => {
    const runtime = {
        _blockInfo: [{
            id: 'pen',
            blocks: [
                {json: {type: 'pen_penDown'}, info: {text: 'pen down', arguments: {}}},
                {json: {type: 'pen_setPenSizeTo'},
                    info: {
                        text: 'set pen size to [SIZE]',
                        arguments: {SIZE: {type: 'number', defaultValue: 1}}
                    }},
                // A separator carries no scratch-blocks JSON.
                {info: {}}
            ]
        }],
        _primitives: {
            motion_movesteps: () => {},
            motion_goto_menu: () => {}
        },
        getIsHat: opcode => opcode === 'event_whenflagclicked'
    };

    test('merges toolbox blocks, extension blocks and runtime-only opcodes', () => {
        const catalog = buildBlockCatalog(runtime, TOOLBOX_XML);
        const opcodes = catalog.map(entry => entry.opcode);

        expect(opcodes).toContain('motion_movesteps');
        expect(opcodes).toContain('pen_setPenSizeTo');
        // Implemented by the runtime but absent from the toolbox, so listed without detail.
        expect(opcodes).toContain('motion_goto_menu');
        // The separator has no opcode and must not appear.
        /* eslint-disable-next-line no-undefined */
        expect(opcodes).not.toContain(undefined);
    });

    test('keeps the toolbox detail for an opcode the runtime also implements', () => {
        const movesteps = buildBlockCatalog(runtime, TOOLBOX_XML)
            .find(entry => entry.opcode === 'motion_movesteps');

        expect(movesteps.inputs).toEqual([{name: 'STEPS', shadow: 'math_number', default: '10'}]);
    });

    test('carries an extension block\'s own argument metadata', () => {
        const setPenSize = buildBlockCatalog(runtime, TOOLBOX_XML)
            .find(entry => entry.opcode === 'pen_setPenSizeTo');

        expect(setPenSize.category).toBe('pen');
        expect(setPenSize.inputs).toEqual([
            /* eslint-disable-next-line no-undefined */
            {name: 'SIZE', type: 'number', default: 1, menu: undefined}
        ]);
    });

    test('flags hat blocks', () => {
        const catalog = buildBlockCatalog(runtime, TOOLBOX_XML);

        expect(catalog.every(entry => entry.isHat === false)).toBe(true);
    });
});
