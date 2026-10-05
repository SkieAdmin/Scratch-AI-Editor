/**
 * Find a costume, backdrop or sound by name or by index.
 *
 * Indexes count from 0, as list_costumes and list_sounds report them.
 * @param {Array<object>} items the target's costumes or sounds
 * @param {{name: (string|undefined), index: (number|undefined)}} choice which one, by exactly one of the two
 * @param {string} kind what the items are, for messages: "costume", "backdrop" or "sound"
 * @param {string} ownerName who they belong to, for messages
 * @returns {number} the item's index
 */
const findAssetIndex = (items, choice, kind, ownerName) => {
    const hasName = typeof choice.name !== 'undefined';
    const hasIndex = typeof choice.index !== 'undefined';
    if (hasName === hasIndex) {
        const problem = hasName ? 'not both' : 'and pass one of them';
        throw new Error(`Choose the ${kind} by "name" or by "index", ${problem}.`);
    }

    if (hasIndex) {
        if (!Number.isInteger(choice.index) || choice.index < 0 || choice.index >= items.length) {
            throw new Error(
                `"index" must be a whole number from 0 to ${items.length - 1}: ${ownerName} has ` +
                `${items.length} ${kind}${items.length === 1 ? '' : 's'}. Got ${JSON.stringify(choice.index)}.`
            );
        }
        return choice.index;
    }

    const index = items.findIndex(item => item.name === choice.name);
    if (index === -1) {
        throw new Error(
            `${ownerName} has no ${kind} named ${JSON.stringify(choice.name)}. Its ${kind}s are: ` +
            `${items.map(item => item.name).join(', ')}.`
        );
    }
    return index;
};

export {findAssetIndex};
