const { CATEGORIES } = require('../../utils/constants');
const { createItem, searchLocations, classifyByText, findPotentialMatches } = require('../../utils/store');
const { CAMPUS_CENTER, nearestCampusLocations } = require('../../utils/locations');

const COMMON_LOCATION_LIMIT = 10;
const MAP_PICKER_MAX_CAMPUS_DISTANCE = 1600;

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

function getErrorMessage(error, fallback = '请检查云开发配置') {
  const message = error && (error.message || error.errMsg || error.messageText || (error.result && error.result.message));
  const errCode = error && (error.errCode || error.errcode || (error.result && (error.result.errCode || error.result.errcode)));
  const requestId = error && (error.callID || error.requestID || error.requestId);
  return [
    errCode ? `errCode: ${errCode}` : '',
    String(message || fallback),
    requestId ? `callId: ${requestId}` : ''
  ].filter(Boolean).join(' | ').replace(/\s+/g, ' ').slice(0, 180);
}

function isCloudPermissionError(error) {
  return /-601034|没有权限|请先开通云开发|云托管|cloud\.callFunction:fail/i.test(getErrorMessage(error, ''));
}

function getRecognitionErrorText(error, fallback = '图片识别失败') {
  if (isCloudPermissionError(error)) {
    return '图片识别失败：当前 AppID 没有云开发调用权限，请在微信开发者工具开通云开发并选择正确环境';
  }
  return `图片识别失败：${getErrorMessage(error, fallback)}`;
}

function getImageMimeType(filePath = '') {
  const ext = String(filePath).split('?')[0].split('.').pop().toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

function compressImageForRecognition(filePath) {
  if (!wx.compressImage) return Promise.resolve(filePath);
  return new Promise((resolve) => {
    wx.compressImage({
      src: filePath,
      quality: 60,
      success: (res) => resolve(res.tempFilePath || filePath),
      fail: () => resolve(filePath)
    });
  });
}

function readImageAsBase64(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'base64',
      success: (res) => resolve(res.data),
      fail: reject
    });
  });
}

function normalizeModelData(raw = {}) {
  const payload = raw && raw.data && !raw.category && !raw.aiTags ? raw.data : raw;
  const tags = []
    .concat(payload.aiTags || [])
    .concat(payload.tags || [])
    .concat(payload.colors || [])
    .concat(payload.accessories || [])
    .filter(Boolean);
  return {
    title: payload.title || payload.name || '',
    description: payload.description || payload.visualDescription || payload.caption || '',
    category: payload.category || '',
    aiTags: tags,
    visualDescription: payload.visualDescription || payload.description || payload.caption || '',
    yoloObjects: payload.yoloObjects || payload.objects || [],
    semanticTags: payload.semanticTags || payload.tags || [],
    imageEmbedding: payload.imageEmbedding || payload.image_embedding || [],
    semanticEmbedding: payload.semanticEmbedding || payload.semantic_embedding || payload.embedding || []
  };
}

function requestModelApi(endpoint, imageBase64, mimeType, hint) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: endpoint,
      method: 'POST',
      header: {
        'content-type': 'application/json'
      },
      data: {
        imageBase64,
        mimeType,
        hint
      },
      success: (res) => {
        const body = res.data || {};
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(body.message || body.error || `HTTP ${res.statusCode}`));
          return;
        }
        if (body.ok === false) {
          reject(new Error(body.message || body.error || '模型接口返回失败'));
          return;
        }
        resolve(normalizeModelData(body.ok ? body.data : body));
      },
      fail: reject
    });
  });
}

function unique(values = []) {
  const seen = {};
  return values
    .map((value) => String(value || '').trim())
    .filter((value) => {
      if (!value || seen[value]) return false;
      seen[value] = true;
      return true;
    });
}

function normalizeObjectTag(entry) {
  if (!entry) return '';
  if (typeof entry === 'string') return entry;
  return entry.name || entry.label || entry.className || '';
}

function buildExtractedText(data = {}, form = {}) {
  const rawTags = []
    .concat(data.semanticTags || [])
    .concat(data.aiTags || [])
    .concat((data.yoloObjects || []).map(normalizeObjectTag))
    .concat(form.semanticTags || [])
    .concat(form.aiTags || [])
    .concat([data.category || form.category]);
  const ignored = {
    '模型识别中': true,
    '图片自动识别': true,
    '手动校正': true,
    '待确认': true,
    '其他': true
  };
  return unique(rawTags)
    .filter((tag) => !ignored[tag])
    .slice(0, 4)
    .join('、') || '物品特征待确认';
}

function getMatchTarget(type) {
  return type === 'lost' ? '历史招领' : '历史寻物';
}

function buildAiProcessSteps(stage, extractedText, type) {
  if (!stage || stage === 'idle') return [];
  if (stage === 'error') {
    return [{
      key: 'error',
      text: '图片识别失败，可手动填写或重新上传',
      status: 'error'
    }];
  }

  return [
    {
      key: 'recognize',
      text: '正在识别物品特征',
      status: stage === 'recognizing' ? 'active' : 'done'
    },
    {
      key: 'extract',
      text: extractedText ? `已提取：${extractedText}` : '等待提取颜色、类别和细节',
      status: extractedText ? 'done' : 'pending'
    },
    {
      key: 'match',
      text: `正在匹配${getMatchTarget(type)}`,
      status: stage === 'matching' ? 'active' : 'pending'
    }
  ];
}

function commonLocations() {
  return searchLocations().slice(0, COMMON_LOCATION_LIMIT).map((location) => ({
    ...location,
    distanceText: location.area || '校内地点'
  }));
}

function getLocationPickerPlugin() {
  if (typeof requirePlugin !== 'function') return null;
  try {
    return requirePlugin('chooseLocation');
  } catch (error) {
    return null;
  }
}

function normalizePickedLocation(location = {}) {
  const latitude = Number(location.latitude || location.lat);
  const longitude = Number(location.longitude || location.lng);
  return {
    ...location,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null
  };
}

function pickedLocationText(location = {}) {
  return unique([location.name, location.address, location.city]).join(' · ') || '地图选点';
}

function matchCampusLocationByText(location = {}) {
  const source = `${location.name || ''} ${location.address || ''}`.toLowerCase();
  if (!source.trim()) return null;
  return searchLocations().find((campusLocation) => {
    const aliases = [campusLocation.name].concat(campusLocation.aliases || []);
    return aliases.some((alias) => {
      const value = String(alias || '').toLowerCase();
      return value && (source.includes(value) || value.includes(source.trim()));
    });
  });
}

function buildManualLocationConfirm(location) {
  return {
    label: '人工确认：',
    name: location && location.name ? location.name : '已选择地点',
    areaText: location && location.area ? location.area : '校内地点',
    confirmText: '已人工确认，可发布'
  };
}

Page({
  data: {
    categories: CATEGORIES,
    locationKeyword: '',
    locations: searchLocations(),
    locationCandidates: commonLocations(),
    locating: false,
    classifying: false,
    locationTip: '请选择发现或丢失的大致校内地点',
    locationState: 'idle',
    locationMeta: '不调用位置接口，可搜索地点或从常用地点中选择',
    locationConfirm: null,
    aiProcessStage: 'idle',
    aiExtractedText: '',
    aiProcessSteps: [],
    potentialMatches: [],
    modelError: '',
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
    this.setData({
      form: nextForm,
      locationCandidates: commonLocations(),
      locations: searchLocations()
    });
  },

  onShow() {
    this.consumeMapPickerResult();
  },

  onUnload() {
    const plugin = getLocationPickerPlugin();
    if (plugin && plugin.setLocation) plugin.setLocation(null);
  },

  setType(event) {
    const type = event.currentTarget.dataset.type;
    this.setData({
      'form.type': type,
      aiProcessSteps: buildAiProcessSteps(this.data.aiProcessStage, this.data.aiExtractedText, type)
    }, () => this.refreshPotentialMatches());
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

  showCommonLocations() {
    this.setData({
      locating: false,
      locationState: 'idle',
      locationMeta: '已显示常用校内地点，也可以继续搜索',
      locationConfirm: null,
      locationTip: '请选择发现或丢失的大致校内地点',
      locationCandidates: commonLocations(),
      locationKeyword: '',
      locations: searchLocations()
    });
  },

  getLocationPickerConfig() {
    const app = getApp();
    const cached = {
      key: app.globalData.locationPickerKey || '',
      referer: app.globalData.locationPickerReferer || 'LockMyItem',
      category: app.globalData.locationPickerCategory || '大学,餐饮,生活服务'
    };
    if (cached.key) return Promise.resolve(cached);
    if (!app.globalData.cloudReady || !wx.cloud) return Promise.resolve(cached);
    return new Promise((resolve) => {
      wx.cloud.callFunction({
        name: 'lostfound',
        data: { action: 'getPublicConfig' },
        success: (res) => {
          const config = res.result && res.result.data && res.result.data.locationPicker;
          const nextConfig = {
            key: (config && config.key) || cached.key,
            referer: (config && config.referer) || cached.referer,
            category: (config && config.category) || cached.category
          };
          app.globalData.locationPickerKey = nextConfig.key;
          app.globalData.locationPickerReferer = nextConfig.referer;
          app.globalData.locationPickerCategory = nextConfig.category;
          resolve(nextConfig);
        },
        fail: () => resolve(cached)
      });
    });
  },

  openLocationPicker() {
    this.getLocationPickerConfig().then((config) => {
      if (!config.key) {
        wx.showToast({ title: '请先配置地图选点Key', icon: 'none' });
        return;
      }
      const location = JSON.stringify({
        latitude: CAMPUS_CENTER.latitude,
        longitude: CAMPUS_CENTER.longitude
      });
      const params = [
        `key=${encodeURIComponent(config.key)}`,
        `referer=${encodeURIComponent(config.referer || 'LockMyItem')}`,
        `location=${encodeURIComponent(location)}`,
        `category=${encodeURIComponent(config.category || '大学,餐饮,生活服务')}`
      ].join('&');
      wx.navigateTo({
        url: `plugin://chooseLocation/index?${params}`,
        fail: () => wx.showToast({ title: '地图选点插件未启用', icon: 'none' })
      });
    });
  },

  consumeMapPickerResult() {
    const plugin = getLocationPickerPlugin();
    if (!plugin || !plugin.getLocation) return;
    const picked = normalizePickedLocation(plugin.getLocation() || {});
    if (!picked.name && !picked.address && !picked.latitude && !picked.longitude) return;
    if (plugin.setLocation) plugin.setLocation(null);
    this.applyMapPickedLocation(picked);
  },

  applyMapPickedLocation(picked) {
    const detail = pickedLocationText(picked);
    const textMatched = matchCampusLocationByText(picked);
    if (textMatched) {
      this.setLocation(textMatched, `地图选点已匹配到 ${textMatched.name}`, {
        meta: `地图选点：${detail}`,
        detail,
        confirm: {
          ...buildManualLocationConfirm(textMatched),
          label: '地图选点：',
          confirmText: '已根据地图选点匹配到校内地点，请确认后发布'
        }
      });
      return;
    }

    if (!picked.latitude || !picked.longitude) {
      this.setData({
        locationState: 'warn',
        locationTip: '地图选点未返回坐标，请搜索校内地点或重新选点',
        locationMeta: `地图选点：${detail}`,
        locationConfirm: null
      });
      return;
    }

    const candidates = nearestCampusLocations(picked, 6);
    const nearest = candidates[0];
    if (!nearest || nearest.distance > MAP_PICKER_MAX_CAMPUS_DISTANCE) {
      this.setData({
        locationCandidates: candidates.length ? candidates : commonLocations(),
        locationState: 'warn',
        locationTip: '地图选点距离校内地点较远，请确认后从候选地点中选择',
        locationMeta: `地图选点：${detail}`,
        locationConfirm: null,
        'form.locationId': '',
        'form.locationDetail': detail
      });
      return;
    }

    this.setLocation(nearest, `地图选点已匹配到 ${nearest.name}`, {
      meta: `地图选点：${detail} · 距校内地点 ${nearest.distance}m`,
      detail,
      confirm: {
        ...buildManualLocationConfirm(nearest),
        label: '地图选点：',
        confirmText: '已根据地图选点匹配到校内地点，请确认后发布'
      }
    });
    this.setData({ locationCandidates: candidates });
  },

  setLocation(location, tip, options = {}) {
    this.setData({
      'form.locationId': location._id,
      'form.locationDetail': options.detail || '',
      locationKeyword: location.name,
      locations: searchLocations(location.name),
      locationTip: tip,
      locationState: options.state || 'ok',
      locationMeta: options.meta || '地点由用户手动选择',
      locationConfirm: options.confirm || buildManualLocationConfirm(location),
      locating: options.locating === undefined ? this.data.locating : options.locating
    }, () => this.refreshPotentialMatches());
  },

  searchLocation(event) {
    const keyword = event.detail.value;
    this.setData({
      locationKeyword: keyword,
      locations: searchLocations(keyword),
      locationCandidates: [],
      locationConfirm: null
    });
  },

  selectLocation(event) {
    const id = event.currentTarget.dataset.id;
    const location = (this.data.locationCandidates || []).find((entry) => entry._id === id)
      || searchLocations().find((entry) => entry._id === id);
    if (!location) return;
    this.setLocation(location, `已选择 ${location.name}`);
  },

  clearLocation() {
    this.setData({
      'form.locationId': '',
      'form.locationDetail': '',
      locationKeyword: '',
      locationTip: '请选择发现或丢失的大致校内地点',
      locationState: 'idle',
      locationMeta: '不调用位置接口，可搜索地点或从常用地点中选择',
      locationConfirm: null,
      locationCandidates: commonLocations(),
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
          classifying: true,
          modelError: '',
          aiProcessStage: 'recognizing',
          aiExtractedText: '',
          aiProcessSteps: buildAiProcessSteps('recognizing', '', this.data.form.type)
        }, () => this.refreshPotentialMatches());
        this.classifySelectedImage(file.tempFilePath);
      }
    });
  },

  classifySelectedImage(tempFilePath) {
    const app = getApp();
    if (app.globalData.modelApiUrl) {
      this.classifyViaHttpModel(tempFilePath, app.globalData.modelApiUrl);
      return;
    }
    if (!app.globalData.cloudReady || !wx.cloud) {
      this.setData({
        classifying: false,
        'form.aiTags': [],
        modelError: '图片识别失败：云开发未初始化',
        aiProcessStage: 'error',
        aiProcessSteps: buildAiProcessSteps('error', '', this.data.form.type)
      });
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
      fail: (error) => {
        this.classifyLocalImageFallback(tempFilePath, {
          uploadError: getErrorMessage(error, '云存储上传失败'),
          silentFail: false
        });
      }
    });
  },

  classifyViaHttpModel(tempFilePath, endpoint) {
    const hint = this.buildRecognitionHint();
    this.setData({
      classifying: true,
      modelError: '',
      aiProcessStage: 'recognizing',
      aiExtractedText: '',
      aiProcessSteps: buildAiProcessSteps('recognizing', '', this.data.form.type)
    });
    compressImageForRecognition(tempFilePath)
      .then((compressedPath) => {
        return readImageAsBase64(compressedPath).then((imageBase64) => ({
          imageBase64,
          mimeType: getImageMimeType(compressedPath)
        }));
      })
      .then((payload) => requestModelApi(endpoint, payload.imageBase64, payload.mimeType, hint))
      .then((data) => this.applyRecognitionData(data, { fallbackFilePath: tempFilePath }))
      .catch((error) => {
        this.setData({
          classifying: false,
          'form.aiTags': [],
          modelError: `图片识别失败：${getErrorMessage(error, 'HTTP 模型接口调用失败')}`,
          aiProcessStage: 'error',
          aiProcessSteps: buildAiProcessSteps('error', '', this.data.form.type)
        });
        wx.showToast({ title: '图片识别失败', icon: 'none' });
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
    this.classifyImagePayload({ fileId }, options);
  },

  classifyLocalImageFallback(tempFilePath, options = {}) {
    this.setData({
      classifying: true,
      modelError: options.uploadError ? `${options.uploadError}，已改用图片直传识别` : ''
    });
    compressImageForRecognition(tempFilePath)
      .then((compressedPath) => {
        return readImageAsBase64(compressedPath).then((imageBase64) => ({
          imageBase64,
          mimeType: getImageMimeType(compressedPath)
        }));
      })
      .then((payload) => this.classifyImagePayload(payload, Object.assign({}, options, {
        replaceImage: false,
        fallbackFilePath: tempFilePath
      })))
      .catch((error) => {
        this.setData({
          classifying: false,
          'form.aiTags': [],
          modelError: getRecognitionErrorText(error, '图片读取失败'),
          aiProcessStage: 'error',
          aiProcessSteps: buildAiProcessSteps('error', '', this.data.form.type)
        });
        if (!options.silentFail) wx.showToast({ title: '图片识别失败', icon: 'none' });
      });
  },

  classifyImagePayload(payload = {}, options = {}) {
    const hint = this.buildRecognitionHint();

    this.setData({
      classifying: true,
      'form.aiTags': this.data.form.aiTags.length ? this.data.form.aiTags : ['模型识别中'],
      modelError: options.uploadError ? `${options.uploadError}，已改用图片直传识别` : '',
      aiProcessStage: 'recognizing',
      aiExtractedText: '',
      aiProcessSteps: buildAiProcessSteps('recognizing', '', this.data.form.type)
    });

    wx.cloud.callFunction({
      name: 'lostfound',
      data: Object.assign({
        action: 'classifyImage',
        hint
      }, payload),
      success: (callRes) => {
        const result = callRes.result || {};
        if (!result.ok) {
          this.setData({
            classifying: false,
            modelError: `图片识别失败：${result.message || '模型识别失败'}`,
            aiProcessStage: 'error',
            aiProcessSteps: buildAiProcessSteps('error', '', this.data.form.type)
          });
          if (!options.silentFail) wx.showToast({ title: result.message || '模型识别失败', icon: 'none' });
          return;
        }
        this.applyRecognitionData(normalizeModelData(result.data || {}), Object.assign({}, options, {
          fileId: payload.fileId
        }));
      },
      fail: (error) => {
        console.error('[lostfound] cloud classifyImage failed', error);
        this.setData({
          classifying: false,
          modelError: getRecognitionErrorText(error, '云函数调用失败'),
          aiProcessStage: 'error',
          aiProcessSteps: buildAiProcessSteps('error', '', this.data.form.type)
        });
        if (!options.silentFail) wx.showToast({ title: '查看红色错误详情', icon: 'none' });
      }
    });
  },

  buildRecognitionHint() {
    return [
      this.data.form.title,
      this.data.form.description,
      this.data.form.category,
      ...(this.data.form.aiTags || [])
    ].join(' ').trim();
  },

  applyRecognitionData(data = {}, options = {}) {
    const extractedText = buildExtractedText(data, this.data.form);
    const nextData = {
      'form.title': this.data.form.title || data.title || data.category || '',
      'form.description': this.data.form.description || data.description || data.visualDescription || '',
      'form.category': data.category || this.data.form.category,
      'form.aiTags': data.aiTags || [],
      'form.visualDescription': data.visualDescription || '',
      'form.yoloObjects': data.yoloObjects || [],
      'form.semanticTags': data.semanticTags || [],
      'form.imageEmbedding': data.imageEmbedding || [],
      'form.semanticEmbedding': data.semanticEmbedding || [],
      classifying: false,
      aiProcessStage: 'matching',
      aiExtractedText: extractedText,
      aiProcessSteps: buildAiProcessSteps('matching', extractedText, this.data.form.type),
      modelError: ''
    };
    if (options.replaceImage && options.fileId) nextData['form.imageUrls'] = [options.fileId];
    if (options.fallbackFilePath) nextData['form.imageUrls'] = [options.fallbackFilePath];
    this.setData(nextData, () => this.refreshPotentialMatches());
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
      locations: searchLocations(),
      modelError: '',
      aiProcessStage: 'idle',
      aiExtractedText: '',
      aiProcessSteps: [],
      locationCandidates: commonLocations(),
      locationTip: '请选择发现或丢失的大致校内地点',
      locationState: 'idle',
      locationMeta: '不调用位置接口，可搜索地点或从常用地点中选择',
      locationConfirm: null
    });
    wx.navigateTo({ url: `/pages/detail/detail?id=${item._id}` });
  }
});
