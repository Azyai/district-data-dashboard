CREATE TABLE dash_snapshot_observation (
    observation_id BIGINT NOT NULL COMMENT '采样记录主键',
    snapshot_id VARCHAR(64) NOT NULL COMMENT '所属快照标识',
    metric_id VARCHAR(64) NOT NULL COMMENT '指标标识',
    point_no INT NOT NULL COMMENT '指标下的展示顺序',
    point_label VARCHAR(80) COMMENT '时段或类别标签',
    metric_value DECIMAL(18, 2) NOT NULL COMMENT '指标数值',
    PRIMARY KEY (observation_id),
    CONSTRAINT uk_dash_snapshot_metric_point UNIQUE (snapshot_id, metric_id, point_no)
) COMMENT '大屏授权快照中的指标采样值';
