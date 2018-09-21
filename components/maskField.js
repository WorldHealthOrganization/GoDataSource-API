'use strict';

const escapeRegExp = require('./escapeRegExp');

/**
 * Check if a mask is valid. Supported chars (in addition to any other literal)
 * 0 - digit
 * 9 - sequence number
 * Y - year
 * @ - letter
 * & - any character
 * Note: just one sequence number is accepted in a mask. E.g. Y99@ is supported while Y99@99& is not supported because
 * it contains two sequence numbers (99 appears twice)
 * @param mask
 * @return {boolean}
 */
function maskIsValid(mask) {
  const maskRegExp = /^(?:9*[^9()]*|[^9()]*9*[^9()]*|[^9()]*9*)$/;
  return maskRegExp.test(mask);
}

/**
 * Bulid mask regex string (not regular expression) to be used for searching next sequence
 * @param mask
 * @param propertyTemplate
 * @return {string|boolean}
 */
function getMaskRegExpStringForSearch(mask, propertyTemplate) {
  // escape regex input
  mask = escapeRegExp(mask);
  propertyTemplate = escapeRegExp(propertyTemplate);

  // check if the mask is valid
  if (!maskIsValid(mask)) {
    return false;
  }
  // with special meaning
  const replaceMap = {
    // year
    'YYYY': '\\d{4,4}',
    // digit
    0: '\\d',
    // sequence digit (capture group)
    9: '(\\d)',
    // letter
    '@': '[a-zA-Z]',
    // any char
    '&': '.'
  };
  // build regex string from mask by replacing chars with special meaning
  Object.keys(replaceMap).forEach(function (supportedPlaceholder) {
    mask = mask.replace(new RegExp(supportedPlaceholder, 'g'), replaceMap[supportedPlaceholder]);
  });
  // in order to correctly extract sequence placeholders, we need to isolate placeholder groups from the rest of the mask
  const leftIndex = mask.indexOf('(');
  const rightIndex = mask.lastIndexOf(')');
  // isolate the placeholder groups from the rest of the mask by using wrapping them in RegExp groups
  const groupedMask = new RegExp(`^(${mask.substring(0, leftIndex)})${mask.substring(leftIndex, rightIndex + 1)}(${mask.substring(rightIndex + 1)})$`);
  // test if the mask that needs to be resolved matches the original mask
  if (!groupedMask.test(propertyTemplate)) {
    return false;
  }
  // mask search string should contain all chars as literals except the ones used as sequence placeholders
  return propertyTemplate.replace(groupedMask, function () {
    let placeholder = '';
    // placeholder groups are in the middle (from 1 to last -1). Last two arguments are offset and string
    for (let i = 1; i < (arguments.length - 4); i++) {
      placeholder += '(\\d)';
    }
    // keep first and last group, replace the rest with placeholders
    return `${arguments[1]}${placeholder}${arguments[arguments.length - 3]}`;
  });
}

/**
 * Convert a mask to a regular expression
 * @param mask
 * @param propertyTemplate
 * @return {RegExp|boolean} Either RegExp or false
 */
function convertMaskToSearchRegExp(mask, propertyTemplate) {
  const maskString = getMaskRegExpStringForSearch(mask, propertyTemplate);
  if (maskString) {
    return new RegExp(`^${maskString}$`);
  }
  return false;
}

/**
 * Resolve mask. Supported chars (in addition to any other literal)
 * 0 - digit
 * 9 - sequence number
 * Y - year
 * @ - letter
 * & - any character
 * Note: just one sequence number is accepted in a mask. E.g. Y99@ is supported while Y99@99& is not supported because
 * it contains two sequence numbers (99 appears twice)
 * @param mask
 * @param propertyTemplate
 * @param numericValue
 * @param callback
 * @return {*}
 */
function resolveMask(mask, propertyTemplate, numericValue, callback) {
  if (!maskIsValid(mask)) {
    return callback({
      code: 'INVALID_MASK',
      message: 'Invalid mask. The mask does not match the following pattern: /^(?:9*[^9()]*|[^9()]*9*[^9()]*|[^9()]*9*)$/.'
    });
  }
  // start with max sequence length of 0
  let maxSequenceLength = 0;
  // match sequence placeholders
  const matches = mask.match('9+');
  // if matches found
  if (matches) {
    // get the length (no. of placeholder chars)
    maxSequenceLength = matches[0].length;
  }
  // if there's a sequence number that needs to be inserted and it exceeds the maximum length
  if (numericValue > 1 && numericValue.toString().length > maxSequenceLength) {
    // stop with error
    return callback({
      code: 'MASK_TOO_SHORT',
      message: 'Cannot resolve mask. The numeric value is too big for current mask.'
    });
  }
  // get mask string
  let maskString = getMaskRegExpStringForSearch(mask, propertyTemplate);
  // if no mask string returned
  if (!maskString) {
    // stop with error
    return callback({
      code: 'MASK_MISS_MATCH',
      message: 'Cannot resolve mask. Property template does not match mask pattern'
    });
  }
  // insert the numeric value into the mask
  while (numericValue) {
    // search the last digit placeholder
    const endPosition = maskString.lastIndexOf('(\\d)');
    // validate position
    if (endPosition !== -1) {
      // insert the last digit of the number on the last digit placeholder position
      maskString = `${maskString.substring(0, endPosition)}${numericValue % 10}${maskString.substring(endPosition + 4)}`;
    }
    // do it until all the digits were processed
    numericValue = parseInt(numericValue / 10);
  }
  // replace remaining digit placeholders with 0
  maskString = maskString.replace(/\(\\d\)/g, '0');
  // send back the result
  callback(null, maskString);
}

/**
 * Extract value from a masked field
 * @param mask
 * @param value
 * @return {number}
 */
function extractValueFromMaskedField(mask, value) {
  let extractedValue = '0';
  let maskRegExp = convertMaskToSearchRegExp(mask, value);
  if (maskRegExp) {
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
  }
  return parseInt(extractedValue);
}

module.exports = {
  maskIsValid: maskIsValid,
  convertMaskToSearchRegExp: convertMaskToSearchRegExp,
  resolveMask: resolveMask,
  extractValueFromMaskedField: extractValueFromMaskedField
};
