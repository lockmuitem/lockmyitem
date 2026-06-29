const { listNotifications } = require('../../utils/store');

Page({
  data: {
    labels: {
      system: '系统',
      comment: '评论',
      thanks: '感谢'
    },
    notifications: []
  },

  onShow() {
    this.setData({ notifications: listNotifications() });
  },

  goDetail(event) {
    const id = event.currentTarget.dataset.id;
    if (id) {
      wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
    }
  }
});
