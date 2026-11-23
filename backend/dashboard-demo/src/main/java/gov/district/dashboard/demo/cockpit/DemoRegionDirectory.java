package gov.district.dashboard.demo.cockpit;

import gov.district.dashboard.catalog.RegionDirectory;
import gov.district.dashboard.demo.cockpit.MentougouAreaCatalog.Area;
import java.util.List;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

@Component
@Profile("demo")
final class DemoRegionDirectory implements RegionDirectory {

    @Override
    public List<String> path(String regionId) {
        return MentougouAreaCatalog.path(regionId).stream().map(Area::id).toList();
    }
}
