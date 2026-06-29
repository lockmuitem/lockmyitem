const { login, listMyItems, markReturned, undoReturned } = require('../../utils/store');

Page({
  data: {
    user: {},
    items: []
  },

  onShow() {
    this.load();
  },

  load() {
    this.setData({
      user: login(),
      items: listMyItems()
    });
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
