const { registerUser } = require('../../utils/store');

Page({
  data: {
    nickName: '',
    emailPrefix: '',
    usingWechat: false
  },

  onNickInput(event) {
    this.setData({ nickName: event.detail.value });
  },

  onEmailInput(event) {
    const emailPrefix = String(event.detail.value || '')
      .replace(/@.*/g, '')
      .replace(/[^a-zA-Z0-9._-]/g, '');
    this.setData({ emailPrefix });
  },

  useWechatProfile() {
    wx.getUserProfile({
      desc: '用于显示发布人昵称，方便校内同学联系',
      success: (res) => {
        const userInfo = res.userInfo || {};
        this.setData({
          usingWechat: true,
          nickName: userInfo.nickName || this.data.nickName
        });
        this.finishRegistration({
          nickName: userInfo.nickName || this.data.nickName || '微信用户',
          avatarUrl: userInfo.avatarUrl || '',
          emailPrefix: this.data.emailPrefix,
          loginMethod: 'wechat'
        });
      },
      fail: () => {
        wx.showToast({ title: '可继续使用邮箱注册', icon: 'none' });
      }
    });
  },

  finishRegistration(profile) {
    wx.login({
      success: (loginRes) => {
        try {
          registerUser({
            ...profile,
            openid: loginRes.code ? `wx_${loginRes.code.slice(0, 12)}` : ''
          });
          wx.showToast({ title: '注册完成', icon: 'success' });
          setTimeout(() => wx.switchTab({ url: '/pages/index/index' }), 450);
        } catch (error) {
          wx.showToast({ title: error.message, icon: 'none' });
        }
      },
      fail: () => {
        try {
          registerUser(profile);
          wx.switchTab({ url: '/pages/index/index' });
        } catch (error) {
          wx.showToast({ title: error.message, icon: 'none' });
        }
      }
    });
  },

  submit() {
    this.finishRegistration({
      nickName: this.data.nickName || '上科大同学',
      emailPrefix: this.data.emailPrefix,
      loginMethod: 'email'
    });
  }
});
