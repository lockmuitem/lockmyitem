const { CATEGORIES } = require('../../utils/constants');
const { createItem, searchLocations, classifyByText, findPotentialMatches } = require('../../utils/store');
const { CAMPUS_CENTER, nearestCampusLocations } = require('../../utils/locations');

function initialForm() {
  return {
    type: 'found',
    title: '',
    description: '',
    category: '',
    aiTags: [],
    imageUrls: [],
    locationId: '',
    locationDetail: ''
  };
}

function isCloudFile(filePath = '') {
  return String(filePath).startsWith('cloud://');
}

Page({
  data: {
    categories: CATEGORIES,
    locationKeyword: '',
    locations: searchLocations(),
    locationCandidates: [],
    locating: false,
    classifying: false,
    locationTip: '正在定位到上科大校内地点...',
    potentialMatches: [],
    form: initialForm()
  },

  onLoad(options) {
    const nextForm = initialForm();
    if (options.type) nextForm.type = options.type;
    if (options.image) {
      nextForm.imageUrls = [decodeURIComponent(options.image)];
      nextForm.category = '其他';
      nextForm.aiTags = ['图片自动识别'];
    }
    this.setData({ form: nextForm }, () => this.detectCampusLocation());
  },

  setType(event) {
    this.setData({ 'form.type': event.currentTarget.dataset.type }, () => this.refreshPotentialMatches());
  },

  setCategory(event) {
    this.setData({
      'form.category': event.currentTarget.dataset.category,
      'form.aiTags': ['手动校正']
    }, () => this.refreshPotentialMatches());
  },

  clearCategory() {
    this.setData({
      'form.category': '',
      'form.aiTags': [],
      potentialMatches: []
    });
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: event.detail.value });
    if (field === 'title' || field === 'description') {
      const imageUrl = (this.data.form.imageUrls || [])[0] || '';
      if (isCloudFile(imageUrl)) {
        this.scheduleImageReclassification();
        return;
      }
      const result = classifyByText(`${this.data.form.title} ${this.data.form.description}`);
      if (result.confidence > 0 || event.detail.value.trim()) {
        this.setData({
          'form.category': result.category,
          'form.aiTags': result.aiTags
        }, () => this.refreshPotentialMatches());
      }
    }
  },

  detectCampusLocation() {
    this.setData({ locating: true, locationTip: '正在申请位置权限...' });
    wx.getSetting({
      success: (setting) => {
        const authorized = setting.authSetting['scope.userLocation'];
        if (authorized) {
          this.getPreciseCampusLocation();
          return;
        }
        if (authorized === false) {
          this.openLocationSetting();
          return;
        }
        wx.authorize({
          scope: 'scope.userLocation',
          success: () => this.getPreciseCampusLocation(),
          fail: () => this.handleLocationUnavailable('未获得定位权限，请手动选择上科大校内地点')
        });
      },
      fail: () => this.handleLocationUnavailable('无法读取定位权限，请手动选择上科大校内地点')
    });
  },

  openLocationSetting() {
    wx.showModal({
      title: '需要位置权限',
      content: '开启定位后才能自动匹配上科大校内地点，也可以稍后手动选择。',
      confirmText: '去开启',
      cancelText: '手动选择',
      success: (modalRes) => {
        if (!modalRes.confirm) {
          this.handleLocationUnavailable('未获得定位权限，请手动选择上科大校内地点');
          return;
        }
        wx.openSetting({
          success: (setting) => {
            if (setting.authSetting['scope.userLocation']) {
              this.getPreciseCampusLocation();
            } else {
              this.handleLocationUnavailable('未获得定位权限，请手动选择上科大校内地点');
            }
          },
          fail: () => this.handleLocationUnavailable('未获得定位权限，请手动选择上科大校内地点')
        });
      }
    });
  },

  getPreciseCampusLocation() {
    this.setData({ locating: true, locationTip: '正在获取精准位置...' });
    wx.getLocation({
      type: 'gcj02',
      isHighAccuracy: true,
      highAccuracyExpireTime: 4000,
      success: (res) => this.applyLocatedPosition(res),
      fail: () => this.handleLocationUnavailable('定位失败，请手动选择上科大校内地点'),
      complete: () => {
        this.setData({ locating: false });
      }
    });
  },

  applyLocatedPosition(res) {
    const candidates = nearestCampusLocations(res, 8);
    const nearest = candidates[0];
    const accuracy = Math.round(Number(res.accuracy) || 0);
    if (!nearest || nearest.distance > 1200) {
      this.setData({
        locationCandidates: nearestCampusLocations(CAMPUS_CENTER, 8),
        locationTip: `当前位置距离上科大约 ${nearest ? nearest.distance : '较远'}m，请确认微信开发者工具或手机定位是否在校内`,
        'form.locationId': '',
        locationKeyword: '',
        locations: searchLocations()
      });
      return;
    }
    const isLowAccuracy = accuracy >= 60 || nearest.distance > 80;
    const tip = isLowAccuracy
      ? `定位精度约 ${accuracy || '未知'}m，已预选 ${nearest.name}，请在候选地点中确认`
      : `已按当前位置匹配到 ${nearest.name}，可在下方切换候选地点`;
    this.setData({ locationCandidates: candidates });
    this.setLocation(nearest, tip);
  },

  handleLocationUnavailable(tip) {
    this.setData({
      locating: false,
      locationCandidates: nearestCampusLocations(CAMPUS_CENTER, 8),
      locationTip: tip,
      'form.locationId': '',
      locationKeyword: '',
      locations: searchLocations()
    });
  },

  setLocation(location, tip) {
    this.setData({
      'form.locationId': location._id,
      locationKeyword: location.name,
      locations: searchLocations(location.name),
      locationTip: tip
    }, () => this.refreshPotentialMatches());
  },

  searchLocation(event) {
    const keyword = event.detail.value;
    this.setData({
      locationKeyword: keyword,
      locations: searchLocations(keyword),
      locationCandidates: []
    });
  },

  selectLocation(event) {
    const location = searchLocations().find((entry) => entry._id === event.currentTarget.dataset.id);
    if (!location) return;
    this.setLocation(location, `已选择 ${location.name}`);
  },

  clearLocation() {
    this.setData({
      'form.locationId': '',
      locationKeyword: '',
      locationTip: '可重新定位或手动选择上科大校内地点',
      locationCandidates: [],
      locations: searchLocations()
    });
  },

  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const file = res.tempFiles[0];
        this.setData({
          'form.imageUrls': [file.tempFilePath],
          'form.aiTags': ['模型识别中'],
          classifying: true
        }, () => this.refreshPotentialMatches());
        this.classifySelectedImage(file.tempFilePath);
      }
    });
  },

  classifySelectedImage(tempFilePath) {
    const app = getApp();
    if (!app.globalData.cloudReady) {
      this.setData({ classifying: false, 'form.aiTags': [] });
      wx.showToast({ title: '请先配置云开发环境', icon: 'none' });
      return;
    }

    const suffix = tempFilePath.split('.').pop() || 'jpg';
    const cloudPath = `lostfound/${Date.now()}_${Math.random().toString(16).slice(2)}.${suffix}`;
    wx.cloud.uploadFile({
      cloudPath,
      filePath: tempFilePath,
      success: (uploadRes) => {
        this.classifyUploadedImage(uploadRes.fileID, { replaceImage: true });
      },
      fail: () => {
        this.setData({ classifying: false, 'form.aiTags': [] });
        wx.showToast({ title: '图片上传失败', icon: 'none' });
      }
    });
  },

  scheduleImageReclassification() {
    if (this._classifyHintTimer) clearTimeout(this._classifyHintTimer);
    this._classifyHintTimer = setTimeout(() => {
      const fileId = (this.data.form.imageUrls || [])[0] || '';
      if (isCloudFile(fileId)) {
        this.classifyUploadedImage(fileId, { replaceImage: false, silentFail: true });
      }
    }, 800);
  },

  classifyUploadedImage(fileId, options = {}) {
    const hint = [
      this.data.form.title,
      this.data.form.description,
      this.data.form.category,
      ...(this.data.form.aiTags || [])
    ].join(' ').trim();

    this.setData({
      classifying: true,
      'form.aiTags': this.data.form.aiTags.length ? this.data.form.aiTags : ['模型识别中']
    });

    wx.cloud.callFunction({
      name: 'lostfound',
      data: {
        action: 'classifyImage',
        fileId,
        hint
      },
      success: (callRes) => {
        const result = callRes.result || {};
        if (!result.ok) {
          this.setData({ classifying: false });
          if (!options.silentFail) wx.showToast({ title: result.message || '模型识别失败', icon: 'none' });
          return;
        }
        const data = result.data || {};
        const nextData = {
          'form.category': data.category || this.data.form.category,
          'form.aiTags': data.aiTags || [],
          'form.visualDescription': data.visualDescription || '',
          'form.yoloObjects': data.yoloObjects || [],
          'form.semanticTags': data.semanticTags || [],
          'form.imageEmbedding': data.imageEmbedding || [],
          'form.semanticEmbedding': data.semanticEmbedding || [],
          classifying: false
        };
        if (options.replaceImage) nextData['form.imageUrls'] = [fileId];
        this.setData(nextData, () => this.refreshPotentialMatches());
      },
      fail: () => {
        this.setData({ classifying: false });
        if (!options.silentFail) wx.showToast({ title: '云函数调用失败', icon: 'none' });
      }
    });
  },

  refreshPotentialMatches() {
    if (this.data.form.type !== 'lost') {
      this.setData({ potentialMatches: [] });
      return;
    }
    this.setData({
      potentialMatches: findPotentialMatches(this.data.form)
    });
  },

  goMatchDetail(event) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${event.currentTarget.dataset.id}` });
  },

  submit() {
    if (!this.data.form.imageUrls.length && !this.data.form.category) {
      wx.showToast({ title: '请上传图片或选择分类', icon: 'none' });
      return;
    }
    const item = createItem(this.data.form);
    wx.showToast({ title: '发布成功', icon: 'success' });
    this.setData({
      form: initialForm(),
      locationKeyword: '',
      locations: searchLocations()
    });
    wx.navigateTo({ url: `/pages/detail/detail?id=${item._id}` });
  }
});
