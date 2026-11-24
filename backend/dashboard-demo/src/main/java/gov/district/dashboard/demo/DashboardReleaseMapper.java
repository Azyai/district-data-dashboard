package gov.district.dashboard.demo;

import java.time.Instant;
import java.util.List;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

@Mapper
interface DashboardReleaseMapper {

    @Select("""
            SELECT revision FROM demo_dashboard_draft
            WHERE project_id = #{projectId}
            FOR UPDATE
            """)
    Integer lockDraft(String projectId);

    @Insert("""
            INSERT INTO demo_dashboard_release
                (project_id, draft_revision, submitted_by, submitted_at, review_status, components_json)
            VALUES (#{projectId}, #{revision}, #{submittedBy}, #{submittedAt}, 'PENDING', #{componentsJson})
            """)
    void insertRelease(@Param("projectId") String projectId, @Param("revision") int revision,
                       @Param("submittedBy") String submittedBy, @Param("submittedAt") Instant submittedAt,
                       @Param("componentsJson") String componentsJson);

    @Select("""
            SELECT draft_revision, submitted_by, submitted_at, review_status, reviewed_by, reviewed_at, review_note
            FROM demo_dashboard_release
            WHERE project_id = #{projectId}
            ORDER BY draft_revision DESC
            LIMIT 30
            """)
    List<ReleaseSummaryRow> list(String projectId);

    @Select("""
            SELECT draft_revision, submitted_by, submitted_at, review_status, reviewed_by, reviewed_at, review_note,
                components_json
            FROM demo_dashboard_release
            WHERE project_id = #{projectId} AND draft_revision = #{revision}
            """)
    ReleaseRow find(@Param("projectId") String projectId, @Param("revision") int revision);

    @Update("""
            UPDATE demo_dashboard_release
            SET review_status = #{reviewStatus}, reviewed_by = #{reviewedBy}, reviewed_at = #{reviewedAt},
                review_note = #{reviewNote,jdbcType=VARCHAR}
            WHERE project_id = #{projectId} AND draft_revision = #{revision} AND review_status = 'PENDING'
            """)
    int review(@Param("projectId") String projectId, @Param("revision") int revision,
               @Param("reviewStatus") String reviewStatus, @Param("reviewedBy") String reviewedBy,
               @Param("reviewedAt") Instant reviewedAt, @Param("reviewNote") String reviewNote);

    @Select("""
            SELECT draft_revision, activation_serial, activated_by, activated_at
            FROM demo_dashboard_live
            WHERE project_id = #{projectId}
            """)
    LiveRow findLive(String projectId);

    @Insert("""
            INSERT INTO demo_dashboard_live (project_id, draft_revision, activation_serial, activated_by, activated_at)
            VALUES (#{projectId}, #{revision,jdbcType=INTEGER}, #{serial}, #{activatedBy}, #{activatedAt})
            """)
    void insertLive(@Param("projectId") String projectId, @Param("revision") Integer revision,
                    @Param("serial") long serial, @Param("activatedBy") String activatedBy,
                    @Param("activatedAt") Instant activatedAt);

    @Update("""
            UPDATE demo_dashboard_live
            SET draft_revision = #{revision,jdbcType=INTEGER}, activation_serial = activation_serial + 1,
                activated_by = #{activatedBy}, activated_at = #{activatedAt}
            WHERE project_id = #{projectId} AND activation_serial = #{expectedSerial}
            """)
    int updateLive(@Param("projectId") String projectId, @Param("revision") Integer revision,
                   @Param("expectedSerial") long expectedSerial, @Param("activatedBy") String activatedBy,
                   @Param("activatedAt") Instant activatedAt);

    @Select("""
            SELECT l.draft_revision, l.activation_serial, l.activated_by, l.activated_at, r.components_json
            FROM demo_dashboard_live l
            LEFT JOIN demo_dashboard_release r
                ON r.project_id = l.project_id AND r.draft_revision = l.draft_revision
            WHERE l.project_id = #{projectId} AND (l.draft_revision IS NULL OR r.review_status = 'APPROVED')
            """)
    LiveReleaseRow findLiveRelease(String projectId);

    @Insert("""
            INSERT INTO demo_dashboard_activation
                (project_id, draft_revision, activation_serial, activated_by, activated_at, activation_note)
            VALUES (#{projectId}, #{revision,jdbcType=INTEGER}, #{serial}, #{activatedBy}, #{activatedAt},
                #{note,jdbcType=VARCHAR})
            """)
    void insertActivation(@Param("projectId") String projectId, @Param("revision") Integer revision,
                          @Param("serial") long serial, @Param("activatedBy") String activatedBy,
                          @Param("activatedAt") Instant activatedAt, @Param("note") String note);

    record ReleaseSummaryRow(int revision, String submittedBy, Instant submittedAt, String reviewStatus,
                             String reviewedBy, Instant reviewedAt, String reviewNote) {
    }

    record ReleaseRow(int revision, String submittedBy, Instant submittedAt, String reviewStatus,
                      String reviewedBy, Instant reviewedAt, String reviewNote, String componentsJson) {
    }

    record LiveRow(Integer revision, long serial, String activatedBy, Instant activatedAt) {
    }

    record LiveReleaseRow(Integer revision, long serial, String activatedBy, Instant activatedAt,
                          String componentsJson) {
    }
}
