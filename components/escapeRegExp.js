'use strict';

/**
 * Escape special Regular Expression characters
 * @param string
 * @return {string}
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = escapeRegExp;
