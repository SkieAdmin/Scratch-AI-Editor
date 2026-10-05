import downloadBlob from '../../download-blob';
import {getProjectTitleFromFilename} from '../../sb-file-uploader-utils';

/** The file name a project gets when its title is empty, as the editor's own download names it. */
const DEFAULT_PROJECT_TITLE = 'Scratch Project';

/** How much of a title the editor keeps in a file name. */
const MAX_FILENAME_TITLE_LENGTH = 100;

const UNSAVED_CHANGES = 'The open project has changes that have not been saved. Save them with save_project ' +
    'first, or pass "confirm": true to throw them away.';

/**
 * Build the tools that start, name, save and open whole projects.
 * @param {object} context what the tool layer shares between its tools
 * @param {object} context.vm the VirtualMachine
 * @param {?object} context.project the editor's project state and File menu actions, or null
 *   when the tools run without an editor around the VM
 * @param {?object} context.desktop the desktop shell's file services, or null in a browser
 * @returns {object} the tool handlers, by tool name
 */
const createProjectHandlers = ({vm, project, desktop}) => {
    const editor = () => {
        if (!project) {
            throw new Error('Projects cannot be started, named, saved or opened here: these tools are ' +
                'running without the editor around them.');
        }
        return project;
    };

    const assertTitle = title => {
        if (typeof title !== 'string' || title.trim() === '') {
            throw new Error(`"title" must be a non-empty string, got ${JSON.stringify(title)}.`);
        }
        return title.trim();
    };

    const assertConfirm = confirm => {
        if (typeof confirm !== 'undefined' && typeof confirm !== 'boolean') {
            throw new Error(`"confirm" must be true or false, got ${JSON.stringify(confirm)}.`);
        }
    };

    const contents = () => ({
        sprites: vm.runtime.targets
            .filter(target => target.isOriginal && !target.isStage)
            .map(target => target.getName()),
        backdrops: vm.runtime.getTargetForStage().getCostumes()
            .map(costume => costume.name)
    });

    return {
        new_project: async args => {
            const title = typeof args.title === 'undefined' ? null : assertTitle(args.title);
            assertConfirm(args.confirm);
            if (editor().hasUnsavedChanges() && args.confirm !== true) throw new Error(UNSAVED_CHANGES);

            await editor().createNew();
            if (title !== null) editor().setTitle(title);
            return {title: editor().getTitle(), ...contents()};
        },

        set_project_title: args => {
            editor().setTitle(assertTitle(args.title));
            return {title: editor().getTitle()};
        },

        save_project: async args => {
            if (typeof args.path !== 'undefined' && (typeof args.path !== 'string' || args.path === '')) {
                throw new Error(`"path" must be a file path, got ${JSON.stringify(args.path)}.`);
            }
            const title = editor().getTitle() || DEFAULT_PROJECT_TITLE;
            const sb3 = await vm.saveProjectSb3();

            if (!desktop) {
                if (typeof args.path !== 'undefined') {
                    throw new Error('This editor runs in a browser, which can only download the project to ' +
                        'the browser\'s downloads folder. Leave out "path".');
                }
                const filename = `${title.substring(0, MAX_FILENAME_TITLE_LENGTH)}.sb3`;
                downloadBlob(filename, sb3);
                return {downloaded: filename};
            }

            const saved = await desktop.saveProject(new Uint8Array(await sb3.arrayBuffer()), {title, path: args.path});
            editor().markSaved();
            return {path: saved.path, title};
        },

        load_project: async args => {
            if (!desktop) {
                throw new Error('load_project only works in the Skie AI Editor desktop app. In a browser, open ' +
                    'the project with File > Load from your computer.');
            }
            if (typeof args.path !== 'string' || args.path === '') {
                throw new Error(`"path" must be the path of a .sb3 file, got ${JSON.stringify(args.path)}.`);
            }
            assertConfirm(args.confirm);
            if (editor().hasUnsavedChanges() && args.confirm !== true) throw new Error(UNSAVED_CHANGES);

            const file = await desktop.loadProject(args.path);
            // The file picker hands the VM an ArrayBuffer, so this does too.
            const data = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength);
            await editor().load(data, getProjectTitleFromFilename(file.name) || file.name);
            return {path: file.path, title: editor().getTitle(), ...contents()};
        }
    };
};

export {createProjectHandlers};
