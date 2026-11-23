CREATE TABLE demo_dashboard_draft (
    project_id VARCHAR(64) NOT NULL COMMENT '演示专题标识',
    revision INT NOT NULL COMMENT '已保存草稿版本',
    PRIMARY KEY (project_id)
) COMMENT '演示专题草稿';

CREATE TABLE demo_dashboard_draft_component (
    project_id VARCHAR(64) NOT NULL COMMENT '所属专题标识',
    component_id VARCHAR(64) NOT NULL COMMENT '草稿组件标识',
    ordinal_no INT NOT NULL COMMENT '组件在草稿中的顺序',
    title VARCHAR(200) NOT NULL COMMENT '组件标题',
    component_type VARCHAR(8) NOT NULL COMMENT '组件类型',
    metric_id VARCHAR(64) NOT NULL COMMENT '专题模板指标标识',
    unit VARCHAR(20) NOT NULL COMMENT '指标单位',
    position_x INT NOT NULL COMMENT '画布横坐标',
    position_y INT NOT NULL COMMENT '画布纵坐标',
    component_width INT NOT NULL COMMENT '画布内宽度',
    component_height INT NOT NULL COMMENT '画布内高度',
    layer_z INT NOT NULL COMMENT '组件层级',
    PRIMARY KEY (project_id, component_id),
    CONSTRAINT uk_demo_dashboard_component_order UNIQUE (project_id, ordinal_no),
    CONSTRAINT fk_demo_dashboard_component_draft FOREIGN KEY (project_id) REFERENCES demo_dashboard_draft (project_id)
) COMMENT '演示专题草稿组件与画布位置';
