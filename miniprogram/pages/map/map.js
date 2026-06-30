const { CATEGORIES } = require('../../utils/constants');
const { listItems } = require('../../utils/store');

Page({
  data: {
    categories: CATEGORIES,
    activeCategory: '全部',
    items: []
  },

  onShow() {
    this.loadItems();
  },

  loadItems() {
    this.setData({
      items: listItems({ category: this.data.activeCategory, status: 'active', type: 'lost' })
    });
  },

  selectCategory(event) {
    this.setData({ activeCategory: event.currentTarget.dataset.category }, () => this.loadItems());
  },

  startPublish() {
    wx.navigateTo({ url: '/pages/publish/publish?type=lost' });
  },

  goDetail(event) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${event.currentTarget.dataset.id}` });
  }
});
