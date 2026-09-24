import aiAssistReducer, {
    addAiMessage,
    clearAiChat,
    endAiStream,
    setAiBridgeStatus,
    setAiConfig,
    setAiError,
    setAiModels,
    setAiPanelVisible,
    startAiStream,
    updateAiMessage
} from '../../../src/reducers/ai-assist';
import {BRIDGE_STATUS} from '../../../src/lib/ai/constants';

/* eslint-disable-next-line no-undefined */
const initial = () => aiAssistReducer(undefined, {type: 'anything'});

const message = overrides => ({
    id: 'm1',
    role: 'assistant',
    content: '',
    createdAt: 0,
    ...overrides
});

describe('aiAssistReducer', () => {
    test('returns a usable initial state', () => {
        const state = initial();
        expect(state.visible).toBe(false);
        expect(state.messages).toEqual([]);
        expect(state.streaming).toBe(false);
        expect(state.bridgeStatus).toBe(BRIDGE_STATUS.DISABLED);
        expect(state.config.providerId).toEqual(expect.any(String));
    });

    test('shows and hides the panel', () => {
        const shown = aiAssistReducer(initial(), setAiPanelVisible(true));
        expect(shown.visible).toBe(true);
        expect(aiAssistReducer(shown, setAiPanelVisible(false)).visible).toBe(false);
    });

    test('merges config changes rather than replacing the config', () => {
        const state = aiAssistReducer(initial(), setAiConfig({modelId: 'deepseek-reasoner'}));
        expect(state.config.modelId).toBe('deepseek-reasoner');
        expect(state.config.baseUrls).toEqual(initial().config.baseUrls);
    });

    test('appends messages in order', () => {
        let state = aiAssistReducer(initial(), addAiMessage(message({id: 'a', role: 'user'})));
        state = aiAssistReducer(state, addAiMessage(message({id: 'b'})));
        expect(state.messages.map(m => m.id)).toEqual(['a', 'b']);
    });

    test('patches a single message by id and leaves the others alone', () => {
        let state = aiAssistReducer(initial(), addAiMessage(message({id: 'a', content: 'keep'})));
        state = aiAssistReducer(state, addAiMessage(message({id: 'b', content: 'x'})));
        state = aiAssistReducer(state, updateAiMessage('b', {content: 'xy'}));

        expect(state.messages.find(m => m.id === 'a').content).toBe('keep');
        expect(state.messages.find(m => m.id === 'b').content).toBe('xy');
    });

    test('ignores a patch for an unknown message id', () => {
        const state = aiAssistReducer(initial(), addAiMessage(message({id: 'a'})));
        const patched = aiAssistReducer(state, updateAiMessage('missing', {content: 'nope'}));
        expect(patched.messages).toEqual(state.messages);
    });

    test('tracks the streaming message and clears any previous error', () => {
        const errored = aiAssistReducer(initial(), setAiError('boom'));
        const streaming = aiAssistReducer(errored, startAiStream('m1'));

        expect(streaming.streaming).toBe(true);
        expect(streaming.streamingMessageId).toBe('m1');
        expect(streaming.error).toBeNull();

        const done = aiAssistReducer(streaming, endAiStream());
        expect(done.streaming).toBe(false);
        expect(done.streamingMessageId).toBeNull();
    });

    test('clearing the chat drops messages and stream state but keeps the config', () => {
        let state = aiAssistReducer(initial(), setAiConfig({modelId: 'llama3'}));
        state = aiAssistReducer(state, addAiMessage(message({id: 'a'})));
        state = aiAssistReducer(state, startAiStream('a'));
        state = aiAssistReducer(state, clearAiChat());

        expect(state.messages).toEqual([]);
        expect(state.streaming).toBe(false);
        expect(state.config.modelId).toBe('llama3');
    });

    test('records the bridge status', () => {
        const state = aiAssistReducer(initial(), setAiBridgeStatus(BRIDGE_STATUS.CONNECTED));
        expect(state.bridgeStatus).toBe(BRIDGE_STATUS.CONNECTED);
    });

    test('stores the model list and its loading flag', () => {
        const loading = aiAssistReducer(initial(), setAiModels([], true));
        expect(loading.modelsLoading).toBe(true);

        const loaded = aiAssistReducer(loading, setAiModels([{id: 'llama3'}], false));
        expect(loaded.models).toEqual([{id: 'llama3'}]);
        expect(loaded.modelsLoading).toBe(false);
    });
});
