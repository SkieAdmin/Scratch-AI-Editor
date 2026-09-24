import classNames from 'classnames';
import PropTypes from 'prop-types';
import React, {useCallback, useState} from 'react';
import {defineMessages, injectIntl, FormattedMessage} from 'react-intl';

import Box from '../box/box.jsx';
import Button from '../button/button.jsx';
import Modal from '../modal/modal.jsx';
import intlShape from '../../lib/intlShape.js';
import {
    BRIDGE_STATUS,
    DEFAULT_BASE_URLS,
    MAX_TOOL_ROUNDS,
    MIN_TOOL_ROUNDS,
    PROVIDER_IDS
} from '../../lib/ai/constants';
import {providerMessages} from '../../lib/ai/provider-messages';
import {providerNeedsApiKey} from '../../lib/ai/persistence';

import styles from './ai-settings-modal.css';

/**
 * Name of the environment variable the bridge process reads each remote
 * provider's API key from. Keys are never entered or stored in the browser.
 */
const API_KEY_ENV_VARS = {
    [PROVIDER_IDS.DEEPSEEK]: 'DEEPSEEK_API_KEY',
    [PROVIDER_IDS.OPENROUTER]: 'OPENROUTER_API_KEY'
};

const messages = defineMessages({
    title: {
        defaultMessage: 'AI assistant settings',
        description: 'Title of the AI assistant settings modal',
        id: 'gui.aiAssist.settings.title'
    },
    providerHeading: {
        defaultMessage: 'Provider',
        description: 'Heading of the section where the AI provider is chosen',
        id: 'gui.aiAssist.settings.providerHeading'
    },
    modelHeading: {
        defaultMessage: 'Model',
        description: 'Heading of the section where the AI model is chosen',
        id: 'gui.aiAssist.settings.modelHeading'
    },
    modelLabel: {
        defaultMessage: 'Model to use',
        description: 'Label of the drop-down that chooses which AI model to use',
        id: 'gui.aiAssist.settings.modelLabel'
    },
    modelPlaceholder: {
        defaultMessage: 'Choose a model',
        description: 'Placeholder option shown when no AI model has been chosen yet',
        id: 'gui.aiAssist.settings.modelPlaceholder'
    },
    modelsLoading: {
        defaultMessage: 'Loading models…',
        description: 'Message shown while the list of available AI models is being fetched',
        id: 'gui.aiAssist.settings.modelsLoading'
    },
    modelsEmpty: {
        defaultMessage: 'No models found. Check the endpoint below, then refresh.',
        description: 'Message shown when no AI models could be found for the chosen provider',
        id: 'gui.aiAssist.settings.modelsEmpty'
    },
    refreshModels: {
        defaultMessage: 'Refresh',
        description: 'Text of the button that re-fetches the list of available AI models',
        id: 'gui.aiAssist.settings.refreshModels'
    },
    reasoningBadge: {
        defaultMessage: 'thinks first',
        description: 'Badge marking an AI model that works through a problem before answering',
        id: 'gui.aiAssist.settings.reasoningBadge'
    },
    reasoningModelOption: {
        defaultMessage: '{label} — thinks first',
        description: 'Drop-down entry for an AI model that works through a problem before answering',
        id: 'gui.aiAssist.settings.reasoningModelOption'
    },
    endpointHeading: {
        defaultMessage: 'Endpoint',
        description: 'Heading of the section where the provider’s address is set',
        id: 'gui.aiAssist.settings.endpointHeading'
    },
    endpointLabel: {
        defaultMessage: 'Base URL',
        description: 'Label of the text box holding the address of the chosen AI provider',
        id: 'gui.aiAssist.settings.endpointLabel'
    },
    endpointHint: {
        defaultMessage: 'Default: {defaultUrl}',
        description: 'Hint below the base URL text box showing the provider’s usual address',
        id: 'gui.aiAssist.settings.endpointHint'
    },
    bridgeHeading: {
        defaultMessage: 'Bridge',
        description: 'Heading of the section that configures the local bridge process',
        id: 'gui.aiAssist.settings.bridgeHeading'
    },
    bridgeToggleLabel: {
        defaultMessage: 'Connect through the bridge',
        description: 'Label of the switch that turns the local bridge connection on or off',
        id: 'gui.aiAssist.settings.bridgeToggleLabel'
    },
    bridgeExplanation: {
        defaultMessage: 'The bridge is a small program you run on your own computer. It talks to the AI provider ' +
            'for the editor and keeps your API key out of the browser.',
        description: 'Explanation of what the bridge process does',
        id: 'gui.aiAssist.settings.bridgeExplanation'
    },
    bridgeUrlLabel: {
        defaultMessage: 'Bridge address',
        description: 'Label of the text box holding the address of the bridge process',
        id: 'gui.aiAssist.settings.bridgeUrlLabel'
    },
    bridgeStatusLabel: {
        defaultMessage: 'Status',
        description: 'Label of the readout showing whether the editor is connected to the bridge',
        id: 'gui.aiAssist.settings.bridgeStatusLabel'
    },
    bridgeStatusDisabled: {
        defaultMessage: 'Turned off',
        description: 'Bridge status shown when the bridge connection is switched off',
        id: 'gui.aiAssist.settings.bridgeStatusDisabled'
    },
    bridgeStatusConnecting: {
        defaultMessage: 'Connecting…',
        description: 'Bridge status shown while the editor is opening a connection to the bridge',
        id: 'gui.aiAssist.settings.bridgeStatusConnecting'
    },
    bridgeStatusConnected: {
        defaultMessage: 'Connected',
        description: 'Bridge status shown when the editor is connected to the bridge',
        id: 'gui.aiAssist.settings.bridgeStatusConnected'
    },
    bridgeStatusDisconnected: {
        defaultMessage: 'Not connected',
        description: 'Bridge status shown when the editor is not connected to the bridge',
        id: 'gui.aiAssist.settings.bridgeStatusDisconnected'
    },
    bridgeStatusError: {
        defaultMessage: 'Connection failed',
        description: 'Bridge status shown when the editor could not connect to the bridge',
        id: 'gui.aiAssist.settings.bridgeStatusError'
    },
    testConnection: {
        defaultMessage: 'Test connection',
        description: 'Text of the button that checks whether the bridge can be reached',
        id: 'gui.aiAssist.settings.testConnection'
    },
    apiKeyHeading: {
        defaultMessage: 'API key',
        description: 'Heading of the section explaining where the provider’s API key lives',
        id: 'gui.aiAssist.settings.apiKeyHeading'
    },
    apiKeyLabel: {
        defaultMessage: '{provider} API key',
        description: 'Label of the field where the user types their API key for the chosen AI provider',
        id: 'gui.aiAssist.settings.apiKeyLabel'
    },
    apiKeyPlaceholder: {
        defaultMessage: 'Paste your key here',
        description: 'Placeholder of the API key field',
        id: 'gui.aiAssist.settings.apiKeyPlaceholder'
    },
    apiKeySaved: {
        defaultMessage: 'Saved on this computer.',
        description: 'Confirmation that the typed API key has been stored',
        id: 'gui.aiAssist.settings.apiKeySaved'
    },
    apiKeyShow: {
        defaultMessage: 'Show',
        description: 'Button that reveals the typed API key',
        id: 'gui.aiAssist.settings.apiKeyShow'
    },
    apiKeyHide: {
        defaultMessage: 'Hide',
        description: 'Button that masks the typed API key',
        id: 'gui.aiAssist.settings.apiKeyHide'
    },
    apiKeyClear: {
        defaultMessage: 'Clear',
        description: 'Button that deletes the stored API key',
        id: 'gui.aiAssist.settings.apiKeyClear'
    },
    apiKeyStorageNotice: {
        defaultMessage: 'The key is kept in this browser on this computer so you do not have to type it again. ' +
            'Anything else running on this page could read it. To keep it out of the page entirely, switch on ' +
            'the bridge above and set {envVar} in its environment instead.',
        description: 'Explanation of where the typed API key is stored and how to avoid storing it in the page',
        id: 'gui.aiAssist.settings.apiKeyStorageNotice'
    },
    apiKeyMissingWarning: {
        defaultMessage: '{provider} needs a key before it can answer.',
        description: 'Warning shown when the chosen provider requires an API key and none is set',
        id: 'gui.aiAssist.settings.apiKeyMissingWarning'
    },
    effortHeading: {
        defaultMessage: 'How long it may work',
        description: 'Heading of the section limiting how many tool rounds the assistant may take',
        id: 'gui.aiAssist.settings.effortHeading'
    },
    maxRoundsLabel: {
        defaultMessage: 'Steps before it has to stop',
        description: 'Label of the field limiting how many rounds of tools the assistant may use',
        id: 'gui.aiAssist.settings.maxRoundsLabel'
    },
    maxRoundsHint: {
        defaultMessage: 'A whole story takes many steps: finding sprites, adding them, then writing a ' +
            'script for each one. Raise this if it keeps stopping before it finishes. Lower it to keep ' +
            'a request short. Between {min} and {max}.',
        description: 'Explanation of the limit on how many rounds of tools the assistant may use',
        id: 'gui.aiAssist.settings.maxRoundsHint'
    },
    doneButton: {
        defaultMessage: 'Done',
        description: 'Text of the button that closes the AI assistant settings modal',
        id: 'gui.aiAssist.settings.doneButton'
    }
});

const PROVIDER_ORDER = [
    PROVIDER_IDS.DEEPSEEK,
    PROVIDER_IDS.OPENROUTER,
    PROVIDER_IDS.LM_STUDIO,
    PROVIDER_IDS.OLLAMA
];

const BRIDGE_STATUS_MESSAGES = {
    [BRIDGE_STATUS.DISABLED]: messages.bridgeStatusDisabled,
    [BRIDGE_STATUS.CONNECTING]: messages.bridgeStatusConnecting,
    [BRIDGE_STATUS.CONNECTED]: messages.bridgeStatusConnected,
    [BRIDGE_STATUS.DISCONNECTED]: messages.bridgeStatusDisconnected,
    [BRIDGE_STATUS.ERROR]: messages.bridgeStatusError
};

const AiSettingsModal = props => {
    const [keyVisible, setKeyVisible] = useState(false);
    const {
        bridgeStatus,
        config,
        connectionError,
        intl,
        isRtl,
        models,
        modelsLoading,
        onChangeConfig,
        onRefreshModels,
        onRequestClose,
        onTestConnection
    } = props;

    const providerLabel = intl.formatMessage(providerMessages[config.providerId]);
    const selectedModel = models.find(model => model.id === config.modelId);
    const needsApiKey = providerNeedsApiKey(config.providerId);
    const apiKey = (config.apiKeys || {})[config.providerId] || '';

    const handleProviderChange = useCallback(
        event => onChangeConfig({providerId: event.target.value}),
        [onChangeConfig]
    );
    const handleModelChange = useCallback(
        event => onChangeConfig({modelId: event.target.value}),
        [onChangeConfig]
    );
    const handleBaseUrlChange = useCallback(
        event => onChangeConfig({
            baseUrls: {...config.baseUrls, [config.providerId]: event.target.value}
        }),
        [config.baseUrls, config.providerId, onChangeConfig]
    );
    const handleUseBridgeChange = useCallback(
        event => onChangeConfig({useBridge: event.target.checked}),
        [onChangeConfig]
    );
    const handleApiKeyChange = useCallback(
        event => onChangeConfig({apiKeys: {...config.apiKeys, [config.providerId]: event.target.value}}),
        [config.apiKeys, config.providerId, onChangeConfig]
    );
    const handleApiKeyClear = useCallback(
        () => onChangeConfig({apiKeys: {...config.apiKeys, [config.providerId]: ''}}),
        [config.apiKeys, config.providerId, onChangeConfig]
    );
    const handleToggleKeyVisible = useCallback(() => setKeyVisible(visible => !visible), []);

    const handleMaxRoundsChange = useCallback(
        event => onChangeConfig({maxToolRounds: Number(event.target.value)}),
        [onChangeConfig]
    );

    const handleBridgeUrlChange = useCallback(
        event => onChangeConfig({bridgeUrl: event.target.value}),
        [onChangeConfig]
    );

    const modelOptionLabel = model => (model.reasoning ?
        intl.formatMessage(messages.reasoningModelOption, {label: model.label}) :
        model.label);

    return (
        <Modal
            className={styles.modalContent}
            contentLabel={intl.formatMessage(messages.title)}
            isRtl={isRtl}
            onRequestClose={onRequestClose}
        >
            <Box className={styles.body}>
                <fieldset className={styles.section}>
                    <legend className={styles.heading}>
                        <FormattedMessage {...messages.providerHeading} />
                    </legend>
                    <div className={styles.providerGroup}>
                        {PROVIDER_ORDER.map(providerId => (
                            <label
                                className={classNames(styles.providerOption, {
                                    [styles.providerOptionSelected]: config.providerId === providerId
                                })}
                                key={providerId}
                            >
                                <input
                                    checked={config.providerId === providerId}
                                    name="ai-settings-provider"
                                    type="radio"
                                    value={providerId}
                                    onChange={handleProviderChange}
                                />
                                <FormattedMessage {...providerMessages[providerId]} />
                            </label>
                        ))}
                    </div>
                </fieldset>

                <div className={styles.section}>
                    <h2 className={styles.heading}>
                        <FormattedMessage {...messages.modelHeading} />
                    </h2>
                    <label
                        className={styles.fieldLabel}
                        htmlFor="ai-settings-model"
                    >
                        <FormattedMessage {...messages.modelLabel} />
                    </label>
                    <div className={styles.fieldRow}>
                        <select
                            className={styles.select}
                            disabled={modelsLoading}
                            id="ai-settings-model"
                            value={config.modelId}
                            onChange={handleModelChange}
                        >
                            <option value="">
                                {intl.formatMessage(messages.modelPlaceholder)}
                            </option>
                            {models.map(model => (
                                <option
                                    key={model.id}
                                    value={model.id}
                                >
                                    {modelOptionLabel(model)}
                                </option>
                            ))}
                        </select>
                        <Button
                            className={styles.secondaryButton}
                            disabled={modelsLoading}
                            onClick={onRefreshModels}
                        >
                            <FormattedMessage {...messages.refreshModels} />
                        </Button>
                    </div>
                    {selectedModel && selectedModel.reasoning ? (
                        <span className={styles.reasoningBadge}>
                            <FormattedMessage {...messages.reasoningBadge} />
                        </span>
                    ) : null}
                    {modelsLoading ? (
                        <p className={styles.hint}>
                            <FormattedMessage {...messages.modelsLoading} />
                        </p>
                    ) : null}
                    {!modelsLoading && models.length === 0 ? (
                        <p className={styles.hint}>
                            <FormattedMessage {...messages.modelsEmpty} />
                        </p>
                    ) : null}
                </div>

                <div className={styles.section}>
                    <h2 className={styles.heading}>
                        <FormattedMessage {...messages.endpointHeading} />
                    </h2>
                    <label
                        className={styles.fieldLabel}
                        htmlFor="ai-settings-endpoint"
                    >
                        <FormattedMessage {...messages.endpointLabel} />
                    </label>
                    <input
                        className={styles.textInput}
                        id="ai-settings-endpoint"
                        placeholder={DEFAULT_BASE_URLS[config.providerId]}
                        type="text"
                        value={config.baseUrls[config.providerId]}
                        onChange={handleBaseUrlChange}
                    />
                    <p className={styles.hint}>
                        <FormattedMessage
                            {...messages.endpointHint}
                            values={{defaultUrl: DEFAULT_BASE_URLS[config.providerId]}}
                        />
                    </p>
                </div>

                <div className={styles.section}>
                    <h2 className={styles.heading}>
                        <FormattedMessage {...messages.bridgeHeading} />
                    </h2>
                    <label className={styles.toggleLabel}>
                        <input
                            checked={config.useBridge}
                            type="checkbox"
                            onChange={handleUseBridgeChange}
                        />
                        <FormattedMessage {...messages.bridgeToggleLabel} />
                    </label>
                    <p className={styles.hint}>
                        <FormattedMessage {...messages.bridgeExplanation} />
                    </p>
                    <label
                        className={styles.fieldLabel}
                        htmlFor="ai-settings-bridge-url"
                    >
                        <FormattedMessage {...messages.bridgeUrlLabel} />
                    </label>
                    <div className={styles.fieldRow}>
                        <input
                            className={styles.textInput}
                            id="ai-settings-bridge-url"
                            type="text"
                            value={config.bridgeUrl}
                            onChange={handleBridgeUrlChange}
                        />
                        <Button
                            className={styles.secondaryButton}
                            onClick={onTestConnection}
                        >
                            <FormattedMessage {...messages.testConnection} />
                        </Button>
                    </div>
                    <p className={styles.statusRow}>
                        <span className={styles.fieldLabel}>
                            <FormattedMessage {...messages.bridgeStatusLabel} />
                        </span>
                        <span
                            className={classNames(styles.status, {
                                [styles.statusConnected]: bridgeStatus === BRIDGE_STATUS.CONNECTED,
                                [styles.statusPending]: bridgeStatus === BRIDGE_STATUS.CONNECTING,
                                [styles.statusError]: bridgeStatus === BRIDGE_STATUS.ERROR
                            })}
                        >
                            <FormattedMessage {...BRIDGE_STATUS_MESSAGES[bridgeStatus]} />
                        </span>
                    </p>
                    {connectionError ? (
                        <p className={styles.connectionError}>{connectionError}</p>
                    ) : null}
                </div>

                {needsApiKey ? (
                    <div className={styles.section}>
                        <h2 className={styles.heading}>
                            <FormattedMessage {...messages.apiKeyHeading} />
                        </h2>
                        <label
                            className={styles.fieldLabel}
                            htmlFor="ai-settings-api-key"
                        >
                            <FormattedMessage
                                {...messages.apiKeyLabel}
                                values={{provider: providerLabel}}
                            />
                        </label>
                        <div className={styles.fieldRow}>
                            <input
                                autoComplete="off"
                                className={styles.textInput}
                                id="ai-settings-api-key"
                                placeholder={intl.formatMessage(messages.apiKeyPlaceholder)}
                                spellCheck={false}
                                type={keyVisible ? 'text' : 'password'}
                                value={apiKey}
                                onChange={handleApiKeyChange}
                            />
                            <Button
                                className={styles.secondaryButton}
                                onClick={handleToggleKeyVisible}
                            >
                                <FormattedMessage
                                    {...(keyVisible ? messages.apiKeyHide : messages.apiKeyShow)}
                                />
                            </Button>
                            <Button
                                className={styles.secondaryButton}
                                onClick={handleApiKeyClear}
                            >
                                <FormattedMessage {...messages.apiKeyClear} />
                            </Button>
                        </div>
                        {apiKey === '' ? (
                            <p
                                className={styles.warning}
                                role="alert"
                            >
                                <FormattedMessage
                                    {...messages.apiKeyMissingWarning}
                                    values={{provider: providerLabel}}
                                />
                            </p>
                        ) : (
                            <p className={styles.hint}>
                                <FormattedMessage {...messages.apiKeySaved} />
                            </p>
                        )}
                        <p className={styles.hint}>
                            <FormattedMessage
                                {...messages.apiKeyStorageNotice}
                                values={{
                                    envVar: (
                                        <code className={styles.code}>
                                            {API_KEY_ENV_VARS[config.providerId]}
                                        </code>
                                    )
                                }}
                            />
                        </p>
                    </div>
                ) : null}

                <div className={styles.section}>
                    <h2 className={styles.heading}>
                        <FormattedMessage {...messages.effortHeading} />
                    </h2>
                    <label
                        className={styles.fieldLabel}
                        htmlFor="ai-settings-max-rounds"
                    >
                        <FormattedMessage {...messages.maxRoundsLabel} />
                    </label>
                    <input
                        className={styles.textInput}
                        id="ai-settings-max-rounds"
                        max={MAX_TOOL_ROUNDS}
                        min={MIN_TOOL_ROUNDS}
                        step={1}
                        type="number"
                        value={config.maxToolRounds}
                        onChange={handleMaxRoundsChange}
                    />
                    <p className={styles.hint}>
                        <FormattedMessage
                            {...messages.maxRoundsHint}
                            values={{max: MAX_TOOL_ROUNDS, min: MIN_TOOL_ROUNDS}}
                        />
                    </p>
                </div>

                <Box className={styles.footer}>
                    <Button
                        className={styles.doneButton}
                        onClick={onRequestClose}
                    >
                        <FormattedMessage {...messages.doneButton} />
                    </Button>
                </Box>
            </Box>
        </Modal>
    );
};

AiSettingsModal.propTypes = {
    bridgeStatus: PropTypes.oneOf(Object.values(BRIDGE_STATUS)).isRequired,
    config: PropTypes.shape({
        apiKeys: PropTypes.objectOf(PropTypes.string).isRequired,
        baseUrls: PropTypes.objectOf(PropTypes.string).isRequired,
        bridgeUrl: PropTypes.string.isRequired,
        modelId: PropTypes.string.isRequired,
        providerId: PropTypes.oneOf(Object.values(PROVIDER_IDS)).isRequired,
        maxToolRounds: PropTypes.number.isRequired,
        useBridge: PropTypes.bool.isRequired
    }).isRequired,
    connectionError: PropTypes.string,
    intl: intlShape.isRequired,
    isRtl: PropTypes.bool,
    models: PropTypes.arrayOf(PropTypes.shape({
        id: PropTypes.string.isRequired,
        label: PropTypes.string.isRequired,
        reasoning: PropTypes.bool
    })).isRequired,
    modelsLoading: PropTypes.bool.isRequired,
    onChangeConfig: PropTypes.func.isRequired,
    onRefreshModels: PropTypes.func.isRequired,
    onRequestClose: PropTypes.func.isRequired,
    onTestConnection: PropTypes.func.isRequired
};

export default injectIntl(AiSettingsModal);
