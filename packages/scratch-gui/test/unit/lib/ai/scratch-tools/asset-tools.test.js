import {createToolRunner} from '../../../../../src/lib/ai/scratch-tools/runner';
import {makeVm} from './fake-vm';

jest.mock('../../../../../src/lib/make-toolbox-xml', () => ({
    __esModule: true,
    default: () => '<xml></xml>'
}));
jest.mock('../../../../../src/lib/ai/scratch-tools/block-definitions', () => ({
    isScratchBlocksType: () => false
}));

const SCENE = '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360">' +
    '<rect width="480" height="360" fill="#2d6a4f"/></svg>';

/**
 * A project like a fresh one after two library backdrops were added: the blank
 * backdrop1 first, and the stage showing the last one added.
 * @returns {object} the fake vm and its targets
 */
const withScenes = () => {
    const made = makeVm();
    made.stage.getCostumes().push({name: 'Jungle', dataFormat: 'png'}, {name: 'Woods', dataFormat: 'png'});
    made.stage.currentCostume = 2;
    return made;
};

describe('deleting costumes and backdrops', () => {
    /*
     * A new project's blank "backdrop1" could not be removed, so every scene
     * built from library backdrops kept an empty one in front of it.
     */
    test('delete_backdrop removes the blank backdrop a new project starts with', async () => {
        const {vm, stage} = withScenes();
        const {runTool} = createToolRunner(vm);

        const result = await runTool('delete_backdrop', {name: 'backdrop1'});

        expect(stage.deleteCostume).toHaveBeenCalledWith(0);
        expect(result).toEqual({targetId: 'stage-id', deleted: 'backdrop1', backdrops: ['Jungle', 'Woods']});
        expect(vm.emitTargetsUpdate).toHaveBeenCalled();
    });

    test('delete_costume removes a sprite\'s costume by position', async () => {
        const {vm} = makeVm();
        const {runTool} = createToolRunner(vm);

        const result = await runTool('delete_costume', {targetId: 'Cat', index: 1});

        expect(result).toEqual({targetId: 'sprite-id', deleted: 'costume2', costumes: ['costume1']});
    });

    test('a target must keep one costume, and the message says what to do instead', async () => {
        const {vm, stage} = makeVm();
        const {runTool} = createToolRunner(vm);

        await expect(runTool('delete_backdrop', {name: 'backdrop1'}))
            .rejects.toThrow(/must keep at least one backdrop.*Add another backdrop/s);
        expect(stage.deleteCostume).not.toHaveBeenCalled();
    });

    test('names the costumes there are when asked for one that is not there', async () => {
        const {vm} = makeVm();
        const {runTool} = createToolRunner(vm);

        await expect(runTool('delete_costume', {targetId: 'Cat', name: 'costume9'}))
            .rejects.toThrow(/no costume named "costume9"\. Its costumes are: costume1, costume2/);
    });
});

describe('reordering and renaming costumes', () => {
    test('reorder_costume moves a backdrop to the front of the stage\'s list', async () => {
        const {vm} = withScenes();
        const {runTool} = createToolRunner(vm);

        const result = await runTool('reorder_costume', {targetId: 'stage', from: 2, to: 0});

        expect(vm.reorderCostume).toHaveBeenCalledWith('stage-id', 2, 0);
        expect(result).toEqual({targetId: 'stage-id', backdrops: ['Woods', 'backdrop1', 'Jungle']});
    });

    test('reorder_costume refuses a position outside the list', async () => {
        const {vm} = makeVm();
        const {runTool} = createToolRunner(vm);

        await expect(runTool('reorder_costume', {targetId: 'Cat', from: 0, to: 2}))
            .rejects.toThrow(/"to" must be a costume position from 0 to 1/);
    });

    test('rename_costume reports the name Scratch settled on', async () => {
        const {vm, sprite} = makeVm();
        const {runTool} = createToolRunner(vm);

        const result = await runTool('rename_costume', {targetId: 'Cat', name: 'costume2', newName: 'costume1'});

        expect(sprite.renameCostume).toHaveBeenCalledWith(1, 'costume1');
        expect(result).toEqual({targetId: 'sprite-id', index: 1, name: 'costume12'});
    });

    test('rename_costume wants a new name', async () => {
        const {vm} = makeVm();
        const {runTool} = createToolRunner(vm);

        await expect(runTool('rename_costume', {targetId: 'Cat', index: 0, newName: ' '}))
            .rejects.toThrow(/"newName" must be a non-empty string/);
    });
});

describe('sounds', () => {
    const withSounds = () => {
        const made = makeVm();
        made.sprite.getSounds().push({name: 'Pop', dataFormat: 'wav'}, {name: 'Chirp', dataFormat: 'wav'});
        return made;
    };

    test('delete_sound removes a sound by name', async () => {
        const {vm} = withSounds();
        const {runTool} = createToolRunner(vm);

        const result = await runTool('delete_sound', {targetId: 'Cat', name: 'Pop'});

        expect(result).toEqual({targetId: 'sprite-id', deleted: 'Pop', sounds: ['Meow', 'Chirp']});
    });

    test('reorder_sound moves a sound', async () => {
        const {vm} = withSounds();
        const {runTool} = createToolRunner(vm);

        const result = await runTool('reorder_sound', {targetId: 'Cat', from: 0, to: 2});

        expect(vm.reorderSound).toHaveBeenCalledWith('sprite-id', 0, 2);
        expect(result.sounds).toEqual(['Pop', 'Chirp', 'Meow']);
    });

    test('rename_sound renames a sound by position', async () => {
        const {vm} = withSounds();
        const {runTool} = createToolRunner(vm);

        expect(await runTool('rename_sound', {targetId: 'Cat', index: 2, newName: 'Tweet'}))
            .toEqual({targetId: 'sprite-id', index: 2, name: 'Tweet'});
    });
});

describe('drawing costumes and backdrops as SVG', () => {
    test('add_backdrop_from_svg stores the drawing as an SVG asset and adds it to the stage', async () => {
        const {vm, stage} = makeVm();
        const {runTool} = createToolRunner(vm);

        const result = await runTool('add_backdrop_from_svg', {name: 'Night', svg: SCENE});

        const [assetType, dataFormat, data] = vm.runtime.storage.createAsset.mock.calls[0];
        expect([assetType, dataFormat]).toEqual(['ImageVector', 'svg']);
        expect(new TextDecoder().decode(data)).toContain('#2d6a4f');
        expect(vm.addBackdrop).toHaveBeenCalledWith('drawn.svg', expect.objectContaining({name: 'Night'}));
        expect(result).toEqual({targetId: 'stage-id', name: 'Night', index: 1});
        expect(stage.getCostumes().map(costume => costume.name)).toEqual(['backdrop1', 'Night']);
    });

    test('add_costume_from_svg adds the drawing to a sprite', async () => {
        const {vm} = makeVm();
        const {runTool} = createToolRunner(vm);

        const result = await runTool('add_costume_from_svg', {
            targetId: 'Cat',
            name: 'Star',
            svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle r="9" cx="10" cy="10"/></svg>'
        });

        expect(vm.addCostume).toHaveBeenCalledWith('drawn.svg', expect.objectContaining({name: 'Star'}), 'sprite-id');
        expect(result).toEqual({targetId: 'sprite-id', name: 'Star', index: 2});
    });

    test('refuses a drawing with a script in it, and adds nothing', async () => {
        const {vm} = makeVm();
        const {runTool} = createToolRunner(vm);

        await expect(runTool('add_backdrop_from_svg', {
            name: 'Trap',
            svg: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><script>x()</script></svg>'
        })).rejects.toThrow(/<script> element/);
        expect(vm.addBackdrop).not.toHaveBeenCalled();
    });
});
