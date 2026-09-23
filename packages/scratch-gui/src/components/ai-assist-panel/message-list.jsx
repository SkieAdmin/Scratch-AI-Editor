import PropTypes from 'prop-types';
import React, {useCallback, useEffect, useRef} from 'react';
import {defineMessage, FormattedMessage, useIntl} from 'react-intl';

import MessageBubble, {messageShape} from './message-bubble.jsx';

import styles from './message-list.css';

/**
 * How close to the bottom, in pixels, still counts as "following the
 * conversation". Anything further up means the reader is looking at older
 * messages and must not be yanked back down.
 */
const FOLLOW_THRESHOLD = 32;

const listLabel = defineMessage({
    id: 'gui.aiAssist.conversation',
    defaultMessage: 'Conversation',
    description: 'ARIA label for the list of messages exchanged with the AI assistant'
});

const MessageList = props => {
    const {messages, streaming} = props;
    const intl = useIntl();
    const listRef = useRef(null);
    const followingRef = useRef(true);

    const handleScroll = useCallback(() => {
        const list = listRef.current;
        const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
        followingRef.current = distanceFromBottom <= FOLLOW_THRESHOLD;
    }, []);

    // Runs after every render because streamed tokens grow the last bubble
    // without changing the message count.
    useEffect(() => {
        if (!followingRef.current) return;
        const list = listRef.current;
        list.scrollTop = list.scrollHeight;
    });

    const lastIndex = messages.length - 1;

    return (
        <ol
            aria-label={intl.formatMessage(listLabel)}
            aria-live="polite"
            className={styles.list}
            ref={listRef}
            role="log"
            onScroll={handleScroll}
        >
            {messages.length === 0 ? (
                <li className={styles.empty}>
                    <FormattedMessage
                        defaultMessage="Ask for a story, a game idea, or help with the blocks you already have."
                        description="Placeholder shown in the AI assistant panel before the first message"
                        id="gui.aiAssist.emptyState"
                    />
                </li>
            ) : messages.map((message, index) => (
                <MessageBubble
                    isStreaming={streaming && index === lastIndex && message.role === 'assistant'}
                    key={message.id}
                    message={message}
                />
            ))}
        </ol>
    );
};

MessageList.propTypes = {
    messages: PropTypes.arrayOf(messageShape).isRequired,
    streaming: PropTypes.bool
};

MessageList.defaultProps = {
    streaming: false
};

export default MessageList;
