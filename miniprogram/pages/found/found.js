const { listItems } = require('../../utils/store');

Page({
  data: {
    items: []
  },

  onShow() {
    this.setData({ items: listItems({ status: 'returned' }) });
  },

  goDetail(event) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${event.currentTarget.dataset.id}` });
  }
});
