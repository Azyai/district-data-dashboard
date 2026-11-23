package gov.district.dashboard.demo;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.math.BigDecimal;

@TableName("dash_snapshot_observation")
record DemoObservation(@TableId Long observationId, String snapshotId, String metricId,
                       Integer pointNo, String pointLabel, BigDecimal metricValue) {
}
