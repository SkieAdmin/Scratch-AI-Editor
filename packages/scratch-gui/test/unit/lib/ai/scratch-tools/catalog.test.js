import connectScratchBlocks from '../../../../../src/lib/blocks';
import {completeCatalog} from '../../../../../src/lib/ai/scratch-tools/catalog';
import {createToolRunner} from '../../../../../src/lib/ai/scratch-tools/runner';
import {makeTarget, makeVm} from './fake-vm';

jest.mock('../../../../../src/lib/make-toolbox-xml', () => ({
    __esModule: true,
    default: () => '<xml></xml>'
}));

/** The parts of the editor's toolbox these tests look at, written as make-toolbox-xml writes them. */
const TOOLBOX_XML = `<xml>
    <category name="Motion" toolboxitemid="motion">
        <block type="motion_goto">
            <value name="TO"><shadow type="motion_goto_menu"></shadow></value>
        </block>
    </category>
    <category name="Looks" toolboxitemid="looks">
        <block type="looks_switchcostumeto">
            <value name="COSTUME"><shadow type="looks_costume"><field name="COSTUME">costume1</field></shadow></value>
        </block>
        <block type="looks_switchbackdropto">
            <value name="BACKDROP"><shadow type="looks_backdrops"><field name="BACKDROP">Jungle</field></shadow></value>
        </block>
    </category>
    <category name="Sound" toolboxitemid="sound">
        <block type="sound_play">
            <value name="SOUND_MENU">
                <shadow type="sound_sounds_menu"><field name="SOUND_MENU">Meow</field></shadow>
            </value>
        </block>
    </category>
    <category name="Events" toolboxitemid="event">
        <block type="event_whenkeypressed"></block>
        <block type="event_whenbackdropswitchesto"></block>
    </category>
    <category name="Control" toolboxitemid="control">
        <block type="control_if"/>
        <block type="control_if_else"/>
    </category>
</xml>`;

/**
 * A project with two backdrops, a second sprite and a variable, with the
 * editor's own menus connected to scratch-blocks as the editor does on load.
 * @returns {object} the fake vm and a runner over it
 */
const makeProject = () => {
    const made = makeVm();
    made.stage.getCostumes().splice(0, 1, {name: 'Jungle'}, {name: 'Woods'});
    const dog = makeTarget({id: 'dog-id', name: 'Dog', costumes: [{name: 'dog1'}]});
    made.vm.runtime.targets.push(dog);
    connectScratchBlocks(made.vm);
    const {runTool} = createToolRunner(made.vm, {getToolboxXml: () => TOOLBOX_XML});
    return {...made, runTool};
};

const findBlock = (catalog, opcode) => catalog.blocks.find(entry => entry.opcode === opcode);

/*
 * The catalogue came from the toolbox alone, which lists only the inputs that
 * hold a typed-in default. It showed no fields at all for hats and C-blocks.
 */
describe('get_block_catalog', () => {
    test('reports the BACKDROP field of "when backdrop switches to", with the backdrops there are', async () => {
        const {runTool} = makeProject();

        const catalog = await runTool('get_block_catalog', {targetId: 'Cat', category: 'event'});

        expect(findBlock(catalog, 'event_whenbackdropswitchesto').fields)
            .toEqual([{name: 'BACKDROP', options: ['Jungle', 'Woods']}]);
    });

    test('reports the KEY_OPTION field of "when key pressed"', async () => {
        const {runTool} = makeProject();

        const catalog = await runTool('get_block_catalog', {targetId: 'Cat', search: 'whenkeypressed'});

        const [keyOption] = findBlock(catalog, 'event_whenkeypressed').fields;
        expect(keyOption.name).toBe('KEY_OPTION');
        expect(keyOption.options).toEqual(expect.arrayContaining(['space', 'up arrow', 'any', 'z', '0']));
    });

    test('reports the condition and branches of "if" and "if else"', async () => {
        const {runTool} = makeProject();

        const catalog = await runTool('get_block_catalog', {targetId: 'Cat', category: 'control'});

        expect(findBlock(catalog, 'control_if').inputs).toEqual([
            {name: 'CONDITION', kind: 'boolean'},
            {name: 'SUBSTACK', kind: 'branch'}
        ]);
        expect(findBlock(catalog, 'control_if_else').inputs).toEqual([
            {name: 'CONDITION', kind: 'boolean'},
            {name: 'SUBSTACK', kind: 'branch'},
            {name: 'SUBSTACK2', kind: 'branch'}
        ]);
    });

    test('reports each menu input\'s menu, field and current items', async () => {
        const {runTool} = makeProject();

        const catalog = await runTool('get_block_catalog', {targetId: 'Cat'});

        expect(findBlock(catalog, 'looks_switchbackdropto').inputs).toEqual([{
            name: 'BACKDROP',
            kind: 'menu',
            shadow: 'looks_backdrops',
            default: 'Jungle',
            menu: 'looks_backdrops',
            field: 'BACKDROP',
            options: ['Jungle', 'Woods', 'next backdrop', 'previous backdrop', 'random backdrop']
        }]);
        expect(findBlock(catalog, 'looks_switchcostumeto').inputs[0])
            .toMatchObject({kind: 'menu', menu: 'looks_costume', field: 'COSTUME', options: ['costume1', 'costume2']});
        expect(findBlock(catalog, 'sound_play').inputs[0])
            .toMatchObject({kind: 'menu', menu: 'sound_sounds_menu', field: 'SOUND_MENU', options: ['Meow']});
        expect(findBlock(catalog, 'motion_goto').inputs[0]).toMatchObject({
            kind: 'menu',
            menu: 'motion_goto_menu',
            field: 'TO',
            // Every other sprite, but not the one the script is on.
            options: ['_random_', '_mouse_', 'Dog'],
            optionLabels: {_random_: 'random position', _mouse_: 'mouse-pointer'}
        });
    });

    test('fills a menu from the target the scripts would be on', async () => {
        const {runTool} = makeProject();

        const catalog = await runTool('get_block_catalog', {targetId: 'Dog', search: 'looks_switchcostumeto'});

        expect(findBlock(catalog, 'looks_switchcostumeto').inputs[0].options).toEqual(['dog1']);
    });
});

describe('completeCatalog', () => {
    const shapes = {
        data_setvariableto: {
            inputs: [{name: 'VALUE', kind: 'value'}],
            fields: [{name: 'VARIABLE', variable: 'variable'}]
        },
        pen_setPenColorParamTo: {
            inputs: [{name: 'COLOR_PARAM', kind: 'value'}, {name: 'VALUE', kind: 'value'}],
            fields: []
        },
        pen_menu_colorParam: {
            inputs: [],
            fields: [{name: 'colorParam', options: [['color', 'color'], ['saturation', 'saturation']]}]
        }
    };
    const describeBlock = opcode => shapes[opcode] || null;

    test('lists the variables a variable field can name', () => {
        const {vm, sprite} = makeVm();
        sprite.variables['mine-id'] = {id: 'mine-id', name: 'my speed', type: '', value: 0};

        const [entry] = completeCatalog(
            [{opcode: 'data_setvariableto', category: 'data', inputs: [], fields: [], isHat: false}],
            {vm, target: sprite, describeBlock}
        );

        expect(entry.fields).toEqual([{name: 'VARIABLE', variable: 'variable', options: ['my speed', 'score']}]);
        expect(entry.inputs).toEqual([{name: 'VALUE', kind: 'value'}]);
    });

    test('gives an extension menu input its menu and items', () => {
        const {vm, sprite} = makeVm();
        vm.runtime._blockInfo.push({
            id: 'pen',
            blocks: [{
                json: {type: 'pen_setPenColorParamTo'},
                info: {arguments: {COLOR_PARAM: {type: 'string', menu: 'colorParam'}, VALUE: {type: 'number'}}}
            }],
            menus: [{json: {type: 'pen_menu_colorParam', args0: [{type: 'field_dropdown', name: 'colorParam'}]}}],
            menuInfo: {colorParam: {acceptReporters: true, items: ['color', 'saturation']}}
        });

        const [entry] = completeCatalog([{
            opcode: 'pen_setPenColorParamTo',
            category: 'pen',
            inputs: [
                {name: 'COLOR_PARAM', type: 'string', default: 'color', menu: 'colorParam'},
                {name: 'VALUE', type: 'number', default: 50}
            ],
            fields: [],
            isHat: false
        }], {vm, target: sprite, describeBlock});

        expect(entry.inputs).toEqual([
            {
                name: 'COLOR_PARAM',
                kind: 'menu',
                default: 'color',
                menu: 'pen_menu_colorParam',
                field: 'colorParam',
                options: ['color', 'saturation']
            },
            {name: 'VALUE', kind: 'value', default: 50}
        ]);
    });

    test('still describes a block whose definition it cannot read, from the toolbox', () => {
        const {vm, sprite} = makeVm();

        const [entry] = completeCatalog([{
            opcode: 'motion_movesteps',
            category: 'motion',
            inputs: [{name: 'STEPS', shadow: 'math_number', default: '10'}],
            fields: [],
            isHat: false
        }], {vm, target: sprite, describeBlock: () => null});

        expect(entry.inputs).toEqual([{name: 'STEPS', kind: 'value', shadow: 'math_number', default: '10'}]);
    });
});
