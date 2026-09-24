import React from 'react';
import configureStore from 'redux-mock-store';
import {Provider} from 'react-redux';
import {fireEvent} from '@testing-library/react';
import '@testing-library/jest-dom';

import {renderWithIntl} from '../../helpers/intl-helpers.jsx';
import AiAssistPanel from '../../../src/containers/ai-assist-panel.jsx';
import {setActiveBridge} from '../../../src/lib/ai/bridge-client';
import {BRIDGE_STATUS, PROVIDER_IDS} from '../../../src/lib/ai/constants';
import {aiAssistInitialState} from '../../../src/reducers/ai-assist';
import {flushMicrotasks, installFakeSocket, lastSocket} from '../lib/ai/fake-bridge-socket';

// The container only closes over the vm; nothing in these tests reaches it.
const fakeVm = {};

const ADD_MESSAGE = 'scratch-gui/ai-assist/ADD_MESSAGE';
const SET_ERROR = 'scratch-gui/ai-assist/SET_ERROR';
const UPDATE_MESSAGE = 'scratch-gui/ai-assist/UPDATE_MESSAGE';

const PROVIDER_ERROR =
    'Unknown AI provider "undefined". Known providers: deepseek, openrouter, lmstudio, ollama.';

describe('AiAssistPanel container', () => {
    const buildStore = (aiAssist = {}) => configureStore()({
        locales: {isRtl: false},
        scratchGui: {
            aiAssist: {...aiAssistInitialState, ...aiAssist},
            targets: {sprites: {}}
        }
    });

    const render = store => renderWithIntl(
        <Provider store={store}>
            <AiAssistPanel vm={fakeVm} />
        </Provider>
    );

    const collapsedTab = container => container.querySelector('button[aria-expanded]');

    test('opening the panel asks for it to be visible', () => {
        const store = buildStore({visible: false});
        const {container} = render(store);

        fireEvent.click(collapsedTab(container));

        expect(store.getActions()).toContainEqual({
            type: 'scratch-gui/ai-assist/SET_VISIBLE',
            visible: true
        });
    });

    /*
     * The tab and the close button are wired straight to `onClick`, so the
     * handler is called with a click event rather than the state to move to.
     * Reading that argument as the next visibility made every click open the
     * panel and none of them close it.
     */
    test('closing the panel asks for it to be hidden, not shown again', () => {
        const store = buildStore({visible: true});
        const {container} = render(store);

        fireEvent.click(collapsedTab(container));

        expect(store.getActions()).toContainEqual({
            type: 'scratch-gui/ai-assist/SET_VISIBLE',
            visible: false
        });
    });
});

describe('AiAssistPanel talking to the bridge', () => {
    let restoreWebSocket;

    beforeEach(() => {
        restoreWebSocket = installFakeSocket();
    });

    afterEach(() => {
        restoreWebSocket();
        setActiveBridge(null);
    });

    const buildStore = (aiAssist = {}) => configureStore()({
        locales: {isRtl: false},
        scratchGui: {
            aiAssist: {
                ...aiAssistInitialState,
                visible: true,
                bridgeStatus: BRIDGE_STATUS.CONNECTED,
                config: {
                    ...aiAssistInitialState.config,
                    providerId: PROVIDER_IDS.DEEPSEEK,
                    modelId: 'deepseek-chat',
                    useBridge: true
                },
                ...aiAssist
            },
            targets: {sprites: {}}
        }
    });

    /**
     * Mount the panel with its bridge connected.
     * @param {object} store the mock store to render against
     * @returns {object} the render result
     */
    const renderConnected = store => {
        const result = renderWithIntl(
            <Provider store={store}>
                <AiAssistPanel vm={fakeVm} />
            </Provider>
        );
        lastSocket().open();
        return result;
    };

    /**
     * Type a message and press send.
     * @param {object} rendered the render result
     * @param {string} text what to send
     */
    const send = (rendered, text) => {
        fireEvent.change(rendered.container.querySelector('textarea'), {target: {value: text}});
        fireEvent.click(rendered.getByLabelText('Send'));
    };

    test('names the provider in the field the bridge reads', async () => {
        const store = buildStore();
        const rendered = renderConnected(store);

        send(rendered, 'make a cat');
        await flushMicrotasks();

        const request = lastSocket().sentOfType('chat')[0];
        expect(request).toMatchObject({provider: PROVIDER_IDS.DEEPSEEK, model: 'deepseek-chat'});
        expect(request).not.toHaveProperty('providerId');
    });

    test('a failed turn leaves no empty assistant bubble behind', async () => {
        const store = buildStore();
        const rendered = renderConnected(store);

        send(rendered, 'make a cat');
        await flushMicrotasks();

        const {id} = lastSocket().sentOfType('chat')[0];
        lastSocket().receive({type: 'chat-done', id, ok: false, error: PROVIDER_ERROR});
        await flushMicrotasks();

        const added = store.getActions().filter(action => action.type === ADD_MESSAGE);
        expect(added.map(action => action.message.role)).toEqual(['user']);
        expect(store.getActions()).toContainEqual({type: SET_ERROR, error: PROVIDER_ERROR});
    });

    test('adds the assistant bubble carrying the first fragment the model streams', async () => {
        const store = buildStore();
        const rendered = renderConnected(store);

        send(rendered, 'say hi');
        await flushMicrotasks();

        const {id} = lastSocket().sentOfType('chat')[0];
        lastSocket().receive({type: 'chat-delta', id, delta: {reasoning: 'they said hi'}});
        lastSocket().receive({type: 'chat-delta', id, delta: {content: 'Hi!'}});
        lastSocket().receive({
            type: 'chat-done',
            id,
            ok: true,
            result: {content: 'Hi!', reasoning: 'they said hi', toolCalls: [], finishReason: 'stop'}
        });
        await flushMicrotasks();

        const assistant = store.getActions()
            .filter(action => action.type === ADD_MESSAGE)
            .map(action => action.message)
            .filter(message => message.role === 'assistant');

        expect(assistant).toHaveLength(1);
        expect(assistant[0]).toMatchObject({content: '', reasoning: 'they said hi'});
    });

    test('tells the bridge to stop a turn the user abandons', async () => {
        const store = buildStore();
        const rendered = renderConnected(store);

        send(rendered, 'write a long story');
        await flushMicrotasks();
        const {id} = lastSocket().sentOfType('chat')[0];

        // Starting a new chat aborts the turn in flight, the same way the stop
        // button does.
        fireEvent.click(rendered.getByText('New chat'));
        await flushMicrotasks();

        expect(lastSocket().sentOfType('chat-cancel')).toEqual([{type: 'chat-cancel', id}]);
    });
});

describe('AiAssistPanel streaming a long reply', () => {
    let restoreWebSocket;

    beforeEach(() => {
        restoreWebSocket = installFakeSocket();
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
        restoreWebSocket();
        setActiveBridge(null);
    });

    const buildStore = () => configureStore()({
        locales: {isRtl: false},
        scratchGui: {
            aiAssist: {
                ...aiAssistInitialState,
                visible: true,
                bridgeStatus: BRIDGE_STATUS.CONNECTED,
                config: {
                    ...aiAssistInitialState.config,
                    providerId: PROVIDER_IDS.DEEPSEEK,
                    modelId: 'deepseek-reasoner',
                    useBridge: true
                }
            },
            targets: {sprites: {}}
        }
    });

    /*
     * A reasoning model emits thousands of fragments. Dispatching each one
     * re-rendered the whole transcript against a longer and longer string, and
     * the main thread became too busy to answer the bridge's heartbeat, so the
     * bridge closed a healthy connection.
     */
    test('coalesces many fragments into few store updates', async () => {
        const store = buildStore();
        const rendered = renderWithIntl(
            <Provider store={store}>
                <AiAssistPanel vm={fakeVm} />
            </Provider>
        );
        lastSocket().open();

        fireEvent.change(rendered.container.querySelector('textarea'), {target: {value: 'think hard'}});
        fireEvent.click(rendered.getByLabelText('Send'));
        await flushMicrotasks();

        const {id} = lastSocket().sentOfType('chat')[0];
        for (let i = 0; i < 500; i++) {
            lastSocket().receive({type: 'chat-delta', id, delta: {reasoning: `token ${i} `}});
        }
        await flushMicrotasks();

        const updates = store.getActions().filter(action => action.type === UPDATE_MESSAGE);
        expect(updates.length).toBeLessThan(20);
    });

    test('shows everything once the reply finishes', async () => {
        const store = buildStore();
        const rendered = renderWithIntl(
            <Provider store={store}>
                <AiAssistPanel vm={fakeVm} />
            </Provider>
        );
        lastSocket().open();

        fireEvent.change(rendered.container.querySelector('textarea'), {target: {value: 'hi'}});
        fireEvent.click(rendered.getByLabelText('Send'));
        await flushMicrotasks();

        const {id} = lastSocket().sentOfType('chat')[0];
        lastSocket().receive({type: 'chat-delta', id, delta: {content: 'Hel'}});
        lastSocket().receive({type: 'chat-delta', id, delta: {content: 'lo!'}});
        lastSocket().receive({type: 'chat-done', id, ok: true, result: {content: 'Hello!', toolCalls: []}});
        await flushMicrotasks();

        const updates = store.getActions().filter(action => action.type === UPDATE_MESSAGE);
        expect(updates[updates.length - 1].patch.content).toBe('Hello!');
    });
});
