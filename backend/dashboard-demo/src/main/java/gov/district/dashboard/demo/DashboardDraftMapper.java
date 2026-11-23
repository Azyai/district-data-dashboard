package gov.district.dashboard.demo;

import gov.district.dashboard.demo.DemoPlaybackService.Component;
import gov.district.dashboard.demo.DemoPlaybackService.Geometry;
import java.util.List;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

@Mapper
interface DashboardDraftMapper {

    @Select("""
            SELECT d.revision, c.component_id, c.title, c.component_type, c.metric_id, c.unit,
                c.position_x, c.position_y, c.component_width, c.component_height, c.layer_z
            FROM demo_dashboard_draft d
            LEFT JOIN demo_dashboard_draft_component c ON c.project_id = d.project_id
            WHERE d.project_id = #{projectId}
            ORDER BY c.ordinal_no
            """)
    List<DraftRow> find(String projectId);

    @Insert("""
            INSERT INTO demo_dashboard_draft (project_id, revision)
            VALUES (#{projectId}, 1)
            """)
    void create(String projectId);

    @Update("""
            UPDATE demo_dashboard_draft SET revision = revision + 1
            WHERE project_id = #{projectId} AND revision = #{revision}
            """)
    int advance(@Param("projectId") String projectId, @Param("revision") int revision);

    @Delete("DELETE FROM demo_dashboard_draft_component WHERE project_id = #{projectId}")
    void clearComponents(String projectId);

    @Insert("""
            <script>
            INSERT INTO demo_dashboard_draft_component (
                project_id, component_id, ordinal_no, title, component_type, metric_id, unit,
                position_x, position_y, component_width, component_height, layer_z
            ) VALUES
            <foreach collection="components" item="component" index="ordinal" separator=",">
                (#{projectId}, #{component.id}, #{ordinal}, #{component.title}, #{component.type},
                 #{component.metricId}, #{component.unit}, #{component.geometry.x}, #{component.geometry.y},
                 #{component.geometry.width}, #{component.geometry.height}, #{component.geometry.z})
            </foreach>
            </script>
            """)
    void insertComponents(@Param("projectId") String projectId, @Param("components") List<Component> components);

    record DraftRow(int revision, String componentId, String title, String componentType, String metricId,
                    String unit, Integer positionX, Integer positionY, Integer componentWidth,
                    Integer componentHeight, Integer layerZ) {
        Component component() {
            return new Component(componentId, title, componentType, metricId, unit,
                    new Geometry(positionX, positionY, componentWidth, componentHeight, layerZ));
        }
    }
}
