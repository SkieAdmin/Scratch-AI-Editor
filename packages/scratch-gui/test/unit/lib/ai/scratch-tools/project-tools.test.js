import downloadBlob from '../../../../../src/lib/download-blob';
import {createToolRunner} from '../../../../../src/lib/ai/scratch-tools/runner';
import {makeVm} from './fake-vm';

jest.mock('../../../../../src/lib/make-toolbox-xml', () => ({
    __esModule: true,
    default: () => '<xml></xml>'
}));
jest.mock('../../../../../src/lib/ai/scratch-tools/block-definitions', () => ({
    isScratchBlocksType: () => false
}));
// A real download needs object URLs, which jsdom does not have.
jest.mock('../../../../../src/lib/download-blob', () => ({
    __esModule: true,
    default: jest.fn()
}));

const SB3_BYTES = [0x50, 0x4b, 0x03, 0x04];

/**
 * A stand-in for the editor's project state, as `createProjectAdapter` provides it.
 * @param {object} [state] how the project starts out
 * @returns {object} the fake adapter
 */
const makeProject = (state = {}) => {
    const project = {
        title: 'My Game',
        unsaved: false,
        ...state,
        getTitle: () => project.title,
        setTitle: jest.fn(title => {
            project.title = title;
        }),
        hasUnsavedChanges: () => project.unsaved,
        markSaved: jest.fn(() => {
            project.unsaved = false;
        }),
        createNew: jest.fn(() => Promise.resolve()),
        load: jest.fn(() => Promise.resolve())
    };
    return project;
};

const makeDesktop = () => ({
    captureWindow: jest.fn(),
    saveProject: jest.fn((bytes, request) => Promise.resolve({path: `C:/Projects/${request.path || request.title}.sb3`})),
    loadProject: jest.fn(path => Promise.resolve({
        // A view into a larger buffer, as IPC can deliver one.
        bytes: new Uint8Array(new Uint8Array([9, ...SB3_BYTES, 9]).buffer, 1, SB3_BYTES.length),
        name: 'Jungle Game.sb3',
        path: `C:/Projects/${path}`
    }))
});

const vmThatSaves = () => {
    const made = makeVm();
    made.vm.saveProjectSb3 = jest.fn(() => Promise.resolve({
        arrayBuffer: () => Promise.resolve(new Uint8Array(SB3_BYTES).buffer)
    }));
    return made;
};

describe('new_project', () => {
    test('starts a new project and gives it the title asked for', async () => {
        const {vm} = makeVm();
        const project = makeProject();
        const {runTool} = createToolRunner(vm, {project});

        const result = await runTool('new_project', {title: '  Maria in the Jungle '});

        expect(project.createNew).toHaveBeenCalled();
        expect(project.setTitle).toHaveBeenCalledWith('Maria in the Jungle');
        expect(result).toEqual({title: 'Maria in the Jungle', sprites: ['Cat'], backdrops: ['backdrop1']});
    });

    test('will not throw away unsaved changes unless told to', async () => {
        const {vm} = makeVm();
        const project = makeProject({unsaved: true});
        const {runTool} = createToolRunner(vm, {project});

        await expect(runTool('new_project', {})).rejects.toThrow(/not been saved.*"confirm": true/s);
        expect(project.createNew).not.toHaveBeenCalled();

        await runTool('new_project', {confirm: true});
        expect(project.createNew).toHaveBeenCalled();
    });

    test('keeps the editor\'s default title when none is given', async () => {
        const {vm} = makeVm();
        const project = makeProject();
        const {runTool} = createToolRunner(vm, {project});

        await runTool('new_project', {});

        expect(project.setTitle).not.toHaveBeenCalled();
    });
});

describe('set_project_title', () => {
    test('sets the title the menu bar shows', async () => {
        const {vm} = makeVm();
        const project = makeProject();
        const {runTool} = createToolRunner(vm, {project});

        expect(await runTool('set_project_title', {title: 'Jungle Quest'})).toEqual({title: 'Jungle Quest'});
    });

    test('refuses an empty title', async () => {
        const {vm} = makeVm();
        const {runTool} = createToolRunner(vm, {project: makeProject()});

        await expect(runTool('set_project_title', {title: '  '})).rejects.toThrow(/non-empty string/);
    });
});

describe('save_project', () => {
    test('has the desktop app write the .sb3 and reports where it went', async () => {
        const {vm} = vmThatSaves();
        const project = makeProject({unsaved: true});
        const desktop = makeDesktop();
        const {runTool} = createToolRunner(vm, {project, desktop});

        const result = await runTool('save_project', {});

        const [bytes, request] = desktop.saveProject.mock.calls[0];
        expect(Array.from(bytes)).toEqual(SB3_BYTES);
        expect(request).toEqual({title: 'My Game'});
        expect(result).toEqual({path: 'C:/Projects/My Game.sb3', title: 'My Game'});
        expect(project.hasUnsavedChanges()).toBe(false);
    });

    test('passes a path on to the desktop app', async () => {
        const {vm} = vmThatSaves();
        const desktop = makeDesktop();
        const {runTool} = createToolRunner(vm, {project: makeProject(), desktop});

        await runTool('save_project', {path: 'tests/run1'});

        expect(desktop.saveProject.mock.calls[0][1]).toEqual({title: 'My Game', path: 'tests/run1'});
    });

    test('names an untitled project as the editor does', async () => {
        const {vm} = vmThatSaves();
        const desktop = makeDesktop();
        const {runTool} = createToolRunner(vm, {project: makeProject({title: ''}), desktop});

        await runTool('save_project', {});

        expect(desktop.saveProject.mock.calls[0][1].title).toBe('Scratch Project');
    });

    test('downloads the file in a browser, and leaves the changes marked unsaved', async () => {
        const {vm} = vmThatSaves();
        const project = makeProject({unsaved: true});
        const {runTool} = createToolRunner(vm, {project});

        const result = await runTool('save_project', {});

        expect(downloadBlob).toHaveBeenCalledWith('My Game.sb3', expect.anything());
        expect(result).toEqual({downloaded: 'My Game.sb3'});
        expect(project.hasUnsavedChanges()).toBe(true);
    });

    test('cannot choose where a browser puts its download', async () => {
        const {vm} = vmThatSaves();
        const {runTool} = createToolRunner(vm, {project: makeProject()});

        await expect(runTool('save_project', {path: 'C:/elsewhere.sb3'})).rejects.toThrow(/browser.*Leave out "path"/s);
    });
});

describe('load_project', () => {
    test('opens the file the desktop app reads, titled after it', async () => {
        const {vm} = makeVm();
        const project = makeProject();
        const desktop = makeDesktop();
        const {runTool} = createToolRunner(vm, {project, desktop});

        const result = await runTool('load_project', {path: 'Jungle Game.sb3'});

        const [data, title] = project.load.mock.calls[0];
        expect(data).toBeInstanceOf(ArrayBuffer);
        expect(Array.from(new Uint8Array(data))).toEqual(SB3_BYTES);
        expect(title).toBe('Jungle Game');
        expect(result).toMatchObject({path: 'C:/Projects/Jungle Game.sb3', sprites: ['Cat'], backdrops: ['backdrop1']});
    });

    test('will not throw away unsaved changes unless told to', async () => {
        const {vm} = makeVm();
        const project = makeProject({unsaved: true});
        const {runTool} = createToolRunner(vm, {project, desktop: makeDesktop()});

        await expect(runTool('load_project', {path: 'Jungle Game.sb3'})).rejects.toThrow(/"confirm": true/);
        await runTool('load_project', {path: 'Jungle Game.sb3', confirm: true});
        expect(project.load).toHaveBeenCalledTimes(1);
    });

    test('needs the desktop app', async () => {
        const {vm} = makeVm();
        const {runTool} = createToolRunner(vm, {project: makeProject()});

        await expect(runTool('load_project', {path: 'Jungle Game.sb3'})).rejects.toThrow(/desktop app/);
    });
});

test('the project tools say why they cannot work without the editor around them', async () => {
    const {vm} = makeVm();
    const {runTool} = createToolRunner(vm);

    await expect(runTool('set_project_title', {title: 'Game'})).rejects.toThrow(/without the editor/);
});
