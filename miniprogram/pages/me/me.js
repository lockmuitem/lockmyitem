const { login, updateUserProfile, listMyItems, markReturned, undoReturned } = require('../../utils/store');

Page({
  data: {
    user: {},
    avatarText: '微',
    userSubtitle: '未填写邮箱 · 校园互助账号',
    profileForm: {
      nickName: '',
      email: ''
    },
    items: [],
    stats: {
      total: 0,
      active: 0,
      returned: 0
    },
    loadError: ''
  },

  onShow() {
    this.load();
  },

  load() {
    try {
      const user = login();
      const items = listMyItems().map((item) => {
        const statusText = item.status === 'returned' ? '已回家' : '寻找中';
        const typeText = item.type === 'lost' ? '寻物' : '招领';
        const metaParts = [statusText, typeText, item.category, item.locationName].filter(Boolean);
        return {
          ...item,
          statusText,
          typeText,
          metaText: metaParts.join(' · ')
        };
      });
      const stats = {
        total: items.length,
        active: items.filter((item) => item.status === 'active').length,
        returned: items.filter((item) => item.status === 'returned').length
      };
      const nickName = user.nickName || '微信用户';
      this.setData({
        user,
        avatarText: nickName.slice(0, 1),
        userSubtitle: `${user.email || '未填写邮箱'} · 校园互助账号`,
        profileForm: {
          nickName,
          emailPrefix: user.emailPrefix || String(user.email || '').replace(/@shanghaitech\.edu\.cn$/i, '')
        },
        items,
        stats,
        loadError: ''
      });
    } catch (error) {
      this.setData({
        loadError: error.message || '资料加载失败',
        items: [],
        stats: { total: 0, active: 0, returned: 0 }
      });
    }
  },

  onProfileInput(event) {
    const field = event.currentTarget.dataset.field;
    const value = field === 'emailPrefix'
      ? String(event.detail.value || '').replace(/@.*/g, '').replace(/[^a-zA-Z0-9._-]/g, '')
      : event.detail.value;
    this.setData({ [`profileForm.${field}`]: value });
  },

  saveProfile() {
    try {
      const user = updateUserProfile(this.data.profileForm);
      const nickName = user.nickName || '微信用户';
      this.setData({
        user,
        avatarText: nickName.slice(0, 1),
        userSubtitle: `${user.email || '未填写邮箱'} · 校园互助账号`
      });
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
