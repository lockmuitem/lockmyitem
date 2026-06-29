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
      items: listItems({ category: this.data.activeCategory, status: 'active' })
    });
  },

  selectCategory(event) {
    this.setData({ activeCategory: event.currentTarget.dataset.category }, () => this.loadItems());
  },

  startPublish() {
    wx.showActionSheet({
      itemList: ['我捡到了', '我丢了'],
      success: (typeRes) => {
        const type = typeRes.tapIndex === 0 ? 'found' : 'lost';
        wx.chooseMedia({
          count: 1,
          mediaType: ['image'],
          sourceType: ['album', 'camera'],
          success: (mediaRes) => {
            const file = mediaRes.tempFiles[0];
            wx.navigateTo({
              url: `/pages/publish/publish?type=${type}&image=${encodeURIComponent(file.tempFilePath)}`
            });
          },
          fail: () => {
            wx.navigateTo({ url: `/pages/publish/publish?type=${type}` });
          }
        });
      }
    });
  },

  goDetail(event) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${event.currentTarget.dataset.id}` });
  }
});
