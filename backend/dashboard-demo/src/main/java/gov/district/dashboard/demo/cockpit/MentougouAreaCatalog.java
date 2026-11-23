package gov.district.dashboard.demo.cockpit;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * Demonstration directory of 9 towns and 4 subdistricts with selected villages and communities.
 * Administrative names follow the Mentougou district government directory.
 * Coordinates are local schematic positions. Activity weights are synthetic.
 */
final class MentougouAreaCatalog {

    static final Area ROOT = new Area("mentougou", "门头沟区", "district", 0, 0, 0, List.of(
            town("dayu", "大峪街道", 0.72, 0.25,
                    sample("dayu-juchangdongjie", "剧场东街社区", -0.48, -0.22, 86),
                    sample("dayu-shuangyu", "双峪社区", 0.41, 0.29, 78)),
            town("chengzi", "城子街道", 0.76, 0.01,
                    sample("chengzi-yanbaojiayuan", "燕保家园社区", -0.44, -0.29, 68),
                    sample("chengzi-qikeshu", "七棵树东街社区", 0.43, 0.28, 63)),
            town("dongxinfang", "东辛房街道", 0.56, 0.40,
                    sample("dongxinfang-shimenying-4", "石门营新区四区社区", -0.46, -0.24, 62),
                    sample("dongxinfang-shimenying-7", "石门营新区七区社区", 0.51, 0.18, 63)),
            town("datai", "大台街道", -0.14, 0.38,
                    sample("datai-qianjuntai", "千军台社区", -0.53, -0.15, 24),
                    sample("datai-muchengjian", "木城涧社区", 0.45, 0.27, 28)),
            town("longquan", "龙泉镇", 0.55, 0.10,
                    sample("longquan-sanjiadian", "三家店村", -0.43, -0.29, 47),
                    sample("longquan-liuliqu", "琉璃渠村", 0.41, 0.33, 42)),
            town("yongding", "永定镇", 0.82, 0.59,
                    sample("yongding-shichang", "石厂村", -0.45, -0.15, 72),
                    sample("yongding-xixincheng", "西辛秤村", 0.54, 0.31, 52)),
            town("tanzhesi", "潭柘寺镇", 0.34, 0.69,
                    sample("tanzhesi-nancun", "南村", -0.51, 0.25, 37),
                    sample("tanzhesi-nanxinfang", "南辛房村", 0.51, -0.24, 32)),
            town("junzhuang", "军庄镇", 0.69, -0.26,
                    sample("junzhuang-junzhuang", "军庄村", -0.40, 0.27, 41),
                    sample("junzhuang-huiyu", "灰峪村", 0.56, -0.28, 31)),
            town("miaofengshan", "妙峰山镇", 0.33, -0.37,
                    sample("miaofengshan-longjiazhuang", "陇驾庄村", -0.48, -0.24, 41),
                    sample("miaofengshan-shuiyuzui", "水峪嘴村", 0.45, 0.31, 33)),
            town("wangping", "王平镇", 0.12, 0.12,
                    sample("wangping-huihexinyuan", "惠和新苑社区", -0.44, -0.15, 36),
                    sample("wangping-jiuyuan", "韭园村", 0.42, 0.25, 25)),
            town("yanchi", "雁翅镇", -0.15, -0.25,
                    sample("yanchi-qinyu", "芹峪村", -0.49, 0.20, 30),
                    sample("yanchi-weizishui", "苇子水村", 0.53, -0.21, 23)),
            town("zhaitang", "斋堂镇", -0.48, -0.06,
                    sample("zhaitang-dongzhaitang", "东斋堂村", -0.49, -0.23, 36),
                    sample("zhaitang-cuandixia", "爨底下村", 0.43, 0.22, 31)),
            town("qingshui", "清水镇", -0.76, 0.27,
                    sample("qingshui-shengli", "胜利村", -0.44, -0.20, 24),
                    sample("qingshui-hongshuiyu", "洪水峪村", 0.53, 0.31, 23))
    ));

    private static final List<List<Area>> ALL_PATHS = paths(ROOT, List.of()).toList();
    private static final Map<String, List<Area>> PATHS = ALL_PATHS.stream()
            .collect(Collectors.toUnmodifiableMap(path -> path.getLast().id(), path -> path));

    static List<List<Area>> allPaths() {
        return ALL_PATHS;
    }

    static List<Area> path(String regionId) {
        return PATHS.getOrDefault(regionId, List.of());
    }

    private static Stream<List<Area>> paths(Area area, List<Area> ancestors) {
        var current = new ArrayList<>(ancestors);
        current.add(area);
        List<Area> path = List.copyOf(current);
        return Stream.concat(Stream.of(path), area.children().stream().flatMap(child -> paths(child, path)));
    }

    private MentougouAreaCatalog() {
    }

    private static Area town(String id, String name, double x, double z, Area... children) {
        return new Area(id, name, "town", x, z, 0, List.of(children));
    }

    private static Area sample(String id, String name, double x, double z, int activity) {
        return new Area(id, name, "village", x, z, activity, List.of());
    }

    record Area(String id, String name, String level, double x, double z, int activity, List<Area> children) {
    }
}
