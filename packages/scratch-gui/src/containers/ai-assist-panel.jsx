import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {defineMessages, injectIntl} from 'react-intl';
import {connect} from 'react-redux';
import VM from '@scratch/scratch-vm';

import AiAssistPanelComponent from '../components/ai-assist-panel/ai-assist-panel.jsx';
import BridgeClient, {setActiveBridge} from '../lib/ai/bridge-client';
import intlShape from '../lib/intlShape.js';
import {createId, runChatTurn} from '../lib/ai/chat-session';
import {buildSystemPrompt} from '../lib/ai/system-prompt';
import {BRIDGE_STATUS, DEEPSEEK_MODELS, PROVIDER_IDS} from '../lib/ai/constants';
import {providerNeedsApiKey, saveConfig} from '../lib/ai/persistence';
import {providerMessages} from '../lib/ai/provider-messages';
import {getProvider} from '../lib/ai/providers';
import {TOOL_DEFINITIONS, createToolRunner} from '../lib/ai/scratch-tools';
import {
    addAiMessage,
    clearAiChat,
    endAiStream,
    setAiBridgeStatus,
    setAiError,
    setAiPanelVisible,
    setAiPanelWidth,
    startAiStream,
    updateAiMessage
} from '../reducers/ai-assist';
import {openAiSettingsModal} from '../reducers/modals';

const messages = defineMessages({
    bridgeOffline: {
        id: 'gui.aiAssist.error.bridgeOffline',
        defaultMessage: 'The Scratch AI bridge is not connected. Start it, then try again.',
        description: 'Error shown when the assistant needs the bridge but it is not running'
    },
    needsApiKey: {
        id: 'gui.aiAssist.error.needsApiKey',
        defaultMessage: 'This provider needs an API key. Add one in Settings, or choose a provider that ' +
            'runs on your own computer.',
        description: 'Error shown when a provider that requires an API key has none configured'
    },
    noModel: {
        id: 'gui.aiAssist.error.noModel',
        defaultMessage: 'Choose a model in Settings before sending a message.',
        description: 'Error shown when the user sends a message with no model selected'
    }
});

class AiAssistPanel extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleAbort',
            'handleAttachFiles',
            'handleBridgeStatusChange',
            'handleNewChat',
            'handleSend',
            'handleToggleVisible',
            'handleToolInvoke',
            'handleWidthChange'
        ]);

        this.toolRunner = createToolRunner(props.vm);
        this.toolDefinitions = TOOL_DEFINITIONS;
        this.bridge = null;
        this.abortController = null;
        this.startedMessages = new Set();
    }

    componentDidMount () {
        if (this.props.config.useBridge) this.openBridge();
    }

    componentDidUpdate (prevProps) {
        const {useBridge, bridgeUrl} = this.props.config;
        const changed = useBridge !== prevProps.config.useBridge || bridgeUrl !== prevProps.config.bridgeUrl;
        if (!changed) return;

        this.closeBridge();
        if (useBridge) this.openBridge();
    }

    componentWillUnmount () {
        this.closeBridge();
        if (this.abortController) this.abortController.abort();
    }

    openBridge () {
        this.bridge = new BridgeClient({
            url: this.props.config.bridgeUrl,
            onStatusChange: this.handleBridgeStatusChange,
            onToolInvoke: this.handleToolInvoke
        });
        this.bridge.setToolDefinitions(this.toolDefinitions);
        this.bridge.connect();
        // The settings modal lists models over the same connection.
        setActiveBridge(this.bridge);
    }

    closeBridge () {
        if (!this.bridge) return;
        this.bridge.disconnect();
        this.bridge = null;
        setActiveBridge(null);
    }

    handleBridgeStatusChange (status, detail) {
        this.props.onSetBridgeStatus(status);
        if (status === BRIDGE_STATUS.ERROR && detail) this.props.onSetError(detail);
    }

    /**
     * Run a tool the bridge asked for on behalf of an external AI client.
     * @param {string} name the tool to run
     * @param {object} args the tool's arguments
     * @returns {Promise<object>} the tool's result
     */
    handleToolInvoke (name, args) {
        return this.toolRunner.runTool(name, args);
    }

    handleWidthChange (width) {
        this.props.onSetWidth(width);
        // The store has no thunk middleware, so persistence happens at the call
        // site, the same way the theme and color-mode settings are written through.
        saveConfig({...this.props.config, panelWidth: width});
    }

    /**
     * Flip the panel open or closed.
     *
     * The tab and the close button pass this straight to `onClick`, so it is
     * called with a click event rather than the state to move to; the current
     * state is the only reliable input.
     */
    handleToggleVisible () {
        this.props.onSetVisible(!this.props.visible);
    }

    handleNewChat () {
        if (this.abortController) this.abortController.abort();
        this.props.onClearChat();
    }

    handleAbort () {
        if (this.abortController) this.abortController.abort();
        this.props.onEndStream();
    }

    /**
     * Read picked files into the attachment shape the chat uses.
     * @param {Array<File>} files the files the user chose
     * @returns {Promise<Array<object>>} name, mime type and data URL for each file
     */
    handleAttachFiles (files) {
        return Promise.all(files.map(file => new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve({
                name: file.name,
                mimeType: file.type,
                dataUrl: reader.result
            });
            reader.onerror = () => reject(new Error(`Could not read "${file.name}".`));
            reader.readAsDataURL(file);
        })));
    }

    /**
     * Pick where completions run. Providers that need an API key are only
     * reachable through the bridge, because that is where the key is kept.
     * @returns {object} an object exposing a `chat` method
     */
    resolveTransport () {
        const {providerId, modelId, baseUrls, apiKeys, useBridge} = this.props.config;
        const {intl} = this.props;

        if (useBridge) {
            if (!this.bridge || this.props.bridgeStatus !== BRIDGE_STATUS.CONNECTED) {
                throw new Error(intl.formatMessage(messages.bridgeOffline));
            }
            return {
                chat: request => this.bridge.chat(
                    {
                        provider: providerId,
                        model: request.model,
                        messages: request.messages,
                        tools: request.tools
                    },
                    {
                        onContentDelta: request.onContentDelta,
                        onReasoningDelta: request.onReasoningDelta,
                        signal: request.signal
                    }
                )
            };
        }

        const apiKey = apiKeys[providerId];
        if (providerNeedsApiKey(providerId) && !apiKey) {
            throw new Error(intl.formatMessage(messages.needsApiKey));
        }

        const provider = getProvider(providerId);
        return {
            chat: request => provider.chat({
                ...request,
                apiKey,
                model: modelId,
                baseUrl: baseUrls[providerId]
            })
        };
    }

    async handleSend (text, attachments) {
        const userMessage = {
            id: createId(),
            role: 'user',
            content: text,
            attachments,
            createdAt: Date.now()
        };
        this.props.onAddMessage(userMessage);
        this.props.onSetError(null);

        if (!this.props.config.modelId) {
            this.props.onSetError(this.props.intl.formatMessage(messages.noModel));
            return;
        }

        const history = this.props.messages.concat([userMessage]);
        this.abortController = new AbortController();
        this.startedMessages = new Set();

        try {
            const transport = this.resolveTransport();

            await runChatTurn({
                transport,
                model: this.props.config.modelId,
                history,
                systemPrompt: buildSystemPrompt({
                    spriteNames: this.props.spriteNames,
                    revision: this.toolRunner.getRevision()
                }),
                toolDefinitions: this.toolDefinitions,
                runTool: this.toolRunner.runTool,
                signal: this.abortController.signal,
                onMessageStart: id => this.props.onStartStream(id),
                onContentDelta: (id, delta) => this.appendTo(id, 'content', delta),
                onReasoningDelta: (id, delta) => this.appendTo(id, 'reasoning', delta),
                onToolCallStart: (id, call) => this.patchToolCall(id, {...call, status: 'running'}),
                onToolCallEnd: (id, call) => this.patchToolCall(id, call),
                onMessageEnd: () => this.props.onEndStream()
            });
        } catch (e) {
            if (e.name !== 'AbortError') this.props.onSetError(e.message);
            this.props.onEndStream();
        } finally {
            this.abortController = null;
        }
    }

    /**
     * Add the assistant bubble for a turn, the first time that turn has anything
     * to show.
     *
     * Creating it when the turn starts would leave an empty bubble behind
     * whenever the request fails before the model says a word, which is exactly
     * what a misconfigured provider or an offline bridge does. Waiting also
     * costs nothing: the composer already shows the turn is running, and the
     * first fragment is carried into the message this creates.
     * @param {string} id the message id for this turn
     * @param {object} initial the first content, reasoning or tool call to show
     * @returns {boolean} true when this call created the message
     */
    ensureMessage (id, initial) {
        if (this.startedMessages.has(id)) return false;

        this.startedMessages.add(id);
        this.props.onAddMessage({
            id,
            role: 'assistant',
            content: '',
            reasoning: '',
            toolCalls: [],
            createdAt: Date.now(),
            ...initial
        });
        return true;
    }

    appendTo (id, field, delta) {
        if (this.ensureMessage(id, {[field]: delta})) return;

        const message = this.props.messages.find(candidate => candidate.id === id);
        if (!message) return;
        this.props.onUpdateMessage(id, {[field]: (message[field] || '') + delta});
    }

    patchToolCall (id, call) {
        if (this.ensureMessage(id, {toolCalls: [call]})) return;

        const message = this.props.messages.find(candidate => candidate.id === id);
        if (!message) return;

        const existing = message.toolCalls || [];
        const index = existing.findIndex(candidate => candidate.id === call.id);
        const toolCalls = index === -1 ?
            existing.concat([call]) :
            existing.map((candidate, i) => (i === index ? {...candidate, ...call} : candidate));

        this.props.onUpdateMessage(id, {toolCalls});
    }

    currentModel () {
        const {providerId, modelId} = this.props.config;
        if (providerId === PROVIDER_IDS.DEEPSEEK) {
            return DEEPSEEK_MODELS.find(model => model.id === modelId) || DEEPSEEK_MODELS[0];
        }
        return this.props.models.find(model => model.id === modelId) || {id: modelId, reasoning: false};
    }

    render () {
        const model = this.currentModel();

        return (
            <AiAssistPanelComponent
                bridgeStatus={this.props.bridgeStatus}
                error={this.props.error}
                messages={this.props.messages}
                modelIsReasoning={Boolean(model.reasoning)}
                modelLabel={model.id}
                providerLabel={this.props.intl.formatMessage(providerMessages[this.props.config.providerId])}
                streaming={this.props.streaming}
                visible={this.props.visible}
                width={this.props.config.panelWidth}
                onAbort={this.handleAbort}
                onAttachFiles={this.handleAttachFiles}
                onNewChat={this.handleNewChat}
                onOpenSettings={this.props.onOpenSettings}
                onSend={this.handleSend}
                onToggleVisible={this.handleToggleVisible}
                onWidthChange={this.handleWidthChange}
            />
        );
    }
}

AiAssistPanel.propTypes = {
    bridgeStatus: PropTypes.string,
    config: PropTypes.shape({
        apiKeys: PropTypes.object,
        baseUrls: PropTypes.object,
        bridgeUrl: PropTypes.string,
        modelId: PropTypes.string,
        panelWidth: PropTypes.number,
        providerId: PropTypes.string,
        useBridge: PropTypes.bool
    }).isRequired,
    error: PropTypes.string,
    intl: intlShape.isRequired,
    messages: PropTypes.arrayOf(PropTypes.object).isRequired,
    models: PropTypes.arrayOf(PropTypes.object).isRequired,
    onAddMessage: PropTypes.func.isRequired,
    onClearChat: PropTypes.func.isRequired,
    onEndStream: PropTypes.func.isRequired,
    onOpenSettings: PropTypes.func.isRequired,
    onSetBridgeStatus: PropTypes.func.isRequired,
    onSetError: PropTypes.func.isRequired,
    onSetWidth: PropTypes.func.isRequired,
    onStartStream: PropTypes.func.isRequired,
    onSetVisible: PropTypes.func.isRequired,
    onUpdateMessage: PropTypes.func.isRequired,
    spriteNames: PropTypes.arrayOf(PropTypes.string).isRequired,
    streaming: PropTypes.bool,
    visible: PropTypes.bool,
    vm: PropTypes.instanceOf(VM).isRequired
};

const mapStateToProps = state => ({
    bridgeStatus: state.scratchGui.aiAssist.bridgeStatus,
    config: state.scratchGui.aiAssist.config,
    error: state.scratchGui.aiAssist.error,
    messages: state.scratchGui.aiAssist.messages,
    models: state.scratchGui.aiAssist.models,
    spriteNames: Object.values(state.scratchGui.targets.sprites).map(sprite => sprite.name),
    streaming: state.scratchGui.aiAssist.streaming,
    visible: state.scratchGui.aiAssist.visible
});

const mapDispatchToProps = dispatch => ({
    onAddMessage: message => dispatch(addAiMessage(message)),
    onClearChat: () => dispatch(clearAiChat()),
    onEndStream: () => dispatch(endAiStream()),
    onOpenSettings: () => dispatch(openAiSettingsModal()),
    onSetBridgeStatus: status => dispatch(setAiBridgeStatus(status)),
    onSetError: error => dispatch(setAiError(error)),
    onSetWidth: width => dispatch(setAiPanelWidth(width)),
    onStartStream: id => dispatch(startAiStream(id)),
    onSetVisible: visible => dispatch(setAiPanelVisible(visible)),
    onUpdateMessage: (id, patch) => dispatch(updateAiMessage(id, patch))
});

export default injectIntl(connect(mapStateToProps, mapDispatchToProps)(AiAssistPanel));
