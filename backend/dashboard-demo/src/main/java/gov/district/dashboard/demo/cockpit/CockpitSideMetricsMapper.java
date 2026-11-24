package gov.district.dashboard.demo.cockpit;

import java.util.List;
import java.util.Set;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

@Mapper
interface CockpitSideMetricsMapper {

    @Select("SELECT revision, left_metrics, right_metrics FROM demo_cockpit_side_metrics WHERE layout_id = 1")
    Row read();

    @Select("""
            <script>
            SELECT COUNT(*) FROM cat_metric WHERE published_version IS NOT NULL AND metric_id IN
            <foreach collection="ids" item="id" open="(" close=")" separator=",">#{id}</foreach>
            </script>
            """)
    int countPublished(@Param("ids") Set<String> ids);

    @Update("""
            UPDATE demo_cockpit_side_metrics SET left_metrics = #{left}, right_metrics = #{right}, revision = revision + 1
            WHERE layout_id = 1 AND revision = #{revision}
            """)
    int replace(@Param("revision") long revision, @Param("left") String left, @Param("right") String right);

    record Row(long revision, String leftMetrics, String rightMetrics) {
        CockpitSideMetrics.Settings toSettings() {
            return new CockpitSideMetrics.Settings(revision, List.of(leftMetrics.split(",")), List.of(rightMetrics.split(",")));
        }
    }
}
