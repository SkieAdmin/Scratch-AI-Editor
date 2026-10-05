import {cleanUpLayout} from './layout';
import {menuInputFor} from './menus';
import {BRANCH_INPUT_PREFIX} from './serialize';

const assertCoordinate = (name, value) => {
    if (typeof value !== 'number' || !isFinite(value)) {
        throw new Error(`"${name}" must be a finite number, got ${JSON.stringify(value)}.`);
    }
};

/**
 * Every block record in a script: the stack, the blocks and shadows in its
 * inputs, and the blocks in its branches.
 * @param {object} blocks the target's Blocks container
 * @param {string} topBlockId the script's top block
 * @returns {Array<object>} the records, top block first
 */
const collectScript = (blocks, topBlockId) => {
    const records = [];
    const visit = blockId => {
        for (let id = blockId; id; id = blocks.getNextBlock(id)) {
            const block = blocks.getBlock(id);
            records.push(block);
            Object.values(block.inputs).forEach(input => {
                if (input.block) visit(input.block);
                // A reporter dropped into an input hides the shadow underneath, which still belongs to the script.
                if (input.shadow && input.shadow !== input.block) visit(input.shadow);
            });
        }
    };
    visit(topBlockId);
    return records;
};

/**
 * Build the tools that edit scripts in place: change one value, move or tidy
 * scripts, and copy a script to another target.
 * @param {object} context what the tool layer shares between its tools
 * @param {object} context.vm the VirtualMachine
 * @param {Function} context.resolveTarget finds a target from a `targetId` argument
 * @param {Function} context.publishBlockChange tells the editor a target's blocks changed
 * @param {Function} context.buildField builds a field record, resolving variable names
 * @param {Function} context.buildShadow builds the shadow block that holds an input's value
 * @returns {object} the tool handlers, by tool name
 */
const createEditingHandlers = ({vm, resolveTarget, publishBlockChange, buildField, buildShadow}) => {
    const scriptIn = (target, topBlockId) => {
        if (typeof topBlockId !== 'string') {
            throw new Error('"topBlockId" must be the id of a script\'s top block, as reported by get_target.');
        }
        if (target.blocks.getScripts().indexOf(topBlockId) === -1) {
            throw new Error(`${target.getName()} has no script starting at block "${topBlockId}". Call ` +
                'get_target for the current script ids.');
        }
        return topBlockId;
    };

    const setField = (target, block, fieldName, value) => {
        if (!block.fields[fieldName]) {
            const fields = Object.keys(block.fields);
            throw new Error(`A ${block.opcode} block has no field "${fieldName}". Its fields are: ` +
                `${fields.length > 0 ? fields.join(', ') : 'none'}.`);
        }
        const field = buildField(target, fieldName, String(value));
        if (typeof field.id === 'undefined') {
            // The editor's own path for choosing a dropdown item.
            target.blocks.changeBlock({element: 'field', id: block.id, name: fieldName, value: field.value});
            return;
        }
        // The VM's change path looks a variable up on the sprite being edited,
        // which need not be this one, so a variable, list or message is set here.
        block.fields[fieldName] = {...block.fields[fieldName], ...field};
        target.blocks.resetCache();
        vm.runtime.emitProjectChanged();
    };

    const setInput = (target, block, inputName, value) => {
        if (inputName.startsWith(BRANCH_INPUT_PREFIX)) {
            throw new Error(`"${inputName}" is a branch of the C-block, which holds blocks rather than a value.`);
        }

        const input = block.inputs[inputName];
        if (!input) {
            const records = [];
            const menuOpcode = menuInputFor(vm.runtime, block.opcode, inputName);
            const shadow = buildShadow(target, inputName, value, block.id, records, menuOpcode);
            records.forEach(record => target.blocks.createBlock(record));
            block.inputs[inputName] = {name: inputName, block: shadow.id, shadow: shadow.id};
            target.blocks.resetCache();
            vm.runtime.emitProjectChanged();
            return;
        }

        if (!input.shadow) {
            throw new Error(`Input "${inputName}" takes a block rather than a typed value, such as a condition. ` +
                'Build the block into the script with create_script instead.');
        }
        if (input.block !== input.shadow) {
            // The editor puts the slot back when a reporter is dragged out of
            // an input; replacing it with a value does the same.
            target.blocks.deleteBlock(input.block);
            input.block = input.shadow;
        }
        const shadow = target.blocks.getBlock(input.shadow);
        setField(target, shadow, Object.keys(shadow.fields)[0], value);
    };

    return {
        set_block_input: args => {
            const target = resolveTarget(args.targetId);
            const block = typeof args.blockId === 'string' ? target.blocks.getBlock(args.blockId) : null;
            if (!block) {
                throw new Error(`${target.getName()} has no block ${JSON.stringify(args.blockId)}. Call get_target ` +
                    'for the ids of its blocks.');
            }
            const hasInput = typeof args.input === 'string';
            const hasField = typeof args.field === 'string';
            if (hasInput === hasField) {
                throw new Error(`Name the "input" or the "field" to change${hasInput ? ', not both' : ''}.`);
            }
            if (typeof args.value !== 'string' && typeof args.value !== 'number') {
                throw new Error(`"value" must be a number or a string, got ${JSON.stringify(args.value)}.`);
            }

            if (hasInput) {
                setInput(target, block, args.input, args.value);
            } else {
                setField(target, block, args.field, args.value);
            }
            publishBlockChange(target);

            return {
                targetId: target.id,
                blockId: block.id,
                [hasInput ? 'input' : 'field']: hasInput ? args.input : args.field,
                value: String(args.value)
            };
        },

        move_script: args => {
            const target = resolveTarget(args.targetId);
            const topBlockId = scriptIn(target, args.topBlockId);
            assertCoordinate('x', args.x);
            assertCoordinate('y', args.y);

            target.blocks.moveBlock({id: topBlockId, newCoordinate: {x: args.x, y: args.y}});
            publishBlockChange(target);
            return {targetId: target.id, topBlockId, x: args.x, y: args.y};
        },

        clean_up_scripts: args => {
            const target = resolveTarget(args.targetId);
            const layout = cleanUpLayout(target.blocks, opcode => vm.runtime.getIsHat(opcode));

            layout.forEach(({topBlockId, x, y}) => {
                target.blocks.moveBlock({id: topBlockId, newCoordinate: {x, y}});
            });
            publishBlockChange(target);
            return {targetId: target.id, scripts: layout};
        },

        copy_script_to: async args => {
            const from = resolveTarget(args.fromTarget);
            const to = resolveTarget(args.toTarget);
            const topBlockId = scriptIn(from, args.topBlockId);
            if (from.id === to.id) {
                throw new Error(`"fromTarget" and "toTarget" are both ${from.getName()}. copy_script_to copies a ` +
                    'script to another sprite or to the stage.');
            }

            const records = collectScript(from.blocks, topBlockId);
            const scriptsBefore = new Set(to.blocks.getScripts());
            // What dropping a dragged script on a sprite in the sprite list
            // does: new block ids, local variables reconciled, and any
            // extension the script uses loaded on the way.
            await vm.shareBlocksToTarget(records, to.id, from.id);
            const copiedTopBlockId = to.blocks.getScripts().find(id => !scriptsBefore.has(id));
            publishBlockChange(to);

            return {
                fromTargetId: from.id,
                toTargetId: to.id,
                topBlockId: copiedTopBlockId,
                blockCount: records.length
            };
        }
    };
};

export {createEditingHandlers};
