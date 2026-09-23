import PropTypes from 'prop-types';
import React, {forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState} from 'react';
import {defineMessages, useIntl} from 'react-intl';

import attachIcon from './icon--attach.svg';
import sendIcon from './icon--send.svg';

import styles from './composer.css';

/** Tallest the textarea grows before it starts scrolling, in pixels. */
const MAX_TEXTAREA_HEIGHT = 160;

const messages = defineMessages({
    abort: {
        id: 'gui.aiAssist.abort',
        defaultMessage: 'Stop generating',
        description: 'Label for the button that stops the assistant mid-reply'
    },
    attach: {
        id: 'gui.aiAssist.attach',
        defaultMessage: 'Attach a file',
        description: 'Label for the button that attaches a file to the message being written'
    },
    placeholder: {
        id: 'gui.aiAssist.placeholder',
        defaultMessage: 'Ask for a story…',
        description: 'Placeholder text in the AI assistant message box'
    },
    removeAttachment: {
        id: 'gui.aiAssist.removeAttachment',
        defaultMessage: 'Remove {name}',
        description: 'Label for the button that removes one attachment from the message being written'
    },
    send: {
        id: 'gui.aiAssist.send',
        defaultMessage: 'Send',
        description: 'Label for the button that sends a message to the AI assistant'
    }
});

const Composer = forwardRef((props, ref) => {
    const {onAbort, onAttachFiles, onSend, streaming = false} = props;
    const intl = useIntl();
    const [text, setText] = useState('');
    const [attachments, setAttachments] = useState([]);
    const fileInputRef = useRef(null);
    const textareaRef = useRef(null);

    useImperativeHandle(ref, () => ({
        focus: () => textareaRef.current.focus()
    }), []);

    useEffect(() => {
        const textarea = textareaRef.current;
        textarea.style.height = 'auto';
        textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
    }, [text]);

    const canSend = !streaming && (text.trim().length > 0 || attachments.length > 0);

    const handleChange = useCallback(event => {
        setText(event.target.value);
    }, []);

    const handleSend = useCallback(() => {
        if (!canSend) return;
        onSend(text.trim(), attachments);
        setText('');
        setAttachments([]);
    }, [attachments, canSend, onSend, text]);

    const handleKeyDown = useCallback(event => {
        if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
        event.preventDefault();
        handleSend();
    }, [handleSend]);

    const handleAttachClick = useCallback(() => {
        fileInputRef.current.click();
    }, []);

    const handleFilesChosen = useCallback(event => {
        const files = Array.from(event.target.files);
        // Clearing the input lets the same file be picked again straight away.
        event.target.value = '';
        if (files.length === 0) return;
        Promise.resolve(onAttachFiles(files)).then(chosen => {
            if (!Array.isArray(chosen)) {
                // eslint-disable-next-line no-console
                console.warn(
                    'Composer: onAttachFiles must resolve to an array of {name, mimeType, dataUrl}; ' +
                        'dropping the attachment',
                    chosen
                );
                return;
            }
            setAttachments(current => current.concat(chosen));
        });
    }, [onAttachFiles]);

    const handleRemoveAttachment = useCallback(event => {
        const {name} = event.currentTarget.dataset;
        setAttachments(current => current.filter(attachment => attachment.name !== name));
    }, []);

    return (
        <div className={styles.composer}>
            {attachments.length > 0 ? (
                <ul className={styles.attachments}>
                    {attachments.map(attachment => (
                        <li
                            className={styles.attachment}
                            key={attachment.name}
                        >
                            <span className={styles.attachmentName}>{attachment.name}</span>
                            <button
                                aria-label={intl.formatMessage(messages.removeAttachment, {name: attachment.name})}
                                className={styles.attachmentRemove}
                                data-name={attachment.name}
                                type="button"
                                onClick={handleRemoveAttachment}
                            >{'×'}</button>
                        </li>
                    ))}
                </ul>
            ) : null}

            <div className={styles.row}>
                <input
                    className={styles.fileInput}
                    multiple
                    ref={fileInputRef}
                    tabIndex={-1}
                    type="file"
                    onChange={handleFilesChosen}
                />
                <button
                    aria-label={intl.formatMessage(messages.attach)}
                    className={styles.iconButton}
                    title={intl.formatMessage(messages.attach)}
                    type="button"
                    onClick={handleAttachClick}
                >
                    <img
                        alt=""
                        className={styles.icon}
                        draggable={false}
                        src={attachIcon}
                    />
                </button>

                <textarea
                    className={styles.textarea}
                    placeholder={intl.formatMessage(messages.placeholder)}
                    ref={textareaRef}
                    rows={1}
                    value={text}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                />

                {streaming ? (
                    <button
                        aria-label={intl.formatMessage(messages.abort)}
                        className={styles.abortButton}
                        title={intl.formatMessage(messages.abort)}
                        type="button"
                        onClick={onAbort}
                    >
                        <span className={styles.abortGlyph} />
                    </button>
                ) : (
                    <button
                        aria-label={intl.formatMessage(messages.send)}
                        className={styles.sendButton}
                        disabled={!canSend}
                        title={intl.formatMessage(messages.send)}
                        type="button"
                        onClick={handleSend}
                    >
                        <img
                            alt=""
                            className={styles.icon}
                            draggable={false}
                            src={sendIcon}
                        />
                    </button>
                )}
            </div>
        </div>
    );
});

Composer.displayName = 'Composer';

Composer.propTypes = {
    onAbort: PropTypes.func.isRequired,
    /**
     * Called with the chosen `File` objects. Must resolve to an array of
     * `{name, mimeType, dataUrl}` describing the files; reading them is the
     * container's job so that this component stays free of side effects.
     */
    onAttachFiles: PropTypes.func.isRequired,
    onSend: PropTypes.func.isRequired,
    streaming: PropTypes.bool
};

export default Composer;
