'use strict';

// dependencies
const App = require('../server/server');
const Helpers = require('./helpers');
const localizationHelper = require('./localizationHelper');
const PromiseQueue = require('p-queue');

// attach author timestamps (createdAt, updatedAt, createdBy, updatedBy)
// attach follow up index and address
const _createFollowUpEntry = function (props, contact) {
  // set index based on the difference in days from start date until the follow up set date
  // index is incremented by 1 because if follow up is on exact start day, the counter starts with 0
  props.index = localizationHelper.getDaysSince(contact.followUp.startDate, props.date) + 1;

  // set follow up address to match contact's current address
  props.address = App.models.person.getCurrentAddress(contact);
  props.usualPlaceOfResidenceLocationId = props.address && props.address.locationId ?
    props.address.locationId :
    null;

  return props;
};

// count contacts that have follow up period between the passed start/end dates
module.exports.countContactsEligibleForFollowup = function (startDate, endDate, outbreakId, contactIds, options) {
  // where condition used to count eligible contacts
  let where = {
    $and: [
      {
        outbreakId: outbreakId,
        // should have relationships
        hasRelationships: true,
        // at least one of the relationships needs to be active
        'relationshipsRepresentation.active': true,
        // only contacts that are under follow up
        'followUp.status': 'LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE_UNDER_FOLLOW_UP',
        $or: [
          {
            // follow up period is inside contact's follow up period
            $and: [
              {
                'followUp.startDate': {
                  $lte: startDate
                }
              },
              {
                'followUp.endDate': {
                  $gte: endDate
                }
              }
            ]
          },
          {
            // period starts before contact's start date but ends before contact's end date
            $and: [
              {
                'followUp.startDate': {
                  $gte: startDate
                }
              },
              {
                'followUp.startDate': {
                  $lte: endDate
                }
              },
              {
                'followUp.endDate': {
                  $gte: endDate
                }
              }
            ]
          },
          {
            // period starts before contact's end date and after contact's start date
            // but stops after contact's end date
            $and: [
              {
                'followUp.startDate': {
                  $lte: startDate
                }
              },
              {
                'followUp.endDate': {
                  $gte: startDate
                }
              },
              {
                'followUp.endDate': {
                  $lte: endDate
                }
              }
            ]
          },
          {
            // contact's period is inside follow up period
            $and: [
              {
                'followUp.startDate': {
                  $gte: startDate
                }
              },
              {
                'followUp.endDate': {
                  $gte: startDate
                }
              },
              {
                'followUp.endDate': {
                  $lte: endDate
                }
              }
            ]
          }
        ]
      }
    ]
  };

  // check if the follow-ups should be generated only for specific contacts.
  if (contactIds.length) {
    // let filter = { where: where};
    const filter = App.utils.remote
      .mergeFilters(
        {
          where: {
            _id: {
              $in: contactIds
            }
          }
        }, {
          where: where
        }
      );

    // use the merged conditions
    where = filter.where;
  }

  // add geographical restriction to filter if needed
  return App.models.person
    .addGeographicalRestrictions(options.remotingContext, where)
    .then(updatedFilter => {
      // update where if needed
      updatedFilter && (where = updatedFilter);

      // count
      return App.models.contact
        .count(where);
    });
};

// get contacts that have follow up period between the passed start/end dates
module.exports.getContactsEligibleForFollowup = function (startDate, endDate, outbreakId, contactIds, skip, limit, options) {
  // where condition used to count eligible contacts
  let where = {
    $and: [
      {
        outbreakId: outbreakId,
        // should have relationships
        hasRelationships: true,
        // at least one of the relationships needs to be active
        'relationshipsRepresentation.active': true,
        // only contacts that are under follow up
        'followUp.status': 'LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE_UNDER_FOLLOW_UP',
        $or: [
          {
            // follow up period is inside contact's follow up period
            $and: [
              {
                'followUp.startDate': {
                  $lte: startDate
                }
              },
              {
                'followUp.endDate': {
                  $gte: endDate
                }
              }
            ]
          },
          {
            // period starts before contact's start date but ends before contact's end date
            $and: [
              {
                'followUp.startDate': {
                  $gte: startDate
                }
              },
              {
                'followUp.startDate': {
                  $lte: endDate
                }
              },
              {
                'followUp.endDate': {
                  $gte: endDate
                }
              }
            ]
          },
          {
            // period starts before contact's end date and after contact's start date
            // but stops after contact's end date
            $and: [
              {
                'followUp.startDate': {
                  $lte: startDate
                }
              },
              {
                'followUp.endDate': {
                  $gte: startDate
                }
              },
              {
                'followUp.endDate': {
                  $lte: endDate
                }
              }
            ]
          },
          {
            // contact's period is inside follow up period
            $and: [
              {
                'followUp.startDate': {
                  $gte: startDate
                }
              },
              {
                'followUp.endDate': {
                  $gte: startDate
                }
              },
              {
                'followUp.endDate': {
                  $lte: endDate
                }
              }
            ]
          }
        ]
      }
    ]
  };

  // check if the follow-ups should be generated only for specific contacts.
  if (contactIds.length) {
    // let filter = { where: where};
    const filter = App.utils.remote
      .mergeFilters(
        {
          where: {
            _id: {
              $in: contactIds
            }
          }
        }, {
          where: where
        }
      );

    // use the merged conditions
    where = filter.where;
  }

  // add geographical restriction to filter if needed
  return App.models.person
    .addGeographicalRestrictions(options.remotingContext, where)
    .then(updatedFilter => {
      // update where if needed
      updatedFilter && (where = updatedFilter);

      // retrieve contacts
      return App.models.contact
        .rawFind(where, {
          skip: skip,
          limit: limit,
          sort: {
            createdAt: 1
          },
          projection: {
            outbreakId: 1,
            addresses: 1,
            followUp: 1,
            followUpTeamId: 1,
            responsibleUserId: 1
          }
        });
    });
};

// get list of follow ups ordered by created date for a given contact
module.exports.getContactFollowups = function (startDate, endDate, contactId) {
  return App.models.followUp
    .rawFind({
      personId: contactId,
      $and: [
        {
          date: {
            $gte: startDate
          }
        },
        {
          date: {
            $lte: endDate
          }
        }
      ]
    }, {
      sort: {
        date: 1
      },
      projection: {
        _id: 1,
        date: 1,
        personId: 1,
        statusId: 1,
        teamId: 1,
        responsibleUserId: 1
      }
    });
};

/**
 * Retrieve all teams and corresponding location/sub location
 * @param getLocationsHierarchy Flag specifying if location hierarchy is needed
 * @returns {*}
 */
module.exports.getAllTeamsWithLocationsIncluded = function (getLocationsHierarchy = false) {
  return App.models.team.find()
    .then((teams) => Promise.all(teams.map((team) => {
      return new Promise((resolve, reject) => {
        // if we need to get locations hierarchy we need to get team location and sublocations with all details
        // else the IDs are enough
        if (getLocationsHierarchy) {
          return App.models.location
            .getSubLocationsWithDetails(team.locationIds || [], [], {}, (err, locations) => {
              if (err) {
                return reject(err);
              }
              return resolve(locations);
            });
        } else {
          return App.models.location
            .getSubLocations(team.locationIds || [], [], (err, locations) => {
              if (err) {
                return reject(err);
              }
              return resolve(locations);
            });
        }
      })
        .then((locations) => {
          if (getLocationsHierarchy) {
            // if we need to get locations hierarchy we got team location and sublocations with all details
            // set the IDs in locations container to not break existing logic
            team.locations = locations.map(location => location.id);

            // also construct a flatten map for the hierarchical list
            // buildHierarchicalLocationsList function doesn't construct the list if there is no location with parentLocationId null
            // since we want the hierarchy to start from the team assigned locations we need to send those locations with parentLocationId null
            team.locationsFlattenReferences = App.models.location
              .getReferencesFromHierarchicalList(
                App.models.location.buildHierarchicalLocationsList(
                  locations.map(location => {
                    if (location.toJSON) {
                      location = location.toJSON();
                    }
                    // check if location is actually assigned to the team; in that case set parentLocationId to null
                    (team.locationIds.indexOf(location.id) !== -1) && (location.parentLocationId = null);

                    return location;
                  })
                )
              );
          } else {
            team.locations = locations;
          }

          return team;
        });
    })));
};

/**
 * Get nearest fit teams for given location
 * Will return all teams activating in the contact's nearest fit location.
 * Only teams from the nearest fit location (contact location or first found parent location) will be added in the result
 * Each team should have a locationsFlattenReferences property containing references for all team's locations and sublocations
 * Nearest fit teams will be the ones which have the shortest references for the contact location
 * @param teams Array of teams
 * @param location Location for which to find nearest fit teams
 * @returns {[]}
 */
const getNearestFitTeamsForLocation = function (teams, location) {
  // initialize result
  let nearestFitTeams = [];

  // initialize shortest ref distance container
  let shortestRefDistance;

  // loop through the teams and find the nearest ones for the location
  teams.forEach(team => {
    if (!team.locationsFlattenReferences) {
      // team doesn't have locations to check
      return;
    }

    // initialize team shortest ref container
    let teamShortestRefDistance;

    // loop through the locations until a 0 reference is found or the loop finishes
    for (let index = 0; index < team.locationsFlattenReferences.length; index++) {
      let locationRef = team.locationsFlattenReferences[index];
      let locationIndexInRef = locationRef.indexOf(location);
      if (locationIndexInRef === -1) {
        // ref doesn't contain location
        continue;
      }

      // ref contains location; get position
      let locationPositionInRef = locationIndexInRef === 0 ? 0 : locationRef.split('.').indexOf(location);

      if (teamShortestRefDistance !== undefined && teamShortestRefDistance <= locationPositionInRef) {
        // the contact location was already found as a shortest/equal ref length to the current one
        // the team is already added in the eligible teams; continue with next location ref maybe we can find a shorter ref
        continue;
      } else {
        // found ref is shorter than existing team ref; cache it as the shortest
        teamShortestRefDistance = locationPositionInRef;
      }

      // we need to add team in eligible teams if the shortest ref found until now is >= than found team ref
      if (shortestRefDistance === undefined || shortestRefDistance > teamShortestRefDistance) {
        // ref is shorter than existing shortest; reset findings and use it
        nearestFitTeams = [team.id];
        shortestRefDistance = teamShortestRefDistance;
      } else if (shortestRefDistance === teamShortestRefDistance) {
        // found team ref length is the same as the shortest ref found until now; add team
        nearestFitTeams.push(team.id);
      } else {
        // team shortest ref is longer than other teams shortest ref; nothing to do
      }

      // if found team shortest ref is 0 there is no need to continue the loop through the locations as there cannot be a shorter ref
      if (teamShortestRefDistance === 0) {
        break;
      }
    }
  });

  return nearestFitTeams;
};

/**
 * Get a contact's teams that are eligible for assignment on generated follow ups
 * Priority is a follows:
 * 1. use contact.followUpTeamId
 * 2. use latest contact.followUpsList assigned team if useLastAssignedTeam is true
 * 3. use "nearest fit" or "all teams" algorithm
 * @param contact
 * @param teams
 * @param useLastAssignedTeam Flag specifying whether last team assignment should be used for new follow-ups
 * @param eligibleTeamsAlgorithm Algorithm to be applied in order to select eligible teams
 * @returns {Promise<[]>}
 */
module.exports.getContactFollowupEligibleTeams = function (contact, teams, useLastAssignedTeam, eligibleTeamsAlgorithm) {
  // check for contact followUpTeamId
  if (contact.followUpTeamId) {
    // contact has a default assigned team; use it
    return Promise.resolve([contact.followUpTeamId]);
  }

  // check if last follow-up assigned team needs to be used
  if (useLastAssignedTeam &&
    Array.isArray(contact.followUpsList) && contact.followUpsList.length
  ) {
    // use latest assigned team
    // contact.followUpsList should be sorted ascending by date
    for (let i = contact.followUpsList.length - 1; i >= 0; i--) {
      let followUp = contact.followUpsList[i];
      if (followUp.teamId) {
        // found an assigned team on an existing follow-up; use it
        return Promise.resolve([followUp.teamId]);
      }
    }
  }

  // find all eligible teams depending on algorithm to use
  let eligibleTeams = [];
  // normalize addresses
  contact.addresses = contact.addresses || [];

  // first get the contact's usual place of residence
  let contactResidence = contact.addresses.find(address => address.typeId === 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE_USUAL_PLACE_OF_RESIDENCE');

  // check for algorithm; default round-robin of all teams
  if (
    !eligibleTeamsAlgorithm ||
    eligibleTeamsAlgorithm === 'LNG_REFERENCE_DATA_CATEGORY_FOLLOWUP_GENERATION_TEAM_ASSIGNMENT_ALGORITHM_ROUND_ROBIN_ALL_TEAMS'
  ) {
    // "all teams" algorithm
    // all teams activating in the contact's location via that location or parents. All teams from the location or parent locations will be added in the assignment pool
    if (contactResidence) {
      // try to find index of the address location in teams locations
      let filteredTeams = teams.filter((team) => team.locations.indexOf(contactResidence.locationId) !== -1);
      if (filteredTeams.length) {
        eligibleTeams = filteredTeams.map((team) => team.id);
      }
    } else {
      // check all contact addresses; stop at first address that has a matching team
      for (let i = 0; i < contact.addresses.length; i++) {
        // try to find index of the address location in teams locations
        let filteredTeams = teams.filter((team) => team.locations.indexOf(contact.addresses[i].locationId) !== -1);
        if (filteredTeams.length) {
          eligibleTeams = eligibleTeams.concat(filteredTeams.map((team) => team.id));
          break;
        }
      }
    }
  } else {
    // nearest fit algorithm
    // all teams activating in the contact's nearest fit location. Only teams from the nearest fit location (contact location or first found parent location) will be added in the assignment pool
    // in this case each team should have a locationsFlattenReferences property containing references for all team's locations and sublocations
    // nearest fit teams will be the ones which have the shortest references for the contact location
    if (contactResidence) {
      // find teams for contact residence
      eligibleTeams = getNearestFitTeamsForLocation(teams, contactResidence.locationId);
    } else {
      // check all contact addresses; stop at first address that has a matching team
      for (let i = 0; i < contact.addresses.length; i++) {
        let contactAddressLocationId = contact.addresses[i].locationId;
        if (!contactAddressLocationId) {
          // address doesn't have a locationId set; check next address
          continue;
        }

        let nearestFitTeamsForAddress = getNearestFitTeamsForLocation(teams, contactAddressLocationId);
        if (nearestFitTeamsForAddress.length) {
          // found an address where some teams can reach; stop the search
          eligibleTeams = nearestFitTeamsForAddress;
          break;
        }
      }
    }
  }

  return Promise.resolve(eligibleTeams);
};

/**
 * Generate follow ups for a given period
 * @param contact
 * @param teams
 * @param period
 * @param freq
 * @param freqPerDay
 * @param targeted
 * @param overwriteExistingFollowUps flag specifying whether exiting follow-ups should be overwritten
 * @param teamAssignmentPerDay map of team assignment per day; used to not rely only on round-robin as we may reach odd scenarios
 * @param intervalOfFollowUp Option specifying the interval when follow-ups should be generated. If empty then no restrictions will be applied, otherwise it will generate follow-ups only on specific days (interval sample: '1, 3, 5')
 * @returns {{add: [], update: {}}}
 */
module.exports.generateFollowupsForContact = function (
  contact,
  teams,
  period,
  freq,
  freqPerDay,
  targeted,
  overwriteExistingFollowUps,
  teamAssignmentPerDay,
  intervalOfFollowUp
) {

  // process follow-up interval restrictions
  let intervalOfFollowUpRestrictions;
  if (intervalOfFollowUp) {
    const intervalOfFollowUpValues = intervalOfFollowUp.split(',').map((v) => v.trim()).filter((v) => !!v);
    if (
      intervalOfFollowUpValues &&
      intervalOfFollowUpValues.length > 0
    ) {
      intervalOfFollowUpRestrictions = {};
      intervalOfFollowUpValues.forEach((followUpIndexDay) => {
        intervalOfFollowUpRestrictions[followUpIndexDay] = true;
      });
    }
  }

  /**
   * Get ID of the team with the smallest number of assignments for the day
   */
  const getTeamIdToAssign = function (followUpDate) {
    if (!teams.length) {
      return;
    }

    // get teams with the smallest number of assignments for the day
    let eligibleTeams = [];
    let lowestAssignments;
    for (let i = 0; i < teams.length; i++) {
      let teamId = teams[i];

      if (!teamAssignmentPerDay[followUpDate][teamId]) {
        // team was not yet assigned on this day
        eligibleTeams = [teamId];

        // stop at first team which was not assigned on this day
        break;
      } else if (
        typeof lowestAssignments === 'undefined' ||
        lowestAssignments >= teamAssignmentPerDay[followUpDate][teamId]
      ) {
        // found team with less or equal number of assignments
        if (!lowestAssignments || lowestAssignments > teamAssignmentPerDay[followUpDate][teamId]) {
          // set new low
          lowestAssignments = teamAssignmentPerDay[followUpDate][teamId];
          // reinitialize eligible teams
          eligibleTeams = [teamId];
        } else {
          // same number of assignments as the teams already in the pool
          eligibleTeams.push(teamId);
        }
      }
    }

    // get team for the follow-up
    const teamIdToAssign = eligibleTeams[0];
    if (teamAssignmentPerDay[followUpDate][teamIdToAssign]) {
      teamAssignmentPerDay[followUpDate][teamIdToAssign]++;
    } else {
      teamAssignmentPerDay[followUpDate][teamIdToAssign] = 1;
    }

    return teamIdToAssign;
  };

  let followUpsToAdd = [];
  let followUpsToUpdate = {};

  // if passed period is higher than contact's follow up period
  // restrict follow up start/date to a maximum of contact's follow up period
  let firstIncubationDay = Helpers.getDate(contact.followUp.startDate);
  let lastIncubationDay = Helpers.getDate(contact.followUp.endDate);
  if (period.endDate.isAfter(lastIncubationDay)) {
    period.endDate = lastIncubationDay.clone();
  }
  if (period.startDate.isBefore(firstIncubationDay)) {
    period.startDate = firstIncubationDay.clone();
  }

  // generate follow up, starting from today
  for (let followUpDate = period.startDate.clone(); followUpDate <= period.endDate; followUpDate.add(freq, 'day')) {
    // initialize team assignment map entry
    !teamAssignmentPerDay[followUpDate] && (teamAssignmentPerDay[followUpDate] = {});

    // number of follow ups to be generated per day
    let numberOfFollowUpsPerDay = freqPerDay;

    // ids to delete for the current date
    let followUpIdsToUpdateForDate = [];

    // get list of follow ups that are on the same day as the day we want to generate
    let followUpsInThisDay = contact.followUpsList.filter((followUp) => Helpers.getDate(followUp.date).isSame(followUpDate, 'd'));
    let followUpsInThisDayCount = followUpsInThisDay.length;

    // do not generate over the daily quota
    numberOfFollowUpsPerDay -= followUpsInThisDayCount;

    // for today and in the future,
    // if overwriteExistingFollowUps is true
    // recreate the follow ups that are not performed
    if (overwriteExistingFollowUps && followUpDate.isSameOrAfter(Helpers.getDateEndOfDay(), 'day')) {
      followUpIdsToUpdateForDate.push(...followUpsInThisDay
        .filter(f => {
          if (f.statusId !== 'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE_NOT_PERFORMED') {
            // this followup will not be regenerated; add team assignment to map
            if (teamAssignmentPerDay[followUpDate][f.teamId]) {
              teamAssignmentPerDay[followUpDate][f.teamId]++;
            } else {
              teamAssignmentPerDay[followUpDate][f.teamId] = 1;
            }
          } else {
            return true;
          }
        })
        .map(f => f.id)
      );
    }

    // recreate deleted follow ups, by retaining the UID
    followUpIdsToUpdateForDate.forEach(id => {
      // create follow-up
      const followUp = _createFollowUpEntry({
        // used to easily trace all follow ups for a given outbreak
        outbreakId: contact.outbreakId,
        id: id,
        personId: contact.id,
        date: followUpDate.toDate(),
        targeted: targeted,
        // split the follow ups work equally across teams
        teamId: getTeamIdToAssign(followUpDate),
        statusId: 'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE_NOT_PERFORMED',
        responsibleUserId: contact.responsibleUserId
      }, contact);

      // do we need to update this follow-ups ?
      if (
        !intervalOfFollowUpRestrictions ||
        intervalOfFollowUpRestrictions[followUp.index + '']
      ) {
        // update follow-up
        followUpsToUpdate[id] = followUp;
      }
    });

    // add brand new follow ups, until the daily quota is reached
    for (let i = 0; i < numberOfFollowUpsPerDay; i++) {
      // generate follow-up
      const followUp = _createFollowUpEntry({
        // used to easily trace all follow ups for a given outbreak
        outbreakId: contact.outbreakId,
        personId: contact.id,
        date: followUpDate.toDate(),
        targeted: targeted,
        // split the follow ups work equally across teams
        teamId: getTeamIdToAssign(followUpDate),
        statusId: 'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE_NOT_PERFORMED',
        responsibleUserId: contact.responsibleUserId
      }, contact);

      // do we need to create this follow-ups ?
      if (
        !intervalOfFollowUpRestrictions ||
        intervalOfFollowUpRestrictions[followUp.index + '']
      ) {
        // add it to the list
        followUpsToAdd.push(followUp);
      }
    }
  }

  return {
    add: followUpsToAdd,
    update: followUpsToUpdate
  };
};

module.exports.dbOperationsQueue = function (opts) {
  const queue = new PromiseQueue({
    autoStart: true,
    concurrency: 10 // we do 10 parallel operation across the entire app
  });

  // count of inserted items into database
  queue.count = 0;

  // we do insert operations in database in batches of 100000
  queue.insertBatchSize = 1e5;

  // for remove operations we need to use at most 1000 operations
  // otherwise mongodb throw error because $in operator is too long
  queue.deleteBatchSize = 900;

  // temporary lists of follow ups to be deleted and added in database
  let addList = [];
  let delList = [];

  // list of records waiting to be added after the deletion of existing record with the same id
  let waitingList = {};

  const _insert = function (arr) {
    return () => App.models.followUp
      .rawBulkInsert(arr, null, opts)
      .then(result => {
        queue.count += result.insertedCount;
        return Promise.resolve();
      });
  };

  const _recreate = function (arr, ignore) {
    return () => App.models.followUp
      .rawBulkHardDelete({
        _id: {
          $in: arr
        }
      })
      .then(() => {
        const records = [];
        arr.forEach(id => {
          records.push(waitingList[id]);
          delete waitingList[id];
        });
        _enqueueForInsert(records, ignore);
      });
  };

  const _enqueueForInsert = function (items, ignore) {
    if (ignore) {
      queue.add(_insert(items));
    } else {
      addList.push(...items);
      if (addList.length >= queue.insertBatchSize) {
        queue.add(_insert(addList));
        addList = [];
      }
    }
  };

  const _enqueueForRecreate = function (items, ignore) {
    if (ignore) {
      queue.add(_recreate(items, ignore));
    } else {
      delList.push(...items);
      if (delList.length >= queue.deleteBatchSize) {
        queue.add(_recreate(delList));
        delList = [];
      }
    }
  };

  return {
    // count of follow ups inserted into database
    insertedCount() {
      return queue.count;
    },
    // adds records into queue to be recreated
    // if the batch size is not reached it waits
    enqueueForRecreate(list) {
      const ids = [];
      for (let id in list) {
        waitingList[id] = list[id];
        ids.push(id);
      }
      _enqueueForRecreate(ids);
    },
    // adds records into queue to be inserted
    // if the batch size is not reached it waits
    enqueueForInsert: _enqueueForInsert,
    // internal queue reference, needed to check when the queue is empty
    internalQueue: queue,
    // settle remaining record to be inserted from database
    // this is needed because at the end there might be records left in the list and the limit is not reached
    // those should be processed as well
    settleRemaining() {
      // make sure there are not left item to process
      // doing this to avoid case when the number of follow ups didn't reach the threshold
      // and were never processed
      if (delList.length) {
        _enqueueForRecreate(delList, true);
      }
      if (addList.length) {
        _enqueueForInsert(addList, true);
      }
      return queue.onIdle();
    }
  };
};
