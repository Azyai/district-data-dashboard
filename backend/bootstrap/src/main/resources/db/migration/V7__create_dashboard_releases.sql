CREATE TABLE demo_dashboard_release (
    project_id VARCHAR(64) NOT NULL COMMENT '所属演示专题标识',
    draft_revision INT NOT NULL COMMENT '提交时冻结的草稿版本',
    submitted_by VARCHAR(128) NOT NULL COMMENT '提交人账号',
    submitted_at TIMESTAMP(6) NOT NULL COMMENT '提交时间',
    review_status VARCHAR(8) NOT NULL COMMENT '待审核、通过或退回状态',
    reviewed_by VARCHAR(128) NULL COMMENT '审核人账号',
    reviewed_at TIMESTAMP(6) NULL COMMENT '审核时间',
    review_note VARCHAR(500) NULL COMMENT '审核说明',
    components_json MEDIUMTEXT NOT NULL COMMENT '按草稿顺序保留的不可变组件和画布位置',
    PRIMARY KEY (project_id, draft_revision),
    CONSTRAINT fk_demo_dashboard_release_draft
        FOREIGN KEY (project_id) REFERENCES demo_dashboard_draft (project_id),
    CONSTRAINT chk_demo_dashboard_release_revision CHECK (draft_revision > 0),
    CONSTRAINT chk_demo_dashboard_release_status CHECK (
        CASE review_status
            WHEN 'PENDING' THEN reviewed_by IS NULL AND reviewed_at IS NULL AND review_note IS NULL
            WHEN 'APPROVED' THEN reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL
            WHEN 'RETURNED' THEN reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL
            ELSE FALSE
        END = TRUE
    ),
    CONSTRAINT chk_demo_dashboard_release_size CHECK (CHAR_LENGTH(components_json) <= 65536)
) COMMENT '演示专题发布快照及审核结论';

CREATE TABLE demo_dashboard_live (
    project_id VARCHAR(64) NOT NULL COMMENT '所属演示专题标识',
    draft_revision INT NULL COMMENT '当前播放版本，空值表示默认模板',
    activation_serial BIGINT NOT NULL COMMENT '累计切换序号',
    activated_by VARCHAR(128) NOT NULL COMMENT '最近一次切换操作人',
    activated_at TIMESTAMP(6) NOT NULL COMMENT '最近一次切换时间',
    PRIMARY KEY (project_id),
    CONSTRAINT fk_demo_dashboard_live_draft
        FOREIGN KEY (project_id) REFERENCES demo_dashboard_draft (project_id),
    CONSTRAINT fk_demo_dashboard_live_release
        FOREIGN KEY (project_id, draft_revision) REFERENCES demo_dashboard_release (project_id, draft_revision),
    CONSTRAINT chk_demo_dashboard_live_serial CHECK (activation_serial > 0)
) COMMENT '演示专题当前播放指针';

CREATE TABLE demo_dashboard_activation (
    project_id VARCHAR(64) NOT NULL COMMENT '所属演示专题标识',
    draft_revision INT NULL COMMENT '切换后的播放版本，空值表示默认模板',
    activation_serial BIGINT NOT NULL COMMENT '切换序号',
    activated_by VARCHAR(128) NOT NULL COMMENT '切换操作人',
    activated_at TIMESTAMP(6) NOT NULL COMMENT '切换时间',
    activation_note VARCHAR(500) NULL COMMENT '切换或回退说明',
    PRIMARY KEY (project_id, activation_serial),
    CONSTRAINT fk_demo_dashboard_activation_draft
        FOREIGN KEY (project_id) REFERENCES demo_dashboard_draft (project_id),
    CONSTRAINT fk_demo_dashboard_activation_release
        FOREIGN KEY (project_id, draft_revision) REFERENCES demo_dashboard_release (project_id, draft_revision),
    CONSTRAINT chk_demo_dashboard_activation_serial CHECK (activation_serial > 0)
) COMMENT '演示专题追加式播放切换记录';
