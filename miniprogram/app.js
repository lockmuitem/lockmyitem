const { ensureSeedData } = require('./utils/store');

App({
  globalData: {
    user: null,
    cloudReady: false
  },

  onLaunch() {
    ensureSeedData();

    const cloudEnv = 'replace-with-your-cloud-env-id';
    if (wx.cloud && cloudEnv !== 'replace-with-your-cloud-env-id') {
      wx.cloud.init({
        env: cloudEnv,
        traceUser: true
      });
      this.globalData.cloudReady = true;
    }
  }
});
