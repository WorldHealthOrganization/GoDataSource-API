'use strict';

/**
 * Note: It is not exposed as an actual controller
 * It extends the Outbreak controller with case related actions
 */

module.exports = function (Outbreak) {
  /**
   * Since this endpoint returns person data without checking if the user has the required read permissions,
   * check the user's permissions and return only the fields he has access to
   */
  Outbreak.afterRemote('prototype.findPeopleInCluster', function (context, people, next) {
    const personTypesWithReadAccess = Outbreak.helpers.getUsersPersonReadPermissions(context);

    people.forEach((person, index) => {
      person = person.toJSON();
      Outbreak.helpers.limitPersonInformation(person, personTypesWithReadAccess);
      people[index] = person;
    });
    next();
  });

  /**
   * Find the list of people in a cluster
   * @param clusterId
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.findPeopleInCluster = function (clusterId, filter, options, callback) {
    // find people in a cluster
    Outbreak.prototype.findOrCountPeopleInCluster(clusterId, filter, false, options, callback);
  };

  /**
   * Count the people in a cluster
   * @param clusterId
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.countPeopleInCluster = function (clusterId, filter, options, callback) {
    // count people in cluster
    Outbreak.prototype.findOrCountPeopleInCluster(clusterId, filter, true, options, callback);
  };
};
