/**
 * What the tool layer knows about dropdown menus.
 *
 * A menu in Scratch is a shadow block sitting in an input, the way a typed-in
 * number is a `math_number` shadow. The VM implements no primitive for these
 * blocks, so they are recognised here rather than through the runtime.
 */

/** Core menu shadow blocks, mapped to the field that holds the chosen item. */
const MENU_SHADOW_FIELDS = {
    control_create_clone_of_menu: 'CLONE_OPTION',
    event_broadcast_menu: 'BROADCAST_OPTION',
    looks_backdrops: 'BACKDROP',
    looks_costume: 'COSTUME',
    motion_glideto_menu: 'TO',
    motion_goto_menu: 'TO',
    motion_pointtowards_menu: 'TOWARDS',
    sensing_distancetomenu: 'DISTANCETOMENU',
    sensing_keyoptions: 'KEY_OPTION',
    sensing_of_object_menu: 'OBJECT',
    sensing_touchingobjectmenu: 'TOUCHINGOBJECTMENU',
    sound_sounds_menu: 'SOUND_MENU'
};

/**
 * The core inputs that hold a menu, by block opcode and input name. A plain
 * string written into one of these is the item to choose, not a text literal.
 */
const MENU_INPUTS = {
    control_create_clone_of: {CLONE_OPTION: 'control_create_clone_of_menu'},
    event_broadcast: {BROADCAST_INPUT: 'event_broadcast_menu'},
    event_broadcastandwait: {BROADCAST_INPUT: 'event_broadcast_menu'},
    looks_switchbackdropto: {BACKDROP: 'looks_backdrops'},
    looks_switchbackdroptoandwait: {BACKDROP: 'looks_backdrops'},
    looks_switchcostumeto: {COSTUME: 'looks_costume'},
    motion_glideto: {TO: 'motion_glideto_menu'},
    motion_goto: {TO: 'motion_goto_menu'},
    motion_pointtowards: {TOWARDS: 'motion_pointtowards_menu'},
    sensing_distanceto: {DISTANCETOMENU: 'sensing_distancetomenu'},
    sensing_keypressed: {KEY_OPTION: 'sensing_keyoptions'},
    sensing_of: {OBJECT: 'sensing_of_object_menu'},
    sensing_touchingobject: {TOUCHINGOBJECTMENU: 'sensing_touchingobjectmenu'},
    sound_play: {SOUND_MENU: 'sound_sounds_menu'},
    sound_playuntildone: {SOUND_MENU: 'sound_sounds_menu'}
};

/**
 * Find a menu block that a loaded extension registered.
 *
 * Extension menus are named `<extensionId>_menu_<menuName>` and exist only
 * once their extension is loaded. Each one has a single dropdown field.
 * @param {object} runtime the VM runtime
 * @param {string} opcode the menu block's opcode
 * @returns {?{field: string}} the menu's field name, or null when no loaded extension defines it
 */
const findExtensionMenu = (runtime, opcode) => {
    for (const categoryInfo of runtime._blockInfo) {
        const menu = (categoryInfo.menus || []).find(candidate => candidate.json.type === opcode);
        if (menu) return {field: menu.json.args0[0].name};
    }
    return null;
};

/**
 * Find the menu an extension block expects in one of its inputs.
 *
 * An extension argument backed by a menu is an input holding a menu shadow
 * only when the menu accepts reporters; otherwise the editor draws it as a
 * plain field on the block, which takes no shadow at all.
 * @param {object} runtime the VM runtime
 * @param {string} opcode the extension block's opcode
 * @param {string} inputName the input to look up
 * @returns {?string} the menu shadow's opcode, or null when the input takes no menu
 */
const findExtensionMenuInput = (runtime, opcode, inputName) => {
    for (const categoryInfo of runtime._blockInfo) {
        const blockInfo = categoryInfo.blocks.find(candidate => candidate.json && candidate.json.type === opcode);
        if (!blockInfo) continue;

        const argument = (blockInfo.info.arguments || {})[inputName];
        const menuInfo = argument && argument.menu && (categoryInfo.menuInfo || {})[argument.menu];
        if (!menuInfo || !menuInfo.acceptReporters) return null;

        const menu = categoryInfo.menus.find(candidate => candidate.json.args0[0].name === argument.menu);
        return menu ? menu.json.type : null;
    }
    return null;
};

/**
 * The field a menu shadow keeps its choice in.
 * @param {object} runtime the VM runtime
 * @param {string} opcode the menu block's opcode
 * @returns {?string} the field name, or null when the opcode is not a menu
 */
const menuFieldFor = (runtime, opcode) => {
    if (Object.prototype.hasOwnProperty.call(MENU_SHADOW_FIELDS, opcode)) return MENU_SHADOW_FIELDS[opcode];
    const extensionMenu = findExtensionMenu(runtime, opcode);
    return extensionMenu ? extensionMenu.field : null;
};

/**
 * The menu shadow a block expects in one of its inputs.
 * @param {object} runtime the VM runtime
 * @param {string} opcode the block's opcode
 * @param {string} inputName the input
 * @returns {?string} the menu shadow's opcode, or null when the input does not hold a menu
 */
const menuInputFor = (runtime, opcode, inputName) => {
    const coreInputs = MENU_INPUTS[opcode];
    if (coreInputs && Object.prototype.hasOwnProperty.call(coreInputs, inputName)) return coreInputs[inputName];
    return findExtensionMenuInput(runtime, opcode, inputName);
};

export {
    MENU_INPUTS,
    MENU_SHADOW_FIELDS,
    findExtensionMenu,
    menuFieldFor,
    menuInputFor
};
