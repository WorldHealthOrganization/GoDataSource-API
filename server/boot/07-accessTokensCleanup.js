
module.exports = function (app) {
  if (app.settings.signoutUsersOnRestart) {
    const db = app.dataSources.mongoDb.connector;
    db.connect(() => db.collection('accessToken').remove({}));
  }
};
