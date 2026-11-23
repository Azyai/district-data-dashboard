CREATE INDEX ix_src_observation_measure_scope ON src_observation (batch_id, measure, region_id, observed_on);

CREATE TABLE src_observation_coverage (
    batch_id VARCHAR(36) NOT NULL COMMENT '成功批次标识',
    measure VARCHAR(64) NOT NULL COMMENT '规范度量标识',
    region_id VARCHAR(64) NOT NULL COMMENT '规范区域标识',
    latest_day DATE NOT NULL COMMENT '该区域和度量在成功批次内的最近观测日',
    rate_invalid BOOLEAN NOT NULL COMMENT '该区域和度量在批次内是否存在无效比率观测',
    PRIMARY KEY (batch_id, measure, region_id),
    CONSTRAINT fk_src_observation_coverage_batch FOREIGN KEY (batch_id) REFERENCES src_batch (id)
) COMMENT '按批次、度量及区域物化的观测覆盖范围，用于有界指标读取';

INSERT INTO src_observation_coverage (batch_id, measure, region_id, latest_day, rate_invalid)
SELECT batch_id, measure, region_id, MAX(observed_on),
       MAX(CASE WHEN denominator IS NULL OR denominator <= 0 OR metric_value < 0
                     OR metric_value > denominator THEN 1 ELSE 0 END)
FROM src_observation
GROUP BY batch_id, measure, region_id;
