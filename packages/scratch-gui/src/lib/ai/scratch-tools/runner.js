import backdropLibraryContent from '../../libraries/backdrops.json';
import costumeLibraryContent from '../../libraries/costumes.json';
import soundLibraryContent from '../../libraries/sounds.json';
import spriteLibraryContent from '../../libraries/sprites.json';
import makeToolboxXML from '../../make-toolbox-xml';
import randomizeSpritePosition from '../../randomize-sprite-position';
import {WRITE_TOOL_NAMES} from './definitions';
import {
    BROADCAST_VARIABLE_TYPE,
    LIST_VARIABLE_TYPE,
    SCALAR_VARIABLE_TYPE,
    buildBlockCatalog,
    summarizeCostumes,
    summarizeProject,
    summarizeSounds,
    summarizeTarget,
    summarizeVariables
} from './serialize';

/**
 * Legal characters for a block id, from Blockly by way of scratch-vm's `uid`
 * helper. Ids generated here have to survive sb3 serialization, so they use the
 * same alphabet and length the editor itself uses.
 */
const ID_SOUP = '!#%()*+,-./:;=?@[]^_`{|}~' +
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const ID_LENGTH = 20;

const uid = () => {
    let id = '';
    for (let i = 0; i < ID_LENGTH; i++) {
        id += ID_SOUP.charAt(Math.random() * ID_SOUP.length);
    }
    return id;
};

/**
 * Shadow blocks that hold a typed-in literal, mapped to the field that holds it.
 * These are the slot types the editor drops into an empty input; anything else
 * has to be named explicitly in the block spec.
 */
const SHADOW_FIELDS = {
    colour_picker: 'COLOUR',
    math_angle: 'NUM',
    math_integer: 'NUM',
    math_number: 'NUM',
    math_positive_number: 'NUM',
    math_whole_number: 'NUM',
    note: 'NOTE',
    text: 'TEXT'
};

/** Fields whose value names a variable, list or broadcast rather than being a literal. */
const VARIABLE_FIELD_TYPES = {
    BROADCAST_OPTION: BROADCAST_VARIABLE_TYPE,
    LIST: LIST_VARIABLE_TYPE,
    VARIABLE: SCALAR_VARIABLE_TYPE
};

const WRITE_TOOLS = new Set(WRITE_TOOL_NAMES);

const MAX_SUGGESTIONS = 5;

const suggestNames = (library, wanted) => {
    const needle = String(wanted).toLowerCase();
    return library
        .filter(entry => entry.name.toLowerCase().includes(needle))
        .slice(0, MAX_SUGGESTIONS)
        .map(entry => entry.name);
};

const findLibraryItem = (library, kind, wanted) => {
    if (typeof wanted !== 'string') {
        throw new Error(`"libraryName" must be the name of a ${kind} in the Scratch library, as a string.`);
    }
    const item = library.find(entry => entry.name === wanted);
    if (item) return item;

    const suggestions = suggestNames(library, wanted);
    const hint = suggestions.length > 0 ?
        ` Did you mean: ${suggestions.join(', ')}?` :
        ' Names are case-sensitive and must match the library exactly.';
    throw new Error(`No ${kind} named "${wanted}" in the Scratch library.${hint}`);
};

const assertNumber = (name, value) => {
    if (typeof value !== 'number' || !isFinite(value)) {
        throw new Error(`"${name}" must be a finite number, got ${JSON.stringify(value)}.`);
    }
};

/**
 * Build the Scratch tool layer for a VM.
 *
 * Arguments reaching `runTool` were written by a language model, so they are
 * untrusted input and every one of them is validated here. Errors are phrased
 * so that the model can correct its own call.
 * @param {object} vm the VirtualMachine to operate on
 * @param {object} [options] overrides for the tool layer
 * @param {Function} [options.getToolboxXml] returns the toolbox XML for a target; supply this where
 *   scratch-blocks is not loaded, otherwise the editor's own toolbox is used
 * @returns {{runTool: Function, getRevision: Function}} the tool runner
 */
const createToolRunner = (vm, options = {}) => {
    /**
     * Bumped after every successful write. A write may carry the revision it
     * was planned against; a mismatch means the child edited the project while
     * the assistant was thinking, and the write is refused rather than
     * clobbering their work.
     */
    let revision = 0;

    const getToolboxXml = options.getToolboxXml ||
        (target => makeToolboxXML(false, target.isStage, target.id, vm.runtime.getBlocksXML(target)));

    const stageTarget = () => vm.runtime.getTargetForStage();

    const editingTarget = () => {
        if (!vm.editingTarget) {
            throw new Error('No sprite or stage is being edited yet. Pass "targetId" explicitly.');
        }
        return vm.editingTarget;
    };

    const resolveTarget = targetRef => {
        if (typeof targetRef === 'undefined' || targetRef === null) return editingTarget();
        if (typeof targetRef !== 'string') {
            throw new Error(`"targetId" must be a sprite name, a target id, or "stage", got ${typeof targetRef}.`);
        }
        if (targetRef === 'stage') return stageTarget();

        const byId = vm.runtime.getTargetById(targetRef);
        if (byId) return byId;
        const byName = vm.runtime.getSpriteTargetByName(targetRef);
        if (byName) return byName;

        const known = vm.runtime.targets
            .filter(target => target.isOriginal)
            .map(target => target.getName());
        throw new Error(`No sprite or target matches "${targetRef}". Known targets: ${known.join(', ')}.`);
    };

    const resolveSprite = targetRef => {
        const target = resolveTarget(targetRef);
        if (target.isStage) {
            throw new Error('This tool works on sprites, and the target resolved to the stage.');
        }
        return target;
    };

    /**
     * Tell the editor about a block change.
     *
     * `emitWorkspaceUpdate` only ever emits the editing target's blocks, so it
     * is worth calling only when that is the target that changed;
     * `refreshWorkspace` is the editor's own wrapper around it and also
     * re-syncs the target list. For any other target the sprite pane still
     * needs to hear about the change, which `emitTargetsUpdate` does.
     * @param {object} target the target whose blocks changed
     */
    const publishBlockChange = target => {
        if (vm.editingTarget && vm.editingTarget.id === target.id) {
            vm.refreshWorkspace();
        } else {
            vm.emitTargetsUpdate();
        }
    };

    const assertRevision = args => {
        const expected = args.expectedRevision;
        if (typeof expected === 'undefined' || expected === null) return;
        if (expected !== revision) {
            throw new Error(
                `Conflict: this write expected revision ${expected} but the project is at revision ` +
                `${revision}. It changed while you were working. Read the project again before retrying.`
            );
        }
    };

    const findVariable = (target, name, type) => {
        const search = owner => Object.keys(owner.variables)
            .map(id => owner.variables[id])
            .find(variable => variable.name === name && variable.type === type);

        const local = search(target);
        if (local) return {owner: target, variable: local};

        const stage = stageTarget();
        const global = target.isStage ? null : search(stage);
        if (global) return {owner: stage, variable: global};

        return null;
    };

    const isKnownOpcode = opcode => Boolean(vm.runtime.getOpcodeFunction(opcode)) ||
        vm.runtime.getIsHat(opcode) ||
        Object.prototype.hasOwnProperty.call(SHADOW_FIELDS, opcode) ||
        opcode.endsWith('_menu');

    const assertKnownOpcode = opcode => {
        if (typeof opcode !== 'string') {
            throw new Error(`Every block spec needs an "opcode" string, got ${JSON.stringify(opcode)}.`);
        }
        if (!isKnownOpcode(opcode)) {
            throw new Error(
                `"${opcode}" is not an opcode this project knows. Call get_block_catalog to see the ` +
                'opcodes that exist, and check for a typo or a missing extension.'
            );
        }
    };

    const buildField = (target, fieldName, rawValue) => {
        if (rawValue !== null && typeof rawValue === 'object') {
            return {name: fieldName, ...rawValue};
        }

        const variableType = VARIABLE_FIELD_TYPES[fieldName];
        if (typeof variableType === 'undefined') {
            return {name: fieldName, value: String(rawValue)};
        }

        const name = String(rawValue);
        const found = findVariable(target, name, variableType);
        if (!found) {
            const kind = fieldName === 'BROADCAST_OPTION' ? 'broadcast message' :
                (fieldName === 'LIST' ? 'list' : 'variable');
            throw new Error(
                `${target.getName()} has no ${kind} named "${name}". Create it with set_variable ` +
                'before referring to it from a script.'
            );
        }
        return {name: fieldName, id: found.variable.id, value: found.variable.name, variableType};
    };

    const buildShadow = (inputName, value, parentId, records) => {
        let opcode;
        let field;
        let literal;

        if (typeof value === 'number') {
            opcode = 'math_number';
            field = 'NUM';
            literal = value;
        } else if (typeof value === 'string') {
            opcode = 'text';
            field = 'TEXT';
            literal = value;
        } else {
            opcode = value.shadow;
            assertKnownOpcode(opcode);
            field = value.field || SHADOW_FIELDS[opcode];
            if (!field) {
                throw new Error(
                    `Input "${inputName}" uses shadow "${opcode}", which is not one of the standard ` +
                    'literal slots, so the spec must also name the "field" that holds the value.'
                );
            }
            literal = value.value;
        }

        const record = {
            id: uid(),
            opcode,
            inputs: {},
            fields: {[field]: {name: field, value: String(literal)}},
            next: null,
            topLevel: false,
            parent: parentId,
            shadow: true
        };
        records.push(record);
        return record;
    };

    const buildBlock = (target, spec, records, isTopLevel) => {
        if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
            throw new Error(`Every block must be an object with an "opcode", got ${JSON.stringify(spec)}.`);
        }
        assertKnownOpcode(spec.opcode);

        const record = {
            id: uid(),
            opcode: spec.opcode,
            inputs: {},
            fields: {},
            next: null,
            topLevel: isTopLevel,
            parent: null,
            shadow: false
        };
        records.push(record);

        Object.keys(spec.fields || {}).forEach(fieldName => {
            record.fields[fieldName] = buildField(target, fieldName, spec.fields[fieldName]);
        });

        const buildStack = (specs, parentId) => {
            if (!Array.isArray(specs)) {
                throw new Error(`A branch must be an array of block specs, got ${JSON.stringify(specs)}.`);
            }
            let firstId = null;
            let previous = null;
            specs.forEach(childSpec => {
                const child = buildBlock(target, childSpec, records, false);
                child.parent = previous ? previous.id : parentId;
                if (previous) {
                    previous.next = child.id;
                } else {
                    firstId = child.id;
                }
                previous = child;
            });
            return firstId;
        };

        Object.keys(spec.inputs || {}).forEach(inputName => {
            const value = spec.inputs[inputName];
            if (value === null || typeof value === 'undefined') return;

            if (Array.isArray(value)) {
                record.inputs[inputName] = {
                    name: inputName,
                    block: buildStack(value, record.id),
                    shadow: null
                };
                return;
            }
            if (typeof value === 'object' && typeof value.opcode === 'string') {
                const inner = buildBlock(target, value, records, false);
                inner.parent = record.id;
                record.inputs[inputName] = {name: inputName, block: inner.id, shadow: null};
                return;
            }
            const isLiteral = typeof value === 'number' || typeof value === 'string';
            if (!isLiteral && (typeof value !== 'object' || typeof value.shadow !== 'string')) {
                throw new Error(
                    `Input "${inputName}" must be a number or string literal, an array of block specs ` +
                    'for a branch, a nested block spec with an "opcode", or a slot spec with a ' +
                    `"shadow". Got ${JSON.stringify(value)}.`
                );
            }

            const shadow = buildShadow(inputName, value, record.id, records);
            record.inputs[inputName] = {name: inputName, block: shadow.id, shadow: shadow.id};
        });

        return record;
    };

    const handlers = {
        get_project_summary: () => summarizeProject(vm),

        get_target: args => summarizeTarget(resolveTarget(args.targetId)),

        list_sprites: () => ({
            editingTargetId: vm.editingTarget ? vm.editingTarget.id : null,
            sprites: vm.runtime.targets
                .filter(target => target.isOriginal && !target.isStage)
                .map(target => ({
                    id: target.id,
                    name: target.getName(),
                    x: target.x,
                    y: target.y,
                    size: target.size,
                    direction: target.direction,
                    visible: target.visible
                }))
        }),

        list_costumes: args => {
            const target = resolveTarget(args.targetId);
            return {
                targetId: target.id,
                currentCostume: target.currentCostume,
                costumes: summarizeCostumes(target)
            };
        },

        list_sounds: args => {
            const target = resolveTarget(args.targetId);
            return {targetId: target.id, sounds: summarizeSounds(target)};
        },

        list_variables: args => {
            const target = resolveTarget(args.targetId);
            const stage = stageTarget();
            return {
                targetId: target.id,
                local: target.isStage ? [] : summarizeVariables(target),
                global: summarizeVariables(stage)
            };
        },

        get_block_catalog: args => {
            const target = args.targetId ? resolveTarget(args.targetId) : (vm.editingTarget || stageTarget());
            let blocks = buildBlockCatalog(vm.runtime, getToolboxXml(target));

            if (typeof args.category === 'string') {
                const category = args.category.toLowerCase();
                blocks = blocks.filter(entry => (entry.category || '').toLowerCase() === category);
            }
            if (typeof args.search === 'string') {
                const search = args.search.toLowerCase();
                blocks = blocks.filter(entry => entry.opcode.toLowerCase().includes(search));
            }

            return {targetId: target.id, blocks};
        },

        add_sprite_from_library: args => {
            const item = {...findLibraryItem(spriteLibraryContent, 'sprite', args.libraryName)};
            randomizeSpritePosition(item);
            if (typeof args.x !== 'undefined') {
                assertNumber('x', args.x);
                item.x = args.x;
            }
            if (typeof args.y !== 'undefined') {
                assertNumber('y', args.y);
                item.y = args.y;
            }

            const idsBefore = new Set(vm.runtime.targets.map(target => target.id));
            return vm.addSprite(JSON.stringify(item)).then(() => {
                const added = vm.runtime.targets.find(target => !idsBefore.has(target.id));
                if (typeof args.name === 'string') vm.renameSprite(added.id, args.name);
                vm.setEditingTarget(added.id);
                return {id: added.id, name: added.getName(), x: added.x, y: added.y};
            });
        },

        delete_sprite: args => {
            const target = resolveSprite(args.targetId);
            const name = target.getName();
            vm.deleteSprite(target.id);
            return {deleted: {id: target.id, name}};
        },

        rename_sprite: args => {
            const target = resolveSprite(args.targetId);
            if (typeof args.name !== 'string' || args.name.length === 0) {
                throw new Error('"name" must be a non-empty string.');
            }
            vm.renameSprite(target.id, args.name);
            // Scratch refuses reserved names and de-duplicates the rest, so report what it settled on.
            return {id: target.id, name: target.getName()};
        },

        set_sprite_properties: args => {
            const target = resolveSprite(args.targetId);
            const spriteInfo = {};

            ['x', 'y', 'direction', 'size'].forEach(key => {
                if (typeof args[key] === 'undefined') return;
                assertNumber(key, args[key]);
                spriteInfo[key] = args[key];
            });
            if (typeof args.visible !== 'undefined') {
                if (typeof args.visible !== 'boolean') {
                    throw new Error(`"visible" must be true or false, got ${JSON.stringify(args.visible)}.`);
                }
                spriteInfo.visible = args.visible;
            }
            if (Object.keys(spriteInfo).length === 0) {
                throw new Error('Pass at least one of x, y, direction, size or visible.');
            }

            if (vm.editingTarget && vm.editingTarget.id === target.id) {
                // The VM's own postSpriteInfo applies to whatever is being edited or dragged,
                // which is the editor's path and handles a drag in progress.
                vm.postSpriteInfo(spriteInfo);
            } else {
                target.postSpriteInfo(spriteInfo);
                vm.runtime.emitProjectChanged();
            }
            vm.emitTargetsUpdate();

            return {
                id: target.id,
                x: target.x,
                y: target.y,
                direction: target.direction,
                size: target.size,
                visible: target.visible
            };
        },

        add_costume_from_library: args => {
            const item = findLibraryItem(costumeLibraryContent, 'costume', args.libraryName);
            const target = resolveTarget(args.targetId);
            const vmCostume = {
                name: item.name,
                rotationCenterX: item.rotationCenterX,
                rotationCenterY: item.rotationCenterY,
                bitmapResolution: item.bitmapResolution,
                skinId: null
            };
            // Library costumes carry sb2-era rotation centres, which is why the costume library
            // passes version 2 through addCostumeFromLibrary.
            return vm.addCostume(item.md5ext, vmCostume, target.id, 2).then(() => {
                vm.emitTargetsUpdate();
                return {targetId: target.id, name: vmCostume.name, index: target.getCostumes().length - 1};
            });
        },

        add_backdrop_from_library: args => {
            const item = findLibraryItem(backdropLibraryContent, 'backdrop', args.libraryName);
            const stage = stageTarget();
            const vmBackdrop = {
                name: item.name,
                rotationCenterX: item.rotationCenterX,
                rotationCenterY: item.rotationCenterY,
                bitmapResolution: item.bitmapResolution,
                skinId: null
            };
            return vm.addBackdrop(item.md5ext, vmBackdrop).then(() => {
                vm.emitTargetsUpdate();
                return {name: vmBackdrop.name, index: stage.getCostumes().length - 1};
            });
        },

        add_sound_from_library: args => {
            const item = findLibraryItem(soundLibraryContent, 'sound', args.libraryName);
            const target = resolveTarget(args.targetId);
            const vmSound = {
                format: item.format,
                md5: item.md5ext,
                rate: item.rate,
                sampleCount: item.sampleCount,
                name: item.name
            };
            return vm.addSound(vmSound, target.id).then(() => ({
                targetId: target.id,
                name: vmSound.name,
                index: target.getSounds().length - 1
            }));
        },

        set_variable: args => {
            if (typeof args.name !== 'string' || args.name.length === 0) {
                throw new Error('"name" must be a non-empty variable name.');
            }
            const kind = args.kind || 'variable';
            if (kind !== 'variable' && kind !== 'list') {
                throw new Error(`"kind" must be "variable" or "list", got ${JSON.stringify(args.kind)}.`);
            }
            const type = kind === 'list' ? LIST_VARIABLE_TYPE : SCALAR_VARIABLE_TYPE;

            if (kind === 'list' && !Array.isArray(args.value)) {
                throw new Error('A list\'s "value" must be an array.');
            }
            if (kind === 'variable' && (args.value === null || typeof args.value === 'object')) {
                throw new Error('A variable\'s "value" must be a string, number or boolean. Use kind "list" ' +
                    'for an array.');
            }

            const target = resolveTarget(args.targetId);
            const found = findVariable(target, args.name, type);
            const created = !found;
            const owner = found ? found.owner : (args.scope === 'local' ? target : stageTarget());

            let variableId;
            if (found) {
                variableId = found.variable.id;
            } else {
                variableId = uid();
                owner.createVariable(variableId, args.name, type);
            }
            vm.setVariableValue(owner.id, variableId, args.value);

            if (created) {
                // A new variable only appears in the palette once the workspace is rebuilt.
                if (vm.editingTarget) vm.refreshWorkspace();
            } else {
                vm.emitTargetsUpdate();
            }

            return {id: variableId, name: args.name, kind, created, ownerId: owner.id};
        },

        create_script: args => {
            const target = resolveTarget(args.targetId);
            if (!Array.isArray(args.blocks) || args.blocks.length === 0) {
                throw new Error('"blocks" must be a non-empty array of block specs, top block first.');
            }

            const records = [];
            let previous = null;
            args.blocks.forEach(spec => {
                const record = buildBlock(target, spec, records, previous === null);
                if (previous) {
                    previous.next = record.id;
                    record.parent = previous.id;
                }
                previous = record;
            });

            const topBlock = records[0];
            topBlock.x = typeof args.x === 'number' ? args.x : 0;
            topBlock.y = typeof args.y === 'number' ? args.y : 0;

            records.forEach(record => target.blocks.createBlock(record));
            publishBlockChange(target);

            return {targetId: target.id, topBlockId: topBlock.id, blockCount: records.length};
        },

        delete_script: args => {
            const target = resolveTarget(args.targetId);
            if (typeof args.topBlockId !== 'string') {
                throw new Error('"topBlockId" must be the id of a script\'s top block, as reported by get_target.');
            }
            if (target.blocks.getScripts().indexOf(args.topBlockId) === -1) {
                throw new Error(
                    `${target.getName()} has no script starting at block "${args.topBlockId}". ` +
                    'Call get_target for the current script ids.'
                );
            }

            target.blocks.deleteBlock(args.topBlockId);
            publishBlockChange(target);

            return {targetId: target.id, deletedTopBlockId: args.topBlockId};
        },

        green_flag: () => {
            vm.greenFlag();
            return {running: true};
        },

        stop_all: () => {
            vm.stopAll();
            return {running: false};
        },

        set_editing_target: args => {
            const target = resolveTarget(args.targetId);
            vm.setEditingTarget(target.id);
            return {editingTargetId: target.id, name: target.getName()};
        }
    };

    /**
     * Run one tool call.
     * @param {string} name the tool to run
     * @param {object} [args] the tool's arguments, as written by the model
     * @returns {Promise<object>} the tool's result, plus the revision it left the project at
     */
    const runTool = async (name, args = {}) => {
        const handler = handlers[name];
        if (!handler) {
            throw new Error(`There is no tool called "${name}". Available tools: ${Object.keys(handlers).join(', ')}.`);
        }
        if (args === null || typeof args !== 'object' || Array.isArray(args)) {
            throw new Error(`Arguments for "${name}" must be an object, got ${JSON.stringify(args)}.`);
        }

        const isWrite = WRITE_TOOLS.has(name);
        if (isWrite) assertRevision(args);

        const result = await handler(args);
        if (isWrite) revision += 1;

        return {...result, revision};
    };

    /**
     * The project's current revision, which every write bumps.
     * @returns {number} the revision counter
     */
    const getRevision = () => revision;

    return {getRevision, runTool};
};

export {createToolRunner};
