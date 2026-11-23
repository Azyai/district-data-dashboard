package gov.district.dashboard.platform.api;

public record ApiResult<T>(String code, String message, T data) {

    public static <T> ApiResult<T> ok(T data) {
        return new ApiResult<>(ApiCode.OK.code(), ApiCode.OK.message(), data);
    }

    public static ApiResult<Void> error(ApiCode code) {
        return new ApiResult<>(code.code(), code.message(), null);
    }
}
