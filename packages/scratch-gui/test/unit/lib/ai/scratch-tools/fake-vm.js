import EventEmitter from 'events';

import {MENU_INPUTS} from '../../../../../src/lib/ai/scratch-tools/menus';

/**
 * A stand-in for the VirtualMachine, with just enough of the runtime, targets
 * and renderer for the tool layer to run against.
 */

const HAT_OPCODES = [
    'event_whenflagclicked',
    'event_whenthisspriteclicked',
    'event_whenstageclicked',
    'event_whenbackdropswitchesto'
];
const PRIMITIVE_OPCODES = [
    'motion_movesteps', 'motion_turnright', 'looks_say', 'data_setvariableto', 'event_broadcast',
    'control_if', 'control_if_else',
    ...Object.keys(MENU_INPUTS)
];

/** The PNG a fake snapshot returns: just the signature, which is all any test looks at. */
const SNAPSHOT_DATA = 'iVBORw0KGgo=';

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
        changeBlock: jest.fn(({id, name, value}) => {
            blocks[id].fields[name].value = value;
        }),
        moveBlock: jest.fn(({id, newCoordinate}) => {
            blocks[id].x = newCoordinate.x;
            blocks[id].y = newCoordinate.y;
        }),
        resetCache: jest.fn(),
        all: blocks
    };
};

const makeTarget = config => {
    const costumes = config.costumes || [];
    const sounds = config.sounds || [];
    // Scratch numbers a name that is already taken, as `StringUtil.unusedName` does.
    const unusedName = (items, index, name) => {
        const taken = items.filter((item, i) => i !== index).map(item => item.name);
        let candidate = name;
        for (let n = 2; taken.includes(candidate); n++) candidate = `${name}${n}`;
        return candidate;
    };
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
        customState: {},
        getName: () => target.name,
        getCostumes: () => costumes,
        getSounds: () => sounds,
        getLayerOrder: () => config.layer || 0,
        getCustomState: key => target.customState[key],
        setCostume: jest.fn(index => {
            target.currentCostume = index;
        }),
        createVariable: jest.fn((id, name, type) => {
            target.variables[id] = {id, name, type, value: ''};
        }),
        postSpriteInfo: jest.fn(),
        deleteCostume: jest.fn(index => (costumes.length === 1 ? null : costumes.splice(index, 1)[0])),
        renameCostume: jest.fn((index, name) => {
            costumes[index].name = unusedName(costumes, index, name);
        }),
        deleteSound: jest.fn(index => sounds.splice(index, 1)[0]),
        renameSound: jest.fn((index, name) => {
            sounds[index].name = unusedName(sounds, index, name);
        })
    };
    target.name = config.name;
    return target;
};

/**
 * A stand-in for the VM's extension manager. Loading an extension is what makes
 * its opcodes real, so the fake registers one when asked.
 * @returns {object} the fake manager
 */
const extensionManager = () => {
    const loaded = new Set();
    return {
        isExtensionLoaded: id => loaded.has(id),
        loadExtensionURL: jest.fn(id => {
            loaded.add(id);
            PRIMITIVE_OPCODES.push(`${id}_speakAndWait`);
            return Promise.resolve();
        })
    };
};

/**
 * A renderer whose snapshot arrives on the next draw, as the real one's does.
 * @returns {object} the fake renderer
 */
const makeRenderer = () => {
    const waiting = [];
    return {
        canvas: {width: 480, height: 360},
        requestSnapshot: jest.fn(callback => waiting.push(callback)),
        draw: jest.fn(() => {
            waiting.splice(0).forEach(callback => callback(`data:image/png;base64,${SNAPSHOT_DATA}`));
        })
    };
};

const makeRuntime = (targets, stage) => {
    const runtime = new EventEmitter();
    Object.assign(runtime, {
        targets,
        threads: [],
        getTargetForStage: () => stage,
        getTargetById: id => targets.find(target => target.id === id),
        getSpriteTargetByName: name => targets.find(target => !target.isStage && target.getName() === name),
        /* eslint-disable-next-line no-undefined */
        getOpcodeFunction: opcode => (PRIMITIVE_OPCODES.includes(opcode) ? () => {} : undefined),
        getIsHat: opcode => HAT_OPCODES.includes(opcode),
        getBlocksXML: () => [],
        emitProjectChanged: jest.fn(),
        // Threads a hat would start, by hat opcode; a test fills this in.
        hatThreads: {},
        startHats: jest.fn(opcode => runtime.hatThreads[opcode] || []),
        // Extension block and menu registrations; none are loaded to begin with.
        _blockInfo: [],
        storage: {
            AssetType: {ImageVector: 'ImageVector'},
            DataFormat: {SVG: 'svg'},
            createAsset: jest.fn((assetType, dataFormat, data) => ({assetId: 'drawn', assetType, dataFormat, data}))
        }
    });
    Object.defineProperties(runtime, {
        _primitives: {get: () => Object.fromEntries(PRIMITIVE_OPCODES.map(opcode => [opcode, () => {}]))},
        _hats: {get: () => Object.fromEntries(HAT_OPCODES.map(opcode => [opcode, {}]))}
    });
    return runtime;
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
        layer: 3,
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
        runtime: makeRuntime(targets, stage),
        renderer: makeRenderer(),
        extensionManager: extensionManager(),
        emitTargetsUpdate: jest.fn(),
        addCostume: jest.fn((md5ext, costume, targetId) => {
            const receiver = targets.find(target => target.id === targetId);
            receiver.getCostumes().push(costume);
            return Promise.resolve();
        }),
        addBackdrop: jest.fn((md5ext, backdrop) => {
            stage.getCostumes().push(backdrop);
            return Promise.resolve();
        }),
        reorderCostume: jest.fn((targetId, from, to) => {
            const costumes = targets.find(target => target.id === targetId).getCostumes();
            costumes.splice(to, 0, costumes.splice(from, 1)[0]);
            return from !== to;
        }),
        reorderSound: jest.fn((targetId, from, to) => {
            const sounds = targets.find(target => target.id === targetId).getSounds();
            sounds.splice(to, 0, sounds.splice(from, 1)[0]);
            return from !== to;
        }),
        // Copies the blocks under new ids, as the VM does when a script is dropped on another sprite.
        shareBlocksToTarget: jest.fn((blocks, targetId) => {
            const receiver = targets.find(target => target.id === targetId);
            const copyId = id => (id ? `${id}-copy` : null);
            JSON.parse(JSON.stringify(blocks)).forEach(block => {
                Object.values(block.inputs).forEach(input => {
                    input.block = copyId(input.block);
                    input.shadow = copyId(input.shadow);
                });
                receiver.blocks.createBlock({
                    ...block,
                    id: copyId(block.id),
                    parent: copyId(block.parent),
                    next: copyId(block.next)
                });
            });
            return Promise.resolve();
        }),
        refreshWorkspace: jest.fn(),
        postIOData: jest.fn(),
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

export {HAT_OPCODES, PRIMITIVE_OPCODES, SNAPSHOT_DATA, makeTarget, makeVm};
