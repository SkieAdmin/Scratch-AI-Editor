import {TOOL_DEFINITIONS} from '../../../../../src/lib/ai/scratch-tools/definitions';
import {createToolRunner} from '../../../../../src/lib/ai/scratch-tools/runner';
import {MENU_INPUTS, MENU_SHADOW_FIELDS} from '../../../../../src/lib/ai/scratch-tools/menus';
import {PRIMITIVE_OPCODES, makeVm} from './fake-vm';

// None of these assertions need a real toolbox, and loading scratch-blocks into jsdom
// to produce one would be pure cost.
jest.mock('../../../../../src/lib/make-toolbox-xml', () => ({
    __esModule: true,
    default: () => '<xml></xml>'
}));

// The same goes for the scratch-blocks registry. This stands in for it with a
// block type that only scratch-blocks defines: the VM implements no primitive for it.
jest.mock('../../../../../src/lib/ai/scratch-tools/block-definitions', () => ({
    isScratchBlocksType: opcode => opcode === 'event_touchingobjectmenu'
}));

/*
 * An earlier version made every write carry the revision it was planned against
 * and rejected any mismatch. The counter only ever moved on the assistant's own
 * writes, so a turn that made several edits failed every call after the first
 * and retried them forever. It could not see a change made in the editor, which
 * was the thing it was supposed to guard against.
 */
describe('createToolRunner writing several times in one turn', () => {
    test('a second write is not blocked by the first', async () => {
        const {vm} = makeVm();
        const runner = createToolRunner(vm);

        await runner.runTool('rename_sprite', {targetId: 'Cat', name: 'Dog'});
        const second = await runner.runTool('rename_sprite', {targetId: 'Dog', name: 'Bird'});

        expect(second.name).toBe('Bird');
        expect(vm.renameSprite).toHaveBeenCalledTimes(2);
    });

    test('a long run of writes all go through', async () => {
        const {vm} = makeVm();
        const runner = createToolRunner(vm);

        for (let i = 0; i < 10; i++) {
            await runner.runTool('rename_sprite', {targetId: vm.runtime.targets[1].name, name: `Sprite${i}`});
        }

        expect(vm.renameSprite).toHaveBeenCalledTimes(10);
    });
});

describe('createToolRunner argument validation', () => {
    test('an unknown opcode is rejected with a pointer to the catalogue', async () => {
        const {vm} = makeVm();
        const runner = createToolRunner(vm);

        await expect(runner.runTool('create_script', {
            targetId: 'Cat',
            blocks: [{opcode: 'motion_teleport_to_mars'}]
        })).rejects.toThrow(/motion_teleport_to_mars.*get_block_catalog/s);
    });

    test('a missing target is rejected and lists the targets that do exist', async () => {
        const {vm} = makeVm();
        const runner = createToolRunner(vm);

        await expect(runner.runTool('get_target', {targetId: 'Nobody'}))
            .rejects.toThrow(/No sprite or target matches "Nobody".*Cat/s);
    });

    test('a variable field naming a variable that does not exist is rejected', async () => {
        const {vm} = makeVm();
        const runner = createToolRunner(vm);

        await expect(runner.runTool('create_script', {
            targetId: 'Cat',
            blocks: [{opcode: 'data_setvariableto', fields: {VARIABLE: 'lives'}, inputs: {VALUE: 0}}]
        })).rejects.toThrow(/no variable named "lives".*set_variable/s);
    });

    test('an unknown tool name is rejected', async () => {
        const {vm} = makeVm();
        const runner = createToolRunner(vm);

        await expect(runner.runTool('explode', {})).rejects.toThrow(/no tool called "explode"/);
    });

    test('nothing is written when validation fails part way through a script', async () => {
        const {sprite, vm} = makeVm();
        const runner = createToolRunner(vm);

        await expect(runner.runTool('create_script', {
            targetId: 'Cat',
            blocks: [{opcode: 'event_whenflagclicked'}, {opcode: 'not_a_real_block'}]
        })).rejects.toThrow();

        expect(sprite.blocks.createBlock).not.toHaveBeenCalled();
    });
});

describe('create_script', () => {
    test('builds a connected stack with a literal shadow and refreshes the workspace', async () => {
        const {sprite, vm} = makeVm();
        const runner = createToolRunner(vm);

        const result = await runner.runTool('create_script', {
            targetId: 'Cat',
            x: 40,
            y: 50,
            blocks: [
                {opcode: 'event_whenflagclicked'},
                {opcode: 'motion_movesteps', inputs: {STEPS: 25}}
            ]
        });

        expect(result.blockCount).toBe(3);

        const created = sprite.blocks.createBlock.mock.calls.map(call => call[0]);
        const [hat, move, shadow] = created;

        expect(hat.opcode).toBe('event_whenflagclicked');
        expect(hat.topLevel).toBe(true);
        expect(hat.parent).toBeNull();
        expect(hat.x).toBe(40);
        expect(hat.y).toBe(50);
        expect(hat.next).toBe(move.id);

        expect(move.parent).toBe(hat.id);
        expect(move.topLevel).toBe(false);
        expect(move.inputs.STEPS).toEqual({name: 'STEPS', block: shadow.id, shadow: shadow.id});

        expect(shadow.opcode).toBe('math_number');
        expect(shadow.shadow).toBe(true);
        expect(shadow.fields.NUM).toEqual({name: 'NUM', value: '25'});

        expect(vm.refreshWorkspace).toHaveBeenCalled();
    });

    test('a target that is not being edited gets a target update instead of a workspace update', async () => {
        const {stage, vm} = makeVm();
        const runner = createToolRunner(vm);

        await runner.runTool('create_script', {
            targetId: 'stage',
            blocks: [{opcode: 'event_whenflagclicked'}]
        });

        expect(stage.blocks.createBlock).toHaveBeenCalled();
        expect(vm.refreshWorkspace).not.toHaveBeenCalled();
        expect(vm.emitTargetsUpdate).toHaveBeenCalled();
    });
});

describe('get_project_summary', () => {
    test('reports names, counts, variable values and script shapes', async () => {
        const {vm} = makeVm();
        const runner = createToolRunner(vm);

        const summary = await runner.runTool('get_project_summary', {});

        expect(summary.editingTargetId).toBe('sprite-id');
        expect(summary.totals).toEqual({sprites: 1, scripts: 1});

        expect(summary.stage.name).toBe('Stage');
        expect(summary.stage.variables).toEqual([
            {id: 'score-id', name: 'score', kind: 'variable', value: 7}
        ]);

        expect(summary.sprites).toHaveLength(1);
        const [cat] = summary.sprites;
        expect(cat).toMatchObject({
            id: 'sprite-id',
            name: 'Cat',
            x: 12,
            y: -30,
            costumeCount: 2,
            soundCount: 1
        });
        expect(cat.scripts).toEqual([
            {topBlockId: 'top1', startsWith: 'event_whenflagclicked', blockCount: 2}
        ]);
    });

    test('the digest carries no asset payloads', async () => {
        const {vm} = makeVm();
        const runner = createToolRunner(vm);

        const summary = await runner.runTool('get_project_summary', {});

        expect(JSON.stringify(summary)).not.toMatch(/assetId|dataFormat|md5ext/);
    });
});

describe('get_target', () => {
    test('expands each script block by block, with literals inlined', async () => {
        const {vm} = makeVm();
        const runner = createToolRunner(vm);

        const detail = await runner.runTool('get_target', {targetId: 'Cat'});

        expect(detail.scripts).toEqual([{
            topBlockId: 'top1',
            x: 10,
            y: 20,
            blocks: [
                {id: 'top1', opcode: 'event_whenflagclicked'},
                {id: 'move1', opcode: 'motion_movesteps', inputs: {STEPS: '10'}}
            ]
        }]);
    });
});

describe('set_variable', () => {
    test('creates a global variable on the stage when it does not exist yet', async () => {
        const {stage, vm} = makeVm();
        const runner = createToolRunner(vm);

        const result = await runner.runTool('set_variable', {name: 'lives', value: 3});

        expect(result.created).toBe(true);
        expect(result.ownerId).toBe('stage-id');
        expect(stage.createVariable).toHaveBeenCalledWith(result.id, 'lives', '');
        expect(vm.setVariableValue).toHaveBeenCalledWith('stage-id', result.id, 3);
        expect(vm.refreshWorkspace).toHaveBeenCalled();
    });

    test('updates an existing variable in place', async () => {
        const {vm} = makeVm();
        const runner = createToolRunner(vm);

        const result = await runner.runTool('set_variable', {name: 'score', value: 42});

        expect(result.created).toBe(false);
        expect(result.id).toBe('score-id');
        expect(vm.setVariableValue).toHaveBeenCalledWith('stage-id', 'score-id', 42);
    });

    test('a list value must be an array', async () => {
        const {vm} = makeVm();
        const runner = createToolRunner(vm);

        await expect(runner.runTool('set_variable', {name: 'inventory', kind: 'list', value: 'sword'}))
            .rejects.toThrow(/must be an array/);
    });
});

describe('extensions and broadcasts', () => {
    /*
     * `set_variable` cannot make a broadcast, so telling the model to create one
     * that way left it retrying the same rejected script until it ran out of
     * rounds. Naming a message is how the editor creates one.
     */
    test('naming a new broadcast message creates it instead of failing', async () => {
        const {vm, stage} = makeVm();
        const {runTool} = createToolRunner(vm);

        await runTool('create_script', {
            targetId: 'Cat',
            blocks: [
                {opcode: 'event_whenflagclicked'},
                {opcode: 'event_broadcast', inputs: {}, fields: {BROADCAST_OPTION: 'tell her'}}
            ]
        });

        expect(stage.createVariable).toHaveBeenCalledWith(expect.any(String), 'tell her', 'broadcast_msg');
        // The editing target's workspace has to be told, or the new block is invisible.
        expect(vm.refreshWorkspace).toHaveBeenCalled();
    });

    test('a script that speaks loads the text2speech extension first', async () => {
        const {vm} = makeVm();
        const {runTool} = createToolRunner(vm);

        await runTool('create_script', {
            targetId: 'Cat',
            blocks: [
                {opcode: 'event_whenflagclicked'},
                {opcode: 'text2speech_speakAndWait', inputs: {WORDS: 'hello'}}
            ]
        });

        expect(vm.extensionManager.loadExtensionURL).toHaveBeenCalledWith('text2speech');
    });

    test('add_extension switches one on by name', async () => {
        const {vm} = makeVm();
        const {runTool} = createToolRunner(vm);

        const result = await runTool('add_extension', {extensionId: 'text2speech'});

        expect(result).toMatchObject({extensionId: 'text2speech', loaded: true});
        expect(vm.extensionManager.loadExtensionURL).toHaveBeenCalledWith('text2speech');
    });

    test('add_extension refuses one this editor does not carry', async () => {
        const {vm} = makeVm();
        const {runTool} = createToolRunner(vm);

        await expect(runTool('add_extension', {extensionId: 'not-an-extension'}))
            .rejects.toThrow(/not an extension this editor can add/);
    });
});

describe('search_library', () => {
    /*
     * Guessing at names cost whole turns: the model asked for "Crow", "Bush",
     * "Leaves" and "Sunflower" in a row, none of which exist, and each rejection
     * burned a round.
     */
    test('lists names the library really has', async () => {
        const {vm} = makeVm();
        const {runTool} = createToolRunner(vm);

        const result = await runTool('search_library', {kind: 'sprite'});

        expect(result.total).toBeGreaterThan(0);
        expect(result.matches.length).toBeGreaterThan(0);
        result.matches.forEach(name => expect(typeof name).toBe('string'));
    });

    test('narrows to a search term, case-insensitively', async () => {
        const {vm} = makeVm();
        const {runTool} = createToolRunner(vm);

        const result = await runTool('search_library', {kind: 'sprite', query: 'cat'});

        expect(result.matches.length).toBeGreaterThan(0);
        result.matches.forEach(name => expect(name.toLowerCase()).toContain('cat'));
    });

    test('says so when a search matches nothing, rather than inventing one', async () => {
        const {vm} = makeVm();
        const {runTool} = createToolRunner(vm);

        const result = await runTool('search_library', {kind: 'sprite', query: 'definitely-not-a-sprite'});

        expect(result.matches).toEqual([]);
    });

    test('rejects a library that does not exist', async () => {
        const {vm} = makeVm();
        const {runTool} = createToolRunner(vm);

        await expect(runTool('search_library', {kind: 'wallpaper'})).rejects.toThrow(/is not a library/);
    });
});

describe('unknown opcodes', () => {
    /*
     * Scratch names its palettes in the plural but its opcodes in the singular,
     * so a model reaching for the operators palette writes `operators_join`
     * where the block is `operator_join`. Saying so costs one round; sending it
     * back to the catalogue costs several.
     */
    test('names the real opcode when the guess is close', async () => {
        const {vm} = makeVm();
        const {runTool} = createToolRunner(vm);

        await expect(runTool('create_script', {
            targetId: 'Cat',
            blocks: [{opcode: 'looks_says', inputs: {}}]
        })).rejects.toThrow(/Did you mean.*looks_say/s);
    });

    test('points at the catalogue when nothing is close', async () => {
        const {vm} = makeVm();
        const {runTool} = createToolRunner(vm);

        await expect(runTool('create_script', {
            targetId: 'Cat',
            blocks: [{opcode: 'zzz_nonsense', inputs: {}}]
        })).rejects.toThrow(/get_block_catalog/);
    });
});

describe('menu blocks', () => {
    /**
     * Build a one-block script under a green flag hat and return the records it created.
     * @param {object} vm the fake vm
     * @param {object} spec the block spec to build
     * @param {string} [targetId] where to build it
     * @returns {Promise<Array<object>>} the created block records, in creation order
     */
    const buildOne = async (vm, spec, targetId = 'Cat') => {
        const {runTool} = createToolRunner(vm);
        await runTool('create_script', {targetId, blocks: [{opcode: 'event_whenflagclicked'}, spec]});
        const target = targetId === 'stage' ?
            vm.runtime.getTargetForStage() :
            vm.runtime.getSpriteTargetByName(targetId);
        return target.blocks.createBlock.mock.calls.map(call => call[0]);
    };

    /**
     * The shadow a built block holds in one of its inputs.
     * @param {Array<object>} records the created block records
     * @param {string} opcode the block that owns the input
     * @param {string} inputName the input
     * @returns {object} the shadow record
     */
    const shadowIn = (records, opcode, inputName) => {
        const owner = records.find(record => record.opcode === opcode);
        const input = owner.inputs[inputName];
        expect(input.block).toBe(input.shadow);
        return records.find(record => record.id === input.shadow);
    };

    /*
     * Menus are shadow blocks that the VM implements no primitive for, so the
     * opcode check rejected every one that did not happen to end in "_menu":
     * "looks_backdrops" is not an opcode this project knows.
     */
    test('a backdrop menu named as a shadow builds the real dropdown', async () => {
        const {vm} = makeVm();

        const records = await buildOne(vm, {
            opcode: 'looks_switchbackdropto',
            inputs: {BACKDROP: {shadow: 'looks_backdrops', field: 'BACKDROP', value: 'Jungle'}}
        }, 'stage');

        const menu = shadowIn(records, 'looks_switchbackdropto', 'BACKDROP');
        expect(menu.opcode).toBe('looks_backdrops');
        expect(menu.shadow).toBe(true);
        expect(menu.fields).toEqual({BACKDROP: {name: 'BACKDROP', value: 'Jungle'}});
    });

    test.each(Object.entries(MENU_SHADOW_FIELDS))('%s is accepted and keeps its choice in %s', async (menu, field) => {
        const {vm} = makeVm();

        const records = await buildOne(vm, {opcode: 'motion_goto', inputs: {TO: {shadow: menu, value: 'x'}}});

        const shadow = shadowIn(records, 'motion_goto', 'TO');
        expect(shadow.opcode).toBe(menu);
        expect(shadow.fields[field].value).toBe('x');
    });

    const menuInputCases = Object.entries(MENU_INPUTS).flatMap(([opcode, inputs]) => Object.entries(inputs)
        .map(([inputName, menu]) => [opcode, inputName, menu]));

    test.each(menuInputCases)('a plain value in %s.%s chooses from %s', async (opcode, inputName, menu) => {
        const {vm} = makeVm();

        const records = await buildOne(vm, {opcode, inputs: {[inputName]: 'Jungle'}});

        const shadow = shadowIn(records, opcode, inputName);
        expect(shadow.opcode).toBe(menu);
        expect(shadow.fields[MENU_SHADOW_FIELDS[menu]].value).toBe('Jungle');
    });

    test('a plain value in an ordinary input is still a literal', async () => {
        const {vm} = makeVm();

        const records = await buildOne(vm, {opcode: 'looks_say', inputs: {MESSAGE: 'Jungle'}});

        expect(shadowIn(records, 'looks_say', 'MESSAGE').opcode).toBe('text');
    });

    test('a broadcast menu names its message and creates it when it is new', async () => {
        const {stage, vm} = makeVm();

        const records = await buildOne(vm, {opcode: 'event_broadcast', inputs: {BROADCAST_INPUT: 'go'}});

        const field = shadowIn(records, 'event_broadcast', 'BROADCAST_INPUT').fields.BROADCAST_OPTION;
        expect(stage.createVariable).toHaveBeenCalledWith(field.id, 'go', 'broadcast_msg');
        expect(field).toMatchObject({value: 'go', variableType: 'broadcast_msg'});
    });

    test('an opcode that only scratch-blocks defines is accepted', async () => {
        const {vm} = makeVm();

        const records = await buildOne(vm, {
            opcode: 'motion_goto',
            inputs: {TO: {shadow: 'event_touchingobjectmenu', field: 'TOUCHINGOBJECTMENU', value: '_mouse_'}}
        });

        expect(shadowIn(records, 'motion_goto', 'TO').opcode).toBe('event_touchingobjectmenu');
    });

    test('a misspelt menu is still rejected', async () => {
        const {vm} = makeVm();
        const {runTool} = createToolRunner(vm);

        await expect(runTool('create_script', {
            targetId: 'stage',
            blocks: [{
                opcode: 'looks_switchbackdropto',
                inputs: {BACKDROP: {shadow: 'looks_backdrop', value: 'Jungle'}}
            }]
        })).rejects.toThrow(/"looks_backdrop" is not an opcode/);
    });

    describe('from an extension', () => {
        /**
         * Register the pen extension's colour parameter block and its menu, as
         * the runtime does when the extension loads.
         * @param {object} vm the fake vm
         */
        const registerPen = vm => {
            PRIMITIVE_OPCODES.push('pen_setPenColorParamTo');
            vm.runtime._blockInfo.push({
                id: 'pen',
                blocks: [{
                    json: {type: 'pen_setPenColorParamTo'},
                    info: {arguments: {COLOR_PARAM: {type: 'string', menu: 'colorParam'}, VALUE: {type: 'number'}}}
                }],
                menus: [{json: {type: 'pen_menu_colorParam', args0: [{type: 'field_dropdown', name: 'colorParam'}]}}],
                menuInfo: {colorParam: {acceptReporters: true, items: ['color', 'saturation']}}
            });
        };

        test('a menu named as a shadow is accepted and its field found', async () => {
            const {vm} = makeVm();
            registerPen(vm);

            const records = await buildOne(vm, {
                opcode: 'pen_setPenColorParamTo',
                inputs: {COLOR_PARAM: {shadow: 'pen_menu_colorParam', value: 'color'}, VALUE: 50}
            });

            const menu = shadowIn(records, 'pen_setPenColorParamTo', 'COLOR_PARAM');
            expect(menu.opcode).toBe('pen_menu_colorParam');
            expect(menu.fields).toEqual({colorParam: {name: 'colorParam', value: 'color'}});
        });

        test('a plain value in a menu input chooses from the menu', async () => {
            const {vm} = makeVm();
            registerPen(vm);

            const records = await buildOne(vm, {
                opcode: 'pen_setPenColorParamTo',
                inputs: {COLOR_PARAM: 'saturation', VALUE: 50}
            });

            expect(shadowIn(records, 'pen_setPenColorParamTo', 'COLOR_PARAM').opcode).toBe('pen_menu_colorParam');
            expect(shadowIn(records, 'pen_setPenColorParamTo', 'VALUE').opcode).toBe('math_number');
        });
    });
});

describe('the tool catalogue', () => {
    test('every tool it lists has a handler, and every handler is listed', async () => {
        const {vm} = makeVm();
        const {runTool} = createToolRunner(vm);

        const missing = await runTool('not_a_tool', {}).catch(error => error.message);
        const handled = missing.replace(/^.*Available tools: /s, '').replace(/\.$/, '')
            .split(', ');

        expect(handled.sort()).toEqual(TOOL_DEFINITIONS.map(tool => tool.name).sort());
    });
});
