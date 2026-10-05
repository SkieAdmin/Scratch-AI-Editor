import {sanitizeSvg} from '@scratch/scratch-svg-renderer';

/** The largest SVG accepted: far more than a drawing needs, and small enough to stay quick. */
const MAX_SVG_LENGTH = 512 * 1024;

/** Elements that run code or pull in other documents, which a costume has no use for. */
const FORBIDDEN_ELEMENTS = ['script', 'foreignObject', 'iframe', 'embed', 'object'];

/** A CSS `url(...)` reference, capturing what it points at. */
const CSS_URL = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;

const isInternalReference = target => target.trim().startsWith('#');

/** An embedded picture, which an <image> may carry inline. */
const isEmbeddedImage = target => /^data:image\//i.test(target.trim());

/**
 * Find what an SVG refers to outside itself through CSS `url()` or `@import`.
 * @param {string} css a style attribute, a presentation attribute or a style sheet
 * @returns {Array<string>} the outside references
 */
const externalCssReferences = css => {
    const found = Array.from(css.matchAll(CSS_URL), match => match[2])
        .filter(target => !isInternalReference(target));
    return /@import/i.test(css) ? found.concat(['@import']) : found;
};

/**
 * Describe everything in an SVG that a costume must not contain.
 * @param {Element} root the parsed <svg> element
 * @returns {Array<string>} one line per problem, empty when there are none
 */
const findProblems = root => {
    const problems = [];
    [root, ...root.getElementsByTagName('*')].forEach(element => {
        if (FORBIDDEN_ELEMENTS.includes(element.localName)) {
            problems.push(`a <${element.localName}> element`);
            return;
        }
        Array.from(element.attributes).forEach(attribute => {
            const {name, value} = attribute;
            if (name.toLowerCase().startsWith('on')) {
                problems.push(`an event handler, ${name}`);
            } else if (attribute.localName === 'href') {
                if (!isInternalReference(value) && !isEmbeddedImage(value)) problems.push(`a link to ${value}`);
            } else {
                externalCssReferences(value).forEach(target => problems.push(`a reference to ${target}`));
            }
        });
        if (element.localName === 'style') {
            externalCssReferences(element.textContent).forEach(target => problems.push(`a reference to ${target}`));
        }
    });
    return problems;
};

/**
 * Check an SVG an assistant drew, then clean it as the editor cleans an
 * uploaded costume.
 *
 * What a costume must not contain is refused with the reason rather than
 * quietly removed, so the model can draw it again without it. The editor's
 * own sanitizer then runs as well, for anything subtler.
 * @param {*} svg the SVG markup
 * @returns {string} the SVG to store
 */
const prepareSvg = svg => {
    if (typeof svg !== 'string' || svg.trim() === '') {
        throw new Error('"svg" must be the SVG markup, as a string.');
    }
    if (svg.length > MAX_SVG_LENGTH) {
        throw new Error(`The SVG is ${svg.length} characters long; keep it under ${MAX_SVG_LENGTH}.`);
    }

    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const parseError = parsed.getElementsByTagName('parsererror')[0];
    if (parseError) {
        throw new Error(`The SVG is not well-formed XML: ${parseError.textContent.trim().split('\n')[0]}`);
    }
    const root = parsed.documentElement;
    if (root.localName !== 'svg') {
        throw new Error(`The SVG's outermost element must be <svg>, not <${root.localName}>.`);
    }

    const problems = findProblems(root);
    if (problems.length > 0) {
        throw new Error(
            `The SVG contains ${problems.join('; ')}. A costume cannot run code or load anything from ` +
            'outside the SVG, so draw everything inside it.'
        );
    }
    if (!root.hasAttribute('viewBox') && !(root.hasAttribute('width') && root.hasAttribute('height'))) {
        throw new Error('Give the <svg> a viewBox, or a width and a height, so the editor knows how big the ' +
            'drawing is.');
    }

    return sanitizeSvg.sanitizeSvgText(svg);
};

export {prepareSvg};
