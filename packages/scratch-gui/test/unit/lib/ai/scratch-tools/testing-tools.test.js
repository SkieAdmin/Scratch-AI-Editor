import {createToolRunner} from '../../../../../src/lib/ai/scratch-tools/runner';
import {SNAPSHOT_DATA, makeVm} from './fake-vm';

jest.mock('../../../../../src/lib/make-toolbox-xml', () => ({
    __esModule: true,
    default: () => '<xml></xml>'
}));
jest.mock('../../../../../src/lib/ai/scratch-tools/block-definitions', () => ({
    isScratchBlocksType: () => false
}));

const BUBBLE_STATE_KEY = 'Scratch.looks';

describe('get_runtime_state', () => {
    test('reports the backdrop, every sprite and every variable', async () => {
        const {vm, sprite} = makeVm();
        sprite.currentCostume = 1;
        sprite.customState[BUBBLE_STATE_KEY] = {type: 'say', text: 'Hi'};
        const {runTool} = createToolRunner(vm);

        const state = await runTool('get_runtime_state', {});

        expect(state).toEqual({
            isRunning: false,
            backdrop: {name: 'backdrop1', index: 0},
            question: null,
            variables: [{name: 'score', kind: 'variable', value: 7}],
            sprites: [{
                id: 'sprite-id',
                name: 'Cat',
                x: 12,
                y: -30,
                direction: 90,
                size: 100,
                visible: true,
                costume: {name: 'costume2', index: 1},
                layer: 3,
                bubble: {type: 'say', text: 'Hi'},
                variables: []
            }]
        });
    });

    test('counts a waiting script as running, but not a monitor updating itself', async () => {
        const {vm} = makeVm();
        const {runTool} = createToolRunner(vm);

        vm.runtime.threads = [{updateMonitor: true}];
        expect((await runTool('get_runtime_state', {})).isRunning).toBe(false);

        vm.runtime.threads = [{updateMonitor: true}, {updateMonitor: false}];
        expect((await runTool('get_runtime_state', {})).isRunning).toBe(true);
    });

    test('shows no bubble once its text is cleared, or while the sprite is hidden', async () => {
        const {vm, sprite} = makeVm();
        const {runTool} = createToolRunner(vm);

        sprite.customState[BUBBLE_STATE_KEY] = {type: 'think', text: ''};
        expect((await runTool('get_runtime_state', {})).sprites[0].bubble).toBeNull();

        sprite.customState[BUBBLE_STATE_KEY] = {type: 'think', text: 'Hmm'};
        sprite.visible = false;
        expect((await runTool('get_runtime_state', {})).sprites[0].bubble).toBeNull();
    });

    test('reports the question an "ask and wait" block is waiting on', async () => {
        const {vm, sprite} = makeVm();
        const {runTool} = createToolRunner(vm);

        vm.runtime.emit('SAY', sprite, 'say', 'What is your name?');
        vm.runtime.emit('QUESTION', '');

        expect((await runTool('get_runtime_state', {})).question).toEqual({
            text: 'What is your name?',
            askedBy: 'Cat'
        });
    });

    test('leaves broadcast messages out of the variables', async () => {
        const {vm, stage} = makeVm();
        stage.variables.go = {id: 'go', name: 'go', type: 'broadcast_msg', value: 'go'};
        const {runTool} = createToolRunner(vm);

        const state = await runTool('get_runtime_state', {});

        expect(state.variables.map(variable => variable.name)).toEqual(['score']);
    });
});

describe('wait', () => {
    test('lets the project run, then reports its state', async () => {
        const {vm} = makeVm();
        const {runTool} = createToolRunner(vm);

        const state = await runTool('wait', {ms: 10});

        expect(state.waitedMs).toBe(10);
        expect(state.backdrop).toEqual({name: 'backdrop1', index: 0});
    });

    test('refuses to wait longer than 15 seconds, or for a fraction of a millisecond', async () => {
        const {vm} = makeVm();
        const {runTool} = createToolRunner(vm);

        await expect(runTool('wait', {ms: 15001})).rejects.toThrow(/from 0 to 15000/);
        await expect(runTool('wait', {ms: 1.5})).rejects.toThrow(/whole number/);
        await expect(runTool('wait', {})).rejects.toThrow(/"ms"/);
    });
});

describe('capture_stage', () => {
    test('returns the stage as a PNG image block, drawing it first', async () => {
        const {vm} = makeVm();
        const {runTool} = createToolRunner(vm);

        const result = await runTool('capture_stage', {});

        expect(vm.renderer.draw).toHaveBeenCalled();
        expect(result.content[0]).toEqual({type: 'image', mimeType: 'image/png', data: SNAPSHOT_DATA});
        expect(JSON.parse(result.content[1].text)).toMatchObject({width: 480, height: 360});
    });

    test('gives up when the stage never draws', async () => {
        jest.useFakeTimers();
        try {
            const {vm} = makeVm();
            vm.renderer.draw = jest.fn();
            const {runTool} = createToolRunner(vm);

            const capture = runTool('capture_stage', {});
            const failure = expect(capture).rejects.toThrow(/did not draw/);
            await jest.advanceTimersByTimeAsync(5000);

            await failure;
        } finally {
            jest.useRealTimers();
        }
    });
});

describe('capture_editor', () => {
    test('asks the desktop shell for a picture of the window', async () => {
        const {vm} = makeVm();
        const desktop = {
            captureWindow: jest.fn(() => Promise.resolve({
                data: 'aGVsbG8=',
                mimeType: 'image/png',
                width: 1280,
                height: 860
            }))
        };
        const {runTool} = createToolRunner(vm, {desktop});

        const result = await runTool('capture_editor', {});

        expect(result.content[0]).toEqual({type: 'image', mimeType: 'image/png', data: 'aGVsbG8='});
        expect(JSON.parse(result.content[1].text)).toMatchObject({width: 1280, height: 860});
    });

    test('says it needs the desktop app when it runs in a browser', async () => {
        const {vm} = makeVm();
        const {runTool} = createToolRunner(vm);

        await expect(runTool('capture_editor', {})).rejects.toThrow(/desktop app.*capture_stage/s);
    });
});

describe('click_sprite', () => {
    test('starts the sprite\'s "when this sprite clicked" scripts', async () => {
        const {vm, sprite} = makeVm();
        vm.runtime.hatThreads.event_whenthisspriteclicked = [{}];
        const {runTool} = createToolRunner(vm);

        const result = await runTool('click_sprite', {targetId: 'Cat'});

        expect(vm.runtime.startHats).toHaveBeenCalledWith('event_whenthisspriteclicked', null, sprite);
        expect(result).toEqual({targetId: 'sprite-id', name: 'Cat', scriptsStarted: 1});
    });

    test('clicks the stage, starting its "when stage clicked" scripts', async () => {
        const {vm, stage} = makeVm();
        vm.runtime.hatThreads.event_whenstageclicked = [{}, {}];
        const {runTool} = createToolRunner(vm);

        const result = await runTool('click_sprite', {targetId: 'stage'});

        expect(vm.runtime.startHats).toHaveBeenCalledWith('event_whenstageclicked', null, stage);
        expect(result.scriptsStarted).toBe(2);
    });
});

describe('press_key', () => {
    test('presses and releases the key through the keyboard, as the editor does', async () => {
        const {vm} = makeVm();
        const {runTool} = createToolRunner(vm);

        const result = await runTool('press_key', {key: 'space', holdMs: 0});

        expect(vm.postIOData.mock.calls).toEqual([
            ['keyboard', {key: ' ', isDown: true}],
            ['keyboard', {key: ' ', isDown: false}]
        ]);
        expect(result).toEqual({key: 'space', heldMs: 0});
    });

    test.each([
        ['left arrow', 'ArrowLeft'],
        ['Up Arrow', 'ArrowUp'],
        ['enter', 'Enter'],
        ['ArrowDown', 'ArrowDown'],
        ['a', 'a'],
        ['7', '7']
    ])('sends "%s" as the browser key "%s"', async (key, browserKey) => {
        const {vm} = makeVm();
        const {runTool} = createToolRunner(vm);

        await runTool('press_key', {key, holdMs: 0});

        expect(vm.postIOData).toHaveBeenCalledWith('keyboard', {key: browserKey, isDown: true});
    });

    test('holds the key down for as long as asked', async () => {
        jest.useFakeTimers();
        try {
            const {vm} = makeVm();
            const {runTool} = createToolRunner(vm);

            const pressing = runTool('press_key', {key: 'a', holdMs: 1000});
            await jest.advanceTimersByTimeAsync(999);
            expect(vm.postIOData).toHaveBeenCalledTimes(1);

            await jest.advanceTimersByTimeAsync(1);
            await pressing;
            expect(vm.postIOData).toHaveBeenLastCalledWith('keyboard', {key: 'a', isDown: false});
        } finally {
            jest.useRealTimers();
        }
    });

    test('refuses a key Scratch cannot see', async () => {
        const {vm} = makeVm();
        const {runTool} = createToolRunner(vm);

        await expect(runTool('press_key', {key: 'shift'})).rejects.toThrow(/not a key Scratch can see/);
        await expect(runTool('press_key', {key: ''})).rejects.toThrow(/"key"/);
        expect(vm.postIOData).not.toHaveBeenCalled();
    });
});

describe('answer_question', () => {
    test('answers as the stage does and hides the answer box', async () => {
        const {vm, sprite} = makeVm();
        const {runTool} = createToolRunner(vm);
        vm.runtime.emit('SAY', sprite, 'say', 'What is your name?');
        vm.runtime.emit('QUESTION', '');
        const answers = [];
        const questions = [];
        vm.runtime.on('ANSWER', answer => answers.push(answer));
        vm.runtime.on('QUESTION', question => questions.push(question));

        const result = await runTool('answer_question', {text: 'Maria'});

        expect(answers).toEqual(['Maria']);
        expect(questions).toEqual([null]);
        expect(result).toEqual({question: 'What is your name?', answer: 'Maria', nextQuestion: null});
        expect((await runTool('get_runtime_state', {})).question).toBeNull();
    });

    test('leaves the answer box up when another question is waiting behind this one', async () => {
        const {vm} = makeVm();
        // The sensing blocks listen first and ask the next queued question as soon as one is answered.
        vm.runtime.on('ANSWER', () => vm.runtime.emit('QUESTION', 'And your age?'));
        const {runTool} = createToolRunner(vm);
        vm.runtime.emit('QUESTION', 'What is your name?');
        const questions = [];
        vm.runtime.on('QUESTION', question => questions.push(question));

        const result = await runTool('answer_question', {text: 'Maria'});

        expect(questions).toEqual(['And your age?']);
        expect(result.nextQuestion).toEqual({text: 'And your age?', askedBy: null});
    });

    test('says so when no question is waiting', async () => {
        const {vm} = makeVm();
        const {runTool} = createToolRunner(vm);

        await expect(runTool('answer_question', {text: 'Maria'})).rejects.toThrow(/No "ask and wait" question/);
    });
});

describe('set_backdrop', () => {
    const withScenes = () => {
        const made = makeVm();
        made.stage.getCostumes().push({name: 'Jungle', dataFormat: 'png'}, {name: 'Woods', dataFormat: 'png'});
        return made;
    };

    test('switches by name and starts "when backdrop switches to" scripts', async () => {
        const {vm, stage} = withScenes();
        vm.runtime.hatThreads.event_whenbackdropswitchesto = [{}];
        const {runTool} = createToolRunner(vm);

        const result = await runTool('set_backdrop', {name: 'Woods'});

        expect(stage.setCostume).toHaveBeenCalledWith(2);
        expect(vm.runtime.startHats).toHaveBeenCalledWith('event_whenbackdropswitchesto', {BACKDROP: 'Woods'});
        expect(vm.emitTargetsUpdate).toHaveBeenCalled();
        expect(result).toEqual({backdrop: {name: 'Woods', index: 2}, scriptsStarted: 1});
    });

    test('switches by position without starting scripts when told not to', async () => {
        const {vm, stage} = withScenes();
        const {runTool} = createToolRunner(vm);

        const result = await runTool('set_backdrop', {index: 1, runHats: false});

        expect(stage.setCostume).toHaveBeenCalledWith(1);
        expect(vm.runtime.startHats).not.toHaveBeenCalled();
        expect(result).toEqual({backdrop: {name: 'Jungle', index: 1}, scriptsStarted: 0});
    });

    test('names the backdrops there are when asked for one that is not there', async () => {
        const {vm} = withScenes();
        const {runTool} = createToolRunner(vm);

        await expect(runTool('set_backdrop', {name: 'Beach'}))
            .rejects.toThrow(/no backdrop named "Beach"\. Its backdrops are: backdrop1, Jungle, Woods/);
    });

    test('wants a name or a position, not both', async () => {
        const {vm} = withScenes();
        const {runTool} = createToolRunner(vm);

        await expect(runTool('set_backdrop', {name: 'Woods', index: 2})).rejects.toThrow(/not both/);
        await expect(runTool('set_backdrop', {})).rejects.toThrow(/"name" or by "index"/);
        await expect(runTool('set_backdrop', {index: 3})).rejects.toThrow(/from 0 to 2/);
    });
});

describe('switching costumes', () => {
    test('set_costume switches a sprite by name', async () => {
        const {vm, sprite} = makeVm();
        const {runTool} = createToolRunner(vm);

        const result = await runTool('set_costume', {targetId: 'Cat', name: 'costume2'});

        expect(sprite.setCostume).toHaveBeenCalledWith(1);
        expect(result).toEqual({targetId: 'sprite-id', costume: {name: 'costume2', index: 1}});
    });

    test('set_sprite_properties takes a costume by name or by position', async () => {
        const {vm, sprite} = makeVm();
        const {runTool} = createToolRunner(vm);

        expect((await runTool('set_sprite_properties', {targetId: 'Cat', costume: 'costume2'})).costume)
            .toBe('costume2');
        expect((await runTool('set_sprite_properties', {targetId: 'Cat', costume: 0, x: 5})).costume)
            .toBe('costume1');
        expect(sprite.setCostume.mock.calls).toEqual([[1], [0]]);
    });

    test('set_sprite_properties still wants something to change', async () => {
        const {vm} = makeVm();
        const {runTool} = createToolRunner(vm);

        await expect(runTool('set_sprite_properties', {targetId: 'Cat'})).rejects.toThrow(/visible or costume/);
    });
});
