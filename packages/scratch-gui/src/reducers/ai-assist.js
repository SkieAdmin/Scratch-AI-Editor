import {BRIDGE_STATUS} from '../lib/ai/constants';
import {clampWidth, loadConfig} from '../lib/ai/persistence';

const SET_VISIBLE = 'scratch-gui/ai-assist/SET_VISIBLE';
const SET_WIDTH = 'scratch-gui/ai-assist/SET_WIDTH';
const SET_CONFIG = 'scratch-gui/ai-assist/SET_CONFIG';
const SET_MODELS = 'scratch-gui/ai-assist/SET_MODELS';
const SET_BRIDGE_STATUS = 'scratch-gui/ai-assist/SET_BRIDGE_STATUS';
const SET_ERROR = 'scratch-gui/ai-assist/SET_ERROR';
const ADD_MESSAGE = 'scratch-gui/ai-assist/ADD_MESSAGE';
const UPDATE_MESSAGE = 'scratch-gui/ai-assist/UPDATE_MESSAGE';
const START_STREAM = 'scratch-gui/ai-assist/START_STREAM';
const END_STREAM = 'scratch-gui/ai-assist/END_STREAM';
const CLEAR_CHAT = 'scratch-gui/ai-assist/CLEAR_CHAT';

const initialState = {
    visible: false,
    config: loadConfig(),
    models: [],
    modelsLoading: false,
    messages: [],
    streaming: false,
    streamingMessageId: null,
    bridgeStatus: BRIDGE_STATUS.DISABLED,
    error: null
};

const reducer = function (state, action) {
    if (typeof state === 'undefined') state = initialState;
    switch (action.type) {
    case SET_VISIBLE:
        return {...state, visible: action.visible};
    case SET_WIDTH:
        return {...state, config: {...state.config, panelWidth: clampWidth(action.width)}};
    case SET_CONFIG:
        return {...state, config: {...state.config, ...action.config}};
    case SET_MODELS:
        return {...state, models: action.models, modelsLoading: action.loading};
    case SET_BRIDGE_STATUS:
        return {...state, bridgeStatus: action.status};
    case SET_ERROR:
        return {...state, error: action.error};
    case ADD_MESSAGE:
        return {...state, messages: state.messages.concat([action.message])};
    case UPDATE_MESSAGE:
        return {
            ...state,
            messages: state.messages.map(message => (
                message.id === action.id ? {...message, ...action.patch} : message
            ))
        };
    case START_STREAM:
        return {...state, streaming: true, streamingMessageId: action.id, error: null};
    case END_STREAM:
        return {...state, streaming: false, streamingMessageId: null};
    case CLEAR_CHAT:
        return {...state, messages: [], streaming: false, streamingMessageId: null, error: null};
    default:
        return state;
    }
};

const setAiPanelVisible = visible => ({type: SET_VISIBLE, visible});

const setAiPanelWidth = width => ({type: SET_WIDTH, width});

const setAiModels = (models, loading = false) => ({type: SET_MODELS, models, loading});

const setAiBridgeStatus = status => ({type: SET_BRIDGE_STATUS, status});

const setAiError = error => ({type: SET_ERROR, error});

const addAiMessage = message => ({type: ADD_MESSAGE, message});

const updateAiMessage = (id, patch) => ({type: UPDATE_MESSAGE, id, patch});

const startAiStream = id => ({type: START_STREAM, id});

const endAiStream = () => ({type: END_STREAM});

const clearAiChat = () => ({type: CLEAR_CHAT});

/**
 * Change one or more assistant configuration fields.
 *
 * The store has no thunk middleware, so callers persist the result themselves
 * with `saveConfig`, matching how the theme and color-mode settings work.
 * @param {object} config the configuration fields to change
 * @returns {object} the action
 */
const setAiConfig = config => ({type: SET_CONFIG, config});

export {
    reducer as default,
    initialState as aiAssistInitialState,
    addAiMessage,
    clearAiChat,
    endAiStream,
    setAiBridgeStatus,
    setAiConfig,
    setAiError,
    setAiModels,
    setAiPanelVisible,
    setAiPanelWidth,
    startAiStream,
    updateAiMessage
};
