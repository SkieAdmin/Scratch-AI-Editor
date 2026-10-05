import {findAssetIndex} from './find-asset';
import {summarizeVariables} from './serialize';
import {imageResult, parseDataUrl} from './tool-results';

/** The longest one `wait` may last, which keeps it well inside the bridge's 30 second tool timeout. */
const MAX_WAIT_MS = 15000;

/** How long a key is held unless told otherwise: a few frames at Scratch's 30 frames a second. */
const DEFAULT_KEY_HOLD_MS = 100;
const MAX_KEY_HOLD_MS = 5000;

/** How long the renderer gets to draw a snapshot before capture_stage gives up. */
const SNAPSHOT_TIMEOUT_MS = 5000;

/** Where the looks blocks keep a target's speech or thought bubble. */
const BUBBLE_STATE_KEY = 'Scratch.looks';

/**
 * The key names Scratch's own blocks use, mapped to the browser key name the
 * editor posts to the VM when that key is pressed.
 */
const SCRATCH_KEYS = {
    'space': ' ',
    'left arrow': 'ArrowLeft',
    'up arrow': 'ArrowUp',
    'right arrow': 'ArrowRight',
    'down arrow': 'ArrowDown',
    'enter': 'Enter'
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Turn a key as the model names it into the browser key name the VM expects.
 * @param {*} key the key: a Scratch key name such as "space", or a single character
 * @returns {string} the browser key name
 */
const toBrowserKey = key => {
    if (typeof key !== 'string' || key === '') {
        throw new Error(`"key" must be a key name or a single character, got ${JSON.stringify(key)}.`);
    }
    const named = SCRATCH_KEYS[key.toLowerCase()];
    if (named) return named;
    if (Object.values(SCRATCH_KEYS).includes(key)) return key;
    // Spread counts characters rather than UTF-16 units, so "é" and "手" are one key each.
    if ([...key].length === 1) return key;

    throw new Error(
        `"${key}" is not a key Scratch can see. Use a single character such as "a" or "1", or one of: ` +
        `${Object.keys(SCRATCH_KEYS).join(', ')}.`
    );
};

/**
 * Check a whole number of milliseconds against a limit.
 * @param {string} name the argument, for messages
 * @param {*} value what was passed
 * @param {number} max the largest value allowed
 */
const assertDuration = (name, value, max) => {
    if (!Number.isInteger(value) || value < 0 || value > max) {
        throw new Error(
            `"${name}" must be a whole number of milliseconds from 0 to ${max}, got ${JSON.stringify(value)}.`
        );
    }
};

/**
 * Build the tools that run a project and look at what it does, so an assistant
 * can test what it built.
 * @param {object} context what the tool layer shares between its tools
 * @param {object} context.vm the VirtualMachine
 * @param {Function} context.resolveTarget finds a target from a `targetId` argument
 * @param {Function} context.stageTarget returns the stage
 * @param {object} context.observer follows the question the project is waiting on
 * @param {?object} context.desktop the desktop shell's services, or null in a browser
 * @returns {object} the tool handlers, by tool name
 */
const createTestingHandlers = ({vm, resolveTarget, stageTarget, observer, desktop}) => {
    const currentCostume = target => ({
        name: target.getCostumes()[target.currentCostume].name,
        index: target.currentCostume
    });

    const bubbleOf = target => {
        const bubble = target.getCustomState(BUBBLE_STATE_KEY);
        // The looks blocks keep the text of a hidden sprite's bubble, but nothing is shown.
        if (!bubble || bubble.text === '' || !target.visible) return null;
        return {type: bubble.type, text: bubble.text};
    };

    const variablesOf = target => summarizeVariables(target)
        .filter(variable => variable.kind !== 'broadcast')
        .map(({name, kind, value}) => ({name, kind, value}));

    const runtimeState = () => {
        const stage = stageTarget();
        return {
            // The same test the editor uses to light up the green flag.
            isRunning: vm.runtime.threads.some(thread => !thread.updateMonitor),
            backdrop: currentCostume(stage),
            question: observer.pendingQuestion,
            variables: variablesOf(stage),
            sprites: vm.runtime.targets
                .filter(target => target.isOriginal && !target.isStage)
                .map(target => ({
                    id: target.id,
                    name: target.getName(),
                    x: target.x,
                    y: target.y,
                    direction: target.direction,
                    size: target.size,
                    visible: target.visible,
                    costume: currentCostume(target),
                    layer: target.getLayerOrder(),
                    bubble: bubbleOf(target),
                    variables: variablesOf(target)
                }))
        };
    };

    const snapshotStage = () => new Promise((resolve, reject) => {
        const renderer = vm.renderer;
        const timer = setTimeout(() => {
            const seconds = SNAPSHOT_TIMEOUT_MS / 1000;
            reject(new Error(`The stage did not draw within ${seconds} seconds, so no picture was taken.`));
        }, SNAPSHOT_TIMEOUT_MS);
        renderer.requestSnapshot(dataUrl => {
            clearTimeout(timer);
            resolve(dataUrl);
        });
        // Draw now rather than at the next frame, so the picture is of the stage
        // as it is when the tool runs.
        renderer.draw();
    });

    const switchCostume = (target, args, kind) => {
        const index = findAssetIndex(target.getCostumes(), args, kind, target.getName());
        target.setCostume(index);
        vm.emitTargetsUpdate();
        return currentCostume(target);
    };

    return {
        get_runtime_state: () => runtimeState(),

        wait: async args => {
            assertDuration('ms', args.ms, MAX_WAIT_MS);
            await sleep(args.ms);
            return {waitedMs: args.ms, ...runtimeState()};
        },

        capture_stage: async () => {
            const image = parseDataUrl(await snapshotStage());
            const canvas = vm.renderer.canvas;
            return imageResult(image, {
                picture: 'the stage, as it looks now',
                width: canvas.width,
                height: canvas.height
            });
        },

        capture_editor: async () => {
            if (!desktop) {
                throw new Error('capture_editor only works in the Skie AI Editor desktop app. Use capture_stage ' +
                    'to see the stage.');
            }
            const capture = await desktop.captureWindow();
            return imageResult(capture, {
                picture: 'the whole editor window',
                width: capture.width,
                height: capture.height
            });
        },

        click_sprite: args => {
            const target = resolveTarget(args.targetId);
            // Both hats, as a real click does: the sprite and stage versions of
            // the block are the same event under two labels.
            const started = [
                ...(vm.runtime.startHats('event_whenthisspriteclicked', null, target) || []),
                ...(vm.runtime.startHats('event_whenstageclicked', null, target) || [])
            ];
            return {targetId: target.id, name: target.getName(), scriptsStarted: started.length};
        },

        press_key: async args => {
            const key = toBrowserKey(args.key);
            const holdMs = typeof args.holdMs === 'undefined' ? DEFAULT_KEY_HOLD_MS : args.holdMs;
            assertDuration('holdMs', holdMs, MAX_KEY_HOLD_MS);

            vm.postIOData('keyboard', {key, isDown: true});
            try {
                await sleep(holdMs);
            } finally {
                vm.postIOData('keyboard', {key, isDown: false});
            }
            return {key: args.key, heldMs: holdMs};
        },

        answer_question: args => {
            if (typeof args.text !== 'string' && typeof args.text !== 'number') {
                throw new Error(`"text" must be the answer to type, got ${JSON.stringify(args.text)}.`);
            }
            const question = observer.pendingQuestion;
            if (!question) {
                throw new Error('No "ask and wait" question is waiting for an answer. Run the script that asks, ' +
                    'then check get_runtime_state for the question before answering it.');
            }

            let askedAgain = false;
            const noticeQuestion = () => {
                askedAgain = true;
            };
            vm.runtime.on('QUESTION', noticeQuestion);
            try {
                // The event the stage sends when the child presses enter in the answer box.
                vm.runtime.emit('ANSWER', String(args.text));
            } finally {
                vm.runtime.removeListener('QUESTION', noticeQuestion);
            }
            // The stage hides its answer box itself when the child answers; an
            // answer from here has to tell it to, unless another question
            // replaced the one answered.
            if (!askedAgain) vm.runtime.emit('QUESTION', null);

            return {question: question.text, answer: String(args.text), nextQuestion: observer.pendingQuestion};
        },

        set_backdrop: args => {
            if (typeof args.runHats !== 'undefined' && typeof args.runHats !== 'boolean') {
                throw new Error(`"runHats" must be true or false, got ${JSON.stringify(args.runHats)}.`);
            }
            const stage = stageTarget();
            const backdrop = switchCostume(stage, args, 'backdrop');
            // The same event the "switch backdrop to" block starts.
            const started = args.runHats === false ? [] :
                (vm.runtime.startHats('event_whenbackdropswitchesto', {BACKDROP: backdrop.name}) || []);
            return {backdrop, scriptsStarted: started.length};
        },

        set_costume: args => {
            const target = resolveTarget(args.targetId);
            return {targetId: target.id, costume: switchCostume(target, args, 'costume')};
        }
    };
};

export {createTestingHandlers};
