'use strict';

const escapeRegExp = require('./escapeRegExp');
const maskPattern = '(9*)(0+)|(9+)(0*)';

/**
 * Check if a mask is valid. We only support numeric mask placeholders (9, 0). The string must not contain š (it's a special symbol used in the code).
 * 9 - optional digit placeholder
 * 0 - digit placeholder
 * @param mask
 * @return {boolean}
 */
function maskIsValid(mask) {
  const maskRegExp = /^(?:(?!š).)*(?:9*0+|9+0*)[^š]*$/;
  return maskRegExp.test(mask);
}

/**
 * Get mask placeholders
 * @param mask
 * @return {Array}
 */
function getMaskPlaceholders(mask) {
  const placeholders = [];
  const maskRegExp = new RegExp(maskPattern, 'g');
  let match = maskRegExp.exec(mask);
  while (match) {
    // look for all group matches
    [1, 2, 3, 4].forEach(function (groupMatch) {
      if (match[groupMatch]) {
        placeholders.push(match[groupMatch])
      }
    });
    match = maskRegExp.exec(mask);
  }
  return placeholders;
}

/**
 * Convert a mask to a regular expression
 * @param mask
 * @return {RegExp|boolean} Either RegExp or false
 */
function convertMaskToSearchRegExp(mask) {
  if (!maskIsValid(mask)) {
    return false;
  }
  mask = escapeRegExp(mask);
  let maskPlaceholders = getMaskPlaceholders(mask);
  maskPlaceholders.forEach(function (placeholder) {
    // assume the digits are required
    let replacer = '(\\d+)';
    // if the digits are optional, update replacer
    if (/9+/.test(placeholder)) {
      replacer = '(\\d*)';
    }
    mask = mask.replace(placeholder, replacer);
  });
  return new RegExp(mask);
}

/**
 * Resolve mask. We only support numeric mask placeholders (9, 0). The string must not contain š (it's a special symbol used in the code).
 * 9 - optional digit placeholder
 * 0 - digit placeholder
 * @param mask
 * @param numericValue
 * @param callback
 * @return {*}
 */
function resolveMask(mask, numericValue, callback) {
  if (!maskIsValid(mask)) {
    return callback({
      code: 'INVALID_MASK',
      message: `Invalid mask. The mask does not match the following pattern: /^(?:(?!š).)*(?:9*0+|9+0*)[^š]*$/.`
    });
  }
  let maskPlaceholders = getMaskPlaceholders(mask);
  // keep a copy of the placeholders, they will be used for resolving the mask
  let _maskPlaceholdersClone = maskPlaceholders.slice();
  let stringValue = numericValue.toString();
  // check if the mask can be resolved (the numeric value length must not exceed total length of the placeholders)
  let maxMaskLength = 0;
  maskPlaceholders.forEach(function (placeholder) {
    maxMaskLength += placeholder.length;
  });
  if (stringValue.length > maxMaskLength) {
    return callback({
      code: 'MASK_TOO_SHORT',
      message: `Cannot resolve mask. The numeric value is too big for current mask.`
    });
  }
  // resolve the placeholders
  let resolved = false;
  const resolvedParts = [];
  while (!resolved) {
    // go through placeholders, starting with the last one
    const placeholder = maskPlaceholders.pop();
    // if the placeholder length is smaller then the value, the value needs to be split between current and next placeholder
    if (placeholder.length <= stringValue.length) {
      let resValue = stringValue.substr(-placeholder.length);
      stringValue = stringValue.substring(0, stringValue.length - resValue.length);
      resolvedParts.unshift(resValue);
    } else {
      // the placeholder length is bigger then the value, the placeholder will have a prefix
      let prefix = placeholder.substring(0, placeholder.length - stringValue.length);
      // 9 represents optional chars, remove the unresolved 9s
      prefix = prefix.replace(/9*/, '');
      let resValue = prefix + stringValue;
      stringValue = '';
      resolvedParts.unshift(resValue);
    }
    // when there is nothing left to resolve
    if (stringValue.length === 0) {
      while (maskPlaceholders.length) {
        let placeholder = maskPlaceholders.pop();
        // use a marker (safe symbol) for unchanged placeholders, it will help later to correctly resolve the mask (it prevents resolving same placeholder twice)
        placeholder = placeholder.replace(/0/g, 'š');
        // remove all the unresolved 9s
        placeholder = placeholder.replace(/9*/, '');
        resolvedParts.unshift(placeholder);
      }
      resolved = true;
    }
  }
  // resolve the mask (replace placeholders with actual resolved values)
  while (_maskPlaceholdersClone.length) {
    let placeholder = _maskPlaceholdersClone.shift();
    mask = mask.replace(placeholder, function () {
      return resolvedParts.shift();
    });
  }
  // replace marker with initial value
  mask = mask.replace(/š/g, '0');
  callback(null, mask);
}

/**
 * Extract value from a masked field
 * @param mask
 * @param value
 * @return {number}
 */
function extractValueFromMaskedField(mask, value) {
  let extractedValue = '';
  let maskRegExp = convertMaskToSearchRegExp(mask);
  let matches = maskRegExp.exec(value);
  if (matches) {
    matches.forEach(function (match, index) {
      // 0 is full match, we're only interested in group matches (1+)
      if (index) {
        extractedValue += match;
      }
    });
  } else {
    extractedValue = 0;
  }
  return parseInt(extractedValue);
}

module.exports = {
  maskIsValid: maskIsValid,
  getMaskPlaceholders: getMaskPlaceholders,
  convertMaskToSearchRegExp: convertMaskToSearchRegExp,
  resolveMask: resolveMask,
  extractValueFromMaskedField: extractValueFromMaskedField
};
