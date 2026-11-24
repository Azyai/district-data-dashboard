package db.demo;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;

/** Reconcile an earlier preview of the synthetic V12 fixture without replacing tickets or operator edits. */
public class V14__Reconcile_preview_hotline_tickets extends BaseJavaMigration {

    private static final int[] MONTH_TOTALS = {1980, 1875, 2045, 2150, 2110, 2280, 2190, 2415, 2530, 2460};

    @Override
    public void migrate(Context context) throws SQLException {
        Connection db = context.getConnection();
        try (PreparedStatement read = db.prepareStatement("""
                SELECT t.ticket_id,t.title,t.ticket_status,t.opened_on,t.assigned_on,t.processed_on,
                       t.closed_on,t.elapsed_days,t.note,s.snapshot_on
                FROM hotline_ticket t JOIN hotline_snapshot s ON s.month_start=t.month_start
                WHERE s.quality='SIMULATED' AND s.month_start=? AND t.ticket_id LIKE ?
                ORDER BY t.ticket_id
                """);
             PreparedStatement duration = db.prepareStatement("""
                UPDATE hotline_ticket SET elapsed_days=? WHERE ticket_id=? AND elapsed_days=?
                """);
             PreparedStatement dispatch = db.prepareStatement("""
                UPDATE hotline_ticket SET ticket_status=?,assigned_on=?,processed_on=?,note=?
                WHERE ticket_id=? AND ticket_status=? AND note=?
                """)) {
            for (int index = 0; index < MONTH_TOTALS.length; index++) {
                YearMonth month = YearMonth.of(2026, index + 1);
                int total = MONTH_TOTALS[index];
                String prefix = "HL-" + month.toString().replace("-", "") + "-";
                read.setObject(1, month.atDay(1));
                read.setString(2, prefix + "%");
                List<Row> rows = new ArrayList<>(total);
                try (ResultSet result = read.executeQuery()) {
                    while (result.next()) {
                        rows.add(new Row(result.getString(1), result.getString(2), result.getString(3),
                                result.getObject(4, LocalDate.class), result.getObject(5, LocalDate.class),
                                result.getObject(6, LocalDate.class), result.getObject(7, LocalDate.class),
                                result.getInt(8), result.getString(9), result.getObject(10, LocalDate.class)));
                    }
                }
                if (rows.size() != total) {
                    continue;
                }
                List<Row> active = new ArrayList<>();
                for (Row row : rows) {
                    if (row.closed() != null) {
                        fixDuration(duration, row);
                    } else {
                        active.add(row);
                    }
                }
                int pending = (int) Math.round(total * 25.0 / MONTH_TOTALS[9]);
                for (int position = 0; position < active.size(); position++) {
                    boolean shouldWait = (position + 1) * pending / active.size() > position * pending / active.size();
                    fixDispatch(dispatch, active.get(position), position % 3 == 0, shouldWait);
                }
                duration.executeBatch();
                dispatch.executeBatch();
            }
        }
    }

    private static void fixDuration(PreparedStatement update, Row row) throws SQLException {
        long actual = ChronoUnit.DAYS.between(row.opened(), row.closed());
        long legacy = ChronoUnit.DAYS.between(row.opened(), row.snapshot());
        if (row.status().equals("closed") && row.elapsed() == legacy && row.elapsed() != actual) {
            update.setLong(1, actual);
            update.setString(2, row.id());
            update.setInt(3, row.elapsed());
            update.addBatch();
        }
    }

    private static void fixDispatch(PreparedStatement update, Row row, boolean wasPending, boolean isPending)
            throws SQLException {
        if (wasPending == isPending || !row.status().equals(wasPending ? "pending" : "processing")) {
            return;
        }
        String processingNote = V12__Seed_demo_hotline.processingNote(row.title());
        String pendingNote = V12__Seed_demo_hotline.PENDING_NOTE;
        LocalDate start = row.opened();
        boolean datesMatch = wasPending ? row.assigned() == null && row.processed() == null
                : start.equals(row.assigned()) && start.plusDays(1).equals(row.processed());
        if (!datesMatch || processingNote == null || !row.note().equals(wasPending ? pendingNote : processingNote)) {
            return;
        }
        update.setString(1, isPending ? "pending" : "processing");
        update.setObject(2, isPending ? null : start);
        update.setObject(3, isPending ? null : start.plusDays(1));
        update.setString(4, isPending ? pendingNote : processingNote);
        update.setString(5, row.id());
        update.setString(6, row.status());
        update.setString(7, row.note());
        update.addBatch();
    }

    private record Row(String id, String title, String status, LocalDate opened, LocalDate assigned,
                       LocalDate processed, LocalDate closed, int elapsed, String note, LocalDate snapshot) {}
}
