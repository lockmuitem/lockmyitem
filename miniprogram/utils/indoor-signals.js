const WIFI_TIMEOUT = 2600;
const BLE_TIMEOUT = 3200;
const BLE_SCAN_WINDOW = 2200;

function hasApi(name) {
  return typeof wx !== 'undefined' && typeof wx[name] === 'function';
}

function collectWifiSignals() {
  return new Promise((resolve) => {
    if (!hasApi('startWifi')) {
      resolve({ ok: false, reason: '当前基础库不支持 Wi-Fi 采集', connected: null, list: [] });
      return;
    }
    let done = false;
    let connected = null;
    let list = [];
    let wifiListHandler = null;
    const finish = (extra = {}) => {
      if (done) return;
      done = true;
      if (wifiListHandler && hasApi('offGetWifiList')) {
        wx.offGetWifiList(wifiListHandler);
      }
      resolve({
        ok: Boolean(connected || list.length),
        connected,
        list,
        ...extra
      });
    };
    const timer = setTimeout(() => finish({ reason: 'Wi-Fi 采集超时' }), WIFI_TIMEOUT);
    wx.startWifi({
      success: () => {
        if (hasApi('getConnectedWifi')) {
          wx.getConnectedWifi({
            success: (res) => { connected = res.wifi || null; },
            complete: () => {}
          });
        }
        if (hasApi('onGetWifiList') && hasApi('getWifiList')) {
          wifiListHandler = (res) => {
            list = (res.wifiList || []).slice(0, 20);
            clearTimeout(timer);
            finish();
          };
          wx.onGetWifiList(wifiListHandler);
          wx.getWifiList({
            fail: () => {
              clearTimeout(timer);
              finish({ reason: '无法读取 Wi-Fi 列表' });
            }
          });
          return;
        }
        clearTimeout(timer);
        finish();
      },
      fail: () => {
        clearTimeout(timer);
        finish({ reason: 'Wi-Fi 未开启或权限不可用' });
      }
    });
  });
}

function collectBleSignals() {
  return new Promise((resolve) => {
    if (!hasApi('openBluetoothAdapter')) {
      resolve({ ok: false, reason: '当前基础库不支持 BLE 采集', devices: [] });
      return;
    }
    let done = false;
    let deviceFoundHandler = null;
    const devices = [];
    const finish = (extra = {}) => {
      if (done) return;
      done = true;
      if (deviceFoundHandler && hasApi('offBluetoothDeviceFound')) {
        wx.offBluetoothDeviceFound(deviceFoundHandler);
      }
      if (hasApi('stopBluetoothDevicesDiscovery')) {
        wx.stopBluetoothDevicesDiscovery({ complete: () => {} });
      }
      if (hasApi('closeBluetoothAdapter')) {
        wx.closeBluetoothAdapter({ complete: () => {} });
      }
      resolve({
        ok: Boolean(devices.length),
        devices: devices.slice(0, 20),
        ...extra
      });
    };
    const timer = setTimeout(() => finish({ reason: 'BLE 采集超时' }), BLE_TIMEOUT);
    wx.openBluetoothAdapter({
      success: () => {
        if (hasApi('onBluetoothDeviceFound')) {
          deviceFoundHandler = (res) => {
            (res.devices || []).forEach((device) => {
              const id = device.deviceId || device.name || device.localName;
              if (!id || devices.some((entry) => entry.deviceId === device.deviceId)) return;
              devices.push({
                deviceId: device.deviceId,
                name: device.name || device.localName || '',
                RSSI: device.RSSI
              });
            });
          };
          wx.onBluetoothDeviceFound(deviceFoundHandler);
        }
        wx.startBluetoothDevicesDiscovery({
          allowDuplicatesKey: false,
          success: () => {
            setTimeout(() => {
              clearTimeout(timer);
              finish();
            }, BLE_SCAN_WINDOW);
          },
          fail: () => {
            clearTimeout(timer);
            finish({ reason: 'BLE 扫描不可用' });
          }
        });
      },
      fail: () => {
        clearTimeout(timer);
        finish({ reason: '蓝牙未开启或权限不可用' });
      }
    });
  });
}

function signalSummary(wifi = {}, ble = {}) {
  const wifiCount = (wifi.connected ? 1 : 0) + (wifi.list || []).length;
  const bleCount = (ble.devices || []).length;
  if (!wifiCount && !bleCount) return '未采集到可用 Wi-Fi/BLE 室内信号';
  return `已采集 Wi-Fi ${wifiCount} 个、BLE ${bleCount} 个室内信号`;
}

function resolveIndoorSignals(wifi, ble) {
  const app = getApp();
  if (!app.globalData.cloudReady || !wx.cloud) {
    return Promise.resolve({ ok: false, reason: '云开发未启用，跳过云端室内增强定位' });
  }
  return new Promise((resolve) => {
    wx.cloud.callFunction({
      name: 'lostfound',
      data: {
        action: 'resolveIndoorSignals',
        wifi,
        ble
      },
      success: (res) => {
        const result = res.result || {};
        resolve(result.ok ? { ok: true, data: result.data || {} } : { ok: false, reason: result.message || '室内增强定位未返回结果' });
      },
      fail: () => resolve({ ok: false, reason: '室内增强定位云函数调用失败' })
    });
  });
}

function collectIndoorSignals() {
  return Promise.all([collectWifiSignals(), collectBleSignals()])
    .then(([wifi, ble]) => resolveIndoorSignals(wifi, ble)
      .then((network) => ({
        wifi,
        ble,
        network,
        summary: signalSummary(wifi, ble)
      })))
    .catch(() => ({
      wifi: { ok: false, connected: null, list: [] },
      ble: { ok: false, devices: [] },
      network: { ok: false, reason: '室内增强定位不可用' },
      summary: '室内增强定位不可用'
    }));
}

module.exports = {
  collectIndoorSignals
};
