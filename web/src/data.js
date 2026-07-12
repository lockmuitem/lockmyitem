import umbrellaImage from './assets/items/umbrella.jpg';
import cardImage from './assets/items/card.jpg';
import earbudsImage from './assets/items/earbuds.jpg';
import keysImage from './assets/items/keys.jpg';
import notebookImage from './assets/items/notebook.jpg';
import { campusMapImage, campusMapImageBoundaries, campusMapLocations, campusMapMeta, campusMapOutline, locationAliases } from './campusMapData.js';

export { campusMapImage, campusMapImageBoundaries, campusMapMeta, campusMapOutline, locationAliases };

export const categories = ['全部', '证件', '电子产品', '书本资料', '衣物', '钥匙', '校园卡', '雨伞', '水杯', '其他'];

export const categoryImages = {
  证件: cardImage,
  电子产品: earbudsImage,
  书本资料: notebookImage,
  衣物: notebookImage,
  钥匙: keysImage,
  校园卡: cardImage,
  雨伞: umbrellaImage,
  水杯: notebookImage,
  其他: notebookImage
};

export const categoryKeywords = {
  证件: ['证件', '身份证', '学生证', '卡片', '护照', 'id', 'card', 'license', 'passport'],
  电子产品: ['手机', '电脑', '耳机', '充电器', '平板', '电子', 'airpods', 'phone', 'laptop', 'computer', 'earbuds', 'headphone', 'charger'],
  书本资料: ['书', '教材', '笔记', '资料', '文件', '纸', 'book', 'notebook', 'paper', 'document'],
  衣物: ['衣服', '外套', '帽子', '围巾', '手套', 'coat', 'shirt', 'hat', 'cap', 'glove', 'backpack'],
  钥匙: ['钥匙', '门禁', 'key', 'keys'],
  校园卡: ['校园卡', '一卡通', '饭卡', 'campus card', 'student card'],
  雨伞: ['伞', '雨伞', 'umbrella'],
  水杯: ['杯', '水杯', '保温杯', 'cup', 'bottle', 'mug']
};

export const locations = campusMapLocations;

export const seedItems = [
  {
    id: 'item_umbrella_found_1',
    type: 'found',
    title: '黑色折叠伞，带红色钥匙扣',
    description: '在一号食堂门口捡到，一把黑色雨伞，伞柄上有红色钥匙扣。',
    category: '雨伞',
    tags: ['黑色', '红色钥匙扣', '折叠伞'],
    image: umbrellaImage,
    locationId: 'silk-road-dining',
    ownerName: '食堂门口同学',
    status: 'active',
    createdAt: '2026-06-28T13:10:00.000Z'
  },
  {
    id: 'item_card_1',
    type: 'found',
    title: '蓝色校园卡',
    description: '在图书馆二楼自习区靠窗座位旁捡到。',
    category: '校园卡',
    tags: ['卡片', '校园卡', '蓝色'],
    image: cardImage,
    locationId: 'library',
    ownerName: '热心同学',
    status: 'active',
    createdAt: '2026-06-28T11:20:00.000Z'
  },
  {
    id: 'item_earbuds_found_1',
    type: 'found',
    title: '白色无线耳机',
    description: '在校园服务中心门口座椅上捡到，充电盒完好。',
    category: '电子产品',
    tags: ['耳机', '白色', '充电盒'],
    image: earbudsImage,
    locationId: 'service',
    ownerName: '服务中心同学',
    status: 'active',
    createdAt: '2026-06-28T09:10:00.000Z'
  },
  {
    id: 'item_keys_found_1',
    type: 'found',
    title: '钥匙一串，蓝色圆形挂饰',
    description: '在物质学院楼下自行车停放处捡到。',
    category: '钥匙',
    tags: ['钥匙', '蓝色挂饰'],
    image: keysImage,
    locationId: 'spst',
    ownerName: '物质学院同学',
    status: 'active',
    createdAt: '2026-06-27T20:15:00.000Z'
  },
  {
    id: 'item_notebook_found_1',
    type: 'found',
    title: '黑色笔记本',
    description: '封面无字，内有手写课堂笔记。',
    category: '书本资料',
    tags: ['笔记本', '黑色'],
    image: notebookImage,
    locationId: 'sist',
    ownerName: '信息学院同学',
    status: 'active',
    createdAt: '2026-06-27T18:42:00.000Z'
  },
  {
    id: 'item_umbrella_1',
    type: 'lost',
    title: '寻找黑色折叠伞',
    description: '可能落在学生食堂一楼，伞柄上有银色贴纸。',
    category: '雨伞',
    tags: ['黑色', '折叠伞'],
    image: umbrellaImage,
    locationId: 'silk-road-dining',
    ownerName: '赶课人',
    status: 'active',
    createdAt: '2026-06-27T08:30:00.000Z'
  },
  {
    id: 'item_bottle_1',
    type: 'found',
    title: '白色保温杯',
    description: '体育馆看台第三排发现，杯身有贴纸。',
    category: '水杯',
    tags: ['水杯', '保温杯', '白色'],
    image: notebookImage,
    locationId: 'athletic',
    ownerName: '体育馆值日生',
    status: 'returned',
    createdAt: '2026-06-26T19:15:00.000Z',
    returnedAt: '2026-06-27T12:00:00.000Z'
  }
];
