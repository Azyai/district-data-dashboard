package gov.district.dashboard.bootstrap.security;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.core.context.DeferredSecurityContext;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.web.context.HttpRequestResponseHolder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.security.web.csrf.CsrfTokenRepository;
import org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository;

public final class WorkspaceSecurity implements SecurityContextRepository, CsrfTokenRepository {

    public static final String WORKSPACE_HEADER = "X-Dashboard-Workspace";

    private final HttpSessionSecurityContextRepository displaySessions = new HttpSessionSecurityContextRepository();
    private final HttpSessionSecurityContextRepository managementSessions = new HttpSessionSecurityContextRepository();
    private final HttpSessionCsrfTokenRepository displayTokens = new HttpSessionCsrfTokenRepository();
    private final HttpSessionCsrfTokenRepository managementTokens = new HttpSessionCsrfTokenRepository();

    public WorkspaceSecurity() {
        managementSessions.setSpringSecurityContextKey("DISTRICT_MANAGEMENT_SECURITY_CONTEXT");
        managementTokens.setSessionAttributeName("DISTRICT_MANAGEMENT_CSRF_TOKEN");
    }

    private static boolean management(HttpServletRequest request) {
        return "management".equals(request.getHeader(WORKSPACE_HEADER));
    }

    private HttpSessionSecurityContextRepository sessions(HttpServletRequest request) {
        return management(request) ? managementSessions : displaySessions;
    }

    private HttpSessionCsrfTokenRepository tokens(HttpServletRequest request) {
        return management(request) ? managementTokens : displayTokens;
    }

    public boolean containsOtherContext(HttpServletRequest request) {
        var other = management(request) ? displaySessions : managementSessions;
        return other.containsContext(request);
    }

    @Override
    @SuppressWarnings("deprecation")
    public SecurityContext loadContext(HttpRequestResponseHolder holder) {
        return sessions(holder.getRequest()).loadContext(holder);
    }

    @Override
    public DeferredSecurityContext loadDeferredContext(HttpServletRequest request) {
        return sessions(request).loadDeferredContext(request);
    }

    @Override
    public void saveContext(SecurityContext context, HttpServletRequest request, HttpServletResponse response) {
        sessions(request).saveContext(context, request, response);
    }

    @Override
    public boolean containsContext(HttpServletRequest request) {
        return sessions(request).containsContext(request);
    }

    @Override
    public CsrfToken generateToken(HttpServletRequest request) {
        return tokens(request).generateToken(request);
    }

    @Override
    public void saveToken(CsrfToken token, HttpServletRequest request, HttpServletResponse response) {
        tokens(request).saveToken(token, request, response);
    }

    @Override
    public CsrfToken loadToken(HttpServletRequest request) {
        return tokens(request).loadToken(request);
    }
}
