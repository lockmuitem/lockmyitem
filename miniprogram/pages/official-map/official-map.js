Page({
  data: {
    src: 'https://map.shanghaitech.edu.cn/'
  },

  onLoad(options) {
    if (options.src) {
      this.setData({ src: decodeURIComponent(options.src) });
    }
  }
});
