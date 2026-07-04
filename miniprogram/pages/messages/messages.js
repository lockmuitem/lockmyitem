const { listNotifications } = require('../../utils/store');

Page({
  data: {
    notifications: []
  },

  onShow() {
    const labels = {
      system: '系统',
      comment: '评论',
      thanks: '感谢'
    };
    this.setData({
      notifications: listNotifications().map((notice) => ({
        ...notice,
        typeLabel: labels[notice.type] || '通知'
      }))
    });
  },

  goDetail(event) {
    const id = event.currentTarget.dataset.id;
    if (id) {
      wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
    }
  }
});
