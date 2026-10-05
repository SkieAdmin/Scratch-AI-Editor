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
        all: blocks
    };
};

const makeTarget = config => {
    const costumes = config.costumes || [];
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
        getSounds: () => config.sounds || [],
        getLayerOrder: () => config.layer || 0,
        getCustomState: key => target.customState[key],
        setCostume: jest.fn(index => {
            target.currentCostume = index;
        }),
        createVariable: jest.fn((id, name, type) => {
            target.variables[id] = {id, name, type, value: ''};
        }),
        postSpriteInfo: jest.fn()
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
        _blockInfo: []
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
