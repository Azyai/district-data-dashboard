package gov.district.dashboard.bootstrap.hotline;

import java.time.LocalDate;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;

import static org.assertj.core.api.Assertions.assertThat;

class HotlineDemoCalendarTests {
    @Test
    void appendsMissingDaysAcrossMonthBoundaryAndPreservesTheArchiveAndExistingTickets() {
        var db = new DriverManagerDataSource("jdbc:h2:mem:calendar_" + UUID.randomUUID() + ";MODE=MySQL;DB_CLOSE_DELAY=-1", "sa", "");
        Flyway.configure().dataSource(db).locations("classpath:db/migration", "classpath:db/demo").load().migrate();
        var jdbc = new JdbcTemplate(db);
        var calendar = new HotlineDemoCalendar(jdbc, new TransactionTemplate(new DataSourceTransactionManager(db)));
        var first = LocalDate.of(2026, 11, 1);
        calendar.refresh(first);
        int earliestCount = jdbc.queryForObject("SELECT COUNT(*) FROM hotline_ticket WHERE month_start=?", Integer.class, first);
        assertThat(earliestCount).isPositive();
        String id = jdbc.queryForObject("SELECT MIN(ticket_id) FROM hotline_ticket WHERE month_start=?", String.class, first);
        jdbc.update("UPDATE hotline_ticket SET note='已核实现场' WHERE ticket_id=?", id);
        LocalDate next = first.plusMonths(1);
        calendar.refresh(next);
        int count = jdbc.queryForObject("SELECT COUNT(*) FROM hotline_ticket", Integer.class);
        calendar.refresh(next);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM hotline_ticket", Integer.class)).isEqualTo(count);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM hotline_ticket WHERE month_start < ?", Integer.class, first)).isEqualTo(22_035);
        assertThat(jdbc.queryForObject("SELECT note FROM hotline_ticket WHERE ticket_id=?", String.class, id)).isEqualTo("已核实现场");
        assertThat(jdbc.queryForObject("SELECT snapshot_on FROM hotline_snapshot WHERE month_start=?", LocalDate.class, first))
                .isEqualTo(next.minusDays(1));
        assertThat(jdbc.queryForObject("SELECT snapshot_on FROM hotline_snapshot WHERE month_start=?", LocalDate.class, next)).isEqualTo(next);
        assertThat(jdbc.queryForObject("""
                SELECT COUNT(*) FROM hotline_ticket t JOIN hotline_snapshot s ON s.month_start=t.month_start
                WHERE t.month_start >= ? AND (t.opened_on<t.month_start OR t.opened_on>s.snapshot_on OR
                  t.assigned_on>s.snapshot_on OR t.processed_on>s.snapshot_on OR t.closed_on>s.snapshot_on OR
                  t.elapsed_days<>TIMESTAMPDIFF(DAY,t.opened_on,COALESCE(t.closed_on,s.snapshot_on)))
                """, Integer.class, first)).isZero();
    }
}
