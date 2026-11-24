# 区政府数字大屏

本地演示打开即进入门头沟全域数字中心的路网监测页，可按区、镇街和村社查看数据。左侧选择区域和专题，居中标题显示当前范围和主题。常规身份核验后保留驾驶舱入口，政务服务专项身份进入授权专题。业务读数使用演示数据。

## 本地启动

需要 Java 21、Node 24 和 pnpm 12.16.1。后端通过 Maven Wrapper 构建。首次安装需要访问依赖仓库。

在项目根目录打开 PowerShell，构建并启动后端。

```powershell
.\backend\mvnw.cmd -f backend/pom.xml -B -ntp verify
java -jar backend/bootstrap/target/district-dashboard.jar --spring.profiles.active=demo
```

在另一个终端启动前端。

```powershell
Set-Location frontend
pnpm install --frozen-lockfile
pnpm dev
```

打开驾驶舱后，用地图节点或区域目录切换区划。右上角显示实时北京时间。二维左键拖动平移，三维左键拖动旋转和俯仰，滚轮缩放范围为 50 米至 5 公里。身份核验在数据工作台。 [门头沟区演示驾驶舱](http://127.0.0.1:5173) · [地图资源准备](frontend/public/maps/README.md)

Web 应用通过同源 `/api` 代理访问本机 8080。演示 profile 使用内存 H2 数据库，启动时由 Flyway 建表并载入合成数据。演示会话只在显式启用该 profile 时可用。

| 入口 | 默认端口 | 配置 |
| --- | --- | --- |
| Web (Vite) | 5173 | `DASHBOARD_WEB_PORT` |
| Spring Boot 业务 API | 8080 | `DISTRICT_API_PORT`。改端口时同步设置 Web 进程的 `DASHBOARD_API_ORIGIN` |
| Actuator 健康检查 | 8081 | `DISTRICT_MANAGEMENT_PORT`。与业务 API 使用不同端口，监听本机回环 |

隔离联调时，可分别将业务 API、健康检查和 Web 设为 18083、18081 和 4173。在启动 Web 的终端设置 `DASHBOARD_API_ORIGIN=http://127.0.0.1:18083`，浏览器仍使用同源 `/api`。探针从本机访问健康端口，反向代理只转发业务 API。

每个应用实例默认最多使用 8 个数据库连接，等连接的时间最多 2 秒。JdbcTemplate 和 MyBatis 单条语句默认各有 5 秒超时。可通过 `DISTRICT_DB_POOL_SIZE`、`DISTRICT_DB_MIN_IDLE`、`DISTRICT_DB_CONNECTION_TIMEOUT_MS`、`DISTRICT_DB_QUERY_TIMEOUT` 和 `DISTRICT_MAPPER_TIMEOUT_SECONDS` 调整。多实例部署时按实例数计算总连接预算，并给迁移、监控及其他服务留出余量。

要验证 MySQL 8.4，使用专门的空库。由本地安全配置提供 `DISTRICT_MYSQL_URL`、`DISTRICT_MYSQL_USERNAME` 和 `DISTRICT_MYSQL_PASSWORD`，改用以下启动参数。迁移和演示种数会写入指定库。

```powershell
java -jar backend/bootstrap/target/district-dashboard.jar --spring.profiles.active=demo,mysql
```

点击展示页的悬浮语音圆钮并允许使用麦克风，说“小门小门，看大台街道的网格治理”。播报结束后可继续说“小门小门，这里的微网格有多少”。再次点击可关闭监听。圆钮可拖动，切换专题后仍保持位置和监听状态。本机识别需要支持中文本地识别的浏览器与语言包，朗读使用设备的中文语音。豆包流式语音识别 2.0 留待后续服务端接入。

## P2 数据接入

在数据管理选择演示数据管理员。来源流程依次为配置、测试预览和同步。指标表单从成功数据集中选择度量，支持求和、分子分母汇总后计算比率。发布后可在区域数据页查看指标和来源批次，也可用 AI4BI 问当前区域的最新数值。来源、指标版本和历史运行可追溯。 [数据管理](http://127.0.0.1:5173/admin)

- CSV 可直接上传 [空气观测样例](fixtures/p2/air-observations.csv)，字段映射为 `region/date/measure/value/denominator`。
- HTTPS 夹具通过 JDK keytool 生成独立演示信任库。启动后有 `/data.json`、`/alternate.json` 和带错误行的 `/invalid.json`。应用按登记的准确地址访问，始终校验证书。
- MySQL [样例建库脚本](fixtures/p2/mysql-fixture.sql) 建立独立数据库及 `v_observations`。连接登记只引用批准视图，源库账号只授 `SELECT`。JDBC 使用 `sslMode=VERIFY_IDENTITY` 和匹配主机名的证书。来源凭据由服务端环境注入。

本地运行 HTTPS 夹具时，先在独立终端准备并启动测试服务。

```powershell
$fixturePath = Join-Path $env:TEMP 'district-p2-fixtures'
node scripts/p2-https-fixture.mjs prepare $fixturePath
node scripts/p2-https-fixture.mjs serve $fixturePath 18443
```

在后端启动终端登记已批准的样例端点，并仅为此 Java 进程传入独立信任库。若绑定独立 MySQL，`DISTRICT_INGESTION_MYSQL_CONNECTIONS` 使用对象数组，每条包含 `id/label/jdbcUrl/username/password/views`。视图项包含 `id/label/name`。通过 TLS 运行 MySQL 夹具时，将其测试 CA 加入相应的 JDBC 信任库。

```powershell
$fixturePath = Join-Path $env:TEMP 'district-p2-fixtures'
$env:DISTRICT_INGESTION_HTTPS_ENDPOINTS = '[{"label":"治理事件 HTTPS","endpoint":"https://127.0.0.1:18443/data.json"},{"label":"质量校验 HTTPS","endpoint":"https://127.0.0.1:18443/invalid.json"}]'
$fixtureTrust = Join-Path $fixturePath 'fixture-trust.p12'
java "-Djavax.net.ssl.trustStore=$fixtureTrust" '-Djavax.net.ssl.trustStoreType=PKCS12' '-Djavax.net.ssl.trustStorePassword=fixture-only' -jar backend/bootstrap/target/district-dashboard.jar '--spring.profiles.active=demo'
```

三种夹具同时可用时，可在独立空的演示目录执行 `node scripts/p2-smoke.mjs` 生成验收配置并验证发布结果。管理后台浏览器回归使用 `pnpm --dir frontend test:e2e:admin`，有三路已登记夹具时可设 `E2E_VERIFY_ALL_CONNECTORS=1`。

## P3 独立数据页

| 入口 | 路径 |
| --- | --- |
| 路网监测 | [首页](http://127.0.0.1:5173/) |
| 网格治理 | [网格地图](http://127.0.0.1:5173/screens/grid) |
| 水域态势 | [水域地图](http://127.0.0.1:5173/screens/waters) |
| 区域诊断 | [大台街道指标与事项](http://127.0.0.1:5173/screens/diagnosis?area=datai) |
| 城镇人口 | [人口星图](http://127.0.0.1:5173/screens/population) |
| 基层治理 | [接诉即办工单](http://127.0.0.1:5173/screens/governance) |
| 经济发展 | [经济专题](http://127.0.0.1:5173/screens/economy) |

独立页支持直接打开、刷新、前进与后退。使用选择器或语音导航时，React Router 更新地址，区域数据按区域 ID 查询并复用缓存。接诉即办查询还依赖所选月份。地图的路网、村居和水域来自业主演示素材，监测数值采用演示口径。

## 验证

在前后端运行时从项目根目录执行接口冒烟，通过 Vite 代理校验会话、推荐和授权展示链路。

```powershell
node scripts/smoke.mjs http://127.0.0.1:5173
node scripts/generate-api-codes.mjs --check
pnpm --dir frontend contracts:check
pnpm --dir frontend lint
pnpm --dir frontend typecheck
pnpm --dir frontend test:intent
pnpm --dir frontend build
pnpm --dir frontend test:e2e
pnpm --dir frontend test:e2e:topics
pnpm --dir frontend test:e2e:areas
pnpm --dir frontend test:e2e:voice
```

端到端测试需要 Chromium。未安装时运行 `pnpm --dir frontend exec playwright install chromium`。后台健康探针位于 [本机 8081](http://127.0.0.1:8081/actuator/health)，演示接口契约位于 [contracts/openapi.json](contracts/openapi.json)。

修改 API 后运行 `pnpm --dir frontend contracts:generate`。公共响应码编辑 [contracts/response-codes.json](contracts/response-codes.json)，再运行 `node scripts/generate-api-codes.mjs` 同步 Java 和 TypeScript。
