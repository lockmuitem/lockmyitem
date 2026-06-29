# shanghaitech失物招领使用与宣传指南

## 如何使用小程序

1. 打开微信开发者工具，导入项目目录：`D:\Codex\shanghaitech-lost-found-miniprogram`。
2. 本地调试时可用测试号，点击“编译”进入首页。
3. 首页右下角 `+` 发布线索，先选择“我捡到了”或“我丢了”，再上传图片。
4. 发布页中标题、描述、地点都可不填；至少上传图片或选择/识别出分类。
5. 查找页按分类浏览，地图页按上科大地点 pin 找物品。
6. 详情页可评论、感谢发帖人、举报、标记“已回家”或撤回。

## 正式宣传二维码怎么来

微信小程序的正式宣传码不能用测试号生成，必须满足：

- 已在微信公众平台注册小程序，并获得真实 `AppID`。
- 已完成小程序名称、类目、主体等基础设置。
- 已上传体验版或发布正式版。
- 如果使用官网地图页，需要配置业务域名：`map.shanghaitech.edu.cn`。

满足后，可以用本项目脚本生成官方小程序码：

```powershell
python D:\Codex\shanghaitech-lost-found-miniprogram\tools\generate_miniprogram_qr.py `
  --appid "你的AppID" `
  --secret "你的AppSecret" `
  --page "pages/index/index" `
  --scene "source=campus_promo" `
  --output "D:\Codex\shanghaitech-lost-found-miniprogram\shanghaitech失物招领-小程序码.png"
```

生成的 PNG 就可以用于线上海报、公众号推文、朋友圈、班群、宿舍楼/食堂/图书馆线下物料。

## 宣传渠道建议

- 线上：学院群、班级群、学生会公众号、社团群、朋友圈转发。
- 线下：图书馆入口、食堂取餐口、宿舍公告栏、教学楼电梯口、体育馆前台。
- 文案主张：`丢了别慌，捡到顺手发一下。shanghaitech失物招领，帮物品回家。`
