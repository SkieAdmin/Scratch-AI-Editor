import {menuFieldFor, menuInputFor, projectMenuOptions} from './menus';
import {BROADCAST_VARIABLE_TYPE, LIST_VARIABLE_TYPE, SCALAR_VARIABLE_TYPE} from './serialize';

/** What a variable field holds, mapped to the VM's variable type tag. */
const VARIABLE_TYPES = {
    broadcast: BROADCAST_VARIABLE_TYPE,
    list: LIST_VARIABLE_TYPE,
    variable: SCALAR_VARIABLE_TYPE
};

/**
 * Turn `[label, value]` pairs into the values to pass, with the label for any
 * value that does not say what it is.
 * @param {Array<Array>} pairs a dropdown's options
 * @returns {{options: Array<string>, optionLabels: (object|undefined)}} the values, and labels where they differ
 */
const fromPairs = pairs => {
    const options = pairs.map(([, value]) => value);
    const labelled = pairs.filter(([label, value]) => typeof label === 'string' && label !== value);
    if (labelled.length === 0) return {options};
    return {options, optionLabels: Object.fromEntries(labelled.map(([label, value]) => [value, label]))};
};

/**
 * Names of the variables of one kind a script on this target can use: its own
 * and the stage's, or only the stage's for a broadcast message.
 * @param {object} vm the VirtualMachine
 * @param {object} target the target the script would be on
 * @param {string} kind "variable", "list" or "broadcast"
 * @returns {Array<string>} the names
 */
const variableNames = (vm, target, kind) => {
    const stage = vm.runtime.getTargetForStage();
    const owners = target.isStage || kind === 'broadcast' ? [stage] : [target, stage];
    return owners.flatMap(owner => Object.values(owner.variables)
        .filter(variable => variable.type === VARIABLE_TYPES[kind])
        .map(variable => variable.name));
};

/**
 * Complete a block catalogue with what the toolbox cannot say.
 *
 * The toolbox lists only the inputs that hold a typed-in default, so it says
 * nothing of a boolean slot or a C-block's branches, nor of a hat's dropdown.
 * Each block's own definition supplies those, and the project supplies the
 * items of menus that depend on it: costume, backdrop, sound and sprite
 * names, variables and broadcast messages.
 * @param {Array<object>} entries the catalogue `buildBlockCatalog` derived
 * @param {object} context where the scripts would go and how to read definitions
 * @param {object} context.vm the VirtualMachine
 * @param {object} context.target the target the scripts would be on
 * @param {Function} context.describeBlock reads a block type's inputs and fields from its
 *   scratch-blocks definition, returning null when it cannot
 * @returns {Array<object>} the catalogue, each input with its `kind` and each menu with its items
 */
const completeCatalog = (entries, {vm, target, describeBlock}) => {
    const staticOptions = opcode => {
        const shape = describeBlock(opcode);
        const field = shape && shape.fields[0];
        return field && Array.isArray(field.options) ? fromPairs(field.options) : {};
    };

    const describeMenu = (opcode, input) => {
        const menu = (input.shadow && menuFieldFor(vm.runtime, input.shadow) !== null) ?
            input.shadow :
            menuInputFor(vm.runtime, opcode, input.name);
        if (!menu) return null;

        const items = projectMenuOptions(vm, target, menu) || staticOptions(menu);
        return {kind: 'menu', menu, field: menuFieldFor(vm.runtime, menu), ...items};
    };

    const completeInput = (opcode, input) => {
        // An input the toolbox lists has a shadow, so it takes a typed value unless it is a menu.
        const completed = {kind: 'value', ...input};
        // The VM's own argument type and menu name are for its blocks, not for writing a spec.
        delete completed.type;
        delete completed.menu;
        return {...completed, ...describeMenu(opcode, input)};
    };

    const completeField = (opcode, field) => {
        const completed = {...field};
        delete completed.options;
        delete completed.type;
        delete completed.menu;
        if (field.variable) return {...completed, options: variableNames(vm, target, field.variable)};

        const fromProject = projectMenuOptions(vm, target, `${opcode}.${field.name}`);
        if (fromProject) return {...completed, ...fromProject};
        return Array.isArray(field.options) ? {...completed, ...fromPairs(field.options)} : completed;
    };

    return entries.map(entry => {
        const shape = describeBlock(entry.opcode);
        if (!shape) {
            return {
                ...entry,
                inputs: entry.inputs.map(input => completeInput(entry.opcode, input)),
                fields: entry.fields.map(field => completeField(entry.opcode, field))
            };
        }

        // The definition decides what is an input and what is a field, and in
        // what order; the toolbox and extension metadata add slot types and defaults.
        const known = new Map(entry.inputs.concat(entry.fields).map(item => [item.name, item]));
        return {
            ...entry,
            inputs: shape.inputs.map(input => {
                const listed = known.get(input.name);
                return input.kind === 'value' ?
                    completeInput(entry.opcode, {...listed, ...input}) :
                    {name: input.name, kind: input.kind};
            }),
            fields: shape.fields.map(field => {
                const listed = known.get(field.name);
                return completeField(entry.opcode, {
                    ...field,
                    ...(listed && typeof listed.default !== 'undefined' ? {default: listed.default} : {})
                });
            })
        };
    });
};

export {completeCatalog};
