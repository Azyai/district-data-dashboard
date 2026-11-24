package gov.district.dashboard.bootstrap.hotline;

import gov.district.dashboard.demo.cockpit.MentougouAreaCatalog;
import gov.district.dashboard.demo.cockpit.MentougouAreaCatalog.Area;
import java.sql.Date;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/** Append daily synthetic records after the ten archived presentation months. */
@Component
@Profile("demo")
class HotlineDemoCalendar implements ApplicationRunner {
    static final ZoneId BEIJING = ZoneId.of("Asia/Shanghai");
    static final YearMonth FIRST_MONTH = YearMonth.of(2026, 11);
    private static final DateTimeFormatter PREFIX = DateTimeFormatter.ofPattern("'HL-'uuuuMM'-'", Locale.ROOT);
    private static final List<Area> TOWNS = MentougouAreaCatalog.allPaths().stream()
            .map(List::getLast).filter(area -> area.level().equals("town")).toList();
    private static final List<Issue> ISSUES = List.of(
            new Issue("property", "楼道照明故障", "已修复照明并完成回访。"),
            new Issue("utilities", "供水设施滴漏", "已更换密封件并复查。"),
            new Issue("sanitation", "公共区域积存杂物", "已完成清运和现场检查。"),
            new Issue("traffic", "路口标线辨识度低", "已补划标线并复核。"),
            new Issue("other", "便民服务信息待更新", "已更新服务信息并反馈。"));
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;

    HotlineDemoCalendar(JdbcTemplate jdbc, TransactionTemplate transactions) {
        this.jdbc = jdbc;
        this.transactions = transactions;
    }

    @Override
    public void run(ApplicationArguments args) {
        refreshToday();
    }

    @Scheduled(cron = "0 0 0 * * *", zone = "Asia/Shanghai")
    public void refreshToday() {
        refresh(LocalDate.now(BEIJING));
    }

    void refresh(LocalDate today) {
        YearMonth end = YearMonth.from(today);
        for (YearMonth period = FIRST_MONTH; !period.isAfter(end); period = period.plusMonths(1)) {
            LocalDate through = period.equals(end) ? today : period.atEndOfMonth();
            transactions.executeWithoutResult(status -> appendMonth(through));
        }
    }

    private void appendMonth(LocalDate through) {
        LocalDate first = through.withDayOfMonth(1);
        // The seeded district row is a shared lock even when no snapshot exists for this month yet.
        jdbc.queryForObject("SELECT area_id FROM hotline_area WHERE area_id = 'mentougou' FOR UPDATE", String.class);
        var saved = jdbc.query("SELECT snapshot_on, quality, due_days, late_days FROM hotline_snapshot WHERE month_start = ? FOR UPDATE",
                (rs, n) -> new Cutoff(rs.getObject(1, LocalDate.class), rs.getString(2), rs.getInt(3), rs.getInt(4)), first);
        Cutoff cutoff = saved.isEmpty() ? new Cutoff(first.minusDays(1), "SIMULATED", 3, 7) : saved.getFirst();
        if (!cutoff.quality.equals("SIMULATED") || !cutoff.day.isBefore(through)) return;
        if (saved.isEmpty()) {
            jdbc.update("INSERT INTO hotline_snapshot (month_start, snapshot_on, quality, due_days, late_days) VALUES (?, ?, 'SIMULATED', ?, ?)",
                    first, through, cutoff.due, cutoff.late);
        }
        for (LocalDate day = cutoff.day.plusDays(1); !day.isAfter(through); day = day.plusDays(1)) {
            appendDay(day);
        }
        jdbc.update("""
                UPDATE hotline_ticket SET elapsed_days = TIMESTAMPDIFF(DAY, opened_on, ?),
                attention_lane = CASE WHEN opened_on <= ? THEN 'late' WHEN opened_on <= ? THEN 'due' ELSE 'open' END
                WHERE month_start = ? AND ticket_status <> 'closed'
                """, through, through.minusDays(cutoff.late), through.minusDays(cutoff.due), first);
        jdbc.update("UPDATE hotline_snapshot SET snapshot_on = ? WHERE month_start = ?", through, first);
    }

    private void appendDay(LocalDate day) {
        List<Object[]> batch = new ArrayList<>();
        String prefix = day.format(PREFIX);
        int dayIndex = day.getDayOfMonth() - 1;
        for (int t = 0; t < TOWNS.size(); t++) {
            Area town = TOWNS.get(t);
            List<Area> villages = town.children();
            int count = 2 + villages.getFirst().activity() / 12 + (day.getDayOfYear() + t) % 4;
            for (int i = 0; i < count; i++) {
                int seq = dayIndex * 1000 + t * 32 + i + 1;
                int sample = seq + day.getMonthValue() * 11;
                Area village = villages.get((dayIndex + i) % villages.size());
                Issue issue = ISSUES.get((sample + sample / 13) % ISSUES.size());
                boolean pending = sample % 43 == 0;
                boolean closed = !pending && sample % 17 != 0;
                int age = Math.min(dayIndex, sample % 5);
                LocalDate opened = day.minusDays(age);
                LocalDate processed = opened.plusDays(Math.min(age, 1));
                String state = closed ? "closed" : pending ? "pending" : "processing";
                batch.add(new Object[]{prefix + String.format(Locale.ROOT, "%05d", seq), day.withDayOfMonth(1),
                        village.id(), town.id(), issue.category, state, closed ? "closed" : "open", issue.title,
                        opened, pending ? null : Date.valueOf(opened), pending ? null : Date.valueOf(processed),
                        closed ? Date.valueOf(day) : null, age,
                        closed ? issue.outcome : pending ? "已登记诉求，等待派单。" : "承办单位正在核查现场情况。"});
            }
        }
        jdbc.batchUpdate("""
                INSERT INTO hotline_ticket (ticket_id,month_start,area_id,town_id,category_id,ticket_status,
                attention_lane,title,opened_on,assigned_on,processed_on,closed_on,elapsed_days,note)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, batch);
    }

    private record Issue(String category, String title, String outcome) {}
    private record Cutoff(LocalDate day, String quality, int due, int late) {}
}
