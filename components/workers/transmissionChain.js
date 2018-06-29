'use strict';

const worker = {
  buildOrCount: function (relationships, countOnly) {
    // keep a list o chains
    let transmissionChains = [];
    // keep a map of people to chains
    let personIdToChainMap = [];

    /**
     * Merge two chains
     * @param targetIndex
     * @param sourceIndex
     */
    function mergeChains(targetIndex, sourceIndex) {
      let sourceLength = transmissionChains[sourceIndex].length;
      let targetLength = transmissionChains[targetIndex].length;
      let index = 0;

      // while there are source items to process
      while (index < sourceLength) {
        // get source relation
        let relation = transmissionChains[sourceIndex][index];
        // add it to target chain
        transmissionChains[targetIndex][targetLength] = relation;
        // update indices
        personIdToChainMap[relation[0]] = personIdToChainMap[relation[1]] = targetIndex;
        // increment target position
        targetLength++;
        // increment source index
        index++;
      }
      // remove the source
      transmissionChains[sourceIndex] = null;
    }

    let relationsLength = relationships.length;
    let relationsIndex = 0;

    // go through all relationships
    while (relationsIndex < relationsLength) {
      let relationship = relationships[relationsIndex];

      // build a list of (two) person ids
      let personIds = [relationship.persons[0].id, relationship.persons[1].id];
      // check if we actually have a valid relation (should always be the case)
      if (personIds.length === 2) {
        // define some shortcuts
        const person1 = personIds[0],
          person2 = personIds[1],
          indexPerson1 = personIdToChainMap[person1],
          indexPerson2 = personIdToChainMap[person2];

        // treat each scenario separately
        switch (true) {
          // both people were found in (separate) chains
          case indexPerson1 !== undefined && indexPerson2 !== undefined:
            // if they were found found in separate chains
            if (indexPerson1 !== indexPerson2) {
              // find out which chain is bigger, and move the smaller chain to the bigger one
              if (transmissionChains[indexPerson1].length > transmissionChains[indexPerson2].length) {
                // add the people to the bigger chain
                transmissionChains[indexPerson1].push([person1, person2]);
                // set their map
                personIdToChainMap[person1] = personIdToChainMap[person2] = indexPerson1;
                // merge the smaller chain into the bigger one
                mergeChains(indexPerson1, indexPerson2);
              } else {
                // add the people to the bigger chain
                transmissionChains[indexPerson2].push([person1, person2]);
                // set their map
                personIdToChainMap[person1] = personIdToChainMap[person2] = indexPerson2;
                // merge the smaller chain into the bigger one
                mergeChains(indexPerson2, indexPerson1);
              }
            }
            break;
          // only person1 was already present
          case indexPerson1 !== undefined:
            // add both people were person1 where already is
            transmissionChains[indexPerson1].push([person1, person2]);
            // set their map
            personIdToChainMap[person1] = personIdToChainMap[person2] = indexPerson1;
            break;
          // only person2 was already present
          case indexPerson2 !== undefined:
            // add both people were person1 where already is
            transmissionChains[indexPerson2].push([person1, person2]);
            // set their map
            personIdToChainMap[person1] = personIdToChainMap[person2] = indexPerson2;
            break;
          // first appearance of both people
          default:
            // create a new chain
            let length = transmissionChains.push([[person1, person2]]);
            // set their map
            personIdToChainMap[person1] = personIdToChainMap[person2] = length - 1;
            break;
        }
      }
      relationsIndex++;
    }

    // prepare the result
    let result = [];

    // filter out invalid data (chain == null) from the chains list
    let resultIndex = 0;
    let chainIndex = 0;
    let chainLength = transmissionChains.length;
    // while there are items to process
    while (chainIndex < chainLength) {
      // get each chain
      let transmissionChain = transmissionChains[chainIndex];
      // if the chain is valid
      if (transmissionChain !== null) {
        // add it to the list of chains
        result[resultIndex] = transmissionChain;
        resultIndex++;
      }
      chainIndex++;
    }

    if (countOnly) {
      // just count the chains
      result = result.length;
    }
    // send back result
    return result;
  },
  build: function (relationships) {
    return this.buildOrCount(relationships);
  },
  count: function (relationships) {
    return this.buildOrCount(relationships, true);
  }
};

process.on('message', function (message) {
  let result = worker[message.fn](...message.args);
  process.send([null, result]);
});

