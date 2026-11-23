package gov.district.dashboard.catalog;

import java.time.LocalDateTime;
import java.util.List;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

@Mapper
interface MetricMapper {

    String FIND_METRICS = """
            SELECT m.metric_id, m.revision, m.label, m.unit, m.source_id, m.measure, m.aggregation, m.description,
                   r.version AS published_version, r.label AS published_label, r.unit AS published_unit,
                   r.source_id AS published_source_id, r.measure AS published_measure,
                   r.aggregation AS published_aggregation, r.description AS published_description, r.published_at
            FROM cat_metric m
            LEFT JOIN cat_metric_release r ON r.metric_id = m.metric_id AND r.version = m.published_version
            """;

    @Select(FIND_METRICS + "ORDER BY m.metric_id")
    List<MetricRow> findAll();

    @Select(FIND_METRICS + "WHERE m.metric_id = #{id}")
    MetricRow findById(String id);

    @Select(FIND_METRICS + "WHERE m.published_version IS NOT NULL ORDER BY m.metric_id")
    List<MetricRow> findPublished();

    @Insert("""
            INSERT INTO cat_metric (metric_id, revision, label, unit, source_id, measure, aggregation, description)
            VALUES (#{id}, 1, #{label}, #{unit}, #{sourceId}, #{measure}, #{aggregation}, #{description})
            """)
    void insertDraft(MetricInput input);

    @Update("""
            UPDATE cat_metric SET revision = revision + 1, label = #{input.label}, unit = #{input.unit},
                source_id = #{input.sourceId}, measure = #{input.measure}, aggregation = #{input.aggregation},
                description = #{input.description}
            WHERE metric_id = #{input.id} AND revision = #{revision}
            """)
    int updateDraft(@Param("input") MetricInput input, @Param("revision") long revision);

    @Update("""
            UPDATE cat_metric SET revision = revision + 1, published_version = #{version}
            WHERE metric_id = #{id} AND revision = #{revision}
            """)
    int pointToRelease(@Param("id") String id, @Param("revision") long revision, @Param("version") long version);

    @Insert("""
            INSERT INTO cat_metric_release
                (metric_id, version, label, unit, source_id, measure, aggregation, description, published_at)
            VALUES (#{input.id}, #{version}, #{input.label}, #{input.unit}, #{input.sourceId}, #{input.measure},
                #{input.aggregation}, #{input.description}, #{publishedAt})
            """)
    void insertRelease(@Param("input") MetricInput input, @Param("version") long version,
                       @Param("publishedAt") LocalDateTime publishedAt);
}
