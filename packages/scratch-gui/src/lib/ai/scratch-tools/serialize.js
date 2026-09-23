/**
 * Compact descriptions of a Scratch project for an AI assistant.
 *
 * Everything here is read-only and deliberately lossy: an assistant has a
 * fixed context window, so a project digest reports names, counts and script
 * shapes rather than asset payloads or full block records.
 */

/** Variable type tags, mirroring `Variable.SCALAR_TYPE` and friends in scratch-vm. */
const SCALAR_VARIABLE_TYPE = '';
const LIST_VARIABLE_TYPE = 'list';
const BROADCAST_VARIABLE_TYPE = 'broadcast_msg';

/** Inputs whose name starts with this hold a branch of a C-block, not a value. */
const BRANCH_INPUT_PREFIX = 'SUBSTACK';

/** How much of a long string value to show before eliding the rest. */
const MAX_VALUE_LENGTH = 120;

/** How many entries of a list variable to show before reporting only the length. */
const MAX_LIST_PREVIEW = 10;

const truncateString = value => (
    value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH)}…` : value
);

/**
 * Reduce a variable's value to something small enough to put in a prompt.
 * @param {*} value the raw variable value
 * @returns {*} the value, a truncated string, or a list preview object
 */
const summarizeValue = value => {
    if (Array.isArray(value)) {
        const preview = value.slice(0, MAX_LIST_PREVIEW)
            .map(entry => (typeof entry === 'string' ? truncateString(entry) : entry));
        return {length: value.length, preview};
    }
    if (typeof value === 'string') return truncateString(value);
    return value;
};

const variableTypeName = type => {
    if (type === LIST_VARIABLE_TYPE) return 'list';
    if (type === BROADCAST_VARIABLE_TYPE) return 'broadcast';
    return 'variable';
};

/**
 * List the variables, lists and broadcasts owned by a target.
 * @param {object} target a RenderedTarget
 * @returns {Array<object>} one entry per variable, with its id, name, kind and value
 */
const summarizeVariables = target => Object.keys(target.variables).map(id => {
    const variable = target.variables[id];
    return {
        id: variable.id,
        name: variable.name,
        kind: variableTypeName(variable.type),
        value: summarizeValue(variable.value)
    };
});

/**
 * List a target's costumes by index.
 * @param {object} target a RenderedTarget
 * @returns {Array<object>} one entry per costume
 */
const summarizeCostumes = target => target.getCostumes().map((costume, index) => ({
    index,
    name: costume.name,
    format: costume.dataFormat
}));

/**
 * List a target's sounds by index.
 * @param {object} target a RenderedTarget
 * @returns {Array<object>} one entry per sound
 */
const summarizeSounds = target => target.getSounds().map((sound, index) => ({
    index,
    name: sound.name,
    format: sound.dataFormat
}));

const isBranchInput = inputName => inputName.startsWith(BRANCH_INPUT_PREFIX);

/**
 * Read the single field of a shadow block, which is how Scratch stores a
 * literal typed into an input slot.
 * @param {object} shadowBlock the shadow block record
 * @returns {*} the literal value
 */
const shadowLiteral = shadowBlock => {
    const fieldNames = Object.keys(shadowBlock.fields);
    if (fieldNames.length === 0) return null;
    return shadowBlock.fields[fieldNames[0]].value;
};

const serializeBlock = (blocks, blockId) => {
    const stackFrom = firstBlockId => {
        const stack = [];
        let id = firstBlockId;
        while (id) {
            stack.push(serializeBlock(blocks, id));
            id = blocks.getNextBlock(id);
        }
        return stack;
    };
    const valueOf = input => {
        if (!input.block) return null;
        const inner = blocks.getBlock(input.block);
        if (inner.shadow) return shadowLiteral(inner);
        return serializeBlock(blocks, input.block);
    };

    const block = blocks.getBlock(blockId);
    const serialized = {id: blockId, opcode: block.opcode};

    const fieldNames = Object.keys(block.fields);
    if (fieldNames.length > 0) {
        serialized.fields = {};
        fieldNames.forEach(name => {
            serialized.fields[name] = block.fields[name].value;
        });
    }

    Object.keys(block.inputs).forEach(name => {
        if (isBranchInput(name)) {
            serialized.branches = serialized.branches || {};
            serialized.branches[name] = stackFrom(block.inputs[name].block);
        } else {
            serialized.inputs = serialized.inputs || {};
            serialized.inputs[name] = valueOf(block.inputs[name]);
        }
    });

    if (block.mutation) serialized.mutation = block.mutation;

    return serialized;
};

const serializeStack = (blocks, firstBlockId) => {
    const stack = [];
    let blockId = firstBlockId;
    while (blockId) {
        stack.push(serializeBlock(blocks, blockId));
        blockId = blocks.getNextBlock(blockId);
    }
    return stack;
};

/**
 * Describe one script as a nested structure an assistant can read and imitate.
 * @param {object} blocks the target's Blocks container
 * @param {string} topBlockId the id of the script's top block
 * @returns {object} the script, with its position and its stack of blocks
 */
const serializeScript = (blocks, topBlockId) => {
    const topBlock = blocks.getBlock(topBlockId);
    return {
        topBlockId,
        x: topBlock.x,
        y: topBlock.y,
        blocks: serializeStack(blocks, topBlockId)
    };
};

const countBlocksInStack = (blocks, firstBlockId) => {
    let count = 0;
    let blockId = firstBlockId;
    while (blockId) {
        count += 1;
        const block = blocks.getBlock(blockId);
        for (const name of Object.keys(block.inputs).filter(isBranchInput)) {
            count += countBlocksInStack(blocks, block.inputs[name].block);
        }
        blockId = blocks.getNextBlock(blockId);
    }
    return count;
};

/**
 * Describe a script by its shape only: what starts it and how big it is.
 * @param {object} blocks the target's Blocks container
 * @param {string} topBlockId the id of the script's top block
 * @returns {object} the script's id, top opcode and block count
 */
const summarizeScriptShape = (blocks, topBlockId) => ({
    topBlockId,
    startsWith: blocks.getBlock(topBlockId).opcode,
    blockCount: countBlocksInStack(blocks, topBlockId)
});

/**
 * Describe one target in full, including its scripts block by block.
 * @param {object} target a RenderedTarget
 * @returns {object} the target detail
 */
const summarizeTarget = target => {
    const detail = {
        id: target.id,
        name: target.getName(),
        isStage: target.isStage,
        currentCostume: target.currentCostume,
        costumes: summarizeCostumes(target),
        sounds: summarizeSounds(target),
        variables: summarizeVariables(target),
        scripts: target.blocks.getScripts().map(topBlockId => serializeScript(target.blocks, topBlockId))
    };

    if (!target.isStage) {
        detail.x = target.x;
        detail.y = target.y;
        detail.direction = target.direction;
        detail.size = target.size;
        detail.visible = target.visible;
        detail.rotationStyle = target.rotationStyle;
    }

    return detail;
};

const summarizeSprite = target => ({
    id: target.id,
    name: target.getName(),
    x: target.x,
    y: target.y,
    direction: target.direction,
    size: target.size,
    visible: target.visible,
    currentCostume: target.currentCostume,
    costumeCount: target.getCostumes().length,
    soundCount: target.getSounds().length,
    variables: summarizeVariables(target),
    scripts: target.blocks.getScripts().map(topBlockId => summarizeScriptShape(target.blocks, topBlockId))
});

/**
 * Describe the whole project compactly: names, counts, variable values and
 * script shapes. Asset data and individual blocks are left out so that a large
 * project still fits in a prompt; `get_target` supplies the detail.
 * @param {object} vm the VirtualMachine
 * @returns {object} the project digest
 */
const summarizeProject = vm => {
    const stage = vm.runtime.getTargetForStage();
    const sprites = vm.runtime.targets
        .filter(target => target.isOriginal && !target.isStage)
        .map(summarizeSprite);

    return {
        editingTargetId: vm.editingTarget ? vm.editingTarget.id : null,
        stage: {
            id: stage.id,
            name: stage.getName(),
            currentBackdrop: stage.currentCostume,
            backdrops: summarizeCostumes(stage),
            soundCount: stage.getSounds().length,
            variables: summarizeVariables(stage),
            scripts: stage.blocks.getScripts().map(topBlockId => summarizeScriptShape(stage.blocks, topBlockId))
        },
        sprites,
        totals: {
            sprites: sprites.length,
            scripts: sprites.reduce((sum, sprite) => sum + sprite.scripts.length, 0) +
                stage.blocks.getScripts().length
        }
    };
};

const childElements = (element, tagName) => Array.prototype.filter.call(
    element.children,
    child => child.tagName.toLowerCase() === tagName
);

const parseToolboxBlock = blockElement => {
    const categoryElement = blockElement.closest('category');
    const entry = {
        opcode: blockElement.getAttribute('type'),
        category: categoryElement ?
            (categoryElement.getAttribute('toolboxitemid') || categoryElement.getAttribute('name')) :
            null,
        inputs: [],
        fields: []
    };

    childElements(blockElement, 'value').forEach(valueElement => {
        const shadowElement = childElements(valueElement, 'shadow')[0];
        const input = {name: valueElement.getAttribute('name')};
        if (shadowElement) {
            input.shadow = shadowElement.getAttribute('type');
            const shadowField = childElements(shadowElement, 'field')[0];
            if (shadowField) input.default = shadowField.textContent;
        }
        entry.inputs.push(input);
    });

    childElements(blockElement, 'field').forEach(fieldElement => {
        entry.fields.push({
            name: fieldElement.getAttribute('name'),
            default: fieldElement.textContent
        });
    });

    return entry;
};

/**
 * Derive the argument shape of every block in a Blockly toolbox.
 *
 * The toolbox is the only place that names a core block's inputs and fields
 * together with the shadow type and default value each one expects, which is
 * exactly what an assistant needs in order to write a `create_script` call.
 * @param {string} toolboxXml the toolbox XML
 * @returns {Array<object>} one entry per block type, in toolbox order
 */
const parseToolboxCatalog = toolboxXml => {
    const toolboxDocument = new DOMParser().parseFromString(toolboxXml, 'text/xml');
    const seen = new Set();
    const entries = [];

    Array.prototype.forEach.call(toolboxDocument.querySelectorAll('block[type]'), blockElement => {
        const opcode = blockElement.getAttribute('type');
        if (seen.has(opcode)) return;
        seen.add(opcode);
        entries.push(parseToolboxBlock(blockElement));
    });

    return entries;
};

const extensionCatalogEntries = runtime => {
    const entries = [];
    // The runtime exposes `getOpcodeFunction` for single lookups but nothing that
    // enumerates registered blocks, so the block registry is read directly.
    runtime._blockInfo.forEach(categoryInfo => {
        categoryInfo.blocks.forEach(blockInfo => {
            // Separators and labels carry no scratch-blocks JSON and have no opcode.
            if (!blockInfo.json) return;
            const argumentInfo = blockInfo.info.arguments || {};
            entries.push({
                opcode: blockInfo.json.type,
                category: categoryInfo.id,
                text: blockInfo.info.text,
                inputs: Object.keys(argumentInfo).map(name => ({
                    name,
                    type: argumentInfo[name].type,
                    default: argumentInfo[name].defaultValue,
                    menu: argumentInfo[name].menu
                })),
                fields: []
            });
        });
    });
    return entries;
};

/**
 * Build the catalogue of opcodes an assistant may use, with their arguments.
 *
 * Argument shapes come from the toolbox for core blocks and from each
 * extension's own block metadata. Any opcode the runtime implements but the
 * toolbox does not show — menus, and blocks hidden from the palette — is listed
 * without argument detail so that the assistant knows it exists.
 * @param {object} runtime the VM runtime
 * @param {string} toolboxXml the toolbox XML for the target being edited
 * @returns {Array<object>} the catalogue, one entry per opcode
 */
const buildBlockCatalog = (runtime, toolboxXml) => {
    const byOpcode = new Map();

    parseToolboxCatalog(toolboxXml).forEach(entry => byOpcode.set(entry.opcode, entry));
    extensionCatalogEntries(runtime).forEach(entry => {
        if (!byOpcode.has(entry.opcode)) byOpcode.set(entry.opcode, entry);
    });
    Object.keys(runtime._primitives).forEach(opcode => {
        if (byOpcode.has(opcode)) return;
        byOpcode.set(opcode, {
            opcode,
            category: opcode.split('_')[0],
            inputs: [],
            fields: []
        });
    });

    return Array.from(byOpcode.values()).map(entry => ({
        ...entry,
        isHat: runtime.getIsHat(entry.opcode)
    }));
};

export {
    BRANCH_INPUT_PREFIX,
    BROADCAST_VARIABLE_TYPE,
    LIST_VARIABLE_TYPE,
    SCALAR_VARIABLE_TYPE,
    buildBlockCatalog,
    parseToolboxCatalog,
    serializeScript,
    summarizeCostumes,
    summarizeProject,
    summarizeScriptShape,
    summarizeSounds,
    summarizeTarget,
    summarizeVariables
};
