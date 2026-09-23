import classNames from 'classnames';
import PropTypes from 'prop-types';
import React, {useCallback, useEffect, useRef} from 'react';
import {defineMessages, FormattedMessage, useIntl} from 'react-intl';

import {BRIDGE_STATUS, PANEL_MAX_WIDTH, PANEL_MIN_WIDTH} from '../../lib/ai/constants';

import CollapsedTab from './collapsed-tab.jsx';
import Composer from './composer.jsx';
import MessageList from './message-list.jsx';
import {messageShape} from './message-bubble.jsx';

import aiIcon from './icon--ai.svg';

import styles from './ai-assist-panel.css';

/** How much one arrow-key press changes the panel width, in pixels. */
const KEYBOARD_RESIZE_STEP = 16;

const messages = defineMessages({
    close: {
        id: 'gui.aiAssist.close',
        defaultMessage: 'Close AI-Assist',
        description: 'Label for the button that hides the AI assistant panel'
    },
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
    resize: {
        id: 'gui.aiAssist.resize',
        defaultMessage: 'Resize the AI-Assist panel',
        description: 'ARIA label for the handle that changes the width of the AI assistant panel'
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

const clamp = width => Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, width));

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
        onWidthChange,
        providerLabel,
        streaming,
        visible,
        width
    } = props;
    const intl = useIntl();
    const composerRef = useRef(null);
    const dragRef = useRef(null);
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

    const handlePointerDown = useCallback(event => {
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = {
            isRtl: getComputedStyle(event.currentTarget).direction === 'rtl',
            startWidth: width,
            startX: event.clientX
        };
    }, [width]);

    const handlePointerMove = useCallback(event => {
        const drag = dragRef.current;
        if (!drag) return;
        // Dragging the handle away from the panel's edge widens the panel, which
        // is leftwards in LTR and rightwards in RTL.
        const delta = drag.isRtl ? event.clientX - drag.startX : drag.startX - event.clientX;
        onWidthChange(clamp(drag.startWidth + delta));
    }, [onWidthChange]);

    const handlePointerUp = useCallback(event => {
        event.currentTarget.releasePointerCapture(event.pointerId);
        dragRef.current = null;
    }, []);

    const handleResizeKeyDown = useCallback(event => {
        const isRtl = getComputedStyle(event.currentTarget).direction === 'rtl';
        let step = 0;
        if (event.key === 'ArrowLeft') step = isRtl ? -KEYBOARD_RESIZE_STEP : KEYBOARD_RESIZE_STEP;
        else if (event.key === 'ArrowRight') step = isRtl ? KEYBOARD_RESIZE_STEP : -KEYBOARD_RESIZE_STEP;
        else return;
        event.preventDefault();
        onWidthChange(clamp(width + step));
    }, [onWidthChange, width]);

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
                style={{width: `${width}px`}}
                onKeyDown={handleKeyDown}
            >
                <div
                    aria-label={intl.formatMessage(messages.resize)}
                    aria-orientation="vertical"
                    aria-valuemax={PANEL_MAX_WIDTH}
                    aria-valuemin={PANEL_MIN_WIDTH}
                    aria-valuenow={width}
                    className={styles.resizeHandle}
                    role="separator"
                    tabIndex={0}
                    onKeyDown={handleResizeKeyDown}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                />

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
                    <button
                        aria-label={intl.formatMessage(messages.close)}
                        className={styles.closeButton}
                        title={intl.formatMessage(messages.close)}
                        type="button"
                        onClick={onToggleVisible}
                    >{'×'}</button>
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
    /** Called with the new width in pixels, repeatedly while the handle is dragged. */
    onWidthChange: PropTypes.func.isRequired,
    providerLabel: PropTypes.string.isRequired,
    streaming: PropTypes.bool,
    visible: PropTypes.bool,
    width: PropTypes.number.isRequired
};

AiAssistPanel.defaultProps = {
    error: null,
    modelIsReasoning: false,
    streaming: false,
    visible: false
};

export default AiAssistPanel;
