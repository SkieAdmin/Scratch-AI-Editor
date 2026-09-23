import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';
import {defineMessages, useIntl} from 'react-intl';

import styles from './tool-call-row.css';

const TOOL_CALL_STATUS = ['running', 'done', 'error'];

const messages = defineMessages({
    running: {
        id: 'gui.aiAssist.toolRunning',
        defaultMessage: 'Running',
        description: 'Status label for a tool the assistant is still running'
    },
    done: {
        id: 'gui.aiAssist.toolDone',
        defaultMessage: 'Finished',
        description: 'Status label for a tool the assistant finished running'
    },
    error: {
        id: 'gui.aiAssist.toolError',
        defaultMessage: 'Failed',
        description: 'Status label for a tool the assistant failed to run'
    }
});

const ToolCallRow = props => {
    const {durationMs, error, name, status} = props;
    const intl = useIntl();

    return (
        <li className={styles.row}>
            <span
                className={classNames(styles.dot, styles[status])}
                title={intl.formatMessage(messages[status])}
            />
            <span className={styles.name}>{name}</span>
            {typeof durationMs === 'number' ? (
                <span className={styles.duration}>{`${Math.round(durationMs)}ms`}</span>
            ) : null}
            {error ? (
                <span className={styles.errorText}>{error}</span>
            ) : null}
        </li>
    );
};

ToolCallRow.propTypes = {
    durationMs: PropTypes.number,
    error: PropTypes.string,
    name: PropTypes.string.isRequired,
    status: PropTypes.oneOf(TOOL_CALL_STATUS).isRequired
};

export {
    ToolCallRow as default,
    TOOL_CALL_STATUS
};
