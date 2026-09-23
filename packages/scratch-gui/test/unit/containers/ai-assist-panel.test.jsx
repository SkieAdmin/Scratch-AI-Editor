import React from 'react';
import configureStore from 'redux-mock-store';
import {Provider} from 'react-redux';
import {fireEvent} from '@testing-library/react';
import '@testing-library/jest-dom';

import {renderWithIntl} from '../../helpers/intl-helpers.jsx';
import AiAssistPanel from '../../../src/containers/ai-assist-panel.jsx';
import {aiAssistInitialState} from '../../../src/reducers/ai-assist';

// The container only closes over the vm; nothing in these tests reaches it.
const fakeVm = {};

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
