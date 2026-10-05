import {findAssetIndex} from './find-asset';
import {prepareSvg} from './svg';

const namesOf = items => items.map(item => item.name);

/**
 * Check a pair of positions in a list.
 * @param {object} args the tool arguments, carrying `from` and `to`
 * @param {number} length how long the list is
 * @param {string} kind what the list holds, for messages
 */
const assertPositions = (args, length, kind) => {
    ['from', 'to'].forEach(key => {
        if (!Number.isInteger(args[key]) || args[key] < 0 || args[key] >= length) {
            throw new Error(`"${key}" must be a ${kind} position from 0 to ${length - 1}, got ` +
                `${JSON.stringify(args[key])}.`);
        }
    });
};

const assertNewName = newName => {
    if (typeof newName !== 'string' || newName.trim() === '') {
        throw new Error(`"newName" must be a non-empty string, got ${JSON.stringify(newName)}.`);
    }
    return newName.trim();
};

/**
 * Build the tools that tidy and extend a target's costumes, backdrops and sounds.
 * @param {object} context what the tool layer shares between its tools
 * @param {object} context.vm the VirtualMachine
 * @param {Function} context.resolveTarget finds a target from a `targetId` argument
 * @param {Function} context.stageTarget returns the stage
 * @returns {object} the tool handlers, by tool name
 */
const createAssetHandlers = ({vm, resolveTarget, stageTarget}) => {
    const costumeKind = target => (target.isStage ? 'backdrop' : 'costume');

    const deleteCostume = (target, choice) => {
        const kind = costumeKind(target);
        const costumes = target.getCostumes();
        const index = findAssetIndex(costumes, choice, kind, target.getName());
        if (costumes.length === 1) {
            throw new Error(`${target.getName()} must keep at least one ${kind}, and "${costumes[0].name}" is its ` +
                `only one. Add another ${kind} before deleting this one.`);
        }
        const deleted = costumes[index].name;
        target.deleteCostume(index);
        vm.emitTargetsUpdate();
        return {targetId: target.id, deleted, [`${kind}s`]: namesOf(target.getCostumes())};
    };

    const addSvgCostume = async (target, args) => {
        if (typeof args.name !== 'string' || args.name.trim() === '') {
            throw new Error(`"name" must be a non-empty string, got ${JSON.stringify(args.name)}.`);
        }
        const svg = prepareSvg(args.svg);

        // The same asset an uploaded SVG file becomes, so the editor treats it
        // exactly like one: thumbnails, the paint editor and saving all work.
        const storage = vm.runtime.storage;
        const asset = storage.createAsset(
            storage.AssetType.ImageVector,
            storage.DataFormat.SVG,
            new TextEncoder().encode(svg),
            null,
            true
        );
        const costume = {
            name: args.name.trim(),
            dataFormat: storage.DataFormat.SVG,
            asset,
            md5: `${asset.assetId}.${storage.DataFormat.SVG}`,
            assetId: asset.assetId
        };

        if (target.isStage) {
            await vm.addBackdrop(costume.md5, costume);
        } else {
            await vm.addCostume(costume.md5, costume, target.id);
        }
        vm.emitTargetsUpdate();

        const costumes = target.getCostumes();
        // Scratch renames a costume whose name is taken, so report the one it settled on.
        return {targetId: target.id, name: costumes[costumes.length - 1].name, index: costumes.length - 1};
    };

    return {
        delete_costume: args => deleteCostume(resolveTarget(args.targetId), args),

        delete_backdrop: args => deleteCostume(stageTarget(), args),

        reorder_costume: args => {
            const target = resolveTarget(args.targetId);
            const kind = costumeKind(target);
            assertPositions(args, target.getCostumes().length, kind);
            vm.reorderCostume(target.id, args.from, args.to);
            vm.emitTargetsUpdate();
            return {targetId: target.id, [`${kind}s`]: namesOf(target.getCostumes())};
        },

        rename_costume: args => {
            const target = resolveTarget(args.targetId);
            const index = findAssetIndex(target.getCostumes(), args, costumeKind(target), target.getName());
            // Also renames it in every block that chooses it from a menu.
            target.renameCostume(index, assertNewName(args.newName));
            vm.emitTargetsUpdate();
            return {targetId: target.id, index, name: target.getCostumes()[index].name};
        },

        delete_sound: args => {
            const target = resolveTarget(args.targetId);
            const index = findAssetIndex(target.getSounds(), args, 'sound', target.getName());
            const deleted = target.getSounds()[index].name;
            target.deleteSound(index);
            vm.emitTargetsUpdate();
            return {targetId: target.id, deleted, sounds: namesOf(target.getSounds())};
        },

        reorder_sound: args => {
            const target = resolveTarget(args.targetId);
            assertPositions(args, target.getSounds().length, 'sound');
            vm.reorderSound(target.id, args.from, args.to);
            vm.emitTargetsUpdate();
            return {targetId: target.id, sounds: namesOf(target.getSounds())};
        },

        rename_sound: args => {
            const target = resolveTarget(args.targetId);
            const index = findAssetIndex(target.getSounds(), args, 'sound', target.getName());
            target.renameSound(index, assertNewName(args.newName));
            vm.emitTargetsUpdate();
            return {targetId: target.id, index, name: target.getSounds()[index].name};
        },

        add_costume_from_svg: args => addSvgCostume(resolveTarget(args.targetId), args),

        add_backdrop_from_svg: args => addSvgCostume(stageTarget(), args)
    };
};

export {createAssetHandlers};
