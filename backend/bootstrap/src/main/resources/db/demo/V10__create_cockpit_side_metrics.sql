CREATE TABLE demo_cockpit_side_metrics (
    layout_id SMALLINT NOT NULL PRIMARY KEY,
    revision BIGINT NOT NULL,
    left_metrics VARCHAR(194) NOT NULL,
    right_metrics VARCHAR(194) NOT NULL
);

INSERT INTO demo_cockpit_side_metrics (layout_id, revision, left_metrics, right_metrics)
VALUES (1, 1, 'governance-events,service-cases', 'air-quality-rate,road-traffic');
