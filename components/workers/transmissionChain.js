'use strict';

const worker = {
  buildOrCount: function (relationships, followUpPeriod, countOnly) {
    // define the start date of active chains (today - (the follow-up period + 1))
    let activeChainStartDate = new Date();
    activeChainStartDate.setDate(activeChainStartDate.getDate() - (followUpPeriod + 1));
    // keep a list o chains
    let transmissionChains = [];
    // keep a map of people to chains
    let personIdToChainMap = [];
    // keep information about active transmission chains
    let activeTransmissionChains = {};

    // keep information about nodes and edges
    let nodes = {};
    let edges = {};

    /**
     * Merge two chains
     * @param targetIndex
     * @param sourceIndex
     */
    function mergeChains(targetIndex, sourceIndex) {
      let sourceLength = transmissionChains[sourceIndex].length;
      let targetLength = transmissionChains[targetIndex].length;
      let index = 0;

      // if either of the chains were active
      if (activeTransmissionChains[targetIndex] || activeTransmissionChains[sourceIndex]) {
        // mark resulting chain as active
        activeTransmissionChains[targetIndex] = true;
      }

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
      // remove source from active transmission chains list
      activeTransmissionChains[sourceIndex] = null;
    }

    let relationsLength = relationships.length;
    let relationsIndex = 0;

    // go through all relationships
    while (relationsIndex < relationsLength) {
      let relationship = relationships[relationsIndex];

      // check if the relation is active
      let isRelationActive = ((new Date(relationship.contactDate)) > activeChainStartDate);

      // build a list of (two) person ids
      let personIds = [relationship.persons[0].id, relationship.persons[1].id];
      // check if we actually have a valid relation (should always be the case)
      if (personIds.length === 2) {
        // define some shortcuts
        const person1 = personIds[0],
          person2 = personIds[1],
          indexPerson1 = personIdToChainMap[person1],
          indexPerson2 = personIdToChainMap[person2];

        // if it's more than a count and information is available
        if (!countOnly && relationship.people && relationship.people[0] && relationship.people[1]) {
          // get information about first person
          if (!nodes[relationship.people[0].id]) {
            nodes[relationship.people[0].id] = relationship.people[0];
          }
          // get information about second person
          if (!nodes[relationship.people[1].id]) {
            nodes[relationship.people[1].id] = relationship.people[1];
          }
          // remove extra info
          relationship.people = undefined;
          // add information about edges
          edges[relationship.id] = relationship;
        }

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
                // if the relation is active
                if (isRelationActive) {
                  // mark resulting chain as active
                  activeTransmissionChains[indexPerson1] = true;
                }
                // merge the smaller chain into the bigger one
                mergeChains(indexPerson1, indexPerson2);
              } else {
                // add the people to the bigger chain
                transmissionChains[indexPerson2].push([person1, person2]);
                // set their map
                personIdToChainMap[person1] = personIdToChainMap[person2] = indexPerson2;
                // if the relation is active
                if (isRelationActive) {
                  // mark resulting chain as active
                  activeTransmissionChains[indexPerson2] = true;
                }
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
            // if the relation is active
            if (isRelationActive) {
              // mark resulting chain as active
              activeTransmissionChains[indexPerson1] = true;
            }
            break;
          // only person2 was already present
          case indexPerson2 !== undefined:
            // add both people were person1 where already is
            transmissionChains[indexPerson2].push([person1, person2]);
            // set their map
            personIdToChainMap[person1] = personIdToChainMap[person2] = indexPerson2;
            // if the relation is active
            if (isRelationActive) {
              // mark resulting chain as active
              activeTransmissionChains[indexPerson2] = true;
            }
            break;
          // first appearance of both people
          default:
            // create a new chain
            let length = transmissionChains.push([[person1, person2]]);
            // set their map
            personIdToChainMap[person1] = personIdToChainMap[person2] = length - 1;
            // if the relation is active
            if (isRelationActive) {
              // mark resulting chain as active
              activeTransmissionChains[length - 1] = true;
            }
            break;
        }
      }
      relationsIndex++;
    }

    // process the chains
    let _chains = {
      chains: [],
      length: 0
    };
    // store lengths for each chain
    let chainsLengths = [];
    let activeChainsLength = 0;

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
        // check if the chain is active
        let isChainActive = !!activeTransmissionChains[chainIndex];
        // if the chain is active
        if (isChainActive) {
          // update the number of active chains
          activeChainsLength++;
        }
        // add it to the list of chains
        _chains.chains[resultIndex] = {chain: transmissionChain, active: isChainActive};
        // store length for each chain
        chainsLengths[resultIndex] = {length: transmissionChain.length, active: isChainActive};
        resultIndex++;
      }
      chainIndex++;
    }
    // set the number of results
    _chains.length = resultIndex;

    // prepare the result
    let result;

    // only need counters
    if (countOnly) {
      result = {
        chains: chainsLengths,
        length: _chains.length,
        activeChains: activeChainsLength
      };
    } else {
      // return info about nodes, edges and the actual chains
      result = {
        nodes: nodes,
        edges: edges,
        transmissionChains: _chains
      };
    }
    // send back result
    return result;
  },
  build: function (relationships, followUpPeriod) {
    return this.buildOrCount(relationships, followUpPeriod);
  },
  count: function (relationships, followUpPeriod) {
    return this.buildOrCount(relationships, followUpPeriod, true);
  }
};

process.on('message', function (message) {
  let result = worker[message.fn](...message.args);
  process.send([null, result]);
});

