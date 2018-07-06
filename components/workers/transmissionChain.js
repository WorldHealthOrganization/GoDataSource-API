'use strict';

const worker = {
  buildOrCount: function (relationships, countOnly) {
    // keep a list o chains
    let transmissionChains = [];
    // keep a map of people to chains
    let personIdToChainMap = [];
    // keep information about nodes and edges
    let nodes = {};
    let edges = {};
    // keep a list of isolated nodes
    let isolatedNodes = {};

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
        // define shortcuts
        let relationshipPerson1;
        let relationshipPerson2;

        // if people information is available
        if (relationship.people && relationship.people.length) {

          // build defined shortcuts
          relationshipPerson1 = relationship.people[0];
          relationshipPerson2 = relationship.people[1];

          // add edge only when there is information about both people
          // there can be only one person in the relationship because some filtering was applied
          if (relationshipPerson1 && relationshipPerson2) {
            // add information about edges
            edges[relationship.id] = relationship;

            // get information about first person
            if (!nodes[relationshipPerson1.id]) {
              nodes[relationshipPerson1.id] = relationshipPerson1;
            }
            // get information about second person
            if (!nodes[relationshipPerson2.id]) {
              nodes[relationshipPerson2.id] = relationshipPerson2;
            }

            // if none of the people are contacts, mark both nodes as not being isolated
            if (relationshipPerson1.type !== 'contact' && relationshipPerson2.type !== 'contact') {
              if (isolatedNodes[relationshipPerson1.id] === undefined || isolatedNodes[relationshipPerson1.id]) {
                isolatedNodes[relationshipPerson1.id] = false;
              }
              if (isolatedNodes[relationshipPerson2.id] === undefined || isolatedNodes[relationshipPerson2.id]) {
                isolatedNodes[relationshipPerson2.id] = false;
              }

            } else {
              // only person 1 is not a contact, mark the node as isolated (if it was not previously marked otherwise)
              if (relationshipPerson1.type !== 'contact' && isolatedNodes[relationshipPerson1.id] === undefined) {
                isolatedNodes[relationshipPerson1.id] = true;
              }
              // only person 2 is not a contact, mark rhe node as isolated (if it was not previously marked otherwise)
              if (relationshipPerson2.type !== 'contact' && isolatedNodes[relationshipPerson2.id] === undefined) {
                isolatedNodes[relationshipPerson2.id] = true;
              }
            }

          } else {
            // if the relationship does not contain information about both people, skip contacts (they cannot exist unlinked from a chain)
            // get information about first person (if it exists and it's not a contact)
            if (relationshipPerson1 && relationshipPerson1.type !== 'contact' && !nodes[relationshipPerson1.id]) {
              nodes[relationshipPerson1.id] = relationshipPerson1;
              // this seems like an isolated node, mark it as isolated, if no other info was available
              if (isolatedNodes[relationshipPerson1.id] === undefined) {
                isolatedNodes[relationshipPerson1.id] = true;
              }
            }
            // get information about second person (if it exists and it's not a contact)
            if (relationshipPerson2 && relationshipPerson2.type !== 'contact' && !nodes[relationshipPerson2.id]) {
              nodes[relationshipPerson2.id] = relationshipPerson2;
              // this seems like an isolated node, mark it as isolated, if no other info was available
              if (isolatedNodes[relationshipPerson2.id] === undefined) {
                isolatedNodes[relationshipPerson2.id] = true;
              }
            }

            // skip adding nodes to the chain when the relation is incomplete
            relationsIndex++;
            continue;
          }

          // remove extra info
          relationship.people = undefined;
        } else {
          // relationship does not contain people information (is invalid)
          relationsIndex++;
          continue;
        }

        // transmission chains are build only by case/event-case/event relationships
        if (relationshipPerson1.type === 'contact' || relationshipPerson2.type === 'contact') {
          relationsIndex++;
          continue;
        }

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

    // process the chains
    let _chains = {
      chains: [],
      length: 0
    };
    // store lengths for each chain
    let chainsLengths = [];

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
        _chains.chains[resultIndex] = transmissionChain;
        // store length for each chain
        chainsLengths[resultIndex] = {length: transmissionChain.length};
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
        // also add nodes and isolated nodes info
        nodes: nodes,
        isolatedNodes: isolatedNodes,
        chains: chainsLengths,
        length: _chains.length
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

