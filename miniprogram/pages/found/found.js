const { listItems } = require('../../utils/store');

Page({
  data: {
    items: [],
    total: 0
  },

  onShow() {
    const items = listItems({ status: 'returned' });
    this.setData({ items, total: items.length });
  },

  goDetail(event) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${event.currentTarget.dataset.id}` });
  }
});
