from datetime import datetime
from typing import Generic, TypeVar
from uuid import uuid4

from pydantic import BaseModel


T = TypeVar("T")


class ApiError(BaseModel):
    code: str
    detail: str | None = None
    suggestion: str | None = None


class ApiResponse(BaseModel, Generic[T]):
    success: bool
    message: str
    data: T | None = None
    error: ApiError | None = None
    trace_id: str


def build_trace_id() -> str:
    return f"{datetime.now():%Y%m%d}-{uuid4().hex[:8]}"


def success_response(data: T, message: str = "操作成功") -> ApiResponse[T]:
    return ApiResponse(success=True, message=message, data=data, error=None, trace_id=build_trace_id())


def error_response(
    message: str,
    code: str,
    detail: str | None = None,
    suggestion: str | None = None,
    trace_id: str | None = None,
) -> ApiResponse[None]:
    return ApiResponse(
        success=False,
        message=message,
        data=None,
        error=ApiError(code=code, detail=detail, suggestion=suggestion),
        trace_id=trace_id or build_trace_id(),
    )
