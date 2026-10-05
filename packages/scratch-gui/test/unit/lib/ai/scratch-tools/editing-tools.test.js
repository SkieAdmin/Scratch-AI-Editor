import {createToolRunner} from '../../../../../src/lib/ai/scratch-tools/runner';
import {makeVm} from './fake-vm';

jest.mock('../../../../../src/lib/make-toolbox-xml', () => ({
    __esModule: true,
    default: () => '<xml></xml>'
}));
jest.mock('../../../../../src/lib/ai/scratch-tools/block-definitions', () => ({
    isScratchBlocksType: () => false
}));

/**
 * An "x position" reporter, to drop into an input of another block.
 * @param {string} parent the block whose input it sits in
 * @returns {object} the block record
 */
const xPositionIn = parent => ({
    id: 'reporter1',
    opcode: 'motion_xposition',
    inputs: {},
    fields: {},
    next: null,
    topLevel: false,
    parent,
    shadow: false
});

/**
 * Build a script on the stage and return the records it created, by opcode.
 * @param {object} vm the fake vm
 * @param {Array<object>} blocks the script's block specs
 * @returns {Promise<object>} the created records keyed by opcode, and the top block id
 */
const buildOnStage = async (vm, blocks) => {
    const {runTool} = createToolRunner(vm);
    const {topBlockId} = await runTool('create_script', {targetId: 'stage', blocks});
    const records = vm.runtime.getTargetForStage().blocks.createBlock.mock.calls.map(call => call[0]);
    return {topBlockId, byOpcode: Object.fromEntries(records.map(record => [record.opcode, record]))};
};

describe('set_block_input', () => {
    test('changes the number typed into an input, through the editor\'s own path', async () => {
        const {vm, sprite} = makeVm();
        const {runTool} = createToolRunner(vm);

        const result = await runTool('set_block_input', {targetId: 'Cat', blockId: 'move1', input: 'STEPS', value: 25});

        expect(sprite.blocks.changeBlock).toHaveBeenCalledWith({element: 'field', id: 'literal1', name: 'NUM', value: '25'});
        expect(sprite.blocks.getBlock('literal1').fields.NUM.value).toBe('25');
        expect(result).toEqual({targetId: 'sprite-id', blockId: 'move1', input: 'STEPS', value: '25'});
        expect(vm.refreshWorkspace).toHaveBeenCalled();
    });

    test('changes the item a menu input has chosen', async () => {
        const {vm} = makeVm();
        const {byOpcode} = await buildOnStage(vm, [
            {opcode: 'event_whenflagclicked'},
            {opcode: 'looks_switchbackdropto', inputs: {BACKDROP: 'Jungle'}}
        ]);
        const {runTool} = createToolRunner(vm);

        await runTool('set_block_input', {
            targetId: 'stage',
            blockId: byOpcode.looks_switchbackdropto.id,
            input: 'BACKDROP',
            value: 'Woods'
        });

        expect(byOpcode.looks_backdrops.fields.BACKDROP.value).toBe('Woods');
    });

    test('fills in an input the script was built without, as the right kind of slot', async () => {
        const {vm} = makeVm();
        const {byOpcode} = await buildOnStage(vm, [
            {opcode: 'event_whenflagclicked'},
            {opcode: 'looks_switchbackdropto'}
        ]);
        const switcher = byOpcode.looks_switchbackdropto;
        const stage = vm.runtime.getTargetForStage();
        const {runTool} = createToolRunner(vm);

        await runTool('set_block_input', {targetId: 'stage', blockId: switcher.id, input: 'BACKDROP', value: 'Woods'});

        const menu = stage.blocks.getBlock(switcher.inputs.BACKDROP.shadow);
        expect(menu.opcode).toBe('looks_backdrops');
        expect(menu.fields.BACKDROP.value).toBe('Woods');
        expect(switcher.inputs.BACKDROP.block).toBe(menu.id);
    });

    test('replaces a reporter sitting in the input with the value, as dragging it out would', async () => {
        const {vm, sprite} = makeVm();
        const move = sprite.blocks.getBlock('move1');
        sprite.blocks.createBlock(xPositionIn('move1'));
        move.inputs.STEPS.block = 'reporter1';
        const {runTool} = createToolRunner(vm);

        await runTool('set_block_input', {targetId: 'Cat', blockId: 'move1', input: 'STEPS', value: 5});

        expect(sprite.blocks.deleteBlock).toHaveBeenCalledWith('reporter1');
        expect(move.inputs.STEPS).toEqual({name: 'STEPS', block: 'literal1', shadow: 'literal1'});
        expect(sprite.blocks.getBlock('literal1').fields.NUM.value).toBe('5');
    });

    test('changes a dropdown field', async () => {
        const {vm} = makeVm();
        const {byOpcode} = await buildOnStage(vm, [
            {opcode: 'event_whenflagclicked'},
            {opcode: 'motion_goto', inputs: {TO: '_random_'}}
        ]);
        const {runTool} = createToolRunner(vm);

        await runTool('set_block_input', {
            targetId: 'stage',
            blockId: byOpcode.motion_goto_menu.id,
            field: 'TO',
            value: '_mouse_'
        });

        expect(byOpcode.motion_goto_menu.fields.TO.value).toBe('_mouse_');
    });

    test('points a variable field at another variable by name', async () => {
        const {vm, stage} = makeVm();
        stage.variables['lives-id'] = {id: 'lives-id', name: 'lives', type: '', value: 3};
        const {byOpcode} = await buildOnStage(vm, [
            {opcode: 'event_whenflagclicked'},
            {opcode: 'data_setvariableto', fields: {VARIABLE: 'score'}, inputs: {VALUE: 0}}
        ]);
        const {runTool} = createToolRunner(vm);

        await runTool('set_block_input', {
            targetId: 'stage',
            blockId: byOpcode.data_setvariableto.id,
            field: 'VARIABLE',
            value: 'lives'
        });

        expect(byOpcode.data_setvariableto.fields.VARIABLE).toMatchObject({id: 'lives-id', value: 'lives'});
        expect(stage.blocks.resetCache).toHaveBeenCalled();
    });

    test('says which fields a block has when asked for one it lacks', async () => {
        const {vm} = makeVm();
        const {runTool} = createToolRunner(vm);

        await expect(runTool('set_block_input', {targetId: 'Cat', blockId: 'literal1', field: 'TEXT', value: 'hi'}))
            .rejects.toThrow(/math_number block has no field "TEXT"\. Its fields are: NUM/);
    });

    test('refuses a C-block branch, and an input that only takes a block', async () => {
        const {vm} = makeVm();
        const {byOpcode} = await buildOnStage(vm, [
            {opcode: 'event_whenflagclicked'},
            {opcode: 'control_if', inputs: {CONDITION: null}}
        ]);
        const ifBlock = byOpcode.control_if;
        ifBlock.inputs.CONDITION = {name: 'CONDITION', block: null, shadow: null};
        const {runTool} = createToolRunner(vm);

        await expect(runTool('set_block_input', {targetId: 'stage', blockId: ifBlock.id, input: 'SUBSTACK', value: 1}))
            .rejects.toThrow(/branch of the C-block/);
        await expect(runTool('set_block_input', {targetId: 'stage', blockId: ifBlock.id, input: 'CONDITION', value: 1}))
            .rejects.toThrow(/takes a block rather than a typed value/);
    });

    test('wants an input or a field, but not both', async () => {
        const {vm} = makeVm();
        const {runTool} = createToolRunner(vm);

        await expect(runTool('set_block_input', {targetId: 'Cat', blockId: 'move1', value: 1}))
            .rejects.toThrow(/Name the "input" or the "field"/);
        await expect(runTool('set_block_input', {targetId: 'Cat', blockId: 'move1', input: 'STEPS', field: 'X', value: 1}))
            .rejects.toThrow(/not both/);
        await expect(runTool('set_block_input', {targetId: 'Cat', blockId: 'nope', input: 'STEPS', value: 1}))
            .rejects.toThrow(/no block "nope"/);
    });
});

describe('moving and tidying scripts', () => {
    test('move_script moves a script by its top block', async () => {
        const {vm, sprite} = makeVm();
        const {runTool} = createToolRunner(vm);

        const result = await runTool('move_script', {targetId: 'Cat', topBlockId: 'top1', x: 200, y: 40});

        expect(sprite.blocks.moveBlock).toHaveBeenCalledWith({id: 'top1', newCoordinate: {x: 200, y: 40}});
        expect(result).toEqual({targetId: 'sprite-id', topBlockId: 'top1', x: 200, y: 40});
    });

    test('move_script only moves whole scripts', async () => {
        const {vm} = makeVm();
        const {runTool} = createToolRunner(vm);

        await expect(runTool('move_script', {targetId: 'Cat', topBlockId: 'move1', x: 0, y: 0}))
            .rejects.toThrow(/no script starting at block "move1"/);
    });

    test('clean_up_scripts lines the scripts up in one column without overlap', async () => {
        const {vm, sprite} = makeVm();
        const {runTool} = createToolRunner(vm);
        await runTool('create_script', {targetId: 'Cat', x: 400, y: 0, blocks: [{opcode: 'event_whenflagclicked'}]});

        const {scripts} = await runTool('clean_up_scripts', {targetId: 'Cat'});

        expect(scripts.map(script => script.x)).toEqual([0, 0]);
        expect(scripts[0].y).toBe(0);
        expect(scripts[1].y).toBeGreaterThan(2 * 48);
        scripts.forEach(({topBlockId, y}) => expect(sprite.blocks.getBlock(topBlockId).y).toBe(y));
    });
});

describe('copy_script_to', () => {
    test('copies a script to another target under new ids, leaving the original', async () => {
        const {vm, sprite, stage} = makeVm();
        const {runTool} = createToolRunner(vm);

        const result = await runTool('copy_script_to', {fromTarget: 'Cat', topBlockId: 'top1', toTarget: 'stage'});

        const [shared, toId, fromId] = vm.shareBlocksToTarget.mock.calls[0];
        expect(shared.map(block => block.id)).toEqual(['top1', 'move1', 'literal1']);
        expect([toId, fromId]).toEqual(['stage-id', 'sprite-id']);
        expect(result).toEqual({fromTargetId: 'sprite-id', toTargetId: 'stage-id', topBlockId: 'top1-copy', blockCount: 3});
        expect(stage.blocks.getScripts()).toEqual(['top1-copy']);
        expect(sprite.blocks.getScripts()).toEqual(['top1']);
    });

    test('takes the shadow hidden under a reporter along too', async () => {
        const {vm, sprite} = makeVm();
        sprite.blocks.createBlock(xPositionIn('move1'));
        sprite.blocks.getBlock('move1').inputs.STEPS.block = 'reporter1';
        const {runTool} = createToolRunner(vm);

        await runTool('copy_script_to', {fromTarget: 'Cat', topBlockId: 'top1', toTarget: 'stage'});

        expect(vm.shareBlocksToTarget.mock.calls[0][0].map(block => block.id))
            .toEqual(['top1', 'move1', 'reporter1', 'literal1']);
    });

    test('copies to another target, not onto the same one', async () => {
        const {vm} = makeVm();
        const {runTool} = createToolRunner(vm);

        await expect(runTool('copy_script_to', {fromTarget: 'Cat', topBlockId: 'top1', toTarget: 'sprite-id'}))
            .rejects.toThrow(/both Cat/);
    });
});
