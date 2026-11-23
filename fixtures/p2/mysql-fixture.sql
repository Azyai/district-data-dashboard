CREATE DATABASE IF NOT EXISTS district_p2_fixture CHARACTER SET utf8mb4;
USE district_p2_fixture;

CREATE TABLE IF NOT EXISTS fixture_observation (
  region VARCHAR(64) NOT NULL,
  observation_date DATE NOT NULL,
  measure VARCHAR(64) NOT NULL,
  amount DECIMAL(20, 4) NOT NULL,
  denominator DECIMAL(20, 4) NULL,
  PRIMARY KEY (region, observation_date, measure)
);

INSERT IGNORE INTO fixture_observation (region, observation_date, measure, amount, denominator) VALUES
  ('mentougou','2026-11-17','cases',2690,NULL),
  ('mentougou','2026-11-18','cases',2705,NULL),
  ('mentougou','2026-11-19','cases',2722,NULL),
  ('mentougou','2026-11-20','cases',2750,NULL),
  ('mentougou','2026-11-21','cases',2781,NULL),
  ('mentougou','2026-11-22','cases',2803,NULL),
  ('mentougou','2026-11-23','cases',2836,NULL),
  ('miaofengshan','2026-11-17','cases',193,NULL),
  ('miaofengshan','2026-11-18','cases',198,NULL),
  ('miaofengshan','2026-11-19','cases',207,NULL),
  ('miaofengshan','2026-11-20','cases',211,NULL),
  ('miaofengshan','2026-11-21','cases',212,NULL),
  ('miaofengshan','2026-11-22','cases',217,NULL),
  ('miaofengshan','2026-11-23','cases',220,NULL),
  ('miaofengshan-longjiazhuang','2026-11-17','cases',63,NULL),
  ('miaofengshan-longjiazhuang','2026-11-18','cases',66,NULL),
  ('miaofengshan-longjiazhuang','2026-11-19','cases',71,NULL),
  ('miaofengshan-longjiazhuang','2026-11-20','cases',74,NULL),
  ('miaofengshan-longjiazhuang','2026-11-21','cases',73,NULL),
  ('miaofengshan-longjiazhuang','2026-11-22','cases',79,NULL),
  ('miaofengshan-longjiazhuang','2026-11-23','cases',81,NULL);

CREATE OR REPLACE VIEW v_observations AS
SELECT region, observation_date AS `date`, measure, amount AS `value`, denominator
FROM fixture_observation;
