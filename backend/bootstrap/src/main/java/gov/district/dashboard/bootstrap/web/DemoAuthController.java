package gov.district.dashboard.bootstrap.web;

import gov.district.dashboard.bootstrap.security.WorkspaceSecurity;
import gov.district.dashboard.demo.DemoIdentityService;
import gov.district.dashboard.demo.DemoIdentityService.CurrentIdentity;
import gov.district.dashboard.platform.api.ApiResult;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import org.springframework.context.annotation.Profile;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.logout.CookieClearingLogoutHandler;
import org.springframework.security.web.authentication.logout.SecurityContextLogoutHandler;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.util.WebUtils;

@RestController
@Profile("demo")
class DemoAuthController {

    private final DemoIdentityService identities;
    private final WorkspaceSecurity workspace;

    DemoAuthController(DemoIdentityService identities, WorkspaceSecurity workspace) {
        this.identities = identities;
        this.workspace = workspace;
    }

    @GetMapping("/api/v1/auth/csrf")
    ApiResult<CsrfValue> csrf(CsrfToken token) {
        return ApiResult.ok(new CsrfValue(token.getToken(), token.getHeaderName()));
    }

    @PostMapping("/api/v1/auth/demo-session")
    ApiResult<CurrentIdentity> login(@Valid @RequestBody DemoSessionRequest body,
                                     HttpServletRequest request, HttpServletResponse response) {
        CurrentIdentity identity = identities.forPersona(body.persona());
        var authorities = identity.roles().stream().map(role -> new SimpleGrantedAuthority("ROLE_" + role)).toList();
        var authentication = UsernamePasswordAuthenticationToken.authenticated(identity, null, authorities);
        var freshContext = SecurityContextHolder.createEmptyContext();
        freshContext.setAuthentication(authentication);
        var session = request.getSession(true);
        synchronized (WebUtils.getSessionMutex(session)) {
            // A concurrent login may have already rotated the ID for this same browser session.
            if (session.getId().equals(request.getRequestedSessionId())) {
                request.changeSessionId();
            }
            workspace.saveToken(null, request, response);
            SecurityContextHolder.setContext(freshContext);
            workspace.saveContext(freshContext, request, response);
        }
        return ApiResult.ok(identity);
    }

    @GetMapping("/api/v1/me")
    ApiResult<CurrentIdentity> currentIdentity(Authentication authentication) {
        return ApiResult.ok((CurrentIdentity) authentication.getPrincipal());
    }

    @PostMapping("/api/v1/auth/logout")
    ApiResult<Void> logout(HttpServletRequest request, HttpServletResponse response, Authentication authentication) {
        var session = request.getSession(false);
        if (session != null) {
            synchronized (WebUtils.getSessionMutex(session)) {
                boolean keepSession = workspace.containsOtherContext(request);
                var handler = new SecurityContextLogoutHandler();
                handler.setSecurityContextRepository(workspace);
                handler.setInvalidateHttpSession(!keepSession);
                handler.logout(request, response, authentication);
                if (keepSession) {
                    workspace.saveToken(null, request, response);
                } else {
                    new CookieClearingLogoutHandler("DISTRICT_SESSION").logout(request, response, authentication);
                }
            }
        }
        return ApiResult.ok(null);
    }

    record CsrfValue(String token, String headerName) {
    }

    record DemoSessionRequest(@NotNull @Pattern(regexp = "district|service|data-admin|reviewer") String persona) {
    }
}
