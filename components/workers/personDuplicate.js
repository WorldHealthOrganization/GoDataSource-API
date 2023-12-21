'use strict';

const _ = require('lodash');
const helpers = require('../helpers');

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

  // all values must match the conditions, otherwise the id can't be generated
  // this translates into and AND condition between keys, instead of an OR how it was before
  let allMatched = true;

  // go through all the keys
  keys.forEach(function (keyComponent) {
    // get the value associated with the key from the entry
    const value = _.get(entry, keyComponent);
    // if it's a valid value
    if (
      value != null &&
      value !== '' && (
        typeof value !== 'string' ||
        value.trim() !== ''
      )
    ) {
      // add it to the id
      id += value.toString().trim().replace(/(\n|\r)/gm, '').toLowerCase();
    } else {
      allMatched = false;
    }
  });

  // return build id
  return allMatched ? id : '';
}

/**
 * Index an entry
 * @param index
 * @param entry
 * @param keys
 * @param checkReversed
 */
function addEntryToIndex(index, entry, keys, checkReversed) {
  // get index id for that key
  let id = getEntryId(entry, keys);

  // if the id is valid
  if (id.length) {
    // group people with same types
    let idReversed = checkReversed ? getEntryId(entry, [...keys].reverse()) : '';
    idReversed = idReversed ? `${typeof entry.type === 'string' ? entry.type.toLowerCase() : 'unknown_type'}${idReversed}` : idReversed;

    // add the entry to the index using generated id
    // in case we can revert the index id, we should check if we don't have already an index for the reversed id to add it there
    // instead of creating a new index that is the reversed index of an existing normal index
    if (
      idReversed &&
      index[idReversed]
    ) {
      addEntryToIndexWithId(
        index,
        idReversed,
        entry
      );
    } else {
      addEntryToIndexWithId(
        index,
        `${typeof entry.type === 'string' ? entry.type.toLowerCase() : 'unknown_type'}${id}`,
        entry
      );
    }
  }
}


const worker = {
  findOrCount: function (people, filter, countOnly) {
    // keep a list of indices
    const index = {
      name: {},
      documents: {}
    };

    // go through the list of people
    const peopleIdsMap = {};
    people.forEach(function (person) {
      // map person by id
      peopleIdsMap[person._id] = person;

      // if person has name (type event)
      if (
        person.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT' &&
        person.name
      ) {
        // store people indexed by name
        addEntryToIndex(index.name, person, ['name']);
      }
      // store people indexed by firstName and lastName
      addEntryToIndex(index.name, person, ['firstName', 'lastName'], true);
      // store people indexed by firstName and middleName
      addEntryToIndex(index.name, person, ['firstName', 'middleName'], true);
      // store people indexed by middleName and lastName
      addEntryToIndex(index.name, person, ['middleName', 'lastName'], true);

      // if the person has documents
      if (Array.isArray(person.documents)) {
        // go trough the documents
        person.documents.forEach(function (document, idx) {
          // index them by document type and number
          addEntryToIndex(index.documents, person, [`documents.${idx}.type`, `documents.${idx}.number`]);
        });
      }
    });

    // build a list of results
    let results = [];
    let alreadyFoundKey = {};
    // go through the list of indices
    Object.keys(index).forEach(function (indexType) {
      // go through indexed entries of each index
      Object.keys(index[indexType]).forEach(function (groupId) {
        // if there is more than one record indexed
        if (index[indexType][groupId].records.length > 1) {
          // remove duplicates
          const peopleRecords = index[indexType][groupId].records;
          const peopleRecordsWithIds = Object.values(peopleRecords).reduce((acc, person) => {
            acc[person._id] = person;
            return acc;
          }, {});

          // determine group key used to remove duplicates
          // - we could use a hashing function, but since there shouldn't be more than 2 - 3 duplicate ids per group it shouldn't matter
          peopleRecords.sort((pr1, pr2) => pr1._id.localeCompare(pr2._id));
          const peopleKey = peopleRecords.map((pr) => pr._id).join();

          // already found ?
          if (!alreadyFoundKey[peopleKey]) {
            // mark as found
            alreadyFoundKey[peopleKey] = true;

            // find all subgroups of possible duplicates, based on the records marked as "Not a duplicate"
            // get only the subgroups with the highest number of records
            const findPossibleDuplicatesSubGroups = ((peopleData) => {
              // recursive method to determine the persons marked as "Not a duplicate"
              function findNotDuplicatePersons(personId, markedIds = {}) {
                // ignore deleted/invalid persons or the person is already visited (marked as duplicate)
                if (
                  !peopleIdsMap[personId] ||
                  markedIds[personId]
                ) {
                  return [];
                }

                // mark the current person as visited
                markedIds[personId] = true;

                // initialize an array with the current person
                const notDuplicatePersons = [personId];

                // determine not duplicate persons for each person marked as "Not a duplicate"
                if (peopleIdsMap[personId].notDuplicatesIds) {
                  peopleIdsMap[personId].notDuplicatesIds.forEach((id) => {
                    notDuplicatePersons.push(...findNotDuplicatePersons(id, markedIds));
                  });
                }

                // return the array of non-duplicate persons
                return notDuplicatePersons;
              }

              // go through each person to find non-duplicate persons
              const notDuplicatesPersonMap = {};
              peopleData.forEach(person => {
                const notDuplicatePersons = findNotDuplicatePersons(person._id);
                // ignore the persons that were not found as possible duplicate
                notDuplicatesPersonMap[person._id] = notDuplicatePersons.filter(id => !!peopleRecordsWithIds[id]);
              });

              // get the distinct sub-groups
              const notDuplicateGroupPersons = {};
              Object.keys(notDuplicatesPersonMap).forEach((personId) => {

                const subGroupPersons = notDuplicatesPersonMap[personId].sort();
                const subGroupPersonsKey = subGroupPersons.join();
                if (!notDuplicateGroupPersons[subGroupPersonsKey]) {
                  notDuplicateGroupPersons[subGroupPersonsKey] = subGroupPersons;
                }
              });

              // get all combinations
              const findGroupCombinations = ((possibleDuplicatesGroup, currentIndex = 0, currentCombination = {}) => {
                const keys = Object.keys(possibleDuplicatesGroup);
                const combinations = [];

                // if currentIndex reaches the number of keys, we have a complete combination
                if (currentIndex === keys.length) {
                  // add the currentCombination to the combinations array
                  combinations.push({...currentCombination});
                } else {
                  const currentKey = keys[currentIndex];
                  const currentSubGroup = possibleDuplicatesGroup[currentKey];

                  // parse current subgroup
                  for (let i = 0; i < currentSubGroup.length; i++) {
                    // create a copy of the currentCombination and add the current key-value pair to it
                    const newCombination = {...currentCombination};
                    newCombination[currentKey] = currentSubGroup[i];

                    // call the function for the next key
                    combinations.push(...findGroupCombinations(possibleDuplicatesGroup, currentIndex + 1, newCombination));
                  }
                }

                // return
                return combinations;
              });

              // return all combinations
              return findGroupCombinations(notDuplicateGroupPersons);
            });

            // get sub-groups of possible duplicates
            const possibleDuplicatesSubGroups = findPossibleDuplicatesSubGroups(peopleRecords);

            // create the result
            possibleDuplicatesSubGroups.forEach((subGroupPersons, index) => {
              // ignore subgroups with less than 2 elements
              const personIds = Object.values(subGroupPersons);
              if (personIds.length < 2) {
                return;
              }

              // add the list of possible duplicates sub-group to the result
              // create a unique index key from group id and subGroup index
              // extract the subgroup persons
              const persons = [];
              personIds.forEach((personId) => {
                persons.push(peopleRecordsWithIds[personId]);
              });
              results.push({
                duplicateKey: indexType,
                indexKey: groupId + index,
                people: persons
              });
            });
          }
        }
      });
    });

    // if only the count was requested
    if (countOnly) {
      // return the number of results
      return results.length;
    }

    // build result set
    const resultSet = {
      peopleMap: {},
      groups: []
    };
    // paginate result set, if needed
    helpers.paginateResultSet(filter, results)
      .forEach(function (group) {
        // build groups containing only people IDs (less data to transfer down the wire), store person data only once for each person
        const _group = {
          duplicateKey: group.duplicateKey,
          indexKey: group.indexKey,
          peopleIds: []
        };
        // go through the people in the group
        group.people
          .forEach(function (person) {
            // store person id
            _group.peopleIds.push(person._id);
            // store the person in the peopleMap if not already stored
            if (!resultSet.peopleMap[person._id]) {
              resultSet.peopleMap[person._id] = person;
              // use friendlier IDs
              person.id = person._id;
            }
          });
        resultSet.groups.push(_group);
      });
    // return (paginated) result set
    return resultSet;
  },
  find: function (people, filter) {
    return this.findOrCount(people, filter);
  },
  count: function (people) {
    return this.findOrCount(people, {}, true);
  }
};

process.on('message', function (message) {
  let result = worker[message.fn](...message.args);
  process.send([null, result]);
});

