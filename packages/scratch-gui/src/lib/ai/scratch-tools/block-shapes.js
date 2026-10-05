/**
 * Read the inputs and fields of a scratch-blocks block definition without a
 * workspace.
 *
 * A definition's `init` builds the block by calling methods on it: most hand
 * `jsonInit` a JSON description, and a few append inputs and fields one by
 * one. Running `init` against a stand-in that records those calls and ignores
 * everything else, such as colours and connection shapes, gives the block's
 * shape as the editor draws it, which the toolbox alone cannot say: a boolean
 * slot, a C-block's branches and a hat's dropdown hold no default there.
 */

/** Variable field types, as scratch-blocks names them, mapped to what they hold. */
const VARIABLE_KINDS = {
    '': 'variable',
    'list': 'list',
    'broadcast_msg': 'broadcast'
};

/** Field types that hold something to choose or type rather than a label or picture. */
const VALUE_FIELD_TYPES = [
    'field_dropdown',
    'field_input',
    'field_textinput_removable',
    'field_number',
    'field_angle',
    'field_colour',
    'field_colour_slider',
    'field_note',
    'field_matrix'
];

const isBooleanCheck = check => (Array.isArray(check) ? check.includes('Boolean') : check === 'Boolean');

/**
 * Describe a dropdown's options.
 * @param {Array|Function} options the options as the definition gives them
 * @returns {Array<Array>|string} `[label, value]` pairs, or "dynamic" when the
 *   project decides them each time the menu opens
 */
const describeOptions = options => (Array.isArray(options) ? options : 'dynamic');

/**
 * Read the options of a dropdown field object built in `init`.
 * @param {object} field the field, with `getOptions`
 * @returns {Array<Array>|string} its options, or "dynamic" when they cannot be
 *   read without the block on a workspace
 */
const optionsOfField = field => {
    try {
        return describeOptions(field.getOptions(false));
    } catch {
        return 'dynamic';
    }
};

const fieldFromJson = arg => {
    if (arg.type === 'field_variable' || arg.type === 'field_variable_getter') {
        const types = arg.variableTypes || [arg.variableType || ''];
        return {name: arg.name, variable: VARIABLE_KINDS[types[0]] || 'variable'};
    }
    if (arg.type === 'field_dropdown') return {name: arg.name, options: describeOptions(arg.options)};
    if (VALUE_FIELD_TYPES.includes(arg.type)) return {name: arg.name};
    return null;
};

/**
 * Read one argument of a JSON block description into the shape.
 * @param {object} arg an `argsN` entry
 * @param {{inputs: Array, fields: Array}} shape where the shape is collected
 */
const readJsonArg = (arg, shape) => {
    if (arg.type === 'input_value') {
        shape.inputs.push({name: arg.name, kind: isBooleanCheck(arg.check) ? 'boolean' : 'value'});
    } else if (arg.type === 'input_statement') {
        shape.inputs.push({name: arg.name, kind: 'branch'});
    } else {
        const field = fieldFromJson(arg);
        if (field) shape.fields.push(field);
    }
};

const readJson = (json, shape) => {
    for (let i = 0; Object.prototype.hasOwnProperty.call(json, `message${i}`); i++) {
        (json[`args${i}`] || []).forEach(arg => readJsonArg(arg, shape));
    }
};

/**
 * Something that answers any method call by doing nothing and returning
 * itself, so a chain such as `this.setStyle(...).setOutput(...)` runs through.
 * @param {object} known the methods and properties that do something
 * @returns {object} the stand-in
 */
const recorder = known => {
    const proxy = new Proxy(known, {
        get: (target, property) => (property in target ? target[property] : () => proxy)
    });
    return proxy;
};

/**
 * Run a definition's `init` and record the inputs and fields it creates.
 * @param {string} opcode the block type
 * @param {object} definition the scratch-blocks definition, with an `init` method
 * @returns {?{inputs: Array<object>, fields: Array<object>}} the shape, or null
 *   when the definition could not be read this way
 */
const describeDefinition = (opcode, definition) => {
    if (!definition || typeof definition.init !== 'function') return null;

    const shape = {inputs: [], fields: []};
    const inputRecorder = input => recorder({
        appendField: (field, name) => {
            if (typeof name === 'string') {
                const isDropdown = typeof field.getOptions === 'function';
                shape.fields.push(isDropdown ? {name, options: optionsOfField(field)} : {name});
            }
            return inputRecorder(input);
        },
        setCheck: check => {
            if (input && input.kind === 'value' && isBooleanCheck(check)) input.kind = 'boolean';
            return inputRecorder(input);
        }
    });
    const appendInput = kind => name => {
        const input = {name, kind};
        shape.inputs.push(input);
        return inputRecorder(input);
    };

    try {
        definition.init.call(recorder({
            id: `catalog-${opcode}`,
            type: opcode,
            jsonInit: json => readJson(json, shape),
            appendValueInput: appendInput('value'),
            appendStatementInput: appendInput('branch'),
            appendDummyInput: () => inputRecorder(null)
        }));
    } catch {
        // A definition that needs a real workspace to build itself; the toolbox still describes it.
        return null;
    }
    return shape;
};

export {describeDefinition};
