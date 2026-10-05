/**
 * Follows the "ask and wait" question a running project is waiting on.
 *
 * The sensing blocks keep their question queue to themselves and only report
 * it through runtime events, the same ones the stage listens to when it shows
 * its answer box, so the question has to be tracked from those events as they
 * happen.
 * @param {object} runtime the VM runtime
 * @returns {{pendingQuestion: ?object, dispose: Function}} the current
 *   question, as `{text, askedBy}` or null, and a way to stop listening
 */
const createRuntimeObserver = runtime => {
    let lastSay = null;
    let pendingQuestion = null;

    const handleSay = (target, type, text) => {
        lastSay = {target, text: String(text)};
    };

    const handleQuestion = question => {
        if (question === null) {
            pendingQuestion = null;
            return;
        }
        // A visible sprite asks through its speech bubble: the question arrives
        // empty, straight after the bubble it is written in.
        if (question === '' && lastSay) {
            pendingQuestion = {text: lastSay.text, askedBy: lastSay.target.getName()};
            return;
        }
        pendingQuestion = {text: String(question), askedBy: null};
    };

    const handleAnswer = () => {
        pendingQuestion = null;
    };

    runtime.on('SAY', handleSay);
    runtime.on('QUESTION', handleQuestion);
    // Answering makes the sensing blocks ask the next queued question at once,
    // inside the same event, so the answered one has to be cleared before they
    // run rather than after.
    runtime.prependListener('ANSWER', handleAnswer);

    return {
        get pendingQuestion () {
            return pendingQuestion;
        },
        dispose () {
            runtime.removeListener('SAY', handleSay);
            runtime.removeListener('QUESTION', handleQuestion);
            runtime.removeListener('ANSWER', handleAnswer);
        }
    };
};

export {createRuntimeObserver};
