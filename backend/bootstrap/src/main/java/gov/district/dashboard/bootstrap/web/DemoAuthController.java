package gov.district.dashboard.bootstrap.web;

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
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Profile("demo")
class DemoAuthController {

    private final DemoIdentityService identities;
    private final HttpSessionSecurityContextRepository sessions;
    private final HttpSessionCsrfTokenRepository csrfTokens;

    DemoAuthController(DemoIdentityService identities, HttpSessionSecurityContextRepository sessions,
                       HttpSessionCsrfTokenRepository csrfTokens) {
        this.identities = identities;
        this.sessions = sessions;
        this.csrfTokens = csrfTokens;
    }

    @GetMapping("/api/v1/auth/csrf")
    ApiResult<CsrfValue> csrf(CsrfToken token) {
        return ApiResult.ok(new CsrfValue(token.getToken(), token.getHeaderName()));
    }

    @PostMapping("/api/v1/auth/demo-session")
    ApiResult<CurrentIdentity> login(@Valid @RequestBody DemoSessionRequest body,
                                     HttpServletRequest request, HttpServletResponse response) {
        CurrentIdentity identity = identities.forPersona(body.persona());
        request.getSession(true);
        request.changeSessionId();
        csrfTokens.saveToken(null, request, response);

        var authorities = identity.roles().stream().map(role -> new SimpleGrantedAuthority("ROLE_" + role)).toList();
        var authentication = UsernamePasswordAuthenticationToken.authenticated(identity, null, authorities);
        var freshContext = SecurityContextHolder.createEmptyContext();
        freshContext.setAuthentication(authentication);
        SecurityContextHolder.setContext(freshContext);
        sessions.saveContext(freshContext, request, response);
        return ApiResult.ok(identity);
    }

    @GetMapping("/api/v1/me")
    ApiResult<CurrentIdentity> currentIdentity(Authentication authentication) {
        return ApiResult.ok((CurrentIdentity) authentication.getPrincipal());
    }

    @PostMapping("/api/v1/auth/logout")
    ApiResult<Void> logout(HttpServletRequest request, HttpServletResponse response, Authentication authentication) {
        var handler = new SecurityContextLogoutHandler();
        handler.setSecurityContextRepository(sessions);
        handler.logout(request, response, authentication);
        new CookieClearingLogoutHandler("DISTRICT_SESSION").logout(request, response, authentication);
        return ApiResult.ok(null);
    }

    record CsrfValue(String token, String headerName) {
    }

    record DemoSessionRequest(@NotNull @Pattern(regexp = "district|service|data-admin") String persona) {
    }
}
