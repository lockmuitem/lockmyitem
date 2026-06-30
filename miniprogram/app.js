const { ensureSeedData } = require('./utils/store');

App({
  globalData: {
    user: null,
    cloudReady: false
  },

  onLaunch() {
    ensureSeedData();

    if (wx.cloud) {
      try {
        wx.cloud.init({ traceUser: true });
        this.globalData.cloudReady = true;
      } catch (error) {
        this.globalData.cloudReady = false;
      }
    }
  }
});
