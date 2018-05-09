'use strict';

module.exports = function (Cluster) {
  // set flag to not get controller
  Cluster.hasController = false;
};
