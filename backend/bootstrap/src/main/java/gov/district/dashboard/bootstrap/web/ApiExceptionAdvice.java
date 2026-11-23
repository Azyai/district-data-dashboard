package gov.district.dashboard.bootstrap.web;

import gov.district.dashboard.platform.api.ApiCode;
import gov.district.dashboard.platform.api.ApiFailure;
import gov.district.dashboard.platform.api.ApiResult;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MultipartException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

@RestControllerAdvice
class ApiExceptionAdvice {

    private static final Logger LOG = LoggerFactory.getLogger(ApiExceptionAdvice.class);

    @ExceptionHandler(ApiFailure.class)
    ResponseEntity<ApiResult<Void>> identifiedError(ApiFailure failure) {
        ApiCode code = failure.code();
        if (code == ApiCode.INTERNAL_ERROR) {
            LOG.error("Request failed due to a dashboard data integrity error");
        }
        return response(code);
    }

    @ExceptionHandler({HttpMessageNotReadableException.class, MethodArgumentNotValidException.class,
            HttpMediaTypeNotSupportedException.class, MultipartException.class, MissingServletRequestPartException.class})
    ResponseEntity<ApiResult<Void>> invalidRequest() {
        return response(ApiCode.INVALID_REQUEST);
    }

    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<ApiResult<Void>> endpointNotFound() {
        return response(ApiCode.NOT_FOUND);
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiResult<Void>> unexpectedError(Exception error) {
        LOG.error("Unhandled API exception of type {}", error.getClass().getName());
        return response(ApiCode.INTERNAL_ERROR);
    }

    private ResponseEntity<ApiResult<Void>> response(ApiCode code) {
        return ResponseEntity.status(code.httpStatus()).body(ApiResult.error(code));
    }
}
