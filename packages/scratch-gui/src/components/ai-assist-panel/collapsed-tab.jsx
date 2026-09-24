import classNames from 'classnames';
import PropTypes from 'prop-types';
import React, {forwardRef} from 'react';
import {FormattedMessage} from 'react-intl';

import aiIcon from './icon--ai.svg';

import styles from './collapsed-tab.css';

const CollapsedTab = forwardRef((props, ref) => {
    const {expanded, onClick} = props;

    return (
        <button
            aria-expanded={expanded}
            className={classNames(styles.tab, {[styles.besidePanel]: expanded})}
            ref={ref}
            type="button"
            onClick={onClick}
        >
            <img
                alt=""
                className={styles.icon}
                draggable={false}
                src={aiIcon}
            />
            <span className={styles.label}>
                <FormattedMessage
                    defaultMessage="AI-Assist"
                    description="Name of the AI assistant, shown on the tab that opens its panel"
                    id="gui.aiAssist.name"
                />
            </span>
        </button>
    );
});

CollapsedTab.displayName = 'CollapsedTab';

CollapsedTab.propTypes = {
    expanded: PropTypes.bool.isRequired,
    onClick: PropTypes.func.isRequired
};

export default CollapsedTab;
