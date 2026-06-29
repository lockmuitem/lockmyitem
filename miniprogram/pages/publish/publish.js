const { CATEGORIES } = require('../../utils/constants');
const { createItem, searchLocations, classifyByText } = require('../../utils/store');

function initialForm() {
  return {
    type: 'found',
    title: '',
    description: '',
    category: '',
    aiTags: [],
    imageUrls: [],
    locationId: ''
  };
}

Page({
  data: {
    categories: CATEGORIES,
    locationKeyword: '',
    locations: searchLocations(),
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
    this.setData({ form: nextForm });
  },

  setType(event) {
    this.setData({ 'form.type': event.currentTarget.dataset.type });
  },

  setCategory(event) {
    this.setData({
      'form.category': event.currentTarget.dataset.category,
      'form.aiTags': ['手动校正']
    });
  },

  clearCategory() {
    this.setData({
      'form.category': '',
      'form.aiTags': []
    });
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: event.detail.value });
    if (field === 'title' || field === 'description') {
      const result = classifyByText(`${this.data.form.title} ${this.data.form.description}`);
      if (result.confidence > 0 || event.detail.value.trim()) {
        this.setData({
          'form.category': result.category,
          'form.aiTags': result.aiTags
        });
      }
    }
  },

  searchLocation(event) {
    const keyword = event.detail.value;
    this.setData({
      locationKeyword: keyword,
      locations: searchLocations(keyword)
    });
  },

  selectLocation(event) {
    this.setData({ 'form.locationId': event.currentTarget.dataset.id });
  },

  clearLocation() {
    this.setData({
      'form.locationId': '',
      locationKeyword: '',
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
          'form.category': this.data.form.category || '其他',
          'form.aiTags': this.data.form.aiTags.length ? this.data.form.aiTags : ['图片自动识别']
        });
        wx.showToast({ title: '图片已选择', icon: 'success' });
      }
    });
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
