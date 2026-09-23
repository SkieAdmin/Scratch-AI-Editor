import React from 'react';
import styles from './menu-bar.css';
import classNames from 'classnames';
import PropTypes from 'prop-types';
import {connect} from 'react-redux';

import aiIcon from './icon--ai.svg';
import {useIntl, FormattedMessage, defineMessage} from 'react-intl';
import MenuBarMenu from './menu-bar-menu.jsx';
import {MenuItem, MenuSection} from '../menu/menu.jsx';
import useMenuNavigation from '../../hooks/use-menu-navigation';
import dropdownCaret from './dropdown-caret.svg';
import {setAiPanelVisible} from '../../reducers/ai-assist';
import {openAiAboutModal, openAiSettingsModal} from '../../reducers/modals';

const aiMenuAriaMessage = defineMessage({
    id: 'gui.aria.aiMenu',
    defaultMessage: 'AI menu',
    description: 'accessibility label for the AI menu'
});

const AiMenu = ({
    depth,
    isRtl,
    panelVisible,
    onOpenAbout,
    onOpenSettings,
    onTogglePanel
}) => {
    const intl = useIntl();

    const {
        menuRef,
        isExpanded,
        handleKeyDown,
        handleKeyDownOpenMenu,
        handleOnOpen,
        handleOnClose
    } = useMenuNavigation({
        depth,
        isRtl
    });

    const withClose = callback => () => {
        callback();
        handleOnClose();
    };

    return (
        <button
            className={classNames(styles.menuBarItem, styles.hoverable, {
                [styles.active]: isExpanded()
            })}
            onClick={handleOnOpen}
            aria-label={intl.formatMessage(aiMenuAriaMessage)}
            aria-expanded={isExpanded()}
            onKeyDown={handleKeyDown}
            ref={menuRef}
        >
            <img src={aiIcon} />
            <span className={styles.collapsibleLabel}>
                <FormattedMessage
                    defaultMessage="AI"
                    description="Text for the AI dropdown menu in the menu bar"
                    id="gui.menuBar.ai"
                />
            </span>
            <img src={dropdownCaret} />
            <MenuBarMenu
                className={classNames(styles.menuBarMenu)}
                open={isExpanded()}
                place={isRtl ? 'left' : 'right'}
                onRequestClose={handleOnClose}
            >
                <MenuItem
                    onClick={withClose(() => onTogglePanel(!panelVisible))}
                    onParentKeyDown={handleKeyDownOpenMenu}
                    isDataMenuItem
                >
                    {panelVisible ? (
                        <FormattedMessage
                            defaultMessage="Hide AI-Assist"
                            description="Menu bar item for hiding the AI assistant panel"
                            id="gui.menuBar.hideAiAssist"
                        />
                    ) : (
                        <FormattedMessage
                            defaultMessage="Show AI-Assist"
                            description="Menu bar item for showing the AI assistant panel"
                            id="gui.menuBar.showAiAssist"
                        />
                    )}
                </MenuItem>
                <MenuItem
                    onClick={withClose(onOpenSettings)}
                    onParentKeyDown={handleKeyDownOpenMenu}
                    isDataMenuItem
                >
                    <FormattedMessage
                        defaultMessage="AI Settings"
                        description="Menu bar item that opens the AI assistant settings"
                        id="gui.menuBar.aiSettings"
                    />
                </MenuItem>
                <MenuSection>
                    <MenuItem
                        onClick={withClose(onOpenAbout)}
                        onParentKeyDown={handleKeyDownOpenMenu}
                        isDataMenuItem
                    >
                        <FormattedMessage
                            defaultMessage="About"
                            description="Menu bar item that opens the About dialog"
                            id="gui.menuBar.aiAbout"
                        />
                    </MenuItem>
                </MenuSection>
            </MenuBarMenu>
        </button>
    );
};

AiMenu.propTypes = {
    depth: PropTypes.number,
    isRtl: PropTypes.bool,
    onOpenAbout: PropTypes.func.isRequired,
    onOpenSettings: PropTypes.func.isRequired,
    onTogglePanel: PropTypes.func.isRequired,
    panelVisible: PropTypes.bool
};

const mapStateToProps = state => ({
    isRtl: state.locales.isRtl,
    panelVisible: state.scratchGui.aiAssist.visible
});

const mapDispatchToProps = dispatch => ({
    onOpenAbout: () => dispatch(openAiAboutModal()),
    onOpenSettings: () => dispatch(openAiSettingsModal()),
    onTogglePanel: visible => dispatch(setAiPanelVisible(visible))
});

export default connect(mapStateToProps, mapDispatchToProps)(AiMenu);
