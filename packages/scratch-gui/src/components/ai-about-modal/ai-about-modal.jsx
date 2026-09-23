import PropTypes from 'prop-types';
import React from 'react';
import {defineMessages, injectIntl, FormattedMessage} from 'react-intl';

import Box from '../box/box.jsx';
import Button from '../button/button.jsx';
import Modal from '../modal/modal.jsx';
import intlShape from '../../lib/intlShape.js';

import styles from './ai-about-modal.css';

/**
 * Where the source of this modified editor is published. AGPL-3.0 section 13
 * entitles anyone who interacts with the editor over a network to the
 * corresponding source, so this link is always visible.
 */
const SOURCE_URL = 'https://github.com/SkieAdmin/scratch-editor';

/** The unmodified editor this one is derived from. */
const UPSTREAM_URL = 'https://github.com/scratchfoundation/scratch-editor';

const SKIE_ADMIN_URL = 'https://github.com/SkieAdmin';

/** Canonical text of the licence this editor is distributed under. */
const LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';

/** Supplied by webpack's DefinePlugin from the package version. */
const APP_VERSION = process.env.APP_VERSION;

const messages = defineMessages({
    title: {
        defaultMessage: 'About this AI editor',
        description: 'Title of the modal describing the AI editor, its credits and its licence',
        id: 'gui.aiAbout.title'
    },
    intro: {
        defaultMessage: 'An AI assistant built into the Scratch editor, so you can ask for help while you build.',
        description: 'One line summary of what the AI editor is, shown at the top of the About modal',
        id: 'gui.aiAbout.intro'
    },
    creditsHeading: {
        defaultMessage: 'Credits',
        description: 'Heading above the list of people and organizations credited in the About modal',
        id: 'gui.aiAbout.creditsHeading'
    },
    skieAdminRole: {
        defaultMessage: 'AI and MCP integrator',
        description: 'Role credited to SkieAdmin in the About modal',
        id: 'gui.aiAbout.skieAdminRole'
    },
    scratchFoundationRole: {
        defaultMessage: 'The Scratch editor this one is built on',
        description: 'Role credited to the Scratch Foundation in the About modal',
        id: 'gui.aiAbout.scratchFoundationRole'
    },
    attributionHeading: {
        defaultMessage: 'Licence and attribution',
        description: 'Heading above the licence and trademark notices in the About modal',
        id: 'gui.aiAbout.attributionHeading'
    },
    modifiedVersion: {
        defaultMessage: 'This is a modified version of the Scratch editor. It is not affiliated with, endorsed ' +
            'by, or sponsored by the Scratch Foundation.',
        description: 'Notice stating that this editor is an unofficial modification of the Scratch editor',
        id: 'gui.aiAbout.modifiedVersion'
    },
    trademark: {
        defaultMessage: 'Scratch and the Scratch marks are the property of the Scratch Foundation, and are used ' +
            'here only to say what this software is derived from.',
        description: 'Notice about the Scratch Foundation trademarks in the About modal',
        id: 'gui.aiAbout.trademark'
    },
    licenseNotice: {
        defaultMessage: 'This editor is free software, licensed under the <license>{licenseName}</license>.',
        description: 'Notice naming the licence this editor is distributed under, with a link to the licence text',
        id: 'gui.aiAbout.licenseNotice'
    },
    licenseName: {
        defaultMessage: 'GNU Affero General Public License version 3',
        description: 'Name of the licence this editor is distributed under',
        id: 'gui.aiAbout.licenseName'
    },
    sourceNotice: {
        defaultMessage: 'That licence also covers use over a network, so the complete source code of this ' +
            'modified version is always available: <source>{sourceLinkText}</source>. The unmodified editor it ' +
            'is based on is at <upstream>{upstreamLinkText}</upstream>.',
        description: 'Notice telling the user where to get the source code of this modified editor',
        id: 'gui.aiAbout.sourceNotice'
    },
    sourceLinkText: {
        defaultMessage: 'source of this modified editor',
        description: 'Text of the link to the source code of this modified editor',
        id: 'gui.aiAbout.sourceLinkText'
    },
    upstreamLinkText: {
        defaultMessage: 'scratchfoundation/scratch-editor',
        description: 'Text of the link to the upstream Scratch editor source code',
        id: 'gui.aiAbout.upstreamLinkText'
    },
    version: {
        defaultMessage: 'Version {version}',
        description: 'Version number of the editor, shown at the bottom of the About modal',
        id: 'gui.aiAbout.version'
    },
    closeButton: {
        defaultMessage: 'OK',
        description: 'Text of the button that closes the About modal',
        id: 'gui.aiAbout.closeButton'
    }
});

// This builds a rich-text chunk renderer for react-intl, not a component,
// so it has no display name to give.
// eslint-disable-next-line react/display-name
const externalLink = (href, key) => chunks => (
    <a
        className={styles.link}
        href={href}
        key={key}
        rel="noopener noreferrer"
        target="_blank"
    >
        {chunks}
    </a>
);

const AiAboutModal = props => (
    <Modal
        className={styles.modalContent}
        contentLabel={props.intl.formatMessage(messages.title)}
        isRtl={props.isRtl}
        onRequestClose={props.onRequestClose}
    >
        <Box className={styles.body}>
            <p className={styles.intro}>
                <FormattedMessage {...messages.intro} />
            </p>

            <h2 className={styles.heading}>
                <FormattedMessage {...messages.creditsHeading} />
            </h2>
            <ul className={styles.credits}>
                <li className={styles.credit}>
                    <a
                        className={styles.creditLink}
                        href={SKIE_ADMIN_URL}
                        rel="noopener noreferrer"
                        target="_blank"
                    >
                        {'SkieAdmin'}
                    </a>
                    <span className={styles.creditRole}>
                        <FormattedMessage {...messages.skieAdminRole} />
                    </span>
                </li>
                <li className={styles.credit}>
                    <a
                        className={styles.creditLink}
                        href={UPSTREAM_URL}
                        rel="noopener noreferrer"
                        target="_blank"
                    >
                        {'Scratch Foundation'}
                    </a>
                    <span className={styles.creditRole}>
                        <FormattedMessage {...messages.scratchFoundationRole} />
                    </span>
                </li>
            </ul>

            <h2 className={styles.heading}>
                <FormattedMessage {...messages.attributionHeading} />
            </h2>
            <div className={styles.notice}>
                <p><FormattedMessage {...messages.modifiedVersion} /></p>
                <p><FormattedMessage {...messages.trademark} /></p>
                <p>
                    <FormattedMessage
                        {...messages.licenseNotice}
                        values={{
                            license: externalLink(LICENSE_URL, 'license'),
                            licenseName: props.intl.formatMessage(messages.licenseName)
                        }}
                    />
                </p>
                <p>
                    <FormattedMessage
                        {...messages.sourceNotice}
                        values={{
                            source: externalLink(SOURCE_URL, 'source'),
                            sourceLinkText: props.intl.formatMessage(messages.sourceLinkText),
                            upstream: externalLink(UPSTREAM_URL, 'upstream'),
                            upstreamLinkText: props.intl.formatMessage(messages.upstreamLinkText)
                        }}
                    />
                </p>
            </div>

            <Box className={styles.footer}>
                {APP_VERSION ? (
                    <span className={styles.version}>
                        <FormattedMessage
                            {...messages.version}
                            values={{version: APP_VERSION}}
                        />
                    </span>
                ) : null}
                <Button
                    className={styles.closeButton}
                    onClick={props.onRequestClose}
                >
                    <FormattedMessage {...messages.closeButton} />
                </Button>
            </Box>
        </Box>
    </Modal>
);

AiAboutModal.propTypes = {
    intl: intlShape.isRequired,
    isRtl: PropTypes.bool,
    onRequestClose: PropTypes.func.isRequired
};

export default injectIntl(AiAboutModal);
