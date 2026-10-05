import {closeLoadingProject, openLoadingProject} from '../../reducers/modals';
import {setProjectUnchanged} from '../../reducers/project-changed';
import {getIsError, getIsShowingProject, requestNewProject} from '../../reducers/project-state';
import {setProjectTitle} from '../../reducers/project-title';

/**
 * The editor's side of the project file tools: its title, whether it holds
 * unsaved work, and starting or opening a project.
 *
 * A new project goes through the same redux actions as File > New, so the
 * rest of the editor reacts as it would to the menu. File > New saves to a
 * project server first when the editor has one; neither the desktop app nor
 * the standalone editor does, so this never asks for that.
 * @param {object} store the editor's redux store
 * @param {object} vm the VirtualMachine
 * @returns {object} the project adapter the tool runner takes
 */
const createProjectAdapter = (store, vm) => {
    const gui = () => store.getState().scratchGui;

    const assertIdle = () => {
        if (!getIsShowingProject(gui().projectState.loadingState)) {
            throw new Error('The editor is busy loading a project. Try again in a moment.');
        }
    };

    /**
     * Wait until the project being loaded is showing.
     *
     * Settles a turn after the state changes, so the rest of the editor has
     * reacted first: it resets a new project's title in that same update, and
     * a title set any sooner would be overwritten.
     * @returns {Promise<void>} resolves once the project is showing
     */
    const untilShowing = () => new Promise((resolve, reject) => {
        const unsubscribe = store.subscribe(() => {
            const {error, loadingState} = gui().projectState;
            if (getIsShowingProject(loadingState)) {
                unsubscribe();
                setTimeout(resolve);
            } else if (getIsError(loadingState)) {
                unsubscribe();
                reject(new Error(`The new project could not be loaded: ${error}`));
            }
        });
    });

    return {
        getTitle: () => gui().projectTitle,
        setTitle: title => store.dispatch(setProjectTitle(title)),
        hasUnsavedChanges: () => gui().projectChanged,
        markSaved: () => store.dispatch(setProjectUnchanged()),

        createNew: () => {
            assertIdle();
            const shown = untilShowing();
            store.dispatch(requestNewProject(false));
            return shown;
        },

        /*
         * Not through the File > Load states: the menu's file loader owns
         * those, and cancels any load it did not start itself. The VM opens
         * the file directly, under the same loading screen.
         */
        load: async (data, title) => {
            assertIdle();
            store.dispatch(openLoadingProject());
            try {
                await vm.loadProject(data);
            } catch (error) {
                // The VM rejects a file it cannot read with a bare string.
                throw new Error(`The editor could not open that project: ${error.message || String(error)}`);
            } finally {
                store.dispatch(closeLoadingProject());
            }
            store.dispatch(setProjectTitle(title));
            // A project just opened from a file has no unsaved changes. The
            // renderer can finish loading skins a turn later and report a
            // change as it does, so, like the editor's own loaders, this
            // clears the flag after that.
            await new Promise(resolve => setTimeout(resolve));
            store.dispatch(setProjectUnchanged());
        }
    };
};

export {createProjectAdapter};
