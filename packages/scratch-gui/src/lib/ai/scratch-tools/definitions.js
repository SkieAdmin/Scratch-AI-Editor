/**
 * The catalogue of operations an AI assistant may perform against the live VM.
 *
 * `inputSchema` is JSON Schema so that the same entry can be handed to an MCP
 * server's `registerTool` and to an OpenAI-style `tools` array without
 * translation. Descriptions are written for the model, not for a person: they
 * say when to reach for the tool and what a valid argument looks like.
 */

const targetProperty = {
    type: 'string',
    description: 'Sprite name, target id, or "stage". Defaults to the sprite currently being edited.'
};

const blockSpecDescription =
    'A block is {"opcode": "motion_movesteps", "inputs": {...}, "fields": {...}}. An input value is ' +
    'a number or string literal, an array of block specs for a C-block branch, a nested block spec ' +
    '{"opcode": ...} to drop a reporter into the slot, or {"shadow": "<opcode>", "value": <literal>} ' +
    'to choose the slot type explicitly. A field value is a plain string; VARIABLE, LIST and ' +
    'BROADCAST_OPTION fields are resolved by name against the target. Call get_block_catalog for the ' +
    'input and field names of an opcode.';

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
        description: 'Move, turn, resize, or show and hide a sprite. Only the properties you pass ' +
            'are changed.',
        inputSchema: {
            type: 'object',
            properties: {
                targetId: targetProperty,
                x: {type: 'number', description: 'Stage x position, roughly -240 to 240.'},
                y: {type: 'number', description: 'Stage y position, roughly -180 to 180.'},
                direction: {type: 'number', description: 'Heading in degrees; 90 points right.'},
                size: {type: 'number', description: 'Size as a percentage; 100 is full size.'},
                visible: {type: 'boolean', description: 'Whether the sprite is shown on the stage.'}
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
    }
];

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
    toChatTools
};
