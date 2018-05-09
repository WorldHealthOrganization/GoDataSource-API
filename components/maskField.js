'use strict';

const masks = [
  // 'BLA0000BYZ',
  // 'C99T000ABC',
  // '000AYXT',
  // 'TT0000',
  // '0000',
  '99900099000'
  // 'ALPHA000BETA000',
  // 'ALPHA000BETA000GAMMA0000'
];

const values = [
  1,
  12,
  123,
  1234,
  12345,
  123456
];

const maskPattern = '(9*)(0+)|(9+)(0*)';

function maskIsValid(mask) {
  const maskRegExp = new RegExp('9*0+|9+0*');
  return maskRegExp.test(mask);
}

function getMaskPlaceholders(mask) {
  const matches = [];
  const maskRegExp = new RegExp(maskPattern, 'g');
  let match = maskRegExp.exec(mask);
  while (match) {
    [1, 2, 3, 4].forEach(function (m) {
      if (match[m]) {
        matches.push(match[m])
      }
    });
    match = maskRegExp.exec(mask);
  }
  return matches;
}

function convertMaskToSearchRegExp(mask) {
  if(!maskIsValid(mask)) {
    return false;
  }
  let maskPlaceholders = getMaskPlaceholders(mask);
  maskPlaceholders.forEach(function (placeholder) {
    let replacer = '.+';
    if(/9+/.test(placeholder)){
      replacer = '.*';
    }
    mask = mask.replace(placeholder, replacer);
  });
  return new RegExp(mask);
}

function resolveMask(mask, numericValue) {
  if (!maskIsValid(mask)) {
    return "===ERROR===";
  }
  let maskPlaceholders = getMaskPlaceholders(mask);
  let _maskPlaceholdersClone = maskPlaceholders.slice();
  let stringValue = numericValue.toString();
  let maxMaskLength = 0;
  maskPlaceholders.forEach(function (placeholder) {
    maxMaskLength += placeholder.length;
  });
  if (stringValue.length > maxMaskLength) {
    //error
    return '===ERROR===';
  }
  let resolved = false;
  const resolvedParts = [];
  while (!resolved) {
    const placeholder = maskPlaceholders.pop();
    if (placeholder.length <= stringValue.length) {
      let resValue = stringValue.substr(-placeholder.length);
      stringValue = stringValue.substring(0, stringValue.length - resValue.length);
      resolvedParts.unshift(resValue);
    } else {
      let prefix = placeholder.substring(0, placeholder.length - stringValue.length);
      prefix = prefix.replace(/9*/, '');
      let resValue = prefix + stringValue;
      stringValue = '';
      resolvedParts.unshift(resValue);
    }
    if (stringValue.length === 0) {
      while (maskPlaceholders.length) {
        let placeholder = maskPlaceholders.pop();
        placeholder = placeholder.replace(/9*/, '');
        resolvedParts.unshift(placeholder);
      }
      resolved = true;
    }
  }
  while (_maskPlaceholdersClone.length) {
    let placeholder = _maskPlaceholdersClone.shift();
    mask = mask.replace(placeholder, function (m) {
      return resolvedParts.shift();
    });
  }
  return mask;
}

masks.forEach(function (mask) {
    console.log(convertMaskToSearchRegExp(mask));
})

masks.forEach(function (mask) {
  values.forEach(function (value) {
    console.log(resolveMask(mask, value));
  })
})
