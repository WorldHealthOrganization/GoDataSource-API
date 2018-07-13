'use strict';

module.exports = function (Location) {

  /**
   * Do not allow the creation of a location with a name/synonyms that is not unique in the same context
   */
  Location.beforeRemote("create", function (context, modelInstance, next) {
    Location.validateModelIdentifiers(context.args.data)
      .then(() => {
        next();
      })
      .catch(next);
  });

  /**
   * Do not allow the update of a location with a name/synonyms that is not unique in the same context.
   * Do not allow the deactivation a location if it still has sub-locations that are active
   */
  Location.beforeRemote("prototype.patchAttributes", function (context, modelInstance, next) {
    Location.validateModelIdentifiers(context.args.data, context.instance.id)
      .then(() => {
        if (context.args.data.active === false) {
          return Location.checkIfCanDeactivate(context.args.data, context.instance.id);
        }
      })
      .then(() => {
        next();
      })
      .catch((error) => {
        next(error);
      });
  });

  /**
   * Do not allow the deletion of a location if it still has sub-locations
   */
  Location.beforeRemote("deleteById", function (context, modelInstance, next) {
    Location.checkIfCanDelete(context.args.id)
      .then(() => {
        next();
      })
      .catch(next);
  });

  /**
   * Export hierarchical locations list
   * @param callback
   */
  Location.exportHierarchicalList = function (callback) {
    Location
      .find({
        order: 'parentLocationId ASC, id ASC'
      })
      .then(function (locations) {
        callback(null, JSON.stringify(Location.buildHierarchicalLocationsList(locations), null, 2), 'application/json', 'attachment;filename=locations.json');
      }).catch(callback);
  }
};
