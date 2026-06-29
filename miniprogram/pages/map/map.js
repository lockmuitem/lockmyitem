const { searchLocations, listItems } = require('../../utils/store');

Page({
  data: {
    locations: searchLocations(),
    activeLocationId: 'lib',
    activeLocation: {},
    nearbyItems: [],
    officialMapImage: 'https://www.shanghaitech.edu.cn/_upload/article/images/dd/17/82d9bf8c467194ea6bb0dab64fd5/eb2d66ec-028a-40de-9bdd-ddd4ed791e9b.jpg',
    officialMapUrl: 'https://map.shanghaitech.edu.cn/'
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const activeLocation = this.data.locations.find((location) => location._id === this.data.activeLocationId) || this.data.locations[0];
    this.setData({
      activeLocation,
      activeLocationId: activeLocation._id,
      nearbyItems: listItems({ locationId: activeLocation._id, status: 'active' })
    });
  },

  selectLocation(event) {
    this.setData({ activeLocationId: event.currentTarget.dataset.id }, () => this.refresh());
  },

  goDetail(event) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${event.currentTarget.dataset.id}` });
  },

  openOfficialMap() {
    wx.navigateTo({ url: `/pages/official-map/official-map?src=${encodeURIComponent(this.data.officialMapUrl)}` });
  }
});
