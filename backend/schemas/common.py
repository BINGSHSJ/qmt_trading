from typing import Generic, TypeVar

from pydantic import BaseModel, Field


T = TypeVar("T")


class PageQuery(BaseModel):
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=200)
    sort_field: str = "created_at"
    sort_order: str = "desc"
    keyword: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    status: str | None = None


class PageResult(BaseModel, Generic[T]):
    items: list[T]
    page: int
    page_size: int
    total: int
    has_more: bool
