const { ensureSeedData, isRegistered } = require('./utils/store');

const CLOUD_ENV = 'cloud1-d9gnyuxf5b44b6b92';
const MODEL_API_URL = '';
const LOCATION_PICKER_KEY = '';
const LOCATION_PICKER_REFERER = 'LockMyItem';
const LOCATION_PICKER_CATEGORY = '大学,餐饮,生活服务';

App({
  globalData: {
    user: null,
    cloudReady: false,
    cloudEnv: CLOUD_ENV,
    modelApiUrl: MODEL_API_URL,
    locationPickerKey: LOCATION_PICKER_KEY,
    locationPickerReferer: LOCATION_PICKER_REFERER,
    locationPickerCategory: LOCATION_PICKER_CATEGORY
  },

  onLaunch() {
    ensureSeedData();

    if (wx.cloud) {
      try {
        wx.cloud.init({
          env: CLOUD_ENV,
          traceUser: true
        });
        this.globalData.cloudReady = true;
      } catch (error) {
        this.globalData.cloudReady = false;
      }
    }

    setTimeout(() => {
      if (!isRegistered()) {
        wx.reLaunch({ url: '/pages/auth/auth' });
      }
    }, 200);
  }
});
