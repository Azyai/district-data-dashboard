CREATE TABLE hotline_area (
    area_id VARCHAR(64) PRIMARY KEY,
    area_name VARCHAR(80) NOT NULL,
    area_level VARCHAR(12) NOT NULL,
    parent_id VARCHAR(64),
    FOREIGN KEY (parent_id) REFERENCES hotline_area (area_id)
);

CREATE INDEX ix_hotline_area_parent ON hotline_area (parent_id);

CREATE TABLE hotline_category (
    category_id VARCHAR(24) PRIMARY KEY,
    category_name VARCHAR(40) NOT NULL
);

INSERT INTO hotline_category (category_id, category_name) VALUES
('property', '物业与居住'),
('utilities', '供水供电供暖'),
('sanitation', '环境卫生'),
('traffic', '交通出行'),
('other', '其他');

CREATE TABLE hotline_snapshot (
    month_start DATE PRIMARY KEY,
    snapshot_on DATE NOT NULL,
    quality VARCHAR(16) NOT NULL,
    due_days SMALLINT NOT NULL,
    late_days SMALLINT NOT NULL,
    CHECK (due_days > 0 AND late_days > due_days)
);

CREATE TABLE hotline_ticket (
    ticket_id VARCHAR(24) PRIMARY KEY,
    month_start DATE NOT NULL,
    area_id VARCHAR(64) NOT NULL,
    town_id VARCHAR(64) NOT NULL,
    category_id VARCHAR(24) NOT NULL,
    ticket_status VARCHAR(12) NOT NULL,
    attention_lane VARCHAR(12) NOT NULL,
    title VARCHAR(100) NOT NULL,
    opened_on DATE NOT NULL,
    assigned_on DATE,
    processed_on DATE,
    closed_on DATE,
    elapsed_days SMALLINT NOT NULL,
    note VARCHAR(240) NOT NULL,
    FOREIGN KEY (month_start) REFERENCES hotline_snapshot (month_start),
    FOREIGN KEY (area_id) REFERENCES hotline_area (area_id),
    FOREIGN KEY (town_id) REFERENCES hotline_area (area_id),
    FOREIGN KEY (category_id) REFERENCES hotline_category (category_id),
    CHECK (ticket_status IN ('pending', 'processing', 'closed')),
    CHECK (attention_lane IN ('open', 'due', 'late', 'closed')),
    CHECK (elapsed_days >= 0)
);

CREATE INDEX ix_hotline_ticket_month_lane ON hotline_ticket (month_start, attention_lane, opened_on, ticket_id);
CREATE INDEX ix_hotline_ticket_town_month ON hotline_ticket (town_id, month_start, attention_lane);
CREATE INDEX ix_hotline_ticket_area_month ON hotline_ticket (area_id, month_start, attention_lane);

CREATE TABLE hotline_semantic (
    metric_id VARCHAR(32) PRIMARY KEY,
    metric_label VARCHAR(40) NOT NULL,
    metric_description VARCHAR(240) NOT NULL,
    unit VARCHAR(12) NOT NULL,
    supported_dimensions VARCHAR(100) NOT NULL
);

INSERT INTO hotline_semantic (metric_id, metric_label, metric_description, unit, supported_dimensions) VALUES
('received', '受理量', '所选月份和区域内的受理工单数。', '件', 'month,area,category'),
('assigned', '已派单量', '已有派单日期的工单数，包含已办结工单。', '件', 'month,area'),
('closed', '办结量', '状态为已办结的工单数。', '件', 'month,area'),
('open', '正常待办量', '统计日尚未办结，且办理时长短于临期阈值的工单数。', '件', 'month,area'),
('due', '临期量', '统计日尚未办结，且办理时长达到临期、未达到逾期阈值的工单数。', '件', 'month,area'),
('late', '逾期量', '统计日尚未办结，且办理时长达到逾期阈值的工单数。演示口径。', '件', 'month,area'),
('unassigned', '待派单量', '状态为待派单的工单数。', '件', 'month,area'),
('processing', '办理中工单量', '状态为办理中的工单数。', '件', 'month,area'),
('closedRate', '办结率', '所选区域与月份的办结量除以受理量，分母为零时显示零。', '%', 'month,area'),
('receivedMoM', '受理量环比变化', '本月受理量相对上月受理量的百分比变化。首期或上月受理量为零时缺失。', '%', 'month,area');
