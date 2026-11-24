CREATE TABLE hotline_field_metadata (
    source_table VARCHAR(32) NOT NULL,
    column_position SMALLINT NOT NULL,
    column_name VARCHAR(32) NOT NULL,
    sql_type VARCHAR(24) NOT NULL,
    field_description VARCHAR(240) NOT NULL,
    is_nullable BOOLEAN NOT NULL,
    key_role VARCHAR(12) NOT NULL,
    reference_table VARCHAR(32),
    reference_column VARCHAR(32),
    allowed_values VARCHAR(120),
    PRIMARY KEY (source_table, column_name),
    UNIQUE (source_table, column_position)
);

INSERT INTO hotline_field_metadata (
    source_table, column_position, column_name, sql_type, field_description,
    is_nullable, key_role, reference_table, reference_column, allowed_values
) VALUES
('hotline_ticket', 1, 'ticket_id', 'VARCHAR(24)', '工单唯一标识。演示编号形如 HL-202610-00001。', FALSE, 'primary', NULL, NULL, NULL),
('hotline_ticket', 2, 'month_start', 'DATE', '工单所属的统计月份，保存该月第一天。适合按月汇总。', FALSE, 'foreign', 'hotline_snapshot', 'month_start', NULL),
('hotline_ticket', 3, 'area_id', 'VARCHAR(64)', '工单归属的村社标识。用于村社粒度的过滤和汇总。', FALSE, 'foreign', 'hotline_area', 'area_id', NULL),
('hotline_ticket', 4, 'town_id', 'VARCHAR(64)', '工单所属镇街标识。用于镇街粒度的过滤和汇总。', FALSE, 'foreign', 'hotline_area', 'area_id', NULL),
('hotline_ticket', 5, 'category_id', 'VARCHAR(24)', '工单诉求类别，名称可通过诉求类别表取得。', FALSE, 'foreign', 'hotline_category', 'category_id', 'property,utilities,sanitation,traffic,other'),
('hotline_ticket', 6, 'ticket_status', 'VARCHAR(12)', '办理状态，分别表示待派单、办理中、已办结。', FALSE, 'none', NULL, NULL, 'pending,processing,closed'),
('hotline_ticket', 7, 'attention_lane', 'VARCHAR(12)', '按工单状态和统计月阈值划分为正常待办、临期、逾期、已办结。', FALSE, 'none', NULL, NULL, 'open,due,late,closed'),
('hotline_ticket', 8, 'title', 'VARCHAR(100)', '诉求事项标题。演示数据为合成事项，无个人信息。', FALSE, 'none', NULL, NULL, NULL),
('hotline_ticket', 9, 'opened_on', 'DATE', '登记受理日期。', FALSE, 'none', NULL, NULL, NULL),
('hotline_ticket', 10, 'assigned_on', 'DATE', '派单日期，尚未派单时为空。', TRUE, 'none', NULL, NULL, NULL),
('hotline_ticket', 11, 'processed_on', 'DATE', '开始办理日期，尚未开始办理时为空。', TRUE, 'none', NULL, NULL, NULL),
('hotline_ticket', 12, 'closed_on', 'DATE', '反馈并办结的日期，尚未办结时为空。', TRUE, 'none', NULL, NULL, NULL),
('hotline_ticket', 13, 'elapsed_days', 'SMALLINT', '已办结工单从受理到办结的天数。未办结工单从受理到统计日的天数。', FALSE, 'none', NULL, NULL, NULL),
('hotline_ticket', 14, 'note', 'VARCHAR(240)', '工单最新办理进展，演示数据由场景模板合成。', FALSE, 'none', NULL, NULL, NULL),
('hotline_area', 1, 'area_id', 'VARCHAR(64)', '区、镇街或村社的统一标识。', FALSE, 'primary', NULL, NULL, NULL),
('hotline_area', 2, 'area_name', 'VARCHAR(80)', '区域展示名称。', FALSE, 'none', NULL, NULL, NULL),
('hotline_area', 3, 'area_level', 'VARCHAR(12)', '区域级别，分别表示区、镇街、村社。', FALSE, 'none', NULL, NULL, 'district,town,village'),
('hotline_area', 4, 'parent_id', 'VARCHAR(64)', '上级区域标识。区级根节点为空。', TRUE, 'foreign', 'hotline_area', 'area_id', NULL),
('hotline_category', 1, 'category_id', 'VARCHAR(24)', '诉求类别统一标识。', FALSE, 'primary', NULL, NULL, 'property,utilities,sanitation,traffic,other'),
('hotline_category', 2, 'category_name', 'VARCHAR(40)', '诉求类别中文名称。', FALSE, 'none', NULL, NULL, NULL),
('hotline_snapshot', 1, 'month_start', 'DATE', '统计月份的第一天，每月一条快照定义。', FALSE, 'primary', NULL, NULL, NULL),
('hotline_snapshot', 2, 'snapshot_on', 'DATE', '统计截止日期，用于计算未办结工单办理时长。', FALSE, 'none', NULL, NULL, NULL),
('hotline_snapshot', 3, 'quality', 'VARCHAR(16)', '数据质量标识，SIMULATED 表示合成演示数据。', FALSE, 'none', NULL, NULL, 'SIMULATED'),
('hotline_snapshot', 4, 'due_days', 'SMALLINT', '正常待办进入临期的最小天数，演示值为 3。', FALSE, 'none', NULL, NULL, NULL),
('hotline_snapshot', 5, 'late_days', 'SMALLINT', '进入逾期的最小天数，演示值为 7。', FALSE, 'none', NULL, NULL, NULL);
