import {combineReducers, createStore} from 'redux';

import {createProjectAdapter} from '../../../../src/lib/ai/project-adapter';
import {createToolRunner} from '../../../../src/lib/ai/scratch-tools/runner';
import modalsReducer from '../../../../src/reducers/modals';
import projectChangedReducer, {setProjectChanged} from '../../../../src/reducers/project-changed';
import projectStateReducer, {
    LoadingState,
    onFetchedProjectData,
    onLoadedProject,
    projectError,
    projectStateInitialState
} from '../../../../src/reducers/project-state';
import projectTitleReducer, {setProjectTitle} from '../../../../src/reducers/project-title';
import {makeVm} from './scratch-tools/fake-vm';

jest.mock('../../../../src/lib/make-toolbox-xml', () => ({
    __esModule: true,
    default: () => '<xml></xml>'
}));
jest.mock('../../../../src/lib/ai/scratch-tools/block-definitions', () => ({
    isScratchBlocksType: () => false
}));

const EDITOR_DEFAULT_TITLE = 'Scratch Project';

const makeStore = (loadingState = LoadingState.SHOWING_WITHOUT_ID) => createStore(
    combineReducers({
        scratchGui: combineReducers({
            modals: modalsReducer,
            projectChanged: projectChangedReducer,
            projectState: projectStateReducer,
            projectTitle: projectTitleReducer
        })
    }),
    {scratchGui: {projectState: {...projectStateInitialState, loadingState}, projectTitle: 'My Game'}}
);

/**
 * Play the part of the editor around the store: fetch and load the default
 * project when File > New asks for one, then reset the title once it shows.
 * Each step happens some time after the change it answers, as a component
 * reacts only once React has rendered that change, and the editor started
 * watching the store before any tool did.
 * @param {object} store the store to watch
 * @param {object} [options] how the load goes
 * @param {boolean} [options.fail] whether loading the default project fails
 */
const actAsEditor = (store, {fail = false} = {}) => {
    let previous = store.getState().scratchGui.projectState.loadingState;
    store.subscribe(() => {
        const {loadingState} = store.getState().scratchGui.projectState;
        if (loadingState === previous) return;
        const before = previous;
        previous = loadingState;

        let next = null;
        if (loadingState === LoadingState.FETCHING_NEW_DEFAULT) {
            next = onFetchedProjectData({}, LoadingState.FETCHING_NEW_DEFAULT);
        } else if (loadingState === LoadingState.LOADING_VM_NEW_DEFAULT) {
            next = fail ? projectError('the default project is missing') :
                onLoadedProject(LoadingState.LOADING_VM_NEW_DEFAULT, false, true);
        } else if (loadingState === LoadingState.SHOWING_WITHOUT_ID && before === LoadingState.LOADING_VM_NEW_DEFAULT) {
            next = setProjectTitle(EDITOR_DEFAULT_TITLE);
        }
        if (next) setTimeout(() => store.dispatch(next));
    });
};

describe('createProjectAdapter', () => {
    test('File > New settles once the new project is showing', async () => {
        const store = makeStore();
        actAsEditor(store);
        const project = createProjectAdapter(store, {});

        await project.createNew();

        expect(store.getState().scratchGui.projectState.loadingState).toBe(LoadingState.SHOWING_WITHOUT_ID);
        expect(project.getTitle()).toBe(EDITOR_DEFAULT_TITLE);
    });

    /*
     * The editor resets a new project's title in the update that shows it, so
     * a title set as soon as the state says "showing" was overwritten.
     */
    test('a title given to new_project survives the editor resetting it', async () => {
        const store = makeStore();
        actAsEditor(store);
        const {vm} = makeVm();
        const {runTool} = createToolRunner(vm, {project: createProjectAdapter(store, vm)});

        const result = await runTool('new_project', {title: 'Maria in the Jungle'});

        expect(result.title).toBe('Maria in the Jungle');
        expect(store.getState().scratchGui.projectTitle).toBe('Maria in the Jungle');
    });

    test('reports a new project that fails to load', async () => {
        const store = makeStore();
        actAsEditor(store, {fail: true});
        const project = createProjectAdapter(store, {});

        await expect(project.createNew()).rejects.toThrow(/could not be loaded: the default project is missing/);
    });

    test('refuses to start while the editor is still loading a project', () => {
        const store = makeStore(LoadingState.LOADING_VM_FILE_UPLOAD);
        const project = createProjectAdapter(store, {});

        expect(() => project.createNew()).toThrow(/busy loading/);
    });

    test('opens a file the way File > Load does, named after the file', async () => {
        const store = makeStore();
        const vm = {loadProject: jest.fn(() => Promise.resolve())};
        const project = createProjectAdapter(store, vm);
        const data = new ArrayBuffer(4);

        await project.load(data, 'Jungle');

        expect(vm.loadProject).toHaveBeenCalledWith(data);
        const gui = store.getState().scratchGui;
        expect(gui.projectState.loadingState).toBe(LoadingState.SHOWING_WITHOUT_ID);
        expect(gui.projectTitle).toBe('Jungle');
        expect(gui.modals.loadingProject).toBe(false);
    });

    test('keeps showing the old project when a file will not open', async () => {
        const store = makeStore();
        // The VM rejects an unreadable file with a bare string, not an Error.
        const vm = {loadProject: jest.fn(() => Promise.reject('{"validationError":"bad zip"}'))};
        const project = createProjectAdapter(store, vm);

        await expect(project.load(new ArrayBuffer(4), 'Broken')).rejects.toThrow(/could not open that project.*bad zip/);

        const gui = store.getState().scratchGui;
        expect(gui.projectState.loadingState).toBe(LoadingState.SHOWING_WITHOUT_ID);
        expect(gui.projectTitle).toBe('My Game');
        expect(gui.modals.loadingProject).toBe(false);
    });

    test('reads and clears the unsaved-changes flag', () => {
        const store = makeStore();
        const project = createProjectAdapter(store, {});

        store.dispatch(setProjectChanged());
        expect(project.hasUnsavedChanges()).toBe(true);

        project.markSaved();
        expect(project.hasUnsavedChanges()).toBe(false);
    });
});
