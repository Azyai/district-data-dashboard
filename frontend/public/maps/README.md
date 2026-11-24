# 门头沟驾驶舱地图

首页以天地图卫星影像（`img_w` WMTS）为底图，区内显示原色，区外使用灰蓝色保留影像纹理。2D 和 3D 使用相同的区界及影像。3D 起伏来自项目提供的地形模型，两处地标保留各自的精细模型。

## 接入天地图

在 `frontend/.env.local` 设置 `VITE_TIANDITU_TOKEN` 为天地图浏览器端应用的 Key，开发环境使用 Vite 加载，部署时在构建环境配置该变量。浏览器直接访问地图服务。Key 对地图的访问限制可在相应应用的控制台中管理。未配置或服务不可用时，首页显示本地地形并标明来源。[天地图](https://map.tianditu.gov.cn/) · [服务文档](https://lbs.tianditu.gov.cn/server/MapService.html)

## 本地资源

随应用提供的 `district-atlas.geojson`、`district-relief.webp`、`district-elevation.png` 分别用于区镇边界、备用晕渲和展示地形。地形根据本地模型外包范围与地理范围对齐。镇街下的村社范围及地标精细 GLB 由项目提供的原始模型生成，运行资源位于 `local-model/`。

从仓库根目录执行以下命令重新生成资源。先安装前端开发依赖，纹理转换需要 FFmpeg，可通过 `DASHBOARD_FFMPEG` 设置可执行文件路径。地图生成脚本需要 Python、NumPy、Pillow、Shapely 2。

```powershell
node --max-old-space-size=4096 frontend/scripts/prepare-mentougou-model.mjs
node frontend/scripts/prepare-mentougou-texture.mjs
node frontend/scripts/prepare-mentougou-geodata.mjs
python frontend/scripts/prepare-mentougou-atlas.py
```

两处地标优先加载 `tianjie-detail.glb` 和 `jingxi-detail.glb`，保留源立面网格与纹理，使用 Meshopt 压缩。离线地形与在线天地图瓦片分别加载。
