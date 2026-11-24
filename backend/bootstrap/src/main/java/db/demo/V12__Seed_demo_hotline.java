package db.demo;

import gov.district.dashboard.demo.cockpit.MentougouAreaCatalog;
import gov.district.dashboard.demo.cockpit.MentougouAreaCatalog.Area;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Types;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;

public class V12__Seed_demo_hotline extends BaseJavaMigration {

    private static final int DUE_DAYS = 3;
    private static final int LATE_DAYS = 7;
    static final String PENDING_NOTE = "已登记诉求和发生时段，待确认承办单位并派单。";
    private static final DateTimeFormatter ID_MONTH = DateTimeFormatter.ofPattern("uuuuMM");
    private static final int[] DISTRICT_TREND = {1980, 1875, 2045, 2150, 2110, 2280, 2190, 2415, 2530};
    private static final List<TownVolume> TOWN_VOLUMES = List.of(
            new TownVolume("yongding", 552, 10, 9), new TownVolume("dayu", 371, 5, 4),
            new TownVolume("longquan", 322, 4, 4), new TownVolume("chengzi", 225, 4, 3),
            new TownVolume("dongxinfang", 185, 3, 2), new TownVolume("tanzhesi", 153, 3, 2),
            new TownVolume("junzhuang", 113, 2, 2), new TownVolume("wangping", 91, 2, 1),
            new TownVolume("zhaitang", 92, 3, 2), new TownVolume("miaofengshan", 79, 2, 2),
            new TownVolume("qingshui", 71, 2, 1), new TownVolume("yanchi", 65, 2, 1),
            new TownVolume("datai", 62, 2, 2));

    private static final List<Scenario> SCENARIOS = List.of(
            new Scenario("property", "电梯关门异响", "已清理门槽并复查关门功能。", "正在检测门机导轨和关门阻力。"),
            new Scenario("property", "楼门闭门器漏油", "已更换闭门器并复查运行。", "物业正在核对规格并安排更换。"),
            new Scenario("property", "单元楼门口防滑条脱落", "已固定防滑条并检查边缘。", "已设置防滑提示，待测量维修范围。"),
            new Scenario("property", "楼顶雨后渗水", "已修补渗水点并完成试水。", "物业正在排查天沟和落水管。"),
            new Scenario("utilities", "居民楼用水高峰水压偏低", "已调整供水泵并回访。", "供水单位正在排查加压设备参数。"),
            new Scenario("utilities", "公共水表井阀门渗水", "已更换密封件并检查渗漏。", "待核对阀门规格及更换时段。"),
            new Scenario("utilities", "楼层供暖主管异响", "已排气并复测温度。", "正在检查供暖支路和固定件。"),
            new Scenario("utilities", "公共电箱无法锁闭", "已更换锁扣并检查接地。", "已设置临时围护，电工待确认配件。"),
            new Scenario("sanitation", "垃圾投放点排水不畅", "已疏通排水口并完成消杀。", "负责单位正在核查堵塞程度。"),
            new Scenario("sanitation", "绿带堆有建筑废料", "已分类清运并恢复绿地。", "正在调配清运车辆。"),
            new Scenario("sanitation", "便民广场夜间保洁补扫", "已调整班次并现场复查。", "正在按人流高峰安排轮巡。"),
            new Scenario("traffic", "公交候车区地面起翘", "已补平铺面并检查高差。", "已设临时提示，待确认修补范围。"),
            new Scenario("traffic", "路口标线褪色", "已完成补划和现场复查。", "正在核对施工时段和标线范围。"),
            new Scenario("traffic", "村口减速带缺段", "已补齐缺段并复核通行。", "正在备料并协调施工时段。"),
            new Scenario("other", "便民服务指引信息更新", "已同步服务时段和办事地点。", "正在核对各窗口服务信息。"),
            new Scenario("other", "公共健身器材连接件松动", "已加固连接件并复核。", "已暂停使用，正核对部件磨损情况。"));

    @Override
    public void migrate(Context context) throws SQLException {
        Connection connection = context.getConnection();
        seedAreas(connection);
        seedTickets(connection);
    }

    private static void seedAreas(Connection connection) throws SQLException {
        try (PreparedStatement insert = connection.prepareStatement(
                "INSERT INTO hotline_area (area_id, area_name, area_level, parent_id) VALUES (?, ?, ?, ?)")) {
            for (List<Area> path : MentougouAreaCatalog.allPaths()) {
                Area area = path.getLast();
                insert.setString(1, area.id());
                insert.setString(2, area.name());
                insert.setString(3, area.level());
                insert.setString(4, path.size() == 1 ? null : path.get(path.size() - 2).id());
                insert.executeUpdate();
            }
        }
    }

    private static void seedTickets(Connection connection) throws SQLException {
        int octoberTotal = TOWN_VOLUMES.stream().mapToInt(town -> town.closed() + town.due() + town.late()).sum();
        try (PreparedStatement insertSnapshot = connection.prepareStatement("""
                INSERT INTO hotline_snapshot (month_start, snapshot_on, quality, due_days, late_days)
                VALUES (?, ?, 'SIMULATED', ?, ?)
                """);
             PreparedStatement insertTicket = connection.prepareStatement("""
                INSERT INTO hotline_ticket (
                    ticket_id, month_start, area_id, town_id, category_id, ticket_status, attention_lane,
                    title, opened_on, assigned_on, processed_on, closed_on, elapsed_days, note
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """)) {
            for (int month = 1; month <= 10; month++) {
                YearMonth period = YearMonth.of(2026, month);
                LocalDate snapshotOn = period.atDay(24);
                insertSnapshot.setObject(1, period.atDay(1));
                insertSnapshot.setObject(2, snapshotOn);
                insertSnapshot.setInt(3, DUE_DAYS);
                insertSnapshot.setInt(4, LATE_DAYS);
                insertSnapshot.executeUpdate();

                double scale = month == 10 ? 1 : DISTRICT_TREND[month - 1] / (double) octoberTotal;
                int awaitingDispatch = scaled(25, scale);
                int activeTotal = countActive(scale);
                int sequence = 0;
                int activeSequence = 0;
                int previous = 0;
                for (TownVolume town : TOWN_VOLUMES) {
                    Area area = MentougouAreaCatalog.allPaths().stream()
                            .filter(path -> path.getLast().id().equals(town.id()))
                            .findFirst().orElseThrow().getLast();
                    int closedEnd = previous + town.closed();
                    int dueEnd = closedEnd + town.due();
                    int lateEnd = dueEnd + town.late();
                    for (int index = scaled(previous, scale); index < scaled(lateEnd, scale); index++) {
                        String lane = index < scaled(closedEnd, scale) ? "closed"
                                : index < scaled(dueEnd, scale) ? "due" : "late";
                        int elapsed = switch (lane) {
                            case "closed" -> 1 + (sequence * 7 + month) % 22;
                            case "due" -> DUE_DAYS + sequence % (LATE_DAYS - DUE_DAYS);
                            default -> LATE_DAYS + sequence % 11;
                        };
                        String status = "closed";
                        if (!lane.equals("closed")) {
                            int assignedBefore = activeSequence * awaitingDispatch / activeTotal;
                            int assignedNow = ++activeSequence * awaitingDispatch / activeTotal;
                            status = assignedNow > assignedBefore ? "pending" : "processing";
                        }
                        Area village = area.children().get((sequence + month + sequence / 5) % area.children().size());
                        addTicket(insertTicket, period, ++sequence, snapshotOn, village, area, status, lane, elapsed);
                    }
                    previous = lateEnd;
                }
                insertTicket.executeBatch();
            }
        }
    }

    private static int scaled(int total, double scale) {
        return (int) Math.round(total * scale);
    }

    private static int countActive(double scale) {
        int activeTotal = 0;
        int cumulativeTotal = 0;
        for (TownVolume town : TOWN_VOLUMES) {
            int closedEnd = cumulativeTotal + town.closed();
            cumulativeTotal = closedEnd + town.due() + town.late();
            activeTotal += scaled(cumulativeTotal, scale) - scaled(closedEnd, scale);
        }
        return activeTotal;
    }

    private static void addTicket(PreparedStatement insert, YearMonth period, int sequence, LocalDate snapshotOn,
                                  Area village, Area town, String status, String lane, int elapsed) throws SQLException {
        Scenario scenario = SCENARIOS.get((sequence * 7 + period.getMonthValue() + sequence / 23) % SCENARIOS.size());
        LocalDate openedOn = snapshotOn.minusDays(elapsed);
        LocalDate closedOn = status.equals("closed") ? openedOn.plusDays(Math.min(elapsed, 2 + sequence % 4)) : null;
        insert.setString(1, "HL-" + period.format(ID_MONTH) + "-" + "%05d".formatted(sequence));
        insert.setObject(2, period.atDay(1));
        insert.setString(3, village.id());
        insert.setString(4, town.id());
        insert.setString(5, scenario.category());
        insert.setString(6, status);
        insert.setString(7, lane);
        insert.setString(8, scenario.title());
        insert.setObject(9, openedOn);
        setDate(insert, 10, status.equals("pending") ? null : openedOn);
        setDate(insert, 11, status.equals("pending") ? null : openedOn.plusDays(1));
        setDate(insert, 12, closedOn);
        insert.setInt(13, closedOn == null ? elapsed : (int) ChronoUnit.DAYS.between(openedOn, closedOn));
        insert.setString(14, switch (status) {
            case "closed" -> scenario.outcome();
            case "processing" -> scenario.followUp();
            default -> PENDING_NOTE;
        });
        insert.addBatch();
    }

    private static void setDate(PreparedStatement insert, int index, LocalDate value) throws SQLException {
        if (value == null) {
            insert.setNull(index, Types.DATE);
        } else {
            insert.setObject(index, value);
        }
    }

    static String processingNote(String title) {
        return SCENARIOS.stream().filter(scenario -> scenario.title().equals(title))
                .map(Scenario::followUp).findFirst().orElse(null);
    }

    private record TownVolume(String id, int closed, int due, int late) {
    }

    private record Scenario(String category, String title, String outcome, String followUp) {
    }
}
