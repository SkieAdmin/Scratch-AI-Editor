import React from 'react';
import {fireEvent} from '@testing-library/react';
import '@testing-library/jest-dom';
import {renderWithIntl} from '../../helpers/intl-helpers.jsx';
import {BRIDGE_STATUS} from '../../../src/lib/ai/constants';
import AiAssistPanel from '../../../src/components/ai-assist-panel/ai-assist-panel.jsx';

describe('AiAssistPanel component', () => {
    const defaultProps = () => ({
        bridgeStatus: BRIDGE_STATUS.DISABLED,
        error: null,
        messages: [],
        modelIsReasoning: true,
        modelLabel: 'deepseek-reasoner',
        onAbort: jest.fn(),
        onAttachFiles: jest.fn(),
        onNewChat: jest.fn(),
        onOpenSettings: jest.fn(),
        onSend: jest.fn(),
        onToggleVisible: jest.fn(),
        onWidthChange: jest.fn(),
        providerLabel: 'DeepSeek',
        streaming: false,
        visible: true,
        width: 380
    });

    const assistantMessage = overrides => ({
        content: 'Here is an idea.',
        createdAt: 0,
        id: 'm1',
        role: 'assistant',
        ...overrides
    });

    test('the collapsed tab toggles the panel and reports its state', () => {
        const props = defaultProps();
        props.visible = false;
        const {getByRole} = renderWithIntl(<AiAssistPanel {...props} />);

        const tab = getByRole('button', {name: 'AI-Assist'});
        expect(tab).toHaveAttribute('aria-expanded', 'false');

        fireEvent.click(tab);
        expect(props.onToggleVisible).toHaveBeenCalledTimes(1);
    });

    test('the tab reports the panel as expanded while it is open', () => {
        const {getByRole} = renderWithIntl(<AiAssistPanel {...defaultProps()} />);

        expect(getByRole('button', {name: 'AI-Assist'})).toHaveAttribute('aria-expanded', 'true');
    });

    test('Enter sends the message and Shift+Enter does not', () => {
        const props = defaultProps();
        const {getByPlaceholderText} = renderWithIntl(<AiAssistPanel {...props} />);

        const textarea = getByPlaceholderText('Ask for a story…');
        fireEvent.change(textarea, {target: {value: 'make a cat jump'}});

        fireEvent.keyDown(textarea, {key: 'Enter', shiftKey: true});
        expect(props.onSend).not.toHaveBeenCalled();

        fireEvent.keyDown(textarea, {key: 'Enter'});
        expect(props.onSend).toHaveBeenCalledWith('make a cat jump', []);
    });

    test('sending is unavailable while streaming', () => {
        const props = defaultProps();
        props.streaming = true;
        const {getByPlaceholderText, getByRole, queryByRole} = renderWithIntl(<AiAssistPanel {...props} />);

        expect(queryByRole('button', {name: 'Send'})).toBeNull();
        expect(getByRole('button', {name: 'Stop generating'})).toBeInTheDocument();

        const textarea = getByPlaceholderText('Ask for a story…');
        fireEvent.change(textarea, {target: {value: 'make a cat jump'}});
        fireEvent.keyDown(textarea, {key: 'Enter'});
        expect(props.onSend).not.toHaveBeenCalled();
    });

    test('the send button is disabled until there is something to send', () => {
        const props = defaultProps();
        const {getByPlaceholderText, getByRole} = renderWithIntl(<AiAssistPanel {...props} />);

        expect(getByRole('button', {name: 'Send'})).toBeDisabled();

        fireEvent.change(getByPlaceholderText('Ask for a story…'), {target: {value: 'hello'}});
        expect(getByRole('button', {name: 'Send'})).toBeEnabled();
    });

    test('a tool call renders its name and duration', () => {
        const props = defaultProps();
        props.messages = [assistantMessage({
            toolCalls: [{durationMs: 18, id: 't1', name: 'run_project', status: 'done'}]
        })];
        const {getByText} = renderWithIntl(<AiAssistPanel {...props} />);

        expect(getByText('run_project')).toBeInTheDocument();
        expect(getByText('18ms')).toBeInTheDocument();
    });

    test('the reasoning section expands when its toggle is clicked', () => {
        const props = defaultProps();
        props.messages = [assistantMessage({reasoning: 'First I check the sprites.'})];
        const {getByRole, queryByText} = renderWithIntl(<AiAssistPanel {...props} />);

        const toggle = getByRole('button', {name: 'Reasoning'});
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(queryByText('First I check the sprites.')).toBeNull();

        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(queryByText('First I check the sprites.')).toBeInTheDocument();
    });

    test('the provider line names the provider, the model and whether it reasons', () => {
        const {getByText} = renderWithIntl(<AiAssistPanel {...defaultProps()} />);

        expect(getByText('DeepSeek')).toBeInTheDocument();
        expect(getByText('deepseek-reasoner')).toBeInTheDocument();
        expect(getByText('thinks first')).toBeInTheDocument();
    });

    test('Escape closes the panel', () => {
        const props = defaultProps();
        const {getByRole} = renderWithIntl(<AiAssistPanel {...props} />);

        fireEvent.keyDown(getByRole('complementary'), {key: 'Escape'});
        expect(props.onToggleVisible).toHaveBeenCalledTimes(1);
    });
});
