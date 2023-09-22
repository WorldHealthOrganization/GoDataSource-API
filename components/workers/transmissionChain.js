'use strict';

const localizationHelper = require('../localizationHelper');

const worker = {
  /**
   * Build or count transmission chains
   * @param relationships
   * @param followUpPeriod
   * @param countOnly
   * @param options {{activeChainStartDate: Date}}
   * @return {{nodes, edges, transmissionChains: {chains: Array, length: number}}|{nodes, isolatedNodes, chains: Array, length: number, activeChainsCount: number}}
   */
  buildOrCount: function (relationships, followUpPeriod, countOnly, options) {
    // default active chain start date starts from today
    let activeChainStartDate = localizationHelper.toMoment(options.activeChainStartDate).toDate();
    // define the start date of active chains (today - (the follow-up period + 1))
    activeChainStartDate.setDate(activeChainStartDate.getDate() - (followUpPeriod + 1));
    // keep a list o chains
    let transmissionChains = [];
    // keep a map of people to chains
    let personIdToChainMap = [];
    // keep information about active transmission chains
    let activeTransmissionChains = {};

    // case/event to contact map
    const caseEventToContactMap = {};

    /**
     * If any of the people in the pair is a contact, then the other is always a case/event
     * Add the other partner in the case/event to contact map pointing to the contact partner
     * @param person1
     * @param person2
     */
    const addPeoplePairToCaseEventToContactMap = function (person1, person2) {
      if (person1.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT') {
        if (caseEventToContactMap[person2.id]) {
          caseEventToContactMap[person2.id].add(person1.id);
        } else {
          caseEventToContactMap[person2.id] = new Set([person1.id]);
        }
      } else if (person2.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT') {
        if (caseEventToContactMap[person1.id]) {
          caseEventToContactMap[person1.id].add(person2.id);
        } else {
          caseEventToContactMap[person1.id] = new Set([person2.id]);
        }
      }
    };

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
      let isRelationActive = (localizationHelper.toMoment(relationship.contactDate).toDate() > activeChainStartDate);

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
            if (relationshipPerson1.type !== 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT' && relationshipPerson2.type !== 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT') {
              if (isolatedNodes[relationshipPerson1.id] === undefined || isolatedNodes[relationshipPerson1.id]) {
                isolatedNodes[relationshipPerson1.id] = false;
              }
              if (isolatedNodes[relationshipPerson2.id] === undefined || isolatedNodes[relationshipPerson2.id]) {
                isolatedNodes[relationshipPerson2.id] = false;
              }

            } else {
              // only person 1 is not a contact, mark the node as isolated (if it was not previously marked otherwise)
              if (relationshipPerson1.type !== 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT' && isolatedNodes[relationshipPerson1.id] === undefined) {
                isolatedNodes[relationshipPerson1.id] = true;
              }
              // only person 2 is not a contact, mark the node as isolated (if it was not previously marked otherwise)
              if (relationshipPerson2.type !== 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT' && isolatedNodes[relationshipPerson2.id] === undefined) {
                isolatedNodes[relationshipPerson2.id] = true;
              }
            }

          } else {
            // if the relationship does not contain information about both people, skip contacts (they cannot exist unlinked from a chain)
            // get information about first person (if it exists and it's not a contact)
            if (relationshipPerson1 && relationshipPerson1.type !== 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT' && !nodes[relationshipPerson1.id]) {
              nodes[relationshipPerson1.id] = relationshipPerson1;
              // this seems like an isolated node, mark it as isolated, if no other info was available
              if (isolatedNodes[relationshipPerson1.id] === undefined) {
                isolatedNodes[relationshipPerson1.id] = true;
              }
            }
            // get information about second person (if it exists and it's not a contact)
            if (relationshipPerson2 && relationshipPerson2.type !== 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT' && !nodes[relationshipPerson2.id]) {
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

        // check if chains should be restricted
        if (options.noContactChains) {
          // transmission chains are build only by case/event-case/event relationships
          if (relationshipPerson1.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT' || relationshipPerson2.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT') {
            if (options.countContacts) {
              addPeoplePairToCaseEventToContactMap(relationshipPerson1, relationshipPerson2);
            }
            relationsIndex++;
            continue;
          }
        }

        // define some shortcuts
        const person1 = personIds[0],
          person2 = personIds[1],
          indexPerson1 = personIdToChainMap[person1],
          indexPerson2 = personIdToChainMap[person2];

        let length;
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
            length = transmissionChains.push([[person1, person2]]);
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

        // keep an index for people in the chain
        const transmissionChainPersonIndex = {};

        // map each person from the chain into the index
        transmissionChain.forEach(function (peoplePair) {
          peoplePair.forEach(function (personId) {
            transmissionChainPersonIndex[personId] = true;
          });
        });

        // if count contacts flag is set, count the number of contacts per chain
        let contactsCount = 0;
        if (options.countContacts) {
          // unique list of contacts per all participants in a chain
          let contactsSet = new Set();

          const peopleKeys = Object.keys(transmissionChainPersonIndex);
          peopleKeys.forEach((person) => {
            if (caseEventToContactMap[person]) {
              contactsSet = new Set([...contactsSet, ...caseEventToContactMap[person]]);
            }
          });
          contactsCount = contactsSet.size;
        }

        // transmission chain size represents the number of people in the chain
        const transmissionChainSize = Object.keys(transmissionChainPersonIndex).length;

        // add it to the list of chains
        _chains.chains[resultIndex] = {chain: transmissionChain, active: isChainActive, size: transmissionChainSize};
        // include contacts count to chain information
        if (options.countContacts) {
          _chains.chains[resultIndex].contactsCount = contactsCount;
        }
        // store length for each chain
        chainsLengths[resultIndex] = {length: transmissionChain.length, active: isChainActive, size: transmissionChainSize};
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
        length: _chains.length,
        activeChainsCount: activeChainsLength
      };
    } else {
      // keep a map of edges (person:person) to edge data to easily locate edge (relation) data for transmission chain edges
      const edgesMap = {};
      // go through all edges
      Object.keys(edges).forEach(function (edgeId) {
        const edge = edges[edgeId];
        if (!edgesMap[`${edge.persons[0].id}:${edge.persons[1].id}`]) {
          // map them using a double index (person1:person2 & person2:person1) to locate the data regardless of how the edge is built
          edgesMap[`${edge.persons[0].id}:${edge.persons[1].id}`] =
            edgesMap[`${edge.persons[1].id}:${edge.persons[0].id}`] = [];
        }
        edgesMap[`${edge.persons[0].id}:${edge.persons[1].id}`].push(edge);
      });

      // go through the chains list
      _chains.chains.forEach(function (chain) {
        // go through all edges of a chain
        chain.chain.forEach(function (edge) {
          // get edge data
          edgesMap[`${edge[0]}:${edge[1]}`].forEach(function (edgeData) {
            // get contact date
            const contactDate = localizationHelper.toMoment(edgeData.contactDate).toDate();
            // keep a flag for changing data (to know when to re-calculate duration)
            let hadChanges = false;
            // start building period
            if (!chain.period) {
              // mark this as a change
              hadChanges = true;
              // start with first contact date
              chain.period = {
                startDate: contactDate,
                endDate: contactDate,
                duration: 0
              };
            }
            // if the contact date is earlier the current start date
            if (chain.period.startDate > contactDate) {
              // mark this as a change
              hadChanges = true;
              // change current start date with the contact date
              chain.period.startDate = contactDate;
            }
            // if the contact date is later than current end date
            if (chain.period.endDate < contactDate) {
              // mark this as a change
              hadChanges = true;
              // change current end date with the contact date
              chain.period.endDate = contactDate;
            }
            // if there were changes
            if (hadChanges) {
              // re-calculate duration (in days)
              chain.period.duration = Math.round((chain.period.endDate.getTime() - chain.period.startDate.getTime()) / 86400000);
            }
          });
        });
      });

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
  /**
   * Build transmission chains
   * @param relationships
   * @param followUpPeriod
   * @param options {{activeChainStartDate: Date}}
   * @return {*|{nodes, edges, transmissionChains: {chains: Array, length: number}}|{nodes, isolatedNodes, chains: Array, length: number, activeChainsCount: number}}
   */
  build: function (relationships, followUpPeriod, options = {}) {
    return this.buildOrCount(relationships, followUpPeriod, false, options);
  },
  /**
   * Count transmission chains
   * @param relationships
   * @param followUpPeriod
   * @param options {{activeChainStartDate: Date}}
   * @return {*|{nodes, edges, transmissionChains: {chains: Array, length: number}}|{nodes, isolatedNodes, chains: Array, length: number, activeChainsCount: number}}
   */
  count: function (relationships, followUpPeriod, options = {}) {
    return this.buildOrCount(relationships, followUpPeriod, true, options);
  }
};

process.on('message', function (message) {
  let result = worker[message.fn](...message.args);
  process.send([null, result]);
});

