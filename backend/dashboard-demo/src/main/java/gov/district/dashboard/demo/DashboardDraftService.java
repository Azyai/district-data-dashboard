package gov.district.dashboard.demo;

import gov.district.dashboard.demo.DashboardDraftMapper.DraftRow;
import gov.district.dashboard.demo.DemoPlaybackService.BatchQueryResult;
import gov.district.dashboard.demo.DemoPlaybackService.Canvas;
import gov.district.dashboard.demo.DemoPlaybackService.Component;
import gov.district.dashboard.demo.DemoPlaybackService.Geometry;
import gov.district.dashboard.demo.DemoPlaybackService.Manifest;
import gov.district.dashboard.platform.api.ApiCode;
import gov.district.dashboard.platform.api.ApiFailure;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import org.springframework.context.annotation.Profile;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Profile("demo")
public class DashboardDraftService {

    public static final int MAX_COMPONENTS = 20;
    private static final int MIN_WIDTH = 160;
    private static final int MIN_HEIGHT = 120;
    private static final int MAX_LAYER = 1000;
    private static final Pattern ID = Pattern.compile("[a-z][a-z0-9-]{0,63}");

    private final DashboardDraftMapper mapper;
    private final DemoPlaybackService playback;

    DashboardDraftService(DashboardDraftMapper mapper, DemoPlaybackService playback) {
        this.mapper = mapper;
        this.playback = playback;
    }

    public Workspace read(String projectId) {
        Manifest template = DemoPlaybackService.draftTemplate(projectId);
        List<DraftRow> rows = mapper.find(projectId);
        int revision = rows.isEmpty() ? 0 : rows.getFirst().revision();
        List<Component> components = rows.isEmpty() ? template.components() : rows.stream()
                .filter(row -> row.componentId() != null)
                .map(DraftRow::component)
                .toList();
        return new Workspace(template, playback.draftSnapshot(projectId), revision, components);
    }

    @Transactional
    public SavedDraft save(String projectId, int revision, List<Component> components) {
        List<Component> layout = validatedLayout(DemoPlaybackService.draftTemplate(projectId), components);
        if (revision == 0) {
            try {
                mapper.create(projectId);
            } catch (DuplicateKeyException existingDraft) {
                throw new ApiFailure(ApiCode.VERSION_CONFLICT);
            }
        } else {
            if (revision == Integer.MAX_VALUE || mapper.advance(projectId, revision) != 1) {
                throw new ApiFailure(ApiCode.VERSION_CONFLICT);
            }
            mapper.clearComponents(projectId);
        }
        if (!layout.isEmpty()) {
            mapper.insertComponents(projectId, layout);
        }
        return new SavedDraft(revision + 1, layout);
    }

    static List<Component> validatedLayout(Manifest template, List<Component> components) {
        if (components.size() > MAX_COMPONENTS) {
            throw invalid();
        }
        Map<String, Component> material = template.components().stream()
                .collect(Collectors.toMap(Component::metricId, Function.identity()));
        var ids = new HashSet<String>();
        var layout = new ArrayList<Component>(components.size());
        for (Component component : components) {
            Component approved = material.get(component.metricId());
            String title = component.title().strip();
            if (!ID.matcher(component.id()).matches() || !ids.add(component.id())
                    || title.isEmpty() || title.codePointCount(0, title.length()) > 100
                    || approved == null || !approved.type().equals(component.type())
                    || !approved.unit().equals(component.unit())
                    || !fits(component.geometry(), template.canvas())) {
                throw invalid();
            }
            layout.add(new Component(component.id(), title, approved.type(), approved.metricId(), approved.unit(),
                    component.geometry()));
        }
        return List.copyOf(layout);
    }

    private static boolean fits(Geometry geometry, Canvas canvas) {
        return geometry.width() >= MIN_WIDTH && geometry.height() >= MIN_HEIGHT
                && geometry.x() >= 0 && geometry.y() >= 0
                && geometry.x() <= canvas.width() - geometry.width()
                && geometry.y() <= canvas.height() - geometry.height()
                && geometry.z() >= 0 && geometry.z() <= MAX_LAYER;
    }

    private static ApiFailure invalid() {
        return new ApiFailure(ApiCode.INVALID_REQUEST);
    }

    public record Workspace(Manifest template, BatchQueryResult snapshot, int revision, List<Component> components) {
    }

    public record SavedDraft(int revision, List<Component> components) {
    }
}
