package gov.district.dashboard.bootstrap.security;

import gov.district.dashboard.bootstrap.web.ApiErrorWriter;
import gov.district.dashboard.platform.api.ApiCode;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.function.Supplier;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.boot.web.server.servlet.ConfigurableServletWebServerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.csrf.CsrfException;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.security.web.csrf.CsrfTokenRequestHandler;
import org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository;
import org.springframework.security.web.csrf.XorCsrfTokenRequestAttributeHandler;

@Configuration(proxyBeanMethods = false)
class SecurityConfiguration {

    @Bean
    HttpSessionSecurityContextRepository sessionSecurityContextRepository() {
        return new HttpSessionSecurityContextRepository();
    }

    @Bean
    HttpSessionCsrfTokenRepository sessionCsrfTokenRepository() {
        return new HttpSessionCsrfTokenRepository();
    }

    @Bean
    SecurityFilterChain applicationSecurity(HttpSecurity http, Environment environment, ApiErrorWriter errors,
                                           HttpSessionSecurityContextRepository sessions,
                                           HttpSessionCsrfTokenRepository csrfTokens) {
        boolean demoEnabled = environment.acceptsProfiles(Profiles.of("demo"));
        return http
                .authorizeHttpRequests(access -> {
                    access.requestMatchers(HttpMethod.GET, "/actuator/health").permitAll();
                    if (demoEnabled) {
                        access.requestMatchers(HttpMethod.GET, "/api/v1/auth/csrf", "/api/v1/cockpit/areas/*",
                                        "/api/v1/cockpit/topics/*/manifest", "/api/v1/cockpit/topics/*/snapshot",
                                        "/api/v1/cockpit/locations").permitAll()
                                .requestMatchers(HttpMethod.POST, "/api/v1/auth/demo-session").permitAll()
                                .requestMatchers("/api/v1/dashboard-reviews/**").hasRole("DASHBOARD_REVIEWER")
                                .requestMatchers("/api/v1/admin/**").hasRole("DATA_ADMIN")
                                .requestMatchers("/api/v1/**").authenticated();
                    }
                    access.anyRequest().denyAll();
                })
                .securityContext(context -> context.securityContextRepository(sessions))
                .csrf(csrf -> csrf.csrfTokenRepository(csrfTokens).csrfTokenRequestHandler(new HeaderCsrfTokens()))
                .logout(AbstractHttpConfigurer::disable)
                .requestCache(AbstractHttpConfigurer::disable)
                .exceptionHandling(handling -> handling
                        .authenticationEntryPoint((request, response, error) ->
                                errors.write(response, ApiCode.AUTH_REQUIRED))
                        .accessDeniedHandler((request, response, error) ->
                                errors.write(response, error instanceof CsrfException
                                        ? ApiCode.CSRF_INVALID : ApiCode.ACCESS_DENIED)))
                .build();
    }

    @Bean
    @Profile("demo")
    WebServerFactoryCustomizer<ConfigurableServletWebServerFactory> demoLoopbackOnly() throws UnknownHostException {
        InetAddress loopback = InetAddress.getByAddress(new byte[]{127, 0, 0, 1});
        return factory -> factory.setAddress(loopback);
    }

    private static final class HeaderCsrfTokens implements CsrfTokenRequestHandler {
        private final XorCsrfTokenRequestAttributeHandler masked = new XorCsrfTokenRequestAttributeHandler();

        @Override
        public void handle(HttpServletRequest request, HttpServletResponse response, Supplier<CsrfToken> token) {
            masked.handle(request, response, token);
        }

        @Override
        public String resolveCsrfTokenValue(HttpServletRequest request, CsrfToken token) {
            // The JSON API uses a header, so authentication and CSRF can run before multipart parsing.
            return request.getHeader(token.getHeaderName()) == null
                    ? null : masked.resolveCsrfTokenValue(request, token);
        }
    }
}
