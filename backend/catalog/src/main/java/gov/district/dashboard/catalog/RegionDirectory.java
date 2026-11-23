package gov.district.dashboard.catalog;

import java.util.List;

public interface RegionDirectory {

    /** Returns the root-to-region path, or an empty list for an unregistered region. */
    List<String> path(String regionId);
}
