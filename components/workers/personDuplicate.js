'use strict';

const _ = require('lodash');

/**
 * Add an entry to an index on a position (id)
 * @param index
 * @param id
 * @param entry
 */
function addEntryToIndexWithId(index, id, entry) {
  // if the id is not present in the index
  if (!index[id]) {
    // init index for that id
    index[id] = {
      _ids: {},
      records: []
    };
  }
  // index only entries that were not previously indexed
  if (!index[id]._ids[entry._id]) {
    // add the entry to the index
    index[id].records.push(entry);
    // flag the entry as indexed
    index[id]._ids[entry._id] = true;
  }
}

/**
 * Build an id for an entry based on sent keys
 * @param entry
 * @param keys
 * @return {string}
 */
function getEntryId(entry, keys) {
  // start with an empty id
  let id = '';
  // go through all the keys
  keys.forEach(function (keyComponent) {
    // get the value associated with the key from the entry
    const value = _.get(entry, keyComponent);
    // if it's a valid value
    if (value != null) {
      // add it to the id
      id += value.toString().toLowerCase();
    }
  });
  // return build id
  return id;
}

/**
 * Index an entry
 * @param index
 * @param entry
 * @param keys
 * @param searchReverse
 */
function addEntryToIndex(index, entry, keys, searchReverse) {
  // get index id for that key
  const id = getEntryId(entry, keys);
  // if the id is valid
  if (id.length) {
    // add the entry to the index using generated id
    addEntryToIndexWithId(index, id, entry);
    // if the match should be done in a reverse order as well
    if (searchReverse) {
      // get reversed id (id built from the keys in reverse order)
      const revId = getEntryId(entry, keys.reverse());
      // if this is a different id than the original one and there's a matching entry present
      if (id !== revId && index[revId]) {
        // add the entry as a possible duplicate
        addEntryToIndexWithId(index, revId, entry);
      }
    }
  }
}


const worker = {
  findOrCount: function (people, countOnly) {
    // keep a list of indices
    const index = {
      name: {},
      documents: {},
      phoneNumber: {}
    };
    // go through the list of people
    people.forEach(function (person) {
      // store people indexed by name
      addEntryToIndex(index.name, person, ['name']);
      // store people indexed by firstName and lastName (also try to match reverse order)
      addEntryToIndex(index.name, person, ['firstName', 'lastName'], true);
      // store people indexed by firstName and middleName (also try to match reverse order)
      addEntryToIndex(index.name, person, ['firstName', 'middleName'], true);
      // store people indexed by middleName and lastName (also try to match reverse order)
      addEntryToIndex(index.name, person, ['middleName', 'lastName'], true);
      // store people indexed by phoneNumber and gender
      addEntryToIndex(index.phoneNumber, person, ['phoneNumber', 'gender']);
      // if the person has documents
      if (Array.isArray(person.documents)) {
        // go trough the documents
        person.documents.forEach(function (document, index) {
          // index them by document type and number
          addEntryToIndex(index.documents, person, [`document.${index}.type`, `document.${index}.number`]);
        });
      }
    });

    // build a list of results
    let results = [];
    // go through the list of indices
    ['name', 'documents', 'phoneNumber'].forEach(function (indexType) {
      // go through indexed entries of each index
      Object.keys(index[indexType]).forEach(function (groupId) {
        // if there is more than one record indexed
        if (index[indexType][groupId].records.length > 1) {
          // add the list of possible duplicates group to the result
          results.push({
            duplicateKey: indexType,
            indexKey: groupId,
            people: index[indexType][groupId].records
          });
        }
      });
    });

    // if only the count was requested
    if (countOnly) {
      // return the number of results
      return results.length;
    }
    // return results
    return results;
  },
  find: function (people) {
    return this.findOrCount(people);
  },
  count: function (people) {
    return this.findOrCount(people, true);
  }
};

process.on('message', function (message) {
  let result = worker[message.fn](...message.args);
  process.send([null, result]);
});

