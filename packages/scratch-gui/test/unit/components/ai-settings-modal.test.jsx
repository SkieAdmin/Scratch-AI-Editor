import React from 'react';
import ReactModal from 'react-modal';
import {fireEvent} from '@testing-library/react';
import '@testing-library/jest-dom';

import {renderWithIntl} from '../../helpers/intl-helpers.jsx';
import AiSettingsModal from '../../../src/components/ai-settings-modal/ai-settings-modal.jsx';
import {BRIDGE_STATUS, DEFAULT_BASE_URLS, DEFAULT_BRIDGE_URL, PROVIDER_IDS} from '../../../src/lib/ai/constants';

describe('AiSettingsModal', () => {
    beforeAll(() => {
        const appRoot = document.createElement('div');
        document.body.appendChild(appRoot);
        ReactModal.setAppElement(appRoot);
    });

    const config = overrides => ({
        providerId: PROVIDER_IDS.OLLAMA,
        modelId: '',
        baseUrls: {...DEFAULT_BASE_URLS},
        bridgeUrl: DEFAULT_BRIDGE_URL,
        useBridge: false,
        panelWidth: 380,
        apiKeys: {},
        ...overrides
    });

    const getComponent = (configOverrides, propOverrides) => (
        <AiSettingsModal
            bridgeStatus={BRIDGE_STATUS.DISABLED}
            config={config(configOverrides)}
            models={[]}
            modelsLoading={false}
            onChangeConfig={jest.fn()}
            onRefreshModels={jest.fn()}
            onRequestClose={jest.fn()}
            onTestConnection={jest.fn()}
            {...propOverrides}
        />
    );

    test('offers a key field for DeepSeek and names the environment variable as the safer option', () => {
        const {getByLabelText, getByText} = renderWithIntl(getComponent({providerId: PROVIDER_IDS.DEEPSEEK}));

        expect(getByLabelText('DeepSeek API key')).toBeInTheDocument();
        expect(getByText('DEEPSEEK_API_KEY')).toBeInTheDocument();
    });

    test('masks the key until the user asks to see it', () => {
        const {getByLabelText, getByText} = renderWithIntl(getComponent({
            providerId: PROVIDER_IDS.DEEPSEEK,
            apiKeys: {[PROVIDER_IDS.DEEPSEEK]: 'sk-secret'}
        }));

        const field = getByLabelText('DeepSeek API key');
        expect(field).toHaveAttribute('type', 'password');

        fireEvent.click(getByText('Show'));
        expect(getByLabelText('DeepSeek API key')).toHaveAttribute('type', 'text');
    });

    test('reports a typed key to the container so it can be saved', () => {
        const onChangeConfig = jest.fn();
        const {getByLabelText} = renderWithIntl(getComponent(
            {providerId: PROVIDER_IDS.DEEPSEEK},
            {onChangeConfig}
        ));

        fireEvent.change(getByLabelText('DeepSeek API key'), {target: {value: 'sk-typed'}});

        expect(onChangeConfig).toHaveBeenCalledWith({
            apiKeys: {[PROVIDER_IDS.DEEPSEEK]: 'sk-typed'}
        });
    });

    test('clearing the key empties it rather than leaving the old one', () => {
        const onChangeConfig = jest.fn();
        const {getByText} = renderWithIntl(getComponent(
            {providerId: PROVIDER_IDS.DEEPSEEK, apiKeys: {[PROVIDER_IDS.DEEPSEEK]: 'sk-old'}},
            {onChangeConfig}
        ));

        fireEvent.click(getByText('Clear'));

        expect(onChangeConfig).toHaveBeenCalledWith({
            apiKeys: {[PROVIDER_IDS.DEEPSEEK]: ''}
        });
    });

    test('names the OpenRouter environment variable for OpenRouter', () => {
        const {getByText} = renderWithIntl(getComponent({providerId: PROVIDER_IDS.OPENROUTER}));

        expect(getByText('OPENROUTER_API_KEY')).toBeInTheDocument();
    });

    test('shows no API key section for a provider that runs on the user machine', () => {
        const {queryByText} = renderWithIntl(getComponent({providerId: PROVIDER_IDS.OLLAMA}));

        expect(queryByText('Ollama API key')).not.toBeInTheDocument();
        expect(queryByText('DEEPSEEK_API_KEY')).not.toBeInTheDocument();
        expect(queryByText('OPENROUTER_API_KEY')).not.toBeInTheDocument();
    });

    test('warns when a provider that needs a key has none', () => {
        const {getByRole} = renderWithIntl(getComponent({providerId: PROVIDER_IDS.DEEPSEEK}));

        expect(getByRole('alert')).toHaveTextContent(/needs a key/);
    });

    test('drops the warning once a key is set', () => {
        const {queryByRole} = renderWithIntl(getComponent({
            providerId: PROVIDER_IDS.DEEPSEEK,
            apiKeys: {[PROVIDER_IDS.DEEPSEEK]: 'sk-set'}
        }));

        expect(queryByRole('alert')).not.toBeInTheDocument();
    });

    test('marks a reasoning model in the model list', () => {
        const models = [
            {id: 'deepseek-chat', label: 'DeepSeek Chat', reasoning: false},
            {id: 'deepseek-reasoner', label: 'DeepSeek Reasoner', reasoning: true}
        ];
        const {getByText} = renderWithIntl(getComponent(
            {providerId: PROVIDER_IDS.DEEPSEEK, useBridge: true},
            {models}
        ));

        expect(getByText('DeepSeek Chat')).toBeInTheDocument();
        expect(getByText(/DeepSeek Reasoner .* thinks first/)).toBeInTheDocument();
    });

    test('reports the selected provider change', () => {
        const onChangeConfig = jest.fn();
        const {getByLabelText} = renderWithIntl(getComponent({}, {onChangeConfig}));

        fireEvent.click(getByLabelText('DeepSeek'));

        expect(onChangeConfig).toHaveBeenCalledWith({providerId: PROVIDER_IDS.DEEPSEEK});
    });

    test('reports the bridge status', () => {
        const {getByText} = renderWithIntl(getComponent({useBridge: true}, {
            bridgeStatus: BRIDGE_STATUS.ERROR,
            connectionError: 'ECONNREFUSED'
        }));

        expect(getByText('Connection failed')).toBeInTheDocument();
        expect(getByText('ECONNREFUSED')).toBeInTheDocument();
    });
});
