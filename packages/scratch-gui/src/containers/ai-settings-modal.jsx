import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';

import AiSettingsModalComponent from '../components/ai-settings-modal/ai-settings-modal.jsx';
import {getActiveBridge} from '../lib/ai/bridge-client';
import {getProvider} from '../lib/ai/providers';
import {DEEPSEEK_MODELS, PROVIDER_IDS} from '../lib/ai/constants';
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

    /**
     * Ask whoever holds the credentials for this provider.
     *
     * With the bridge on, it is the bridge: it has the API key, so it can list
     * models the page has no way to authenticate for.
     * @param {object} provider the provider being listed
     * @param {string} providerId that provider's identifier
     * @returns {Promise<Array<object>>} the available models
     */
    fetchModels (provider, providerId) {
        const bridge = getActiveBridge();
        const apiKey = (this.props.config.apiKeys || {})[providerId];
        if (this.props.config.useBridge && bridge) return bridge.listModels(providerId, apiKey);

        return provider.listModels({
            apiKey,
            baseUrl: this.props.config.baseUrls[providerId]
        });
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
