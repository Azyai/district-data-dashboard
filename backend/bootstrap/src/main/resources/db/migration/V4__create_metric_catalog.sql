CREATE TABLE cat_metric (
    metric_id VARCHAR(64) NOT NULL COMMENT '指标稳定标识',
    revision BIGINT NOT NULL COMMENT '草稿和发布指针乐观锁版本',
    label VARCHAR(80) NOT NULL COMMENT '草稿展示名称',
    unit VARCHAR(20) NOT NULL COMMENT '草稿展示单位',
    source_id VARCHAR(64) NOT NULL COMMENT '草稿数据来源标识',
    measure VARCHAR(64) NOT NULL COMMENT '草稿观测字段标识',
    aggregation VARCHAR(8) NOT NULL COMMENT '草稿聚合方式',
    description VARCHAR(300) NOT NULL COMMENT '草稿业务口径',
    published_version BIGINT COMMENT '当前发布版本且为空时表示尚未发布',
    PRIMARY KEY (metric_id)
) COMMENT '指标草稿及发布指针';

CREATE TABLE cat_metric_release (
    metric_id VARCHAR(64) NOT NULL COMMENT '所属指标稳定标识',
    version BIGINT NOT NULL COMMENT '发布时的指标版本',
    label VARCHAR(80) NOT NULL COMMENT '已发布展示名称',
    unit VARCHAR(20) NOT NULL COMMENT '已发布展示单位',
    source_id VARCHAR(64) NOT NULL COMMENT '已发布数据来源标识',
    measure VARCHAR(64) NOT NULL COMMENT '已发布观测字段标识',
    aggregation VARCHAR(8) NOT NULL COMMENT '已发布聚合方式',
    description VARCHAR(300) NOT NULL COMMENT '已发布业务口径',
    published_at DATETIME(6) NOT NULL COMMENT 'UTC 发布时间',
    PRIMARY KEY (metric_id, version),
    CONSTRAINT fk_cat_metric_release FOREIGN KEY (metric_id) REFERENCES cat_metric (metric_id)
) COMMENT '不可变的指标口径发布记录';
