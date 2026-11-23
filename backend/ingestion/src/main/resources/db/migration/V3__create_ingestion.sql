CREATE TABLE src_source (
    id VARCHAR(64) NOT NULL COMMENT '来源标识',
    current_version INT NOT NULL COMMENT '当前配置版本',
    created_at TIMESTAMP(3) NOT NULL COMMENT '登记时间',
    updated_at TIMESTAMP(3) NOT NULL COMMENT '配置更新时间',
    next_due_at TIMESTAMP(3) NULL COMMENT '下次调度时间，空为手动模式',
    active_run_id VARCHAR(36) NULL COMMENT '持有租约的运行标识',
    lease_until TIMESTAMP(3) NULL COMMENT '运行租约截止时间',
    last_run_id VARCHAR(36) NULL COMMENT '最近一次运行标识',
    last_success_batch_id VARCHAR(36) NULL COMMENT '当前可读成功批次',
    consecutive_failures INT NOT NULL DEFAULT 0 COMMENT '连续同步失败次数',
    PRIMARY KEY (id),
    INDEX ix_src_source_due (next_due_at),
    INDEX ix_src_source_lease (lease_until)
) COMMENT '来源登记、同步租约与成功批次指针';

CREATE TABLE src_revision (
    source_id VARCHAR(64) NOT NULL COMMENT '来源标识',
    version_no INT NOT NULL COMMENT '配置版本',
    definition TEXT NOT NULL COMMENT '配置和字段映射 JSON，仅含连接引用',
    created_at TIMESTAMP(3) NOT NULL COMMENT '版本创建时间',
    PRIMARY KEY (source_id, version_no),
    CONSTRAINT fk_src_revision_source FOREIGN KEY (source_id) REFERENCES src_source (id)
) COMMENT '来源不可变配置历史';

CREATE TABLE src_asset (
    id VARCHAR(36) NOT NULL COMMENT '上传资产标识',
    file_name VARCHAR(160) NOT NULL COMMENT '已净化的文件显示名称',
    size_bytes BIGINT NOT NULL COMMENT '资产字节数',
    contents LONGBLOB NOT NULL COMMENT '有界 UTF-8 CSV 原始内容',
    created_at TIMESTAMP(3) NOT NULL COMMENT '资产上传时间',
    PRIMARY KEY (id)
) COMMENT '受控 CSV 上传资产';

CREATE TABLE src_batch (
    id VARCHAR(36) NOT NULL COMMENT '成功批次标识',
    source_id VARCHAR(64) NOT NULL COMMENT '来源标识',
    source_version INT NOT NULL COMMENT '本批首次成功的来源版本',
    fingerprint CHAR(64) NOT NULL COMMENT '规范行内容 SHA-256',
    synced_at TIMESTAMP(3) NOT NULL COMMENT '该内容首次同步成功时间',
    PRIMARY KEY (id),
    CONSTRAINT uk_src_batch_fingerprint UNIQUE (source_id, fingerprint),
    CONSTRAINT fk_src_batch_revision FOREIGN KEY (source_id, source_version)
        REFERENCES src_revision (source_id, version_no)
) COMMENT '经质量校验的规范化数据批次';

CREATE TABLE src_observation (
    batch_id VARCHAR(36) NOT NULL COMMENT '成功批次标识',
    region_id VARCHAR(64) NOT NULL COMMENT '规范区域标识',
    observed_on DATE NOT NULL COMMENT '业务观测日期',
    measure VARCHAR(64) NOT NULL COMMENT '规范度量标识',
    metric_value DECIMAL(24, 6) NOT NULL COMMENT '度量值或分子',
    denominator DECIMAL(24, 6) NULL COMMENT '可选分母',
    PRIMARY KEY (batch_id, region_id, observed_on, measure),
    CONSTRAINT fk_src_observation_batch FOREIGN KEY (batch_id) REFERENCES src_batch (id)
) COMMENT '受控数据集规范观测行';

CREATE TABLE src_run (
    id VARCHAR(36) NOT NULL COMMENT '同步运行标识',
    source_id VARCHAR(64) NOT NULL COMMENT '来源标识',
    source_version INT NOT NULL COMMENT '此次运行使用的配置版本',
    status VARCHAR(16) NOT NULL COMMENT '运行状态',
    trigger_type VARCHAR(16) NOT NULL COMMENT '触发方式',
    retry_of VARCHAR(36) NULL COMMENT '重试关联的原运行',
    request_key_hash CHAR(64) NULL COMMENT '幂等键摘要',
    batch_id VARCHAR(36) NULL COMMENT '成功数据批次',
    started_at TIMESTAMP(3) NOT NULL COMMENT '开始时间',
    finished_at TIMESTAMP(3) NULL COMMENT '完成时间',
    rows_read INT NOT NULL COMMENT '读取行数',
    rows_accepted INT NOT NULL COMMENT '规范校验通过行数',
    rows_rejected INT NOT NULL COMMENT '规范校验拒绝行数',
    message VARCHAR(600) NOT NULL COMMENT '安全诊断文本',
    PRIMARY KEY (id),
    CONSTRAINT uk_src_run_request UNIQUE (source_id, request_key_hash),
    CONSTRAINT fk_src_run_revision FOREIGN KEY (source_id, source_version)
        REFERENCES src_revision (source_id, version_no),
    CONSTRAINT fk_src_run_batch FOREIGN KEY (batch_id) REFERENCES src_batch (id),
    INDEX ix_src_run_history (source_id, started_at, id)
) COMMENT '来源同步运行历史';
