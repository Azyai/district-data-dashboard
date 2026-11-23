package gov.district.dashboard.bootstrap;

import org.apache.ibatis.annotations.Mapper;
import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.security.autoconfigure.UserDetailsServiceAutoConfiguration;

@SpringBootApplication(scanBasePackages = "gov.district.dashboard", exclude = UserDetailsServiceAutoConfiguration.class)
@MapperScan(basePackages = {"gov.district.dashboard.demo", "gov.district.dashboard.catalog"}, annotationClass = Mapper.class)
public class DistrictDashboardApplication {

    public static void main(String[] args) {
        SpringApplication.run(DistrictDashboardApplication.class, args);
    }
}
