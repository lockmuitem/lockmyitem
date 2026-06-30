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
    itemTypeText: '',
    itemTypeClass: '',
    locationAreaText: '',
    hasNearby: false,
    hasMapPoint: false,
    mapMarkers: [],
    mapScale: 20,
    comments: [],
    commentText: '',
    isMine: false,
    canMarkReturned: false,
    canUndoReturned: false,
    hasComments: false,
    noComments: true
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
    const item = detail.item;
    const isMine = item ? item.ownerOpenid === user.openid : false;
    const hasMapPoint = Boolean(item && item.latitude && item.longitude);
    const comments = detail.comments || [];
    this.setData({
      item,
      itemTypeText: item && item.type === 'lost' ? '寻物' : '招领',
      itemTypeClass: item && item.type === 'lost' ? 'lost' : 'found',
      locationAreaText: item && item.locationArea ? item.locationArea : '上科大校内地点',
      hasNearby: Boolean(item && item.locationNearby && item.locationNearby.length),
      hasMapPoint,
      mapMarkers: hasMapPoint ? [{
        id: 1,
        latitude: item.latitude,
        longitude: item.longitude,
        title: item.locationName,
        width: 28,
        height: 28,
        callout: {
          content: item.locationName,
          color: '#172026',
          fontSize: 13,
          borderRadius: 6,
          bgColor: '#ffffff',
          padding: 8,
          display: 'ALWAYS'
        }
      }] : [],
      mapScale: item && item.locationId === 'library' ? 20 : 19,
      comments,
      isMine,
      canMarkReturned: Boolean(item && item.status === 'active' && isMine),
      canUndoReturned: Boolean(item && item.status === 'returned' && isMine),
      hasComments: comments.length > 0,
      noComments: comments.length === 0
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
      content: '确认后会移动到已找到分区，之后仍可撤回。',
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
