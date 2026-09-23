import {createToolRunner} from '../../../../../src/lib/ai/scratch-tools/runner';

// None of these assertions need a real toolbox, and loading scratch-blocks into jsdom
// to produce one would be pure cost.
jest.mock('../../../../../src/lib/make-toolbox-xml', () => ({
    __esModule: true,
    default: () => '<xml></xml>'
}));

const HAT_OPCODES = ['event_whenflagclicked'];
const PRIMITIVE_OPCODES = ['motion_movesteps', 'motion_turnright', 'looks_say', 'data_setvariableto'];

const makeBlocks = (records = {}) => {
    const blocks = {...records};
    const scripts = Object.keys(blocks).filter(id => blocks[id].topLevel && !blocks[id].shadow);
    return {
        getBlock: id => blocks[id],
        getNextBlock: id => (blocks[id] ? blocks[id].next : null),
        getScripts: () => scripts,
        createBlock: jest.fn(record => {
            blocks[record.id] = record;
            if (record.topLevel && !record.shadow) scripts.push(record.id);
        }),
        deleteBlock: jest.fn(id => {
            const index = scripts.indexOf(id);
            if (index > -1) scripts.splice(index, 1);
            delete blocks[id];
        }),
        all: blocks
    };
};

const makeTarget = config => {
    const target = {
        id: config.id,
        isStage: Boolean(config.isStage),
        isOriginal: true,
        x: config.x || 0,
        y: config.y || 0,
        direction: 90,
        size: 100,
        visible: true,
        rotationStyle: 'all around',
        currentCostume: 0,
        variables: config.variables || {},
        blocks: makeBlocks(config.blocks),
        getName: () => target.name,
        getCostumes: () => config.costumes || [],
        getSounds: () => config.sounds || [],
        createVariable: jest.fn((id, name, type) => {
            target.variables[id] = {id, name, type, value: ''};
        }),
        postSpriteInfo: jest.fn()
    };
    target.name = config.name;
    return target;
};

const makeVm = () => {
    const stage = makeTarget({
        id: 'stage-id',
        name: 'Stage',
        isStage: true,
        costumes: [{name: 'backdrop1', dataFormat: 'svg'}],
        variables: {
            'score-id': {id: 'score-id', name: 'score', type: '', value: 7}
        }
    });
    const sprite = makeTarget({
        id: 'sprite-id',
        name: 'Cat',
        x: 12,
        y: -30,
        costumes: [{name: 'costume1', dataFormat: 'svg'}, {name: 'costume2', dataFormat: 'svg'}],
        sounds: [{name: 'Meow', dataFormat: 'wav'}],
        blocks: {
            top1: {
                id: 'top1',
                opcode: 'event_whenflagclicked',
                inputs: {},
                fields: {},
                next: 'move1',
                topLevel: true,
                parent: null,
                shadow: false,
                x: 10,
                y: 20
            },
            move1: {
                id: 'move1',
                opcode: 'motion_movesteps',
                inputs: {STEPS: {name: 'STEPS', block: 'literal1', shadow: 'literal1'}},
                fields: {},
                next: null,
                topLevel: false,
                parent: 'top1',
                shadow: false
            },
            literal1: {
                id: 'literal1',
                opcode: 'math_number',
                inputs: {},
                fields: {NUM: {name: 'NUM', value: '10'}},
                next: null,
                topLevel: false,
                parent: 'move1',
                shadow: true
            }
        }
    });

    const targets = [stage, sprite];
    const vm = {
        editingTarget: sprite,
        runtime: {
            targets,
            getTargetForStage: () => stage,
            getTargetById: id => targets.find(target => target.id === id),
            getSpriteTargetByName: name => targets.find(target => !target.isStage && target.getName() === name),
            /* eslint-disable-next-line no-undefined */
            getOpcodeFunction: opcode => (PRIMITIVE_OPCODES.includes(opcode) ? () => {} : undefined),
            getIsHat: opcode => HAT_OPCODES.includes(opcode),
            getBlocksXML: () => [],
            emitProjectChanged: jest.fn()
        },
        emitTargetsUpdate: jest.fn(),
        refreshWorkspace: jest.fn(),
        postSpriteInfo: jest.fn(info => sprite.postSpriteInfo(info)),
        renameSprite: jest.fn((id, name) => {
            targets.find(target => target.id === id).name = name;
        }),
        setEditingTarget: jest.fn(id => {
            vm.editingTarget = targets.find(target => target.id === id);
        }),
        setVariableValue: jest.fn((targetId, variableId, value) => {
            targets.find(target => target.id === targetId).variables[variableId].value = value;
            return true;
        })
    };
    return {sprite, stage, vm};
};

describe('createToolRunner revision guard', () => {
    test('a write bumps the revision and reports it', async () => {
        const {vm} = makeVm();
        const runner = createToolRunner(vm);

        expect(runner.getRevision()).toBe(0);

        const result = await runner.runTool('rename_sprite', {targetId: 'Cat', name: 'Dog'});

        expect(result.name).toBe('Dog');
        expect(result.revision).toBe(1);
        expect(runner.getRevision()).toBe(1);
    });

    test('a write planned against a stale revision is rejected, naming both revisions', async () => {
        const {vm} = makeVm();
        const runner = createToolRunner(vm);

        await runner.runTool('rename_sprite', {targetId: 'Cat', name: 'Dog'});

        await expect(runner.runTool('rename_sprite', {
            targetId: 'Dog',
            name: 'Bird',
            expectedRevision: 0
        })).rejects.toThrow(/expected revision 0.*revision 1/s);

        expect(vm.renameSprite).toHaveBeenCalledTimes(1);
        expect(runner.getRevision()).toBe(1);
    });

    test('a write planned against the current revision goes through', async () => {
        const {vm} = makeVm();
        const runner = createToolRunner(vm);

        const result = await runner.runTool('rename_sprite', {
            targetId: 'Cat',
            name: 'Dog',
            expectedRevision: 0
        });

        expect(result.revision).toBe(1);
    });

    test('a read is not guarded and does not bump the revision', async () => {
        const {vm} = makeVm();
        const runner = createToolRunner(vm);

        await runner.runTool('list_sprites', {});

        expect(runner.getRevision()).toBe(0);
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
        expect(runner.getRevision()).toBe(0);
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

        expect(summary.revision).toBe(0);
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
