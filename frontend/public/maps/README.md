# 门头沟区模型资源

驾驶舱的地形、路网、水系和建筑 GLB 来自项目提供的模型。镇街和村社范围使用项目提供的 WGS84 行政边界。生成脚本位于 `frontend/scripts/`，运行资源位于 `local-model/`。

从仓库根目录执行以下命令生成高精度地形、局部纹理和两个地标模型。先安装前端开发依赖。纹理转换使用 FFmpeg，可通过 `DASHBOARD_FFMPEG` 指定可执行文件路径。

```powershell
node --max-old-space-size=4096 frontend/scripts/prepare-mentougou-model.mjs
node frontend/scripts/prepare-mentougou-texture.mjs
node frontend/scripts/prepare-mentougou-geodata.mjs
```

`mentougou-hd.glb` 使用从原始模型转换的 `mentougou-terrain.jpg` 和原始纹理坐标。镇街和村社下钻按范围加载 `terrain-texture/` 中的原尺寸切片。两处地标优先加载 `tianjie-detail.glb` 和 `jingxi-detail.glb`，保留源立面网格与纹理，并使用 Meshopt 压缩。

`mentougou-sentinel-2-20261008.webp` 用于旧版地形资源的回退显示，含经修改的 Copernicus Sentinel 2026 数据。[许可说明](https://ewds.climate.copernicus.eu/licences/ec-sentinel)
