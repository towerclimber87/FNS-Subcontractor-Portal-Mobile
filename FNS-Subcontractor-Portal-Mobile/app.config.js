const appJson = require('./app.json');

module.exports = () => ({
  ...appJson.expo,
  extra: {
    ...(appJson.expo.extra || {}),
    portalType: 'subcontractor',
    mobileReleaseVersion: appJson.expo.version,
  },
});
