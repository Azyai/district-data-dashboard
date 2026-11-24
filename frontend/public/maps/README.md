# 门头沟区模型资源

驾驶舱的地形、路网、水系和建筑 GLB 来自项目提供的模型。镇街和村社范围使用项目提供的 WGS84 行政边界。生成脚本位于 `frontend/scripts/`，运行资源位于 `local-model/`。

从仓库根目录执行以下命令生成高精度地形与两个地标模型。纹理转换使用 FFmpeg，可通过 `DASHBOARD_FFMPEG` 指定可执行文件路径。

```powershell
node --max-old-space-size=4096 frontend/scripts/prepare-mentougou-model.mjs
node frontend/scripts/prepare-mentougou-geodata.mjs
```

`mentougou-hd.glb` 使用从原始模型转换的 `mentougou-terrain.jpg` 和原始纹理坐标，应随模型一并部署。`tianjie-hd.glb` 和 `jingxi-hd.glb` 包含各自的建筑纹理。

`mentougou-sentinel-2-20261008.webp` 用于旧版地形资源的回退显示，含经修改的 Copernicus Sentinel 2026 数据。[许可说明](https://ewds.climate.copernicus.eu/licences/ec-sentinel)
