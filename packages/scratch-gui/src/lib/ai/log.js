import {getDesktopConfigStore} from './desktop';

/**
 * Report something worth keeping.
 *
 * In the desktop app this appends to `Documents/Scratch3_Logs`, so a problem the
 * user hit yesterday can still be read today. A browser has no such file, so it
 * falls back to the console.
 * @param {string} level 'Information', 'Warning' or 'Error'
 * @param {string} message what happened
 */
const report = (level, message) => {
    const desktop = getDesktopConfigStore();
    if (desktop && typeof desktop.log === 'function') {
        desktop.log(level, message);
        return;
    }

    // eslint-disable-next-line no-console
    console[level === 'Error' ? 'error' : 'warn'](`${level}: ${message}`);
};

const logInformation = message => report('Information', message);
const logWarning = message => report('Warning', message);
const logError = message => report('Error', message);

export {logError, logInformation, logWarning};
