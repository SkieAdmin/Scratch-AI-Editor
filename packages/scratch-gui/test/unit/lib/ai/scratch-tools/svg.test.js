import {prepareSvg} from '../../../../../src/lib/ai/scratch-tools/svg';

const SVG_NS = 'xmlns="http://www.w3.org/2000/svg"';
const XLINK_NS = 'xmlns:xlink="http://www.w3.org/1999/xlink"';

const svg = (body, attributes = 'width="480" height="360"') => `<svg ${SVG_NS} ${XLINK_NS} ${attributes}>${body}</svg>`;

describe('prepareSvg', () => {
    test('passes a plain drawing through', () => {
        const prepared = prepareSvg(svg('<rect width="480" height="360" fill="#3a7d2c"/>'));

        expect(prepared).toContain('<rect');
        expect(prepared).toContain('#3a7d2c');
    });

    test('allows references within the drawing and embedded pictures', () => {
        expect(() => prepareSvg(svg(
            '<defs><linearGradient id="sky"><stop offset="0" stop-color="#9cf"/></linearGradient></defs>' +
            '<rect width="480" height="360" fill="url(#sky)"/>' +
            '<use href="#sky"/><image xlink:href="data:image/png;base64,iVBORw0KGgo=" width="1" height="1"/>'
        ))).not.toThrow();
    });

    test('accepts a viewBox in place of a width and height', () => {
        expect(() => prepareSvg(svg('<circle r="10"/>', 'viewBox="0 0 100 100"'))).not.toThrow();
    });

    test.each([
        ['a script', '<script>alert(1)</script>', /<script> element/],
        ['an event handler', '<rect width="10" height="10" onclick="alert(1)"/>', /event handler, onclick/],
        ['an outside link', '<image href="https://example.com/cat.png" width="10" height="10"/>', /link to https/],
        ['an outside xlink', '<use xlink:href="other.svg#shape"/>', /link to other\.svg/],
        ['an outside CSS url', '<rect width="10" height="10" style="fill: url(\'https://x.example/p\')"/>', /reference to https/],
        ['an imported style sheet', '<style>@import "https://x.example/a.css";</style>', /@import/],
        ['embedded HTML', '<foreignObject width="10" height="10"><div>hi</div></foreignObject>', /<foreignObject>/]
    ])('refuses %s, and says why', (label, body, reason) => {
        expect(() => prepareSvg(svg(body))).toThrow(reason);
    });

    test('refuses markup that is not well-formed', () => {
        expect(() => prepareSvg(`<svg ${SVG_NS} width="10" height="10"><rect>`)).toThrow(/not well-formed/);
    });

    test('refuses a document that is not an SVG', () => {
        expect(() => prepareSvg('<html><body/></html>')).toThrow(/must be <svg>/);
    });

    test('wants to know how big the drawing is', () => {
        expect(() => prepareSvg(svg('<circle r="10"/>', ''))).toThrow(/viewBox, or a width and a height/);
    });

    test('refuses nothing at all, and a drawing too large to be one', () => {
        expect(() => prepareSvg('')).toThrow(/"svg" must be/);
        expect(() => prepareSvg(svg(`<desc>${'x'.repeat(600 * 1024)}</desc>`))).toThrow(/keep it under/);
    });
});
