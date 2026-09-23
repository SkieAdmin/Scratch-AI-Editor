import React from 'react';
import ReactModal from 'react-modal';
import {fireEvent} from '@testing-library/react';
import '@testing-library/jest-dom';

import {renderWithIntl} from '../../helpers/intl-helpers.jsx';
import AiAboutModal from '../../../src/components/ai-about-modal/ai-about-modal.jsx';

describe('AiAboutModal', () => {
    beforeAll(() => {
        const appRoot = document.createElement('div');
        document.body.appendChild(appRoot);
        ReactModal.setAppElement(appRoot);
    });

    const getComponent = () => (
        <AiAboutModal
            onRequestClose={jest.fn()}
        />
    );

    test('credits SkieAdmin with a link that opens safely in a new tab', () => {
        const {getByText} = renderWithIntl(getComponent());

        const link = getByText('SkieAdmin');
        expect(link.tagName).toBe('A');
        expect(link).toHaveAttribute('href', 'https://github.com/SkieAdmin');
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    test('credits the Scratch Foundation with a link to the upstream editor', () => {
        const {getByText} = renderWithIntl(getComponent());

        const link = getByText('Scratch Foundation');
        expect(link.tagName).toBe('A');
        expect(link).toHaveAttribute('href', 'https://github.com/scratchfoundation/scratch-editor');
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    test('states that this is an unaffiliated modified version', () => {
        const {getByText} = renderWithIntl(getComponent());

        expect(getByText(/modified version of the Scratch editor/)).toBeInTheDocument();
        expect(getByText(/not affiliated with, endorsed by, or sponsored by the Scratch Foundation/))
            .toBeInTheDocument();
    });

    test('names the licence and links to both the licence text and the modified source', () => {
        const {getByText} = renderWithIntl(getComponent());

        const licenseLink = getByText('GNU Affero General Public License version 3');
        expect(licenseLink).toHaveAttribute('href', 'https://www.gnu.org/licenses/agpl-3.0.html');

        const sourceLink = getByText('source of this modified editor');
        expect(sourceLink).toHaveAttribute('href', 'https://github.com/SkieAdmin/scratch-editor');
        expect(sourceLink).toHaveAttribute('rel', 'noopener noreferrer');
    });

    test('closes when the OK button is clicked', () => {
        const onRequestClose = jest.fn();
        const {getByText} = renderWithIntl(
            <AiAboutModal onRequestClose={onRequestClose} />
        );

        fireEvent.click(getByText('OK'));

        expect(onRequestClose).toHaveBeenCalled();
    });
});
