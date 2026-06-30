const { login, updateUserProfile, listMyItems, markReturned, undoReturned } = require('../../utils/store');

Page({
  data: {
    user: {},
    profileForm: {
      nickName: '',
      email: ''
    },
    items: []
  },

  onShow() {
    this.load();
  },

  load() {
    const user = login();
    this.setData({
      user,
      profileForm: {
        nickName: user.nickName || '',
        email: user.email || ''
      },
      items: listMyItems()
    });
  },

  onProfileInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`profileForm.${field}`]: event.detail.value });
  },

  saveProfile() {
    try {
      const user = updateUserProfile(this.data.profileForm);
      this.setData({ user });
      wx.showToast({ title: '资料已保存', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' });
    }
  },

  goMessages() {
    wx.navigateTo({ url: '/pages/messages/messages' });
  },

  goPublish() {
    wx.navigateTo({ url: '/pages/publish/publish' });
  },

  goDetail(event) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${event.currentTarget.dataset.id}` });
  },

  markReturned(event) {
    markReturned(event.currentTarget.dataset.id);
    this.load();
    wx.showToast({ title: '已回家', icon: 'success' });
  },

  undoReturned(event) {
    undoReturned(event.currentTarget.dataset.id);
    this.load();
    wx.showToast({ title: '已撤回', icon: 'success' });
  }
});
