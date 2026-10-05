/**
 * The catalogue of operations an AI assistant may perform against the live VM.
 *
 * `inputSchema` is JSON Schema so that the same entry can be handed to an MCP
 * server's `registerTool` and to an OpenAI-style `tools` array without
 * translation. Descriptions are written for the model, not for a person: they
 * say when to reach for the tool and what a valid argument looks like.
 *
 * Two flags limit where a tool is offered. `mcpOnly` tools are kept from the
 * editor's own chat, which hands tool results to the model as text: a picture
 * would arrive as a wall of base64. `desktopOnly` tools need the desktop
 * shell and are not offered in a browser.
 */

const targetProperty = {
    type: 'string',
    description: 'Sprite name, target id, or "stage". Defaults to the sprite currently being edited.'
};

const assetChoiceProperties = kind => ({
    name: {type: 'string', description: `The ${kind}'s name.`},
    index: {
        type: 'integer',
        minimum: 0,
        description: `The ${kind}'s position, counting from 0, as list_costumes reports it. Pass name or index.`
    }
});

const blockSpecDescription =
    'A block is {"opcode": "motion_movesteps", "inputs": {...}, "fields": {...}}. An input value is ' +
    'a number or string literal, an array of block specs for a C-block branch, a nested block spec ' +
    '{"opcode": ...} to drop a reporter into the slot, or {"shadow": "<opcode>", "value": <literal>} ' +
    'to choose the slot type explicitly. In a menu input, such as BACKDROP of looks_switchbackdropto ' +
    'or TO of motion_goto, a plain string picks that item from the dropdown. A field value is a plain ' +
    'string; VARIABLE, LIST and BROADCAST_OPTION fields are resolved by name against the target. Call ' +
    'get_block_catalog for the input and field names of an opcode.';

const TOOL_DEFINITIONS = [
    {
        name: 'get_project_summary',
        description: 'Read a compact digest of the whole project: sprite names and positions, ' +
            'variable names and values, backdrop and costume counts, and the shape of every script. ' +
            'Start here. Use get_target when you need a script block by block.',
        inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false
        }
    },
    {
        name: 'get_target',
        description: 'Read one sprite or the stage in full, including every script block by block.',
        inputSchema: {
            type: 'object',
            properties: {targetId: targetProperty},
            additionalProperties: false
        }
    },
    {
        name: 'list_sprites',
        description: 'List the sprites in the project with their ids, names and positions.',
        inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false
        }
    },
    {
        name: 'list_costumes',
        description: 'List a target\'s costumes, in the order they appear in the costume tab.',
        inputSchema: {
            type: 'object',
            properties: {targetId: targetProperty},
            additionalProperties: false
        }
    },
    {
        name: 'list_sounds',
        description: 'List a target\'s sounds, in the order they appear in the sound tab.',
        inputSchema: {
            type: 'object',
            properties: {targetId: targetProperty},
            additionalProperties: false
        }
    },
    {
        name: 'list_variables',
        description: 'List the variables and lists visible to a target: its own, plus the global ' +
            'ones that live on the stage.',
        inputSchema: {
            type: 'object',
            properties: {targetId: targetProperty},
            additionalProperties: false
        }
    },
    {
        name: 'get_block_catalog',
        description: 'List the opcodes available in this project and the inputs and fields each one ' +
            'takes, including any loaded extensions. Filter it: the unfiltered catalogue is large.',
        inputSchema: {
            type: 'object',
            properties: {
                targetId: targetProperty,
                category: {
                    type: 'string',
                    description: 'Only return blocks in this palette category, for example "motion", ' +
                        '"looks", "control", "operators", "data".'
                },
                search: {
                    type: 'string',
                    description: 'Only return opcodes containing this text.'
                }
            },
            additionalProperties: false
        }
    },
    {
        name: 'add_sprite_from_library',
        description: 'Add one of the sprites that ship with Scratch. Use the library name exactly, ' +
            'for example "Cat" or "Ball". The new sprite becomes the editing target.',
        inputSchema: {
            type: 'object',
            properties: {
                libraryName: {type: 'string', description: 'The sprite\'s name in the Scratch sprite library.'},
                name: {type: 'string', description: 'Rename the sprite after adding it.'},
                x: {type: 'number', description: 'Stage x position. Randomised when omitted, as the editor does.'},
                y: {type: 'number', description: 'Stage y position. Randomised when omitted, as the editor does.'}
            },
            required: ['libraryName'],
            additionalProperties: false
        }
    },
    {
        name: 'delete_sprite',
        description: 'Delete a sprite and all of its clones. The stage cannot be deleted.',
        inputSchema: {
            type: 'object',
            properties: {
                targetId: targetProperty
            },
            required: ['targetId'],
            additionalProperties: false
        }
    },
    {
        name: 'rename_sprite',
        description: 'Rename a sprite. Scratch appends a number if the name is already taken, so ' +
            'check the name in the result.',
        inputSchema: {
            type: 'object',
            properties: {
                targetId: targetProperty,
                name: {type: 'string', description: 'The new sprite name.'}
            },
            required: ['targetId', 'name'],
            additionalProperties: false
        }
    },
    {
        name: 'set_sprite_properties',
        description: 'Move, turn, resize, show or hide a sprite, or switch its costume. Only the ' +
            'properties you pass are changed.',
        inputSchema: {
            type: 'object',
            properties: {
                targetId: targetProperty,
                x: {type: 'number', description: 'Stage x position, roughly -240 to 240.'},
                y: {type: 'number', description: 'Stage y position, roughly -180 to 180.'},
                direction: {type: 'number', description: 'Heading in degrees; 90 points right.'},
                size: {type: 'number', description: 'Size as a percentage; 100 is full size.'},
                visible: {type: 'boolean', description: 'Whether the sprite is shown on the stage.'},
                costume: {
                    type: ['string', 'integer'],
                    description: 'The costume to wear: its name, or its position counting from 0.'
                }
            },
            additionalProperties: false
        }
    },
    {
        name: 'add_costume_from_library',
        description: 'Add one of the costumes that ship with Scratch to a sprite or the stage.',
        inputSchema: {
            type: 'object',
            properties: {
                libraryName: {type: 'string', description: 'The costume\'s name in the Scratch costume library.'},
                targetId: targetProperty
            },
            required: ['libraryName'],
            additionalProperties: false
        }
    },
    {
        name: 'add_backdrop_from_library',
        description: 'Add one of the backdrops that ship with Scratch to the stage and switch to it.',
        inputSchema: {
            type: 'object',
            properties: {
                libraryName: {type: 'string', description: 'The backdrop\'s name in the Scratch backdrop library.'}
            },
            required: ['libraryName'],
            additionalProperties: false
        }
    },
    {
        name: 'add_sound_from_library',
        description: 'Add one of the sounds that ship with Scratch to a sprite or the stage.',
        inputSchema: {
            type: 'object',
            properties: {
                libraryName: {type: 'string', description: 'The sound\'s name in the Scratch sound library.'},
                targetId: targetProperty
            },
            required: ['libraryName'],
            additionalProperties: false
        }
    },
    {
        name: 'set_variable',
        description: 'Set a variable or list, creating it if it does not exist yet. This is also how ' +
            'you make a new variable before referring to it from a script.',
        inputSchema: {
            type: 'object',
            properties: {
                name: {type: 'string', description: 'The variable name as a child would see it.'},
                value: {
                    description: 'The new value. Pass an array for a list.',
                    type: ['string', 'number', 'boolean', 'array']
                },
                kind: {
                    type: 'string',
                    enum: ['variable', 'list'],
                    description: 'Whether this is a single variable or a list. Defaults to "variable".'
                },
                scope: {
                    type: 'string',
                    enum: ['global', 'local'],
                    description: 'Where a newly created variable lives: "global" puts it on the stage ' +
                        'so every sprite can use it, "local" puts it on one sprite. Defaults to "global", ' +
                        'which is what the editor does. Ignored if the variable already exists.'
                },
                targetId: targetProperty
            },
            required: ['name', 'value'],
            additionalProperties: false
        }
    },
    {
        name: 'create_script',
        description: `Build a new stack of blocks on a target. ${blockSpecDescription}`,
        inputSchema: {
            type: 'object',
            properties: {
                targetId: targetProperty,
                blocks: {
                    type: 'array',
                    minItems: 1,
                    description: 'The blocks of the script, top to bottom. The first one is usually a ' +
                        'hat block such as event_whenflagclicked.',
                    items: {type: 'object'}
                },
                x: {type: 'number', description: 'Where to place the script in the code area. Defaults to 0.'},
                y: {type: 'number', description: 'Where to place the script in the code area. Defaults to 0.'}
            },
            required: ['blocks'],
            additionalProperties: false
        }
    },
    {
        name: 'delete_script',
        description: 'Delete a whole script, given the id of its top block. get_target reports that id.',
        inputSchema: {
            type: 'object',
            properties: {
                targetId: targetProperty,
                topBlockId: {type: 'string', description: 'The id of the script\'s top block.'}
            },
            required: ['topBlockId'],
            additionalProperties: false
        }
    },
    {
        name: 'search_library',
        description: 'List or search the names in a Scratch asset library. Library names are exact and ' +
            'case-sensitive, and the library is smaller than you expect, so search here before calling ' +
            'add_sprite_from_library or the other add_*_from_library tools instead of guessing a name.',
        inputSchema: {
            type: 'object',
            properties: {
                kind: {
                    type: 'string',
                    enum: ['sprite', 'costume', 'backdrop', 'sound'],
                    description: 'Which library to look in.'
                },
                query: {
                    type: 'string',
                    description: 'Part of a name to match, case-insensitive. Omit to list from the start.'
                }
            },
            required: ['kind'],
            additionalProperties: false
        }
    },
    {
        name: 'add_extension',
        description: 'Switch on one of the Scratch extensions so its blocks become available. ' +
            'Use "text2speech" to give characters a speaking voice: it adds the "speak" block, ' +
            'which says words out loud while the project runs. create_script loads an extension ' +
            'by itself when a script uses one of its blocks, so call this only to check first.',
        inputSchema: {
            type: 'object',
            properties: {
                extensionId: {
                    type: 'string',
                    enum: ['text2speech', 'music', 'pen', 'translate'],
                    description: 'Which extension to switch on.'
                }
            },
            required: ['extensionId'],
            additionalProperties: false
        }
    },
    {
        name: 'green_flag',
        description: 'Start the project, as if the green flag had been clicked.',
        inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false
        }
    },
    {
        name: 'stop_all',
        description: 'Stop every running script, as if the stop sign had been clicked.',
        inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false
        }
    },
    {
        name: 'set_editing_target',
        description: 'Switch the editor to a sprite or the stage, so the child sees the code you are ' +
            'working on. Tools that take an optional targetId default to this target.',
        inputSchema: {
            type: 'object',
            properties: {targetId: targetProperty},
            required: ['targetId'],
            additionalProperties: false
        }
    },
    {
        name: 'get_runtime_state',
        description: 'Read what the project is doing right now: whether any script is running, the ' +
            'current backdrop, each sprite\'s position, direction, size, visibility, costume, layer and ' +
            'speech or thought bubble, the question an "ask and wait" block is waiting on, and every ' +
            'variable\'s value. Use it after green_flag, click_sprite, press_key or answer_question to ' +
            'check that the scripts did what they should.',
        inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false
        }
    },
    {
        name: 'wait',
        description: 'Let the project run for a while, then read its state as get_runtime_state does. ' +
            'Use it to check timing, for example that a "say for 2 seconds" bubble is gone after 2 seconds.',
        inputSchema: {
            type: 'object',
            properties: {
                ms: {
                    type: 'integer',
                    minimum: 0,
                    maximum: 15000,
                    description: 'How long to wait, in milliseconds. At most 15000.'
                }
            },
            required: ['ms'],
            additionalProperties: false
        }
    },
    {
        name: 'capture_stage',
        mcpOnly: true,
        description: 'Take a picture of the stage as it looks right now, speech and thought bubbles ' +
            'included, and return it as a PNG image. Use it to check how a scene looks.',
        inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false
        }
    },
    {
        name: 'capture_editor',
        mcpOnly: true,
        desktopOnly: true,
        description: 'Take a picture of the whole editor window, code area and sprite list included, ' +
            'and return it as a PNG image. Use capture_stage when only the stage matters.',
        inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false
        }
    },
    {
        name: 'click_sprite',
        description: 'Click a sprite, which starts its "when this sprite clicked" scripts. Pass "stage" ' +
            'to click the stage instead, which starts the stage\'s "when stage clicked" scripts.',
        inputSchema: {
            type: 'object',
            properties: {targetId: targetProperty},
            required: ['targetId'],
            additionalProperties: false
        }
    },
    {
        name: 'press_key',
        description: 'Press a key and let it go, which starts "when key pressed" scripts; "key pressed?" ' +
            'sees the key while it is held.',
        inputSchema: {
            type: 'object',
            properties: {
                key: {
                    type: 'string',
                    description: 'A single character such as "a" or "1", or one of "space", "left arrow", ' +
                        '"right arrow", "up arrow", "down arrow", "enter".'
                },
                holdMs: {
                    type: 'integer',
                    minimum: 0,
                    maximum: 5000,
                    description: 'How long to hold the key down, in milliseconds. Defaults to 100.'
                }
            },
            required: ['key'],
            additionalProperties: false
        }
    },
    {
        name: 'answer_question',
        description: 'Type an answer into the box an "ask and wait" block shows, and press enter, as the ' +
            'child would. The answer then becomes the value of the "answer" block. Fails when no question ' +
            'is waiting; get_runtime_state shows the question.',
        inputSchema: {
            type: 'object',
            properties: {
                text: {type: 'string', description: 'The answer to type.'}
            },
            required: ['text'],
            additionalProperties: false
        }
    },
    {
        name: 'set_backdrop',
        description: 'Switch the stage to one of its backdrops, by name or by position, without adding ' +
            'another copy of it. Starts the "when backdrop switches to" scripts, as the "switch backdrop ' +
            'to" block does, unless runHats is false.',
        inputSchema: {
            type: 'object',
            properties: {
                ...assetChoiceProperties('backdrop'),
                runHats: {
                    type: 'boolean',
                    description: 'Whether to start "when backdrop switches to" scripts. Defaults to true.'
                }
            },
            additionalProperties: false
        }
    },
    {
        name: 'set_costume',
        description: 'Switch a sprite to one of its costumes, by name or by position.',
        inputSchema: {
            type: 'object',
            properties: {
                targetId: targetProperty,
                ...assetChoiceProperties('costume')
            },
            additionalProperties: false
        }
    },
    {
        name: 'new_project',
        mcpOnly: true,
        description: 'Start a new project, as File > New does: the default project, one sprite on a blank ' +
            'backdrop, replaces the open one. Fails when the open project has unsaved changes, unless ' +
            'confirm is true, which throws them away.',
        inputSchema: {
            type: 'object',
            properties: {
                title: {type: 'string', description: 'The new project\'s title. Defaults to the editor\'s own.'},
                confirm: {
                    type: 'boolean',
                    description: 'Set to true to start over even though the open project has unsaved changes.'
                }
            },
            additionalProperties: false
        }
    },
    {
        name: 'set_project_title',
        description: 'Set the project\'s title, which the menu bar shows and save_project names the file after.',
        inputSchema: {
            type: 'object',
            properties: {
                title: {type: 'string', description: 'The new title.'}
            },
            required: ['title'],
            additionalProperties: false
        }
    },
    {
        name: 'save_project',
        mcpOnly: true,
        description: 'Save the project as a .sb3 file. In the desktop app it is written to path, or to ' +
            'Documents/Skie AI Editor/Projects/<title>.sb3 when path is left out, and the result gives the ' +
            'path. In a browser the file is downloaded instead, and path cannot be used.',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'Where to write the file. A relative path is inside Documents/Skie AI ' +
                        'Editor/Projects, and ".sb3" is added when there is no extension.'
                }
            },
            additionalProperties: false
        }
    },
    {
        name: 'load_project',
        mcpOnly: true,
        desktopOnly: true,
        description: 'Open a .sb3 file in the editor, replacing the open project, as File > Load from your ' +
            'computer does. Fails when the open project has unsaved changes, unless confirm is true.',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'The file to open; .sb2 and .sb work too. A relative path is looked up in ' +
                        'Documents/Skie AI Editor/Projects.'
                },
                confirm: {
                    type: 'boolean',
                    description: 'Set to true to open the file even though the open project has unsaved changes.'
                }
            },
            required: ['path'],
            additionalProperties: false
        }
    }
];

/**
 * The tools to offer in one place.
 * @param {object} where the place the list is for
 * @param {boolean} where.desktop whether the editor runs in the desktop shell
 * @param {boolean} where.editorChat true for the editor's own chat, false for an MCP client
 * @returns {Array<object>} the tools, in catalogue order
 */
const selectToolDefinitions = ({desktop, editorChat}) => TOOL_DEFINITIONS.filter(tool =>
    (desktop || !tool.desktopOnly) && !(editorChat && tool.mcpOnly));

/**
 * Restate the catalogue the way an OpenAI-compatible chat API wants it.
 *
 * MCP asks for `{name, description, inputSchema}`, while the chat APIs every
 * provider here speaks want each tool wrapped as
 * `{type: 'function', function: {name, description, parameters}}`. Sending the
 * MCP shape to DeepSeek is rejected with "tools[0]: missing field `type`".
 * @param {Array<object>} definitions the catalogue in MCP form
 * @returns {Array<object>} the same tools in chat-completions form
 */
const toChatTools = definitions => definitions.map(tool => ({
    type: 'function',
    function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema
    }
}));

export {
    TOOL_DEFINITIONS,
    selectToolDefinitions,
    toChatTools
};
