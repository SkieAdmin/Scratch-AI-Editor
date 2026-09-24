/**
 * The desktop shell runs the MCP bridge inside its own process and tells the
 * page where to find it through a preload script. In the browser this global is
 * absent and the editor falls back to whatever the user configured.
 * @returns {?string} the bridge URL, token included, or null in a browser
 */
const getDesktopBridgeUrl = () => {
    const desktop = typeof window === 'undefined' ? null : window.scratchAiDesktop;
    if (!desktop || typeof desktop.bridgeUrl !== 'string' || desktop.bridgeUrl === '') return null;
    return desktop.bridgeUrl;
};

/**
 * Whether the editor is running inside the desktop shell.
 * @returns {boolean} true when the preload bridge is present
 */
const isDesktop = () => getDesktopBridgeUrl() !== null;

/**
 * The desktop shell's settings store, which keeps the configuration in a file
 * the user can open (`Documents/Scratch3_Config.json`) rather than in browser
 * storage. Absent in a browser.
 * @returns {?object} an object with `readConfig` and `writeConfig`, or null
 */
const getDesktopConfigStore = () => {
    const desktop = typeof window === 'undefined' ? null : window.scratchAiDesktop;
    if (!desktop || typeof desktop.readConfig !== 'function') return null;
    return desktop;
};

export {getDesktopBridgeUrl, getDesktopConfigStore, isDesktop};
