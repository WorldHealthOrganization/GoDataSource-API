'use strict';

const app = require('../../server/server');
const _ = require('lodash');
const helpers = require('../../components/helpers');

module.exports = function (HelpItem) {
  /**
   * Default sort for help items
   * @type {string[]}
   */
  HelpItem.defaultOrder = [
    'order ASC'
  ];

  /**
   * Replace the translatable fields with language tokens before saving
   * Save translatable fields values, to create translations later
   */
  HelpItem.observe('before save', function (context, next) {
    // do not execute hook on sync
    if (context.options && context.options._sync) {
      return next();
    }

    if (context.isNewInstance) {
      let instance = context.instance;
      let identifier = `${context.instance.categoryId}_${_.snakeCase(HelpItem.modelName).toUpperCase()}_${_.snakeCase(instance.title).toUpperCase()}`;

      // set instance id, before setting the original context
      // because the setter takes in account the current instance id
      instance.id = identifier;

      // cache original values used to generate the identifier
      helpers.setOriginalValueInContextOptions(context, 'title', instance.title);
      helpers.setOriginalValueInContextOptions(context, 'content', instance.content);

      // update instance with generated identifier
      instance.title = identifier;
      instance.content = identifier + '_DESCRIPTION';
    } else {
      if (context.data && (context.data.title || context.data.content)) {
        let originalValues = {};
        let data = context.data;

        if (data.title) {
          originalValues.title = data.title;
          delete data.title;
        }

        if (data.content) {
          originalValues.content = data.content;
          delete data.content;
        }

        // cache original values used to generate the identifier
        helpers.setOriginalValueInContextOptions(context, 'title', originalValues.title);
        helpers.setOriginalValueInContextOptions(context, 'content', originalValues.content);
      }
    }

    next();
  });

  /**
   * Create language token translations for each available language
   * Defaults to user language at the time of creation
   */
  HelpItem.observe('after save', function (context, next) {
    // do not execute hook on sync
    if (context.options && context.options._sync) {
      return next();
    }

    const models = app.models;
    const languageTokenModel = models.languageToken;

    // retrieve original values
    let originalTitle = helpers.getOriginalValueFromContextOptions(context, 'title');
    let originalContent = helpers.getOriginalValueFromContextOptions(context, 'content');

    if (context.isNewInstance) {
      // content is optional
      if (originalTitle) {
        let tokenPromises = [];
        models.language
          .find()
          .then(function (languages) {
            return languages.forEach((language) => {
              tokenPromises.push(
                languageTokenModel
                  .create({
                    token: context.instance.title,
                    languageId: language.id,
                    translation: originalTitle
                  }, context.options),
                languageTokenModel
                  .create({
                    token: context.instance.content,
                    languageId: language.id,
                    translation: originalContent
                  }, context.options)
              );
            });
          })
          .then(() => Promise.all(tokenPromises))
          .then(() => next())
          .catch((err) => next(err));
      } else {
        next();
      }
    } else {
      if (originalTitle || originalContent) {
        let languageId = context.options.remotingContext.req.authData.user.languageId;
        let languageToken = context.instance.id;
        let updateActions = [];

        let updateFields = [];

        if (originalTitle) {
          updateFields.push('title');
        }

        if (originalContent) {
          updateFields.push('content');
        }

        updateFields.forEach((updateField) => {
          updateActions.push(
            languageTokenModel
              .findOne({
                where: {
                  token: updateField === 'content' ? languageToken + '_DESCRIPTION' : languageToken,
                  languageId: languageId
                }
              })
              .then((languageToken) => {
                return languageToken.updateAttribute(
                  'translation',
                  helpers.getOriginalValueFromContextOptions(context, updateField),
                  context.options
                );
              })
          );
        });

        Promise.all(updateActions)
          .then(() => next())
          .catch(next);
      } else {
        next();
      }
    }
  });

  /**
   * Retrieve help items using mongo aggregation directly
   * @param filter
   * @param countOnly Boolean
   */
  HelpItem.findAggregate = (
    filter,
    countOnly
  ) => {
    return new Promise((resolve, reject) => {
      // convert filter to mongodb filter structure
      filter = filter || {};
      let whereFilter = filter.where ? app.utils.remote.convertLoopbackFilterToMongo(filter.where) : {};

      // add other conditions
      const whereAdditionalConditions = {
        $or: [
          {
            deleted: false
          },
          {
            deleted: {
              $eq: null
            }
          }
        ]
      };

      // construct the final query filter
      whereFilter = _.isEmpty(whereFilter) ?
        whereAdditionalConditions : {
          $and: [
            whereFilter,
            whereAdditionalConditions
          ]
        };

      // construct aggregate filters
      const aggregatePipeline = [
        {
          $match: whereFilter
        }
      ];

      // no need to retrieve contact data, sort & skip records if we just need to count
      if (countOnly) {
        aggregatePipeline.push({
          $project: {
            _id: 1
          }
        });
      } else {
        aggregatePipeline.push(...[
          {
            $lookup: {
              from: 'helpCategory',
              localField: 'categoryId',
              foreignField: '_id',
              as: 'category'
            }
          }, {
            $unwind: {
              path: '$category',
              preserveNullAndEmptyArrays: true
            }
          }
        ]);

        // parse order props
        const knownOrderTypes = {
          ASC: 1,
          DESC: -1
        };
        const orderProps = {};
        if (Array.isArray(filter.order)) {
          filter.order.forEach((pair) => {
            // split prop and order type
            const split = pair.split(' ');
            // ignore if we don't receive a pair
            if (split.length !== 2) {
              return;
            }
            split[1] = split[1].toUpperCase();
            // make sure the order type is known
            if (!knownOrderTypes.hasOwnProperty(split[1])) {
              return;
            }
            orderProps[split[0]] = knownOrderTypes[split[1]];
          });
        }

        // do not add sort with 0 items, it will throw error
        if (Object.keys(orderProps).length) {
          aggregatePipeline.push({
            $sort: orderProps
          });
        }

        // we only add pagination fields if they are numbers
        // otherwise aggregation will fail
        if (!isNaN(filter.skip)) {
          aggregatePipeline.push({
            $skip: filter.skip
          });
        }
        if (!isNaN(filter.limit)) {
          aggregatePipeline.push({
            $limit: filter.limit
          });
        }
      }

      // retrieve data
      app.dataSources.mongoDb.connector
        .collection('helpItem')
        .aggregate(aggregatePipeline)
        .toArray()
        .catch(reject)
        .then((records) => {
          // make sure we have an array
          records = records || [];

          // count records ?
          if (countOnly) {
            return resolve(records.length);
          }

          // replace _id with id
          // root._id & root.category._id
          records.forEach((record) => {
            // root._id
            record.id = record._id;
            delete record._id;

            // root.category._id
            if (record.category) {
              record.category.id = record.category._id;
              delete record.category._id;
            }
          });

          // finished
          resolve(records);
        });
    });
  };
};
