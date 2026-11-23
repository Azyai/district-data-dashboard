package gov.district.dashboard.platform.api;

public final class ApiFailure extends RuntimeException {

    private final ApiCode code;

    public ApiFailure(ApiCode code) {
        super(code.code());
        this.code = code;
    }

    public ApiCode code() {
        return code;
    }
}
