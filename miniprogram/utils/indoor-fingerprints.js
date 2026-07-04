// Optional campus indoor fingerprints.
//
// Fill this file after collecting real ShanghaiTech AP / BLE beacon signals.
// Matching works with exact BSSID/deviceId first, then name/SSID keywords.
const INDOOR_FINGERPRINTS = {
  // Example:
  // library: {
  //   wifi: [
  //     { bssid: 'aa:bb:cc:dd:ee:ff', ssid: 'ShanghaiTech', weight: 32 },
  //     { ssidKeyword: 'Library', weight: 16 }
  //   ],
  //   ble: [
  //     { deviceId: 'AA:BB:CC:DD:EE:FF', nameKeyword: 'Library', weight: 28 }
  //   ],
  //   indoor: { building: '图书馆', floor: '' }
  // }
};

module.exports = {
  INDOOR_FINGERPRINTS
};
