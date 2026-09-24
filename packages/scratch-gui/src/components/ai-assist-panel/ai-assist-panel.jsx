import classNames from 'classnames';
import PropTypes from 'prop-types';
import React, {useCallback, useEffect, useRef} from 'react';
import {defineMessages, FormattedMessage, useIntl} from 'react-intl';

import {BRIDGE_STATUS} from '../../lib/ai/constants';

import CollapsedTab from './collapsed-tab.jsx';
import Composer from './composer.jsx';
import MessageList from './message-list.jsx';
import {messageShape} from './message-bubble.jsx';

import aiIcon from './icon--ai.svg';

import styles from './ai-assist-panel.css';

const messages = defineMessages({
    newChat: {
        id: 'gui.aiAssist.newChat',
        defaultMessage: 'New chat',
        description: 'Label for the button that clears the conversation and starts a new one'
    },
    panel: {
        id: 'gui.aiAssist.panel',
        defaultMessage: 'AI-Assist panel',
        description: 'ARIA label for the AI assistant panel'
    },
    settings: {
        id: 'gui.aiAssist.settings',
        defaultMessage: 'Settings',
        description: 'Label for the button that opens the AI assistant settings'
    },
    statusConnected: {
        id: 'gui.aiAssist.statusConnected',
        defaultMessage: 'Connected to the bridge',
        description: 'Tooltip on the status dot when the editor is talking to the AI bridge'
    },
    statusConnecting: {
        id: 'gui.aiAssist.statusConnecting',
        defaultMessage: 'Connecting to the bridge…',
        description: 'Tooltip on the status dot while the editor is opening a connection to the AI bridge'
    },
    statusDisabled: {
        id: 'gui.aiAssist.statusDisabled',
        defaultMessage: 'Talking to the provider directly',
        description: 'Tooltip on the status dot when the bridge is switched off'
    },
    statusDisconnected: {
        id: 'gui.aiAssist.statusDisconnected',
        defaultMessage: 'Disconnected from the bridge',
        description: 'Tooltip on the status dot when the connection to the AI bridge has dropped'
    },
    statusError: {
        id: 'gui.aiAssist.statusError',
        defaultMessage: 'The bridge reported an error',
        description: 'Tooltip on the status dot when the AI bridge failed'
    }
});

const statusMessages = {
    [BRIDGE_STATUS.CONNECTED]: messages.statusConnected,
    [BRIDGE_STATUS.CONNECTING]: messages.statusConnecting,
    [BRIDGE_STATUS.DISABLED]: messages.statusDisabled,
    [BRIDGE_STATUS.DISCONNECTED]: messages.statusDisconnected,
    [BRIDGE_STATUS.ERROR]: messages.statusError
};

const statusDotClasses = {
    [BRIDGE_STATUS.CONNECTED]: styles.dotConnected,
    [BRIDGE_STATUS.CONNECTING]: styles.dotConnecting,
    [BRIDGE_STATUS.DISABLED]: styles.dotDisabled,
    [BRIDGE_STATUS.DISCONNECTED]: styles.dotDisconnected,
    [BRIDGE_STATUS.ERROR]: styles.dotError
};

const AiAssistPanel = props => {
    const {
        bridgeStatus,
        error,
        messages: chatMessages,
        modelIsReasoning,
        modelLabel,
        onAbort,
        onAttachFiles,
        onNewChat,
        onOpenSettings,
        onSend,
        onToggleVisible,
        providerLabel,
        streaming,
        visible
    } = props;
    const intl = useIntl();
    const composerRef = useRef(null);
    const tabRef = useRef(null);
    const wasVisibleRef = useRef(visible);

    // Move focus into the panel when it opens and back to the tab when it
    // closes, but leave focus alone on the first render.
    useEffect(() => {
        if (visible === wasVisibleRef.current) return;
        wasVisibleRef.current = visible;
        if (visible) composerRef.current.focus();
        else tabRef.current.focus();
    }, [visible]);

    const handleKeyDown = useCallback(event => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        onToggleVisible();
    }, [onToggleVisible]);

    return (
        <div className={styles.root}>
            <CollapsedTab
                expanded={visible}
                ref={tabRef}
                onClick={onToggleVisible}
            />

            <aside
                aria-label={intl.formatMessage(messages.panel)}
                className={classNames(styles.panel, {[styles.panelHidden]: !visible})}
                role="complementary"
                onKeyDown={handleKeyDown}
            >
                <header className={styles.header}>
                    <span
                        className={classNames(styles.statusDot, statusDotClasses[bridgeStatus])}
                        title={intl.formatMessage(statusMessages[bridgeStatus])}
                    />
                    <img
                        alt=""
                        className={styles.titleIcon}
                        draggable={false}
                        src={aiIcon}
                    />
                    <h2 className={styles.title}>
                        <FormattedMessage
                            defaultMessage="AI-Assist"
                            description="Name of the AI assistant, shown on the tab that opens its panel"
                            id="gui.aiAssist.name"
                        />
                    </h2>
                    <button
                        className={styles.headerButton}
                        type="button"
                        onClick={onNewChat}
                    >{intl.formatMessage(messages.newChat)}</button>
                    <button
                        className={styles.headerButton}
                        type="button"
                        onClick={onOpenSettings}
                    >{intl.formatMessage(messages.settings)}</button>
                </header>

                <p className={styles.providerLine}>
                    <span>{providerLabel}</span>
                    <span
                        aria-hidden="true"
                        className={styles.separator}
                    >{'·'}</span>
                    <span className={styles.modelLabel}>{modelLabel}</span>
                    {modelIsReasoning ? (
                        <React.Fragment>
                            <span
                                aria-hidden="true"
                                className={styles.separator}
                            >{'·'}</span>
                            <span>
                                <FormattedMessage
                                    defaultMessage="thinks first"
                                    description="Note that the selected model reasons before it answers"
                                    id="gui.aiAssist.thinksFirst"
                                />
                            </span>
                        </React.Fragment>
                    ) : null}
                </p>

                {error ? (
                    <div
                        className={styles.error}
                        role="alert"
                    >{error}</div>
                ) : null}

                <MessageList
                    messages={chatMessages}
                    streaming={streaming}
                />

                <Composer
                    ref={composerRef}
                    streaming={streaming}
                    onAbort={onAbort}
                    onAttachFiles={onAttachFiles}
                    onSend={onSend}
                />
            </aside>
        </div>
    );
};

AiAssistPanel.propTypes = {
    bridgeStatus: PropTypes.oneOf(Object.values(BRIDGE_STATUS)).isRequired,
    error: PropTypes.string,
    messages: PropTypes.arrayOf(messageShape).isRequired,
    modelIsReasoning: PropTypes.bool,
    modelLabel: PropTypes.string.isRequired,
    onAbort: PropTypes.func.isRequired,
    /**
     * Called with the chosen `File` objects. Must resolve to an array of
     * `{name, mimeType, dataUrl}`; reading the files belongs to the container.
     */
    onAttachFiles: PropTypes.func.isRequired,
    onNewChat: PropTypes.func.isRequired,
    onOpenSettings: PropTypes.func.isRequired,
    /** Called with the trimmed message text and the pending attachments. */
    onSend: PropTypes.func.isRequired,
    /** Called with no arguments to flip the panel between open and closed. */
    onToggleVisible: PropTypes.func.isRequired,
    providerLabel: PropTypes.string.isRequired,
    streaming: PropTypes.bool,
    visible: PropTypes.bool
};

AiAssistPanel.defaultProps = {
    error: null,
    modelIsReasoning: false,
    streaming: false,
    visible: false
};

export default AiAssistPanel;
