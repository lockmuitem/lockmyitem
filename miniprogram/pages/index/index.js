const { CATEGORIES } = require('../../utils/constants');
const { listItems } = require('../../utils/store');

Page({
  data: {
    categories: CATEGORIES,
    activeCategory: '全部',
    items: [],
    stats: {
      total: 0,
      today: 0,
      returned: 0
    }
  },

  onShow() {
    this.loadItems();
  },

  loadItems() {
    const activeItems = listItems({ status: 'active', type: 'found' });
    const todayPrefix = new Date().toISOString().slice(0, 10);
    this.setData({
      items: listItems({ category: this.data.activeCategory, status: 'active', type: 'found' }),
      stats: {
        total: activeItems.length,
        today: activeItems.filter((item) => String(item.createdAt || '').slice(0, 10) === todayPrefix).length,
        returned: listItems({ status: 'returned', type: 'found' }).length
      }
    });
  },

  selectCategory(event) {
    this.setData({ activeCategory: event.currentTarget.dataset.category }, () => this.loadItems());
  },

  startPublish() {
    wx.navigateTo({ url: '/pages/publish/publish?type=found' });
  },

  goDetail(event) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${event.currentTarget.dataset.id}` });
  }
});
