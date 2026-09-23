import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';

import AiSettingsModalComponent from '../components/ai-settings-modal/ai-settings-modal.jsx';
import {getActiveBridge} from '../lib/ai/bridge-client';
import {getProvider} from '../lib/ai/providers';
import {looksLikeReasoningModel} from '../lib/ai/providers/base-provider';
import {BRIDGE_STATUS, DEEPSEEK_MODELS, PROVIDER_IDS} from '../lib/ai/constants';
import {saveConfig} from '../lib/ai/persistence';
import {setAiConfig, setAiError, setAiModels} from '../reducers/ai-assist';
import {closeAiSettingsModal} from '../reducers/modals';

class AiSettingsModal extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, ['handleChangeConfig', 'handleRefreshModels', 'handleTestConnection']);
    }

    componentDidMount () {
        this.handleRefreshModels();
    }

    handleChangeConfig (partialConfig) {
        this.props.onChangeConfig(partialConfig);
        // The store has no thunk middleware, so persistence happens at the call
        // site, the same way the theme and color-mode settings are written through.
        saveConfig({...this.props.config, ...partialConfig});

        const nextProviderId = partialConfig.providerId;
        if (nextProviderId && nextProviderId !== this.props.config.providerId) {
            // The model list belongs to the previous provider; drop it and refetch.
            this.props.onSetModels([], true);
            this.refreshModelsFor(nextProviderId);
        }
    }

    handleRefreshModels () {
        this.refreshModelsFor(this.props.config.providerId);
    }

    async refreshModelsFor (providerId) {
        const provider = getProvider(providerId);

        if (!provider.supportsModelListing) {
            this.props.onSetModels(
                providerId === PROVIDER_IDS.DEEPSEEK ? DEEPSEEK_MODELS : [],
                false
            );
            return;
        }

        this.props.onSetModels([], true);
        try {
            this.props.onSetModels(await this.fetchModels(provider, providerId), false);
        } catch (e) {
            this.props.onSetModels([], false);
            this.props.onSetError(e.message);
        }
    }

    /**
     * List a provider's models wherever its credentials are.
     *
     * With the bridge in use the API key lives there and never reaches the
     * browser, so asking the provider from this page would fail for want of a
     * key even though the bridge could answer.
     * @param {object} provider the provider to list
     * @param {string} providerId the provider's identifier
     * @returns {Promise<Array<object>>} the models it offers
     */
    async fetchModels (provider, providerId) {
        const bridge = getActiveBridge();
        if (this.props.config.useBridge && this.props.bridgeStatus === BRIDGE_STATUS.CONNECTED && bridge) {
            const models = await bridge.listModels(providerId);
            // The bridge reports ids and labels; whether a model reasons is the
            // editor's own judgement, as it is for a browser-side listing.
            return models.map(model => ({...model, reasoning: looksLikeReasoningModel(model.id)}));
        }

        return provider.listModels({
            apiKey: (this.props.config.apiKeys || {})[providerId],
            baseUrl: this.props.config.baseUrls[providerId]
        });
    }

    async handleTestConnection () {
        this.props.onSetError(null);
        try {
            await this.refreshModelsFor(this.props.config.providerId);
        } catch (e) {
            this.props.onSetError(e.message);
        }
    }

    render () {
        return (
            <AiSettingsModalComponent
                bridgeStatus={this.props.bridgeStatus}
                config={this.props.config}
                connectionError={this.props.connectionError}
                isRtl={this.props.isRtl}
                models={this.props.models}
                modelsLoading={this.props.modelsLoading}
                onChangeConfig={this.handleChangeConfig}
                onRefreshModels={this.handleRefreshModels}
                onRequestClose={this.props.onRequestClose}
                onTestConnection={this.handleTestConnection}
            />
        );
    }
}

AiSettingsModal.propTypes = {
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
    connectionError: PropTypes.string,
    isRtl: PropTypes.bool,
    models: PropTypes.arrayOf(PropTypes.object),
    modelsLoading: PropTypes.bool,
    onChangeConfig: PropTypes.func.isRequired,
    onRequestClose: PropTypes.func.isRequired,
    onSetError: PropTypes.func.isRequired,
    onSetModels: PropTypes.func.isRequired
};

const mapStateToProps = state => ({
    bridgeStatus: state.scratchGui.aiAssist.bridgeStatus,
    config: state.scratchGui.aiAssist.config,
    connectionError: state.scratchGui.aiAssist.error,
    isRtl: state.locales.isRtl,
    models: state.scratchGui.aiAssist.models,
    modelsLoading: state.scratchGui.aiAssist.modelsLoading
});

const mapDispatchToProps = dispatch => ({
    onChangeConfig: config => dispatch(setAiConfig(config)),
    onRequestClose: () => dispatch(closeAiSettingsModal()),
    onSetError: error => dispatch(setAiError(error)),
    onSetModels: (models, loading) => dispatch(setAiModels(models, loading))
});

export default connect(mapStateToProps, mapDispatchToProps)(AiSettingsModal);
