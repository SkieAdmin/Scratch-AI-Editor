import EventEmitter from 'events';

import {createRuntimeObserver} from '../../../../../src/lib/ai/scratch-tools/runtime-observer';

const sprite = name => ({getName: () => name});

describe('createRuntimeObserver', () => {
    test('a visible sprite asks through its speech bubble, so the question is the bubble', () => {
        const runtime = new EventEmitter();
        const observer = createRuntimeObserver(runtime);

        // The order the sensing blocks emit them in.
        runtime.emit('SAY', sprite('Maria'), 'say', 'What is your name?');
        runtime.emit('QUESTION', '');

        expect(observer.pendingQuestion).toEqual({text: 'What is your name?', askedBy: 'Maria'});
    });

    test('the stage or a hidden sprite asks in the answer box itself', () => {
        const runtime = new EventEmitter();
        const observer = createRuntimeObserver(runtime);

        runtime.emit('QUESTION', 'How old are you?');

        expect(observer.pendingQuestion).toEqual({text: 'How old are you?', askedBy: null});
    });

    test('an answer clears the question', () => {
        const runtime = new EventEmitter();
        const observer = createRuntimeObserver(runtime);
        runtime.emit('QUESTION', 'How old are you?');

        runtime.emit('ANSWER', '9');

        expect(observer.pendingQuestion).toBeNull();
    });

    /*
     * The sensing blocks listen for ANSWER from the moment the runtime exists,
     * and ask the next queued question inside that same event. A listener added
     * after theirs would clear that new question as if it were the answered one.
     */
    test('a question asked in answer to the last one is kept', () => {
        const runtime = new EventEmitter();
        runtime.on('ANSWER', () => runtime.emit('QUESTION', 'And your name?'));
        const observer = createRuntimeObserver(runtime);
        runtime.emit('QUESTION', 'How old are you?');

        runtime.emit('ANSWER', '9');

        expect(observer.pendingQuestion).toEqual({text: 'And your name?', askedBy: null});
    });

    test('stopping the project clears the question', () => {
        const runtime = new EventEmitter();
        const observer = createRuntimeObserver(runtime);
        runtime.emit('QUESTION', 'How old are you?');

        runtime.emit('QUESTION', null);

        expect(observer.pendingQuestion).toBeNull();
    });

    test('stops listening when disposed', () => {
        const runtime = new EventEmitter();
        const observer = createRuntimeObserver(runtime);

        observer.dispose();

        expect(runtime.listenerCount('SAY')).toBe(0);
        expect(runtime.listenerCount('QUESTION')).toBe(0);
        expect(runtime.listenerCount('ANSWER')).toBe(0);
    });
});
