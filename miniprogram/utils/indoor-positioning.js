const { INDOOR_FINGERPRINTS } = require('./indoor-fingerprints');

const WIFI_TIMEOUT = 2600;
const BLE_TIMEOUT = 3200;
const BLE_SCAN_WINDOW = 2200;

function normalize(value = '') {
  return String(value).trim().toLowerCase();
}

function safeCall(fn) {
  return typeof fn === 'function';
}

function collectWifiSignals() {
  return new Promise((resolve) => {
    if (!safeCall(wx.startWifi)) {
      resolve({ ok: false, reason: '当前基础库不支持 Wi-Fi 采集', connected: null, list: [] });
      return;
    }

    let settled = false;
    let connected = null;
    let list = [];
    let wifiListHandler = null;
    const finish = (result = {}) => {
      if (settled) return;
      settled = true;
      if (wifiListHandler && safeCall(wx.offGetWifiList)) {
        wx.offGetWifiList(wifiListHandler);
      }
      resolve({
        ok: Boolean(connected || list.length),
        reason: result.reason || '',
        connected,
        list
      });
    };

    const timer = setTimeout(() => finish({ reason: 'Wi-Fi 采集超时' }), WIFI_TIMEOUT);
    wx.startWifi({
      success: () => {
        if (safeCall(wx.getConnectedWifi)) {
          wx.getConnectedWifi({
            success: (res) => {
              connected = res.wifi || null;
            },
            fail: () => {}
          });
        }

        if (safeCall(wx.onGetWifiList) && safeCall(wx.getWifiList)) {
          wifiListHandler = (res) => {
            list = (res.wifiList || []).slice(0, 20);
            clearTimeout(timer);
            finish();
          };
          wx.onGetWifiList(wifiListHandler);
          wx.getWifiList({
            fail: () => {
              clearTimeout(timer);
              finish();
            }
          });
          return;
        }

        setTimeout(() => {
          clearTimeout(timer);
          finish();
        }, 500);
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
    if (!safeCall(wx.openBluetoothAdapter)) {
      resolve({ ok: false, reason: '当前基础库不支持 BLE 采集', devices: [] });
      return;
    }

    let devices = [];
    let settled = false;
    let deviceFoundHandler = null;
    const finish = (result = {}) => {
      if (settled) return;
      settled = true;
      if (deviceFoundHandler && safeCall(wx.offBluetoothDeviceFound)) {
        wx.offBluetoothDeviceFound(deviceFoundHandler);
      }
      if (safeCall(wx.stopBluetoothDevicesDiscovery)) {
        wx.stopBluetoothDevicesDiscovery({ complete: () => {} });
      }
      if (safeCall(wx.closeBluetoothAdapter)) {
        wx.closeBluetoothAdapter({ complete: () => {} });
      }
      resolve({
        ok: devices.length > 0,
        reason: result.reason || '',
        devices: devices
          .filter((device) => device.RSSI !== 0)
          .sort((a, b) => (b.RSSI || -100) - (a.RSSI || -100))
          .slice(0, 20)
      });
    };

    const timer = setTimeout(() => finish({ reason: 'BLE 采集超时' }), BLE_TIMEOUT);
    wx.openBluetoothAdapter({
      success: () => {
        if (safeCall(wx.onBluetoothDeviceFound)) {
          deviceFoundHandler = (res) => {
            const nextDevices = res.devices || [];
            nextDevices.forEach((device) => {
              const key = device.deviceId || device.name || device.localName;
              if (!key) return;
              const existed = devices.find((entry) => (
                (entry.deviceId && entry.deviceId === device.deviceId)
                || normalize(entry.name || entry.localName) === normalize(device.name || device.localName)
              ));
              if (existed) {
                if ((device.RSSI || -100) > (existed.RSSI || -100)) Object.assign(existed, device);
              } else {
                devices.push(device);
              }
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
            finish({ reason: '蓝牙未开启或权限不可用' });
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

function matchWifi(fingerprint = {}, wifi = {}) {
  const connected = wifi.connected ? [wifi.connected] : [];
  const allWifi = connected.concat(wifi.list || []);
  return (fingerprint.wifi || []).reduce((score, rule) => {
    const matched = allWifi.some((entry) => {
      const bssidMatched = rule.bssid && normalize(entry.BSSID) === normalize(rule.bssid);
      const ssidMatched = rule.ssid && normalize(entry.SSID) === normalize(rule.ssid);
      const keywordMatched = rule.ssidKeyword && normalize(entry.SSID).includes(normalize(rule.ssidKeyword));
      return bssidMatched || ssidMatched || keywordMatched;
    });
    return matched ? score + (rule.weight || 18) : score;
  }, 0);
}

function matchBle(fingerprint = {}, ble = {}) {
  return (fingerprint.ble || []).reduce((score, rule) => {
    const matched = (ble.devices || []).find((device) => {
      const idMatched = rule.deviceId && normalize(device.deviceId) === normalize(rule.deviceId);
      const name = normalize(device.name || device.localName);
      const nameMatched = rule.name && name === normalize(rule.name);
      const keywordMatched = rule.nameKeyword && name.includes(normalize(rule.nameKeyword));
      return idMatched || nameMatched || keywordMatched;
    });
    if (!matched) return score;
    const rssi = Number(matched.RSSI) || -90;
    const rssiBoost = Math.max(0, Math.min(14, Math.round((rssi + 90) / 4)));
    return score + (rule.weight || 18) + rssiBoost;
  }, 0);
}

function scoreIndoorSignals(location, signals = {}) {
  const fingerprint = INDOOR_FINGERPRINTS[location._id];
  const tencentData = signals.tencentIndoor && signals.tencentIndoor.ok ? signals.tencentIndoor.data || {} : {};
  const tencentMatched = tencentData.locationId === location._id
    || (tencentData.building && normalize(location.name).includes(normalize(tencentData.building)))
    || (tencentData.building && normalize(location.aliases || []).includes(normalize(tencentData.building)));
  if (!fingerprint && !tencentMatched) return { score: 0, reasons: [], indoor: null };
  const wifiScore = fingerprint ? matchWifi(fingerprint, signals.wifi) : 0;
  const bleScore = fingerprint ? matchBle(fingerprint, signals.ble) : 0;
  const tencentScore = tencentMatched ? 44 + Math.round(Number(tencentData.confidence || 0) * 20) : 0;
  const reasons = [];
  if (wifiScore) reasons.push('Wi-Fi 指纹匹配');
  if (bleScore) reasons.push('BLE 信标匹配');
  if (tencentScore) reasons.push('腾讯室内定位匹配');
  return {
    score: wifiScore + bleScore + tencentScore,
    reasons,
    indoor: (fingerprint && fingerprint.indoor) || {
      building: tencentData.building || '',
      floor: tencentData.floor || ''
    }
  };
}

function fuseIndoorLocation(candidates = [], signals = {}) {
  const ranked = candidates.map((candidate) => {
    const signal = scoreIndoorSignals(candidate, signals);
    return {
      ...candidate,
      signalScore: signal.score,
      signalReasons: signal.reasons,
      indoor: signal.indoor,
      fusedScore: candidate.distance - signal.score * 2.4
    };
  }).sort((a, b) => a.fusedScore - b.fusedScore);

  return ranked.map((candidate) => ({
    ...candidate,
    distanceText: candidate.signalScore > 0
      ? `${candidate.distance}m · 室内信号+${candidate.signalScore}`
      : candidate.distanceText
  }));
}

function indoorSignalSummary(signals = {}) {
  const wifiCount = (signals.wifi && ((signals.wifi.connected ? 1 : 0) + (signals.wifi.list || []).length)) || 0;
  const bleCount = (signals.ble && (signals.ble.devices || []).length) || 0;
  const tencentText = signals.tencentIndoor && signals.tencentIndoor.ok ? '，腾讯室内已返回结果' : '';
  if (!wifiCount && !bleCount) return `未采集到可用 Wi-Fi/BLE 室内信号${tencentText}`;
  return `已采集 Wi-Fi ${wifiCount} 个、BLE ${bleCount} 个室内信号${tencentText}`;
}

function resolveTencentIndoor(gps) {
  const app = typeof getApp === 'function' ? getApp() : null;
  if (!app || !app.globalData || !app.globalData.cloudReady || !wx.cloud) {
    return Promise.resolve({ ok: false, reason: '云开发未启用，跳过腾讯室内定位' });
  }
  return new Promise((resolve) => {
    wx.cloud.callFunction({
      name: 'lostfound',
      data: {
        action: 'resolveTencentIndoor',
        gps: gps || null
      },
      success: (res) => {
        const result = res.result || {};
        if (result.ok) {
          resolve({ ok: true, data: result.data || {} });
          return;
        }
        resolve({ ok: false, reason: result.message || '腾讯室内定位未配置' });
      },
      fail: () => resolve({ ok: false, reason: '腾讯室内定位云函数调用失败' })
    });
  });
}

function collectIndoorSignals(gps) {
  return Promise.all([collectWifiSignals(), collectBleSignals()])
    .then(([wifi, ble]) => resolveTencentIndoor(gps)
      .then((tencentIndoor) => ({
        wifi,
        ble,
        tencentIndoor,
        summary: indoorSignalSummary({ wifi, ble, tencentIndoor }),
        calibrated: Object.keys(INDOOR_FINGERPRINTS).length > 0,
        tencentReady: Boolean(tencentIndoor && tencentIndoor.ok)
      })))
    .catch(() => ({
      wifi: { ok: false, connected: null, list: [] },
      ble: { ok: false, devices: [] },
      tencentIndoor: { ok: false, reason: '腾讯室内定位不可用' },
      summary: '室内信号采集不可用',
      calibrated: Object.keys(INDOOR_FINGERPRINTS).length > 0,
      tencentReady: false
    }));
}

module.exports = {
  collectIndoorSignals,
  fuseIndoorLocation,
  indoorSignalSummary
};
