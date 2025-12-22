/* eslint-disable linebreak-style */
/**
 * Middleware to sanitize the `limit` value in LoopBack-style filters passed via query parameters.
 *
 * Purpose:
 * - Ensures that the `limit` field is a non-negative integer.
 * - Prevents runtime errors from malformed or invalid `limit` values (e.g., strings or negative numbers).
 * - Handles both JSON-stringified and object-based `filter` queries.
 *
 * Usage:
 * - Add this middleware before your route handlers to sanitize incoming query filters.
 */
module.exports = function () {
  return function sanitizeLimit(req, res, next) {
    try {
      if (req.query && req.query.filter) {
        let isFilterString = typeof req.query.filter === 'string';
        let filter = req.query.filter;
  
        if (isFilterString) {
          try {
            filter = JSON.parse(filter);
          } catch (parseErr) {
            return next(); // Let LoopBack handle malformed filter
          }
        }
  
        if (filter && typeof filter === 'object' && 'limit' in filter) {
          const limit = parseInt(filter.limit, 10);
    
          filter.limit = isNaN(limit) ? filter.limit : Math.max(0, limit);
        }
          
        req.query.filter = isFilterString ? JSON.stringify(filter) : filter;
      }
    } catch (err) {
      console.error('Unexpected error in sanitizeLimit middleware:', err);
    }
    next();
  };
};