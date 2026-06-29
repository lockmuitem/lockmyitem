const {
  login,
  getItemDetail,
  createComment,
  sendThanks,
  markReturned,
  undoReturned,
  reportContent
} = require('../../utils/store');

Page({
  data: {
    id: '',
    item: null,
    comments: [],
    commentText: '',
    isMine: false
  },

  onLoad(options) {
    this.setData({ id: options.id });
  },

  onShow() {
    this.loadDetail();
  },

  loadDetail() {
    const detail = getItemDetail(this.data.id);
    const user = login();
    this.setData({
      item: detail.item,
      comments: detail.comments,
      isMine: detail.item ? detail.item.ownerOpenid === user.openid : false
    });
  },

  onCommentInput(event) {
    this.setData({ commentText: event.detail.value });
  },

  createComment() {
    const content = this.data.commentText.trim();
    if (!content) {
      wx.showToast({ title: '请输入评论', icon: 'none' });
      return;
    }
    try {
      createComment(this.data.id, content);
      this.setData({ commentText: '' });
      this.loadDetail();
      wx.showToast({ title: '已评论', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' });
    }
  },

  sendThanks() {
    try {
      sendThanks(this.data.id);
      wx.showToast({ title: '感谢已送达', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' });
    }
  },

  markReturned() {
    wx.showModal({
      title: '确认已回家？',
      content: '确认后会移动到已找到分区，你之后还可以撤回。',
      success: (res) => {
        if (!res.confirm) return;
        markReturned(this.data.id);
        this.loadDetail();
        wx.showToast({ title: '已回家', icon: 'success' });
      }
    });
  },

  undoReturned() {
    undoReturned(this.data.id);
    this.loadDetail();
    wx.showToast({ title: '已撤回', icon: 'success' });
  },

  reportItem() {
    reportContent('item', this.data.id, '用户从详情页举报');
    wx.showToast({ title: '已收到举报', icon: 'success' });
  }
});
